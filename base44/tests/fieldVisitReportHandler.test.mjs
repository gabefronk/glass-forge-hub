// The published resolveFieldReport handler, bundled with esbuild and run against an
// in-memory entity store. No live data, no network: the Base44 SDK and the platform secrets
// are stubbed, so the BlueBubbles notifier skips and no email or SMS can leave.
//
// What this covers: the structured submit end to end (job note + invoicing staging + one
// Today item per recipient), retry and edited-re-submit dedupe, the recipient requirement,
// the Installer Error carve-out (no fee line, internal record kept), legacy payload
// compatibility, and the form_context read the phone form depends on.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { filterRows } from '../../tests/support/entityFilter.mjs';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const STUBS = {
  runtime: "export const secrets = { get: () => '' };",
  sdk: 'export const createClientFromRequest = () => globalThis.__testBase44;',
};
const stubPlugin = {
  name: 'test-stubs',
  setup(b) {
    b.onResolve({ filter: /^npm:@base44\/sdk/ }, () => ({ path: 'sdk', namespace: 'stub' }));
    b.onResolve({ filter: /^base44:runtime$/ }, () => ({ path: 'runtime', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: STUBS[a.path], loader: 'js' }));
  },
};
async function loadModule(path) {
  const out = await build({ entryPoints: [here(path)], bundle: true, platform: 'neutral', format: 'esm', write: false, logLevel: 'silent', plugins: [stubPlugin] });
  return import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
}
const handler = (await loadModule('../functions/resolveFieldReport/entry.ts')).default;

// ── In-memory entity store ────────────────────────────────────────────────────
function memoryDb(seed = {}) {
  const tables = new Map();
  let seq = 0;
  const table = (name) => {
    if (!tables.has(name)) tables.set(name, (seed[name] || []).map((r) => ({ ...r })));
    return tables.get(name);
  };
  const sortRows = (rows, sort) => {
    const desc = String(sort || '').startsWith('-');
    const key = String(sort || 'id').replace(/^-/, '');
    return [...rows].sort((a, b) => String(a[key] ?? '').localeCompare(String(b[key] ?? '')) * (desc ? -1 : 1));
  };
  const entity = (name) => ({
    list: async (sort, limit = 1000, skip = 0) => sortRows(table(name), sort).slice(skip, skip + limit).map((r) => ({ ...r })),
    filter: async (q = {}, sort, limit = 1000) => filterRows(table(name), q, sort, limit).map((r) => ({ ...r })),
    get: async (id) => { const r = table(name).find((x) => x.id === id); if (!r) throw new Error('not found'); return { ...r }; },
    create: async (r) => {
      seq += 1;
      const row = { ...r, id: r.id || `${name.toLowerCase()}-${seq}`, created_date: `2026-10-30T12:00:00.${String(seq).padStart(3, '0')}Z` };
      table(name).push(row);
      return { ...row };
    },
    update: async (id, patch) => { const r = table(name).find((x) => x.id === id); if (!r) throw new Error('not found'); Object.assign(r, patch); return { ...r }; },
  });
  const entities = new Proxy({}, { get: (_, name) => entity(String(name)) });
  return {
    table,
    client: {
      entities,
      asServiceRole: { entities },
      auth: { me: async () => ({ id: 'user-crew', email: 'crew@example.com', full_name: 'Crew Member', role: 'admin' }) },
    },
  };
}

async function run(db, body) {
  globalThis.__testBase44 = db.client;
  const res = await handler(new Request('http://test.local/fn', { method: 'POST', body: JSON.stringify(body) }));
  return res.json();
}

// Live-shaped fixtures. Stable TeamMember ids; no live records are read or written.
const MEMBERS = [
  { id: 'tm-pm', member_key: 'milan-fronk-c6d2be25', display_name: 'Milan Fronk', auth_user_ids: ['au-1'], active: true },
  { id: 'tm-ops', member_key: 'israel', display_name: 'Israel', auth_user_ids: ['au-2'], active: true },
  { id: 'tm-sales', member_key: 'yelian', display_name: 'Yelian', auth_user_ids: [], active: true },
  { id: 'tm-owner', member_key: 'gabriel', display_name: 'Gabriel', auth_user_ids: ['au-3'], active: true },
  { id: 'tm-gone', member_key: 'retired', display_name: 'Retired Helper', auth_user_ids: [], active: false },
];
const USERS = [
  { id: 'au-1', full_name: 'Milan Fronk', email: 'milan@example.com', role: 'admin' },
  { id: 'au-2', full_name: 'Israel Yedra', email: 'israel@example.com', role: 'admin' },
  { id: 'au-3', full_name: 'Gabriel Fronk', email: 'gabriel@example.com', role: 'admin' },
];
const RUBRIC = [
  { id: 'pr-ld', kind: 'setting', key: 'long_distance', label: 'Long distance charge', amount: 75, sort: 1 },
  { id: 'pr-vinyl', kind: 'material', key: 'vinyl', label: 'Vinyl', hourly_rate: 100, sort: 1 },
  { id: 'pr-wood', kind: 'material', key: 'wood', label: 'Wood', hourly_rate: 150, sort: 3 },
  { id: 'pr-screen', kind: 'ticket_type', key: 'screen_service', label: 'Screen Service', visit_fee: null, sort: 5 },
  { id: 'pr-install', kind: 'ticket_type', key: 'install', label: 'Install', visit_fee: null, sort: 3 },
  { id: 'pr-warranty', kind: 'ticket_type', key: 'warranty', label: 'Warranty', visit_fee: null, sort: 8 },
  { id: 'pr-initial', kind: 'ticket_type', key: 'initial_visit_po', label: 'Initial visit', visit_fee: null, sort: 1 },
];
const JOB = {
  id: 'job-1', canonical_name: 'Holmes Homes - 408 Oquirrh West', created_date: '2026-01-01T00:00:00Z',
  pm_member_key: 'milan-fronk-c6d2be25',
  accepted_quote_snapshot: {
    lines: [
      { id: 'w-a', mark: 'A1', room: 'Great room', style: 'XO slider', width: 72, height: 48, qty: 2, units: 'in', dimension_basis: 'rough_opening' },
      { id: 'w-b', mark: 'B2', room: 'Basement', style: 'SV', width: 36, height: 24, qty: 1, units: 'in' },
    ],
  },
};
const seed = (over = {}) => memoryDb({ Jobs: [JOB], TeamMember: MEMBERS, User: USERS, PricingRubric: RUBRIC, ...over });

const base = (over = {}) => ({
  action: 'upload', job_id: 'job-1', request_key: 'field-report:job-1:k1',
  photos: ['https://files.test/a.jpg'], notes: 'all four elevations shot', completion: 'complete',
  ...over,
});

// ── form_context ──────────────────────────────────────────────────────────────
test('form_context returns the live eligible recipients and the ordered window package, and no money', async () => {
  const db = seed();
  const res = await run(db, { action: 'form_context', job_id: 'job-1' });
  assert.equal(res.ok, true);
  assert.deepEqual(res.recipients.map((r) => r.id), ['tm-ops', 'tm-owner', 'tm-pm', 'tm-sales']);
  assert.deepEqual(res.recipients.map((r) => r.display_name).sort(), ['Gabriel', 'Israel', 'Milan Fronk', 'Yelian']);
  assert.equal(res.recipients.some((r) => r.display_name === 'Retired Helper'), false, 'inactive members are not offered');
  assert.equal(res.recipients.find((r) => r.id === 'tm-sales').pending_account, true);
  // Narrow by design: a stable id and a display name, nothing else about the person.
  assert.deepEqual(Object.keys(res.recipients[0]).sort(), ['display_name', 'id', 'pending_account']);
  assert.equal(/@|auth_user_ids/.test(JSON.stringify(res.recipients)), false, 'no emails or auth ids leave the server');
  assert.deepEqual(res.windows.map((w) => w.id), ['w-a', 'w-b']);
  assert.equal(res.window_source, 'accepted_quote_snapshot');
  assert.equal(/price|cost|sell|dealer|total/i.test(JSON.stringify(res.windows)), false);
});

// ── Structured submit, staging and fan-out ────────────────────────────────────
test('an eligible billable visit writes one job note, one invoicing staging line and no follow-up when nothing needs it', async () => {
  const db = seed();
  const res = await run(db, base({
    event_type: 'screen_service', hours: 2, material: 'vinyl', long_distance: true,
    screen_issues: [{ kind: 'missing', quantity: 4, location: 'upstairs front' }],
  }));
  assert.equal(res.error, undefined);
  assert.equal(res.ok, true);
  assert.equal(res.event_type, 'screen_service');
  assert.equal(db.table('JobNotes').length, 1);
  assert.match(db.table('JobNotes')[0].body, /Event: Screen Service/);
  assert.match(db.table('JobNotes')[0].body, /Screens missing: qty 4 at upstairs front/);
  assert.deepEqual(db.table('JobNotes')[0].attachments, ['https://files.test/a.jpg']);
  const lines = db.table('FeeLines');
  assert.equal(lines.length, 1);
  assert.equal(lines[0].labor_amt, 275);
  assert.equal(lines[0].billable, true);
  assert.equal(lines[0].billed_to_bfs, false);
  assert.equal(lines[0].source, 'field_report');
  assert.equal(res.invoice_staging_state, 'staged');
  assert.equal(res.charge_labor_amt, 275);
  assert.equal(db.table('TodoTask').length, 0, 'a clean complete visit alerts nobody');
  const row = db.table('FieldVisitReports')[0];
  assert.equal(row.settled, true);
  assert.equal(row.fee_line_id, lines[0].id);
  assert.equal(row.hours, 2);
  assert.equal(row.material, 'vinyl');
  assert.equal(row.media_urls.length, 1);
  assert.deepEqual(row.recipients, []);
});

test('each selected recipient gets their own Today item carrying the job, event, issue detail and report link', async () => {
  const db = seed();
  const res = await run(db, base({
    event_type: 'job_readiness', completion: 'incomplete',
    incomplete_reason: 'Two openings could not be checked',
    window_issues: [
      { kind: 'framing_ro', window_id: 'w-a', current_width: 70.5, current_height: 47, required_width: 72, required_height: 48 },
      { kind: 'needs_clarification', window_id: 'w-b', note: 'is the basement unit egress?' },
    ],
    recipients: ['tm-pm', 'tm-ops', 'tm-sales'],
  }));
  assert.equal(res.error, undefined);
  assert.deepEqual(res.follow_up_triggers.sort(), ['incomplete_work', 'needs_clarification']);
  assert.equal(res.routing, 'selected');
  const tasks = db.table('TodoTask');
  assert.equal(tasks.length, 3);
  assert.deepEqual(tasks.map((t) => t.assignee_member_id).sort(), ['tm-ops', 'tm-pm', 'tm-sales']);
  assert.equal(new Set(tasks.map((t) => t.request_key)).size, 3);
  for (const t of tasks) {
    assert.match(t.title, /Job Readiness/);
    assert.match(t.details, /Holmes Homes - 408 Oquirrh West/);
    assert.match(t.details, /framed 70.5×47/);
    assert.match(t.details, /required 72×48/);
    assert.match(t.details, /is the basement unit egress\?/);
    assert.match(t.details, /Full report: \/jobs\/job-1\?report=/, 'origin linkage');
    assert.equal(t.status, 'open');
    assert.equal(t.category, 'follow_up');
  }
  assert.deepEqual(res.recipient_task_ids.length, 3);
  assert.deepEqual(db.table('FieldVisitReports')[0].recipient_task_ids.length, 3);
});

test('a follow-up trigger with no recipient is refused and writes nothing chargeable', async () => {
  const db = seed();
  const res = await run(db, base({ event_type: 'service', completion: 'incomplete', incomplete_reason: 'locked out', recipients: [] }));
  assert.equal(res.error, 'invalid_report');
  assert.ok(res.fields.includes('recipients_required'));
  assert.equal(db.table('JobNotes').length, 0);
  assert.equal(db.table('FeeLines').length, 0);
  assert.equal(db.table('TodoTask').length, 0);
  assert.equal(db.table('FieldVisitReports').length, 0);
});

test('a recipient id that is not a live active member cannot route a Today item', async () => {
  const db = seed();
  const res = await run(db, base({ event_type: 'service', completion: 'incomplete', incomplete_reason: 'locked out', recipients: ['tm-gone'] }));
  assert.equal(res.error, 'recipients_required');
  assert.equal(db.table('TodoTask').length, 0);
});

// ── Retry and edited re-submit ────────────────────────────────────────────────
test('a retried submit and an edited re-submit of the same form create no duplicates', async () => {
  const db = seed();
  const payload = base({
    event_type: 'warranty', completion: 'incomplete', incomplete_reason: 'part on order',
    warranty_issue: { reported_by: 'Super Randy', text: 'patio door drags' },
    hours: 1.5, material: 'wood', recipients: ['tm-pm', 'tm-ops'],
  });
  const first = await run(db, payload);
  assert.equal(first.error, undefined);
  assert.equal(first.charge_labor_amt, 225);
  assert.equal(db.table('FeeLines').length, 1);
  assert.equal(db.table('TodoTask').length, 2);
  assert.equal(db.table('JobNotes').length, 1);

  // Same request_key, submitted again (a retry after a flaky network).
  const retry = await run(db, payload);
  assert.equal(retry.deduped, true);
  assert.equal(retry.note_id, first.note_id);
  assert.equal(retry.fee_line_id, first.fee_line_id);
  assert.equal(db.table('FeeLines').length, 1, 'no second invoicing staging line');
  assert.equal(db.table('TodoTask').length, 2, 'no second Today item for anybody');
  assert.equal(db.table('JobNotes').length, 1, 'no second job note');

  // Same request_key with edited answers (the worker changed the hours and the recipients).
  const edited = await run(db, { ...payload, hours: 4, recipients: ['tm-pm', 'tm-ops', 'tm-sales'] });
  assert.equal(edited.deduped, true);
  assert.equal(db.table('FeeLines').length, 1, 'an edit never raises a second charge');
  assert.equal(db.table('FeeLines')[0].labor_amt, 225, 'the settled amount is not re-priced');
  assert.equal(db.table('TodoTask').length, 2, 'an edit never fans out a second round');
  assert.equal(db.table('FieldVisitReports').length, 1);

  // A genuinely new form (new key) is a new report.
  const second = await run(db, { ...payload, request_key: 'field-report:job-1:k2' });
  assert.equal(second.deduped, undefined);
  assert.equal(db.table('FeeLines').length, 2);
  assert.equal(db.table('TodoTask').length, 4);
});

test('a partially failed submit resumes on retry instead of doubling anything', async () => {
  const db = seed();
  // An unsettled row from an earlier attempt that already wrote the note.
  const note = await db.client.asServiceRole.entities.JobNotes.create({ job_id: 'job-1', note_date: '2026-10-30', body: 'Event: Screen Service', author: 'crew@example.com', attachments: [] });
  await db.client.asServiceRole.entities.FieldVisitReports.create({
    request_key: 'field-report:job-1:k9', settled: false, job_id: 'job-1', event_type: 'screen_service', job_note_id: note.id,
  });
  const res = await run(db, base({ request_key: 'field-report:job-1:k9', event_type: 'screen_service', hours: 2, material: 'vinyl' }));
  assert.equal(res.error, undefined);
  assert.equal(res.note_id, note.id, 'the existing note is reused');
  assert.equal(db.table('JobNotes').length, 1);
  assert.equal(db.table('FieldVisitReports').length, 1);
  assert.equal(db.table('FeeLines').length, 1, 'the missing staging line is created once');
  assert.equal(db.table('FeeLines')[0].labor_amt, 200);
});

// ── Installer Error ───────────────────────────────────────────────────────────
test('Installer Error creates no fee line and no staging, on first submit and on retry, but keeps the internal record', async () => {
  const db = seed();
  const payload = base({
    event_type: 'installer_error', completion: 'complete',
    items: [{ key: 'missed_flashing', note: 'back dam missing on two openings' }],
    hours: 6, material: 'wood', long_distance: true, request_key: 'field-report:job-1:ie1',
  });
  const res = await run(db, payload);
  assert.equal(res.error, undefined);
  assert.equal(db.table('FeeLines').length, 0, 'never billable');
  assert.equal(res.fee_line_id, '');
  assert.equal(res.charge_labor_amt, 0);
  assert.equal(res.invoice_staging_state, 'not_billable');
  assert.equal(res.internal_cost_state, 'pending');
  assert.equal(res.internal_cost_reason, 'no_internal_labor_cost_rate');

  const row = db.table('FieldVisitReports')[0];
  assert.equal(row.billable, false);
  assert.equal(row.invoice_staging_state, 'not_billable');
  assert.equal(row.hours, 6, 'internal hours are retained');
  assert.equal(row.material, 'wood', 'internal material is retained');
  assert.equal(row.long_distance, false, 'no trip charge is carried for a non-billable visit');
  assert.equal(row.internal_cost_state, 'pending');
  assert.equal(row.internal_cost_amount, null);
  assert.notEqual(row.internal_cost_amount, 900, 'the $150/h wood SELL rate is never used as cost');
  assert.match(db.table('JobNotes')[0].body, /Missed flashing/);
  assert.match(db.table('JobNotes')[0].body, /Hours: 6.0/);

  // Retried and edited: still no charge.
  await run(db, payload);
  await run(db, { ...payload, hours: 9 });
  assert.equal(db.table('FeeLines').length, 0);
  assert.equal(db.table('FieldVisitReports').length, 1);
});

test('Install files no hours, no material and no labour charge, only the long-distance trip', async () => {
  const db = seed();
  const res = await run(db, base({
    event_type: 'install', completion: 'complete', long_distance: true,
    hours: 8, material: 'wood', // a stale/forged client payload: the server must ignore both
    request_key: 'field-report:job-1:in1',
  }));
  assert.equal(res.error, undefined);
  assert.equal(db.table('FeeLines').length, 1);
  assert.equal(db.table('FeeLines')[0].labor_amt, 75);
  assert.equal(db.table('FeeLines')[0].man_hours, null);
  assert.equal(db.table('FeeLines')[0].service_material, null);
  const row = db.table('FieldVisitReports')[0];
  assert.equal(row.hours, null);
  assert.equal(row.material, '');
  assert.equal(row.internal_cost_state, 'unpriced');
});

// ── Sheetrock rescheduling ────────────────────────────────────────────────────
test('sheetrock not stocked flags rescheduling, routes follow-up and invents no date', async () => {
  const db = seed();
  const res = await run(db, base({
    event_type: 'sheetrock_window_install', completion: 'incomplete', incomplete_reason: 'cannot install yet',
    sheetrock_outcomes: [{ key: 'sheetrock_not_stocked', label: 'Sheetrock not stocked yet' }],
    recipients: ['tm-pm'], request_key: 'field-report:job-1:sr1',
  }));
  assert.equal(res.error, undefined);
  assert.equal(res.needs_rescheduling, true);
  assert.match(res.rescheduling_reason, /sheetrock_not_stocked/);
  const row = db.table('FieldVisitReports')[0];
  assert.equal(row.needs_rescheduling, true);
  assert.equal(row.rescheduled_date, '');
  assert.equal(db.table('TodoTask').length, 1);
  assert.match(db.table('TodoTask')[0].details, /Needs rescheduling/);
  // No calendar date is guessed anywhere in the response or the stored row.
  assert.equal(/\d{4}-\d{2}-\d{2}/.test(String(row.rescheduling_reason)), false);
});

// ── Legacy payload compatibility ──────────────────────────────────────────────
test('a legacy quick upload still works, still charges from the rubric, and no longer hardcodes a person', async () => {
  const db = seed({
    CalendarEvents: [{ id: 'ev-1', job_id: 'job-1', job_name: 'Holmes Homes - 408 Oquirrh West', event_date: '2026-10-28', report_status: 'pending' }],
  });
  const res = await run(db, {
    action: 'upload', event_id: 'ev-1', job_id: 'job-1', photos: ['https://files.test/legacy.jpg'],
    notes: 'left two openings', completion: 'incomplete',
    ticket_type: 'screen_service', hours: 1, material: 'vinyl', long_distance: false,
    request_key: 'field-report-legacy:ev-1',
  });
  assert.equal(res.error, undefined);
  assert.equal(res.event_type, '');
  assert.equal(db.table('CalendarEvents')[0].report_status, 'ok');
  assert.equal(db.table('FeeLines').length, 1);
  assert.equal(db.table('FeeLines')[0].labor_amt, 100);
  // The incomplete alert routes to the job's PM TeamMember by stable id, not by name.
  const tasks = db.table('TodoTask');
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].assignee_member_id, 'tm-pm');
  assert.equal(res.routing, 'legacy_fallback');
  assert.match(tasks[0].title, /Incomplete field report/);
  // A retry of the same legacy submit raises no second alert.
  await run(db, {
    action: 'upload', event_id: 'ev-1', job_id: 'job-1', photos: ['https://files.test/legacy.jpg'],
    notes: 'left two openings', completion: 'incomplete', request_key: 'field-report-legacy:ev-1',
  });
  assert.equal(db.table('TodoTask').length, 1);
});

test('a legacy incomplete upload on a job with no PM falls back to the owner member', async () => {
  const db = seed({ Jobs: [{ ...JOB, pm_member_key: '' }] });
  const res = await run(db, { action: 'upload', job_id: 'job-1', notes: 'x', completion: 'incomplete', photos: [], request_key: 'legacy:no-pm' });
  assert.equal(res.error, undefined);
  assert.equal(db.table('TodoTask')[0].assignee_member_id, 'tm-owner');
});

// ── Unrelated actions keep working ────────────────────────────────────────────
test('mark_reported and waive are unchanged', async () => {
  const db = seed({ CalendarEvents: [{ id: 'ev-1', job_id: 'job-1', event_date: '2026-10-28', report_status: 'pending' }] });
  assert.equal((await run(db, { action: 'mark_reported', event_id: 'ev-1' })).action, 'mark_reported');
  assert.equal(db.table('CalendarEvents')[0].report_status, 'ok');
  assert.equal((await run(db, { action: 'waive', event_id: 'ev-1' })).error, 'reason_required');
  assert.equal((await run(db, { action: 'waive', event_id: 'ev-1', reason: 'storm' })).action, 'waived');
  assert.equal(db.table('CalendarEvents')[0].report_status, 'waived');
  assert.equal((await run(db, { action: 'nope' })).error, 'unknown_action');
});
