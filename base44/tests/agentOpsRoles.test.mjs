import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

// Exercise the production integration source with actual shared helpers. Only
// SDK entities/connectors are fake; no live account, text or business writes.
const original = await readFile(new URL('../shared/agentOpsRoles.js', import.meta.url), 'utf8');
const source = original
  .replace("'./pagination.ts'", JSON.stringify(new URL('../shared/pagination.ts', import.meta.url).href))
  .replace("'./billingCore.js'", JSON.stringify(new URL('../shared/billingCore.js', import.meta.url).href));
const { SECTION_LEADS, reconcileLead, checkConnector, executeDailyRuns } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const NOW = '2026-09-13T01:00:00.000Z'; // September 12, 7 PM in Denver.
const lead = id => SECTION_LEADS.find(row => row.id === id);
const freshSource = () => ({ available: true, complete: true, checked_at: NOW, range_start: '2026-06-14', range_end: '2026-12-11' });
const freshRun = () => ({ id: 'knowledge-1', status: 'complete', completed_at: NOW, counts: { jobs: 750, unassigned_records: 2 }, issues: [], source_status: Object.fromEntries(['live_google', 'outlook_installation', 'outlook_service', 'sales_tracker', 'live_probuild', 'probuild_library', 'documents'].map(key => [key, freshSource()])) });

function fixture({ events = [], reports = [], run = freshRun(), quotes = [], auth = [{ refresh_token: 'PRIVATE-REFRESH-TOKEN' }] } = {}) {
  const reads = [], writes = [], saved = new Map();
  let id = 0;
  const listEntity = (name, values) => ({ list: async (sort, limit, skip = 0) => { reads.push({ name, sort, limit, skip }); return values.slice(skip, skip + limit); } });
  const writeEntity = name => ({
    create: async data => { const row = { id: name + '-' + (++id), ...data }; writes.push({ name, op: 'create', data }); saved.set(row.id, row); return row; },
    update: async (key, data) => { writes.push({ name, op: 'update', data }); const row = { ...saved.get(key), id: key, ...data }; saved.set(key, row); return row; },
  });
  const ctx = {
    now: NOW,
    entities: {
      CalendarEvents: listEntity('CalendarEvents', events),
      FieldReports: listEntity('FieldReports', reports),
      QuoteRequests: listEntity('QuoteRequests', quotes),
      ProbuildAuth: listEntity('ProbuildAuth', auth),
      JobKnowledgeRun: { filter: async (query, sort, limit) => { reads.push({ name: 'JobKnowledgeRun', query, sort, limit }); return run ? [run] : []; } },
      AgentOpsConfig: { ...writeEntity('AgentOpsConfig'), filter: async () => [{ id: 'config', autonomous_enabled: true, paused: false, lead_enablement: Object.fromEntries(SECTION_LEADS.map(l => [l.id, true])) }] },
      AgentDailyRun: writeEntity('AgentDailyRun'),
      AgentCenterEscalation: writeEntity('AgentCenterEscalation'),
    },
    connectors: { getConnection: async kind => ({ accessToken: 'PRIVATE-' + kind }) },
    secrets: { get: async key => key === 'WINDOW_QUOTES_SUPERAGENT_API_KEY' ? 'PRIVATE-QUOTE-KEY' : undefined },
  };
  return { ctx, reads, writes };
}

test('calendar lead finds older report gaps beyond the first 1000 future rows', async () => {
  const events = Array.from({ length: 1000 }, (_, i) => ({ id: 'future-' + i, event_date: '2026-09-14', report_status: 'pending' }));
  events.push({ id: 'past-missing', event_date: '2026-09-11', report_status: 'missing_all', days_late: 3 });
  const { ctx, reads, writes } = fixture({ events });
  const result = await reconcileLead(lead('calendar_ops_lead'), ctx);
  assert.match(result.summary, /all 1001 stored calendar rows; 1 past\/current required events/);
  assert(result.exceptions.some(value => /1 calendar events.*past the grace/.test(value)));
  assert.deepEqual(reads.filter(r => r.name === 'CalendarEvents').map(r => r.skip), [0, 1000]);
  assert.equal(writes.length, 0);
});

test('field lead reads reports to exhaustion instead of reporting a sampled count', async () => {
  const reports = Array.from({ length: 2101 }, (_, i) => ({ id: 'report-' + i }));
  const { ctx, reads } = fixture({ reports });
  const result = await reconcileLead(lead('field_reporting_lead'), ctx);
  assert.match(result.summary, /all 2101 stored field reports/);
  assert.deepEqual(reads.filter(r => r.name === 'FieldReports').map(r => r.skip), [0, 1000, 2000]);
  assert.equal(result.exceptions.length, 0);
});

test('a full final cap page fails closed and never reports complete calendar counts', async () => {
  const { ctx, reads } = fixture();
  ctx.entities.CalendarEvents.list = async (sort, limit, skip) => { reads.push({ name: 'cap', skip }); return Array.from({ length: limit }, (_, i) => ({ id: skip + i, event_date: '2026-09-11' })); };
  const result = await reconcileLead(lead('calendar_ops_lead'), ctx);
  assert.equal(reads.filter(r => r.name === 'cap').length, 50);
  assert.match(result.summary, /Reconciliation incomplete/);
  assert(!/Reviewed all/.test(result.summary));
  assert(result.exceptions.some(value => /Could not completely read internal status/.test(value)));
});

test('source entity error yields a safe incomplete summary without provider error text', async () => {
  const { ctx } = fixture();
  ctx.entities.FieldReports.list = async () => { throw Error('https://private.example/?token=SHOULD-NOT-LEAK'); };
  const result = await reconcileLead(lead('field_reporting_lead'), ctx);
  assert.match(result.summary, /Reconciliation incomplete/);
  assert(!JSON.stringify(result).includes('SHOULD-NOT-LEAK'));
});

test('Denver business day excludes tomorrow and cancelled or optional events', async () => {
  const events = [
    { event_date: '2026-09-12', report_status: 'pending' },
    { event_date: '2026-09-13', report_status: 'missing_all', days_late: 1 },
    { event_date: '2026-09-11', report_status: 'missing_all', source_status: 'cancelled', days_late: 1 },
    { event_date: '2026-09-11', report_status: 'missing_all', report_required: false, days_late: 1 },
    { event_date: 'not-a-date', report_status: 'missing_all', days_late: 1 },
  ];
  const { ctx } = fixture({ events });
  const result = await reconcileLead(lead('calendar_ops_lead'), ctx);
  assert.match(result.summary, /1 past\/current required events: 1 pending, 0 missing/);
  assert.equal(result.exceptions.length, 0);
});

test('configured connectors do not mask stale or incomplete provider observations', async () => {
  const run = freshRun();
  run.source_status.live_google.checked_at = '2026-09-10T01:00:00Z';
  run.source_status.outlook_service.coverage = { fresh_complete: false };
  delete run.source_status.outlook_installation.checked_at;
  const { ctx } = fixture({ run });
  const result = await reconcileLead(lead('development_lead'), ctx);
  assert.match(result.summary, /Google Calendar configured, Google Drive configured/);
  assert.match(result.summary, /Configuration alone does not verify a source read/);
  assert.match(result.exceptions.join(' '), /stale capture/);
  assert.match(result.exceptions.join(' '), /incomplete coverage/);
  assert.match(result.exceptions.join(' '), /source freshness unverified/);
  assert(!JSON.stringify(result).includes('PRIVATE-'));
});

test('completed job preparation is selected by source generation order and stale runs block', async () => {
  const run = freshRun(); run.completed_at = '2026-09-10T01:00:00Z';
  const { ctx, reads } = fixture({ run });
  const result = await reconcileLead(lead('sales_order_lead'), ctx);
  assert.deepEqual(reads.find(r => r.name === 'JobKnowledgeRun'), { name: 'JobKnowledgeRun', query: { status: 'complete' }, sort: '-started_at', limit: 1 });
  assert(result.exceptions.some(value => /latest completed job preparation is stale/.test(value)));
});

test('issue assignment is scoped to each lead and resolved issues do not escalate', async () => {
  const run = freshRun();
  run.issues = [
    { code: 'calendar_coverage_gap', assigned_to: 'calendar_ops_lead', status: 'needs_review' },
    { code: 'stale_arrival_source', assigned_to: 'sales_order_lead', status: 'needs_review' },
    { code: 'calendar_fixed', assigned_to: 'calendar_ops_lead', status: 'resolved' },
  ];
  const { ctx } = fixture({ run });
  const calendar = await reconcileLead(lead('calendar_ops_lead'), ctx);
  assert.match(calendar.exceptions.join(' '), /1 unresolved job-data issues.*calendar coverage gap/);
  assert(!calendar.exceptions.join(' ').includes('stale arrival'));
  assert(!calendar.exceptions.join(' ').includes('calendar fixed'));
  const development = await reconcileLead(lead('development_lead'), ctx);
  assert.match(development.exceptions.join(' '), /2 unresolved job-data issues assigned to section leads/);
});

test('missing job preparation and missing source metadata remain explicit', async () => {
  const missing = fixture({ run: null });
  const result = await reconcileLead(lead('field_reporting_lead'), missing.ctx);
  assert.match(result.summary, /no completed preparation run/);
  assert(result.exceptions.some(value => /not prepared/.test(value)));
  const run = freshRun(); delete run.source_status.sales_tracker;
  const other = await reconcileLead(lead('sales_order_lead'), fixture({ run }).ctx);
  assert.match(other.exceptions.join(' '), /Sales Tracker capture: unavailable/);
});

test('stored ProBuild auth configuration and secret fallback work without revealing tokens', async () => {
  const { ctx } = fixture();
  assert.equal(await checkConnector('probuild', ctx), true);
  ctx.entities.ProbuildAuth.list = async () => { throw Error('Cannot read token row'); };
  ctx.secrets.get = async () => 'PRIVATE-FALLBACK-TOKEN';
  assert.equal(await checkConnector('probuild', ctx), true);
  const result = await reconcileLead(lead('field_reporting_lead'), ctx);
  assert(!JSON.stringify(result).includes('PRIVATE-'));
  assert.match(result.summary, /incremental scope; historical library not revalidated/);
});

test('quoting decisions and sample limits stay intact without knowledge dependencies', async () => {
  const { ctx, reads, writes } = fixture({ quotes: [{ worker_status: 'failed' }, { worker_status: 'needs_sign_in' }] });
  ctx.entities.JobKnowledgeRun.filter = async () => { throw Error('Quoting must not depend on job knowledge'); };
  const result = await reconcileLead(lead('quoting_lead'), ctx);
  assert.equal(result.exceptions.length, 2);
  assert.match(result.summary, /latest 2 quote requests: 1 failed, 1 need sign-in/);
  assert.equal(reads.find(r => r.name === 'QuoteRequests').limit, 100);
  assert.equal(writes.length, 0);
});

test('daily run shares full reads, records Denver date and only writes operational records', async () => {
  const { ctx, reads, writes } = fixture();
  const result = await executeDailyRuns(ctx);
  assert.equal(result.ran, 5);
  assert.equal(result.completed, 5);
  assert.equal(result.blocked, 0);
  assert.equal(reads.filter(r => r.name === 'CalendarEvents').length, 1);
  assert.equal(reads.filter(r => r.name === 'JobKnowledgeRun').length, 1);
  const started = writes.filter(w => w.name === 'AgentDailyRun' && w.op === 'create');
  assert.equal(started.length, 5);
  assert(started.every(w => w.data.run_date === '2026-09-12'));
  assert(writes.every(w => ['AgentOpsConfig', 'AgentDailyRun', 'AgentCenterEscalation'].includes(w.name)));
});

test('a gap blocks only its relevant lead and creates the existing internal escalation shape', async () => {
  const run = freshRun(); run.source_status.sales_tracker.checked_at = '2026-09-01T00:00:00Z';
  const { ctx, writes } = fixture({ run });
  const result = await executeDailyRuns(ctx, { onlyLeadId: 'sales_order_lead', triggeredBy: 'manual' });
  assert.equal(result.blocked, 1); assert.equal(result.escalated, 1);
  const escalation = writes.find(w => w.name === 'AgentCenterEscalation').data;
  assert.equal(escalation.status, 'needs_owner_decision');
  assert.equal(escalation.agent_id, 'sales_order_lead');
  assert.match(escalation.context, /Sales Tracker capture: stale capture/);
});
