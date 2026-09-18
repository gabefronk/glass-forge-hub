// Ingest attaches new events / visits / field reports to the canonical existing
// Job (same customer + normalized address, oldest record) instead of creating a
// duplicate, creates at most one Job per new identity per batch, keeps different
// units / lots / customers apart, and flags doubtful evidence for review.
//
// The published handlers (fetchCalendarEvents, fetchProbuildPosts,
// resolveFieldReport) are bundled with esbuild and run against an in-memory
// entity store; the Base44 SDK and the ProBuild network client are stubbed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { groupJobs } from '../../src/lib/jobDedupe.js';
import { createJobIndex, canonicalJob } from '../shared/jobIdentity.js';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

const STUBS = {
  sdk: 'export const createClientFromRequest = () => globalThis.__testBase44;',
  probuild: `export const toMs = (v) => (v ? Date.parse(v) : null);
    export const getProbuildIdToken = async () => 'token';
    export const fetchProbuildProjects = async () => globalThis.__testProbuild.projects;
    export const fetchProbuildPostsForProject = async (_t, id) => globalThis.__testProbuild.posts.filter((p) => p.projectId === id);
    export const filterProjectsByWindow = (projects) => ({ qualifying: projects, stats: { total: projects.length } });`,
};
const stubPlugin = {
  name: 'test-stubs',
  setup(b) {
    b.onResolve({ filter: /^npm:@base44\/sdk/ }, () => ({ path: 'sdk', namespace: 'stub' }));
    b.onResolve({ filter: /probuildApi\.ts$/ }, () => ({ path: 'probuild', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: STUBS[a.path], loader: 'js' }));
  },
};
async function loadModule(path) {
  const out = await build({ entryPoints: [here(path)], bundle: true, platform: 'neutral', format: 'esm', write: false, logLevel: 'silent', plugins: [stubPlugin] });
  return import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'));
}
const ingest = await loadModule('../shared/ingestShared.ts');
const calendarHandler = (await loadModule('../functions/fetchCalendarEvents/entry.ts')).default;
const probuildHandler = (await loadModule('../functions/fetchProbuildPosts/entry.ts')).default;
const fieldReportHandler = (await loadModule('../functions/resolveFieldReport/entry.ts')).default;

// ── In-memory entity store ────────────────────────────────────────────────
function memoryDb(seed = {}) {
  const tables = new Map();
  const bulkCreates = {};
  const fail = new Set();
  let seq = 0;
  const table = (name) => {
    if (!tables.has(name)) tables.set(name, (seed[name] || []).map((r) => ({ ...r })));
    return tables.get(name);
  };
  const stamp = (name, r) => {
    seq++;
    return { ...r, id: r.id || `${name.toLowerCase()}-new-${seq}`, created_date: r.created_date || `2026-09-18T12:00:00.${String(seq).padStart(3, '0')}Z` };
  };
  const sortRows = (rows, sort) => {
    const desc = String(sort || '').startsWith('-');
    const key = String(sort || 'id').replace(/^-/, '');
    return [...rows].sort((a, b) => String(a[key] ?? '').localeCompare(String(b[key] ?? '')) * (desc ? -1 : 1));
  };
  const entity = (name) => ({
    list: async (sort, limit = 1000, skip = 0) => {
      if (fail.has(name)) throw new Error(`${name} unavailable`);
      return sortRows(table(name), sort).slice(skip, skip + limit).map((r) => ({ ...r }));
    },
    filter: async (q = {}, sort, limit = 1000) => sortRows(table(name).filter((r) => Object.entries(q).every(([k, v]) => r[k] === v)), sort).slice(0, limit),
    get: async (id) => {
      const r = table(name).find((x) => x.id === id);
      if (!r) throw new Error('not found');
      return { ...r };
    },
    create: async (r) => { const row = stamp(name, r); table(name).push(row); return { ...row }; },
    bulkCreate: async (rows) => {
      (bulkCreates[name] ||= []).push(rows.length);
      return rows.map((r) => { const row = stamp(name, r); table(name).push(row); return { ...row }; });
    },
    update: async (id, patch) => { const r = table(name).find((x) => x.id === id); Object.assign(r, patch); return { ...r }; },
    bulkUpdate: async (rows) => { for (const p of rows) { const r = table(name).find((x) => x.id === p.id); if (r) Object.assign(r, p); } return rows; },
  });
  const entities = new Proxy({}, { get: (_, name) => entity(String(name)) });
  const client = {
    entities,
    asServiceRole: { entities, integrations: { Core: { UploadFile: async () => ({ file_url: 'https://files.test/x' }) } } },
    auth: { me: async () => ({ id: 'user-1', email: 'crew@example.com', role: 'admin' }) },
  };
  return { table, bulkCreates, fail, client };
}

async function run(handler, db, body) {
  globalThis.__testBase44 = db.client;
  const res = await handler(new Request('http://test.local/fn', { method: 'POST', body: JSON.stringify(body) }));
  const json = await res.json();
  assert.equal(json.error, undefined, `handler error: ${json.error}`);
  return json;
}
const WINDOW = { start_date: '2026-09-01', end_date: '2026-09-30' };
const feeFor = (db, key, field = 'calendar_event_id') => db.table('FeeLines').find((f) => f[field] === key);
const jobsCreated = (db) => (db.bulkCreates.Jobs || []).reduce((n, c) => n + c, 0);

// ── Fixtures: the Pulte 2154 Jordanelle Ridge duplicates from the Jobs hub ──
const pulteA = { id: 'job-a', canonical_name: 'Pulte Home - 2154 Jordanelle Ridge', builder: 'Pulte Home', address: '', created_date: '2026-06-01T10:00:00' };
const pulteB = { id: 'job-b', canonical_name: 'Pulte Homes - 2154 Jordanelle Ridge', address: '2154 Jordanelle Ridge Dr, Heber City, UT 84032', po_numbers: ['4455667'], created_date: '2026-07-10T10:00:00' };
const pulteC = { id: 'job-c', canonical_name: 'pulte home - 2154 jordanelle ridge', aliases: ['pulte home - 2154 jordanelle ridge'], created_date: '2026-08-01T10:00:00' };
const jobD = { id: 'job-d', canonical_name: 'Pulte Home - 2156 Jordanelle Ridge', builder: 'Pulte Home', created_date: '2026-06-02T10:00:00' };
// Newest first, the order ingest reads Jobs in.
const PULTE = [pulteC, pulteB, jobD, pulteA];

const calEvent = (id, date, job_name, extra = {}) => ({
  id: `ce-${id}`, source: 'google', source_status: 'confirmed', google_event_id: id, event_date: date, job_name,
  builder: ingest.extractBuilder(job_name), address: null, po_number: null, oe_number: null, scope_notes: '', created_by: 'office@example.com', ...extra,
});

// ── Matcher ───────────────────────────────────────────────────────────────
test('every spelling of an existing customer + address resolves to the oldest record', () => {
  const cases = [
    ['pulte homes - 2154 jordanelle ridge dr', { rawName: 'Pulte Homes - 2154 Jordanelle Ridge Dr', builder: 'Pulte Homes', address: '2154 Jordanelle Ridge Drive, Heber City, UT 84032' }],
    ['pulte home - 2154 jordanelle ridge drive', { rawName: 'YA - Pulte Home - 2154 Jordanelle Ridge Drive', builder: 'Pulte Home' }],
    // Older syncs stored the "YA" title prefix as the builder.
    ['pulte home - 2154 jordanelle ridge drive', { rawName: 'YA - Pulte Home - 2154 Jordanelle Ridge Drive', builder: 'YA' }],
    ['pulte home - 2154 jordanelle ridge', { rawName: 'pulte home - 2154 jordanelle ridge' }],
  ];
  assert.equal(ingest.extractBuilder('YA - Pulte Home - 2154 Jordanelle Ridge'), 'Pulte Home');
  for (const [normName, extra] of cases) {
    for (const jobs of [PULTE, [...PULTE].reverse()]) {
      const m = ingest.matchJob(normName, jobs, null, null, extra.address || null, extra);
      assert.equal(m.job_id, 'job-a', `${extra.rawName} → oldest record`);
      assert.equal(m.autoCreate, false);
      assert.equal(m.needs_review, false);
    }
  }
  // A PO printed on a newer duplicate still lands on the canonical record.
  assert.equal(ingest.matchJob('pulte warranty', PULTE, '4455667', null, null, { rawName: 'Pulte warranty' }).job_id, 'job-a');
  // The next lot is its own job.
  assert.equal(ingest.matchJob('pulte home - 2156 jordanelle ridge', PULTE, null, null, '2156 Jordanelle Ridge Dr', { builder: 'Pulte Home', rawName: 'Pulte Home - 2156 Jordanelle Ridge' }).job_id, 'job-d');
});

test('ingest and the Jobs hub agree on the canonical record', () => {
  const index = createJobIndex(PULTE);
  const group = groupJobs(PULTE).groupByJobId.get('job-b');
  for (const j of PULTE.filter((x) => x.id !== 'job-d')) assert.equal(canonicalJob(j, index).id, group.id);
  assert.equal(group.id, 'job-a');
});

test('different units, lots, house numbers and customers stay separate', () => {
  const lot12 = { id: 'lot12', canonical_name: 'Ivory Homes - 123 Main St Lot 12', builder: 'Ivory Homes', address: '123 Main St Lot 12, Lehi, UT', created_date: '2026-02-01' };
  const unit1 = { id: 'unit1', canonical_name: 'Pulte Home - 2160 Jordanelle Ridge Unit 1', builder: 'Pulte Home', created_date: '2026-03-01' };
  const jobs = [...PULTE, lot12, unit1];
  const create = (normName, extra) => {
    const m = ingest.matchJob(normName, jobs, null, null, extra.address, extra);
    assert.equal(m.job_id, null, extra.rawName);
    assert.equal(m.autoCreate, true, `${extra.rawName} is a new job`);
    assert.equal(m.needs_review, false);
  };
  create('ivory homes - 123 main st lot 13', { rawName: 'Ivory Homes - 123 Main St Lot 13', builder: 'Ivory Homes', address: '123 Main Street Lot 13' });
  create('pulte home - 2160 jordanelle ridge unit 2', { rawName: 'Pulte Home - 2160 Jordanelle Ridge Unit 2', builder: 'Pulte Home', address: '2160 Jordanelle Ridge Dr Unit 2' });
  create('toll brothers - 2154 jordanelle ridge', { rawName: 'Toll Brothers - 2154 Jordanelle Ridge', builder: 'Toll Brothers', address: '2154 Jordanelle Ridge Dr' });
  // Builders that share only a generic word ("Homes") are different customers.
  create('ivory homes - 2154 jordanelle ridge', { rawName: 'Ivory Homes - 2154 Jordanelle Ridge', builder: 'Ivory Homes', address: '2154 Jordanelle Ridge Dr' });
  create('pulte home - 2158 jordanelle ridge', { rawName: 'Pulte Home - 2158 Jordanelle Ridge', builder: 'Pulte Home', address: '2158 Jordanelle Ridge Dr' });
  // ProBuild names carry the unit without an address field: similarity to Unit 1 must not block it.
  create('pulte home - 2160 jordanelle ridge unit 3', { rawName: 'Pulte Home - 2160 Jordanelle Ridge Unit 3' });
  // The existing lot and unit still attach to themselves.
  assert.equal(ingest.matchJob('ivory homes - 123 main st lot 12', jobs, null, null, '123 Main St Lot 12', { rawName: 'Ivory Homes - 123 Main St Lot 12', builder: 'Ivory Homes' }).job_id, 'lot12');
  assert.equal(ingest.matchJob('pulte home - 2160 jordanelle ridge unit 1', jobs, null, null, null, { rawName: 'Pulte Home - 2160 Jordanelle Ridge Unit 1' }).job_id, 'unit1');
});

test('ambiguous or conflicting evidence is flagged for review: no attach, no create', () => {
  const review = (label, m, reason, candidates) => {
    assert.equal(m.job_id, null, label);
    assert.equal(m.autoCreate, false, `${label}: must not create`);
    assert.equal(m.needs_review, true, `${label}: must be flagged`);
    assert.equal(m.reason, reason, label);
    if (candidates) assert.deepEqual(m.candidate_job_ids, candidates, label);
  };
  const dr = { id: 't1', canonical_name: 'Holmes Homes - 88 Oak Dr', created_date: '2026-01-01' };
  const ct = { id: 't2', canonical_name: 'Holmes Homes - 88 Oak Ct', created_date: '2026-01-02' };
  review('street type missing, existing Dr and Ct', ingest.matchJob('holmes homes - 88 oak', [dr, ct], null, null, '88 Oak', { rawName: 'Holmes Homes - 88 Oak' }), 'existing_duplicates_disagree', ['t1', 't2']);
  review('a third street type', ingest.matchJob('holmes homes - 88 oak ln', [dr, ct], null, null, '88 Oak Ln', { rawName: 'Holmes Homes - 88 Oak Ln' }), 'similar_address', ['t1', 't2']);
  review('unit on one side only', ingest.matchJob('pulte home - 2154 jordanelle ridge unit 2', PULTE, null, null, '2154 Jordanelle Ridge Dr Unit 2', { rawName: 'Pulte Home - 2154 Jordanelle Ridge Unit 2', builder: 'Pulte Home' }), 'similar_address');
  const bare = { id: 'x1', canonical_name: '4410 N Canyon Rd', address: '4410 N Canyon Rd', created_date: '2026-01-01' };
  review('address match, existing customer unknown', ingest.matchJob('pulte home - 4410 n canyon rd', [bare], null, null, '4410 North Canyon Road', { rawName: 'Pulte Home - 4410 N Canyon Rd', builder: 'Pulte Home' }), 'address_match_customer_unknown', ['x1']);
  const toll = { id: 'toll', canonical_name: 'Toll Brothers - 2154 Jordanelle Ridge', builder: 'Toll Brothers', address: '2154 Jordanelle Ridge Dr', created_date: '2026-05-01' };
  review('address shared by two customers, event customer unknown', ingest.matchJob('2154 jordanelle ridge', [...PULTE, toll], null, null, '2154 Jordanelle Ridge Dr', { rawName: '2154 Jordanelle Ridge' }), 'address_shared_by_customers', ['job-a', 'toll']);
  const generic = { id: 'g1', canonical_name: 'Holmes Homes - Daybreak', builder: 'Holmes Homes', address: '607 W Ripple Rd', created_date: '2026-01-01' };
  review('same generic name, another house', ingest.matchJob('holmes homes - daybreak', [generic], null, null, '611 W Ripple Rd', { rawName: 'Holmes Homes - Daybreak', builder: 'Holmes Homes' }), 'name_matches_different_address', ['g1']);
  const poJob = { id: 'p1', canonical_name: 'Pulte Home - 2156 Jordanelle Ridge', builder: 'Pulte Home', po_numbers: ['7654321'], created_date: '2026-01-01' };
  review('PO on a different house', ingest.matchJob('pulte home - 2154 jordanelle ridge', [poJob], '7654321', null, '2154 Jordanelle Ridge Dr', { rawName: 'Pulte Home - 2154 Jordanelle Ridge', builder: 'Pulte Home' }), 'hard_id_conflicts_with_customer_or_address', ['p1']);
  const oeJob = { id: 'o1', canonical_name: 'Ivory Homes - 9 Elm St', builder: 'Ivory Homes', oe_numbers: ['1234567-01'], created_date: '2026-01-02' };
  review('PO and OE on different jobs', ingest.matchJob('warranty', [poJob, oeJob], '7654321', '1234567-01', null, { rawName: 'Warranty' }), 'po_oe_point_to_different_jobs', ['o1', 'p1']);
  review('customer written differently at the same address', ingest.matchJob('pulte - 2154 jordanelle ridge', PULTE, null, null, '2154 Jordanelle Ridge Dr', { rawName: 'Pulte - 2154 Jordanelle Ridge', builder: 'Pulte' }), 'customer_name_differs', ['job-a', 'job-b', 'job-c']);
  const towns = { id: 'dt', canonical_name: 'Holmes Homes - Daybreak Towns', builder: 'Holmes Homes', address: 'Daybreak Towns, South Jordan, UT', created_date: '2026-01-01' };
  review('an address with no house number, shared with another job', ingest.matchJob('holmes homes - towns punch', [towns], null, null, 'Daybreak Towns, South Jordan', { rawName: 'Holmes Homes - Towns punch', builder: 'Holmes Homes' }), 'address_without_house_number', ['dt']);
  assert.equal(ingest.matchJob('holmes homes - daybreak towns', [towns], null, null, 'Daybreak Towns', { rawName: 'Holmes Homes - Daybreak Towns', builder: 'Holmes Homes' }).job_id, 'dt', 'the exact name still attaches');
  review('near-identical name, no address', ingest.matchJob('pulte home 2154 jordanelle ridge', PULTE, null, null, null, { rawName: 'Pulte Home 2154 Jordanelle Ridge' }), 'similar_name');
  review('no job name at all', ingest.matchJob('', PULTE, null, null, null, {}), 'no_job_name');
});

test('batch planner: repeats create once, existing links are kept, skipped rows never create', () => {
  const items = [
    { key: 'a', normName: 'holmes homes - 88 oak dr', rawName: 'Holmes Homes - 88 Oak Dr', builder: 'Holmes Homes', address: '88 Oak Drive, Lehi, UT 84043', poNumber: '1234567' },
    { key: 'b', normName: 'holmes homes – 88 oak', rawName: 'Holmes Homes – 88 Oak', builder: 'Holmes Homes', address: '88 Oak Dr' },
    { key: 'c', normName: 'holmes home - 88 oak drive', rawName: 'YA - Holmes Home - 88 Oak Drive', builder: 'Holmes Home' },
    { key: 'd', normName: 'warranty callback', rawName: 'Warranty callback', poNumber: '1234567' },
    { key: 'e', normName: 'pulte home - 2154 jordanelle ridge', rawName: 'Pulte Home - 2154 Jordanelle Ridge', currentJobId: 'job-c' },
    { key: 'f', normName: 'ivory homes - 9 elm st', rawName: 'Ivory Homes - 9 Elm St', address: '9 Elm St', noCreate: true },
  ];
  const plan = ingest.planIngestJobs(items, PULTE, (item) => ({ canonical_name: item.normName, aliases: [item.normName], po_numbers: item.poNumber ? [item.poNumber] : [], address: item.address || null, builder: item.builder || null }));
  assert.equal(plan.drafts.length, 1, 'one new job for one new customer + address');
  for (const k of ['a', 'b', 'c', 'd']) assert.equal(plan.results.get(k).job_id, 'pending:000001', k);
  assert.equal(plan.results.get('e').job_id, 'job-c', 'an existing link is never re-pointed');
  assert.equal(plan.results.get('f').job_id, null);
  assert.equal(plan.results.get('f').autoCreate, false);
  // Created records map back by order, or by name when the order differs.
  const resolve = ingest.pendingIdResolver(plan.drafts, [{ id: 'real-1', canonical_name: 'holmes homes - 88 oak dr' }]);
  assert.equal(resolve('pending:000001'), 'real-1');
  assert.equal(resolve('job-a'), 'job-a');
  assert.equal(ingest.pendingIdResolver(plan.drafts, [])('pending:000001'), null, 'an unconfirmed create resolves to nothing');
  assert.deepEqual(Object.keys(ingest.draftRecord(plan.drafts[0])).sort(), ['address', 'aliases', 'builder', 'canonical_name', 'po_numbers']);
});

// ── fetchCalendarEvents (published handler) ─────────────────────────────────
test('calendar: repeated visits for an existing customer + address attach to one Job, across runs', async () => {
  const db = memoryDb({
    Jobs: PULTE,
    CalendarEvents: [
      calEvent('g1', '2026-09-02', 'Pulte Homes - 2154 Jordanelle Ridge', { address: '2154 Jordanelle Ridge Dr, Heber City, UT 84032' }),
      calEvent('g2', '2026-09-03', 'YA - Pulte Home - 2154 Jordanelle Ridge Drive'),
      calEvent('g3', '2026-09-04', 'pulte home - 2154 jordanelle ridge'),
      calEvent('g4', '2026-09-05', 'Pulte warranty', { po_number: '4455667' }),
    ],
  });
  const first = await run(calendarHandler, db, WINDOW);
  assert.equal(jobsCreated(db), 0);
  assert.deepEqual(first.auto_created_jobs, []);
  for (const g of ['g1', 'g2', 'g3', 'g4']) {
    assert.equal(feeFor(db, g).job_id, 'job-a', g);
    assert.equal(feeFor(db, g).needs_review, false, g);
  }
  // Next day: another appointment for the same house.
  db.table('CalendarEvents').push(calEvent('g5', '2026-09-09', 'Pulte Homes - 2154 Jordanelle Ridge Dr.', { address: '2154 Jordanelle Ridge Drive' }));
  await run(calendarHandler, db, WINDOW);
  assert.equal(jobsCreated(db), 0);
  assert.equal(feeFor(db, 'g5').job_id, 'job-a');
  assert.equal(db.table('Jobs').length, 4, 'no Job record added, merged or deleted');
});

test('calendar: a new customer + address repeated in one batch creates exactly one Job', async () => {
  const db = memoryDb({
    Jobs: [{ id: 'u1', canonical_name: 'Toll Brothers - 5 Pine Ln', builder: 'Toll Brothers', created_date: '2026-01-01' }],
    CalendarEvents: [
      calEvent('n4', '2026-09-05', 'Warranty callback', { po_number: '1234567' }),
      calEvent('n3', '2026-09-04', 'YA - Holmes Home - 88 Oak Drive'),
      calEvent('n2', '2026-09-03', 'Holmes Homes – 88 Oak', { address: '88 Oak Dr' }),
      calEvent('n1', '2026-09-02', 'Holmes Homes - 88 Oak Dr', { address: '88 Oak Drive, Lehi, UT 84043', po_number: '1234567' }),
    ],
  });
  const res = await run(calendarHandler, db, WINDOW);
  assert.deepEqual(db.bulkCreates.Jobs, [1], 'one bulk create with one Job');
  const created = db.table('Jobs').find((j) => j.id !== 'u1');
  assert.equal(created.canonical_name, 'holmes homes - 88 oak dr', 'named after the first visit');
  assert.deepEqual(created.po_numbers, ['1234567']);
  assert.equal(created.address, '88 Oak Drive, Lehi, UT 84043');
  assert.deepEqual(res.auto_created_jobs, ['holmes homes - 88 oak dr']);
  for (const g of ['n1', 'n2', 'n3', 'n4']) assert.equal(feeFor(db, g).job_id, created.id, g);
  // A later run with another visit attaches to the job created before.
  db.table('CalendarEvents').push(calEvent('n5', '2026-09-10', 'Holmes Homes - 88 Oak Dr', { address: '88 Oak Dr' }));
  await run(calendarHandler, db, WINDOW);
  assert.deepEqual(db.bulkCreates.Jobs, [1]);
  assert.equal(feeFor(db, 'n5').job_id, created.id);
});

test('calendar: different lot, unit and customer stay separate; the next lot attaches to its own Job', async () => {
  const lot12 = { id: 'lot12', canonical_name: 'Ivory Homes - 123 Main St Lot 12', builder: 'Ivory Homes', address: '123 Main St Lot 12, Lehi, UT', created_date: '2026-02-01' };
  const unit1 = { id: 'unit1', canonical_name: 'Pulte Home - 2160 Jordanelle Ridge Unit 1', builder: 'Pulte Home', created_date: '2026-03-01' };
  const db = memoryDb({
    Jobs: [...PULTE, lot12, unit1],
    CalendarEvents: [
      calEvent('s1', '2026-09-02', 'Ivory Homes - 123 Main St Lot 13', { address: '123 Main Street Lot 13' }),
      calEvent('s2', '2026-09-08', 'Ivory Homes - 123 Main St Lot 13', { address: '123 Main St Lot 13, Lehi, UT' }),
      calEvent('s3', '2026-09-02', 'Pulte Home - 2160 Jordanelle Ridge Unit 2', { address: '2160 Jordanelle Ridge Dr Unit 2' }),
      calEvent('s4', '2026-09-02', 'Toll Brothers - 2154 Jordanelle Ridge', { address: '2154 Jordanelle Ridge Dr' }),
      calEvent('s5', '2026-09-02', 'Pulte Home - 2156 Jordanelle Ridge', { address: '2156 Jordanelle Ridge Dr' }),
      calEvent('s6', '2026-09-03', 'Ivory Homes - 123 Main St Lot 12', { address: '123 Main St Lot 12' }),
    ],
  });
  await run(calendarHandler, db, WINDOW);
  assert.equal(jobsCreated(db), 3, 'lot 13, unit 2 and the Toll Brothers house');
  const s1 = feeFor(db, 's1').job_id;
  assert.equal(feeFor(db, 's2').job_id, s1, 'lot 13 repeated in the batch: one Job');
  const ids = [s1, feeFor(db, 's3').job_id, feeFor(db, 's4').job_id];
  assert.equal(new Set(ids).size, 3);
  for (const id of ids) assert.ok(!['job-a', 'job-b', 'job-c', 'job-d', 'lot12', 'unit1'].includes(id), id);
  assert.equal(feeFor(db, 's5').job_id, 'job-d');
  assert.equal(feeFor(db, 's6').job_id, 'lot12');
});

test('calendar: ambiguous events stay unlinked and flagged; existing links and skipped rows create nothing', async () => {
  const dr = { id: 't1', canonical_name: 'Holmes Homes - 88 Oak Dr', created_date: '2026-01-01' };
  const ct = { id: 't2', canonical_name: 'Holmes Homes - 88 Oak Ct', created_date: '2026-01-02' };
  const db = memoryDb({
    Jobs: [...PULTE, dr, ct],
    CalendarEvents: [
      calEvent('a1', '2026-09-02', 'Holmes Homes - 88 Oak', { address: '88 Oak' }),
      calEvent('a2', '2026-09-02', 'Pulte Home - 2154 Jordanelle Ridge Unit 2', { address: '2154 Jordanelle Ridge Dr Unit 2' }),
      calEvent('a3', '2026-09-03', 'Pulte Home 2154 Jordanelle Ridge'),
      // Already linked to a duplicate record: the link is kept, not re-pointed.
      calEvent('k1', '2026-09-04', 'Pulte Homes - 2154 Jordanelle Ridge'),
      // Manually adjusted line with no job: skipped, so it must not create a job.
      calEvent('k2', '2026-09-04', 'Brand New Builder - 1 New St', { address: '1 New St' }),
    ],
    FeeLines: [
      { id: 'fl-k1', calendar_event_id: 'k1', job_id: 'job-c', job_date: '2026-09-04', invoice_month: '2026-09', source: 'calendar', written_by: 'calendar' },
      { id: 'fl-k2', calendar_event_id: 'k2', job_id: null, job_date: '2026-09-04', invoice_month: '2026-09', source: 'calendar', written_by: 'calendar', manually_adjusted: true },
    ],
  });
  const res = await run(calendarHandler, db, WINDOW);
  assert.equal(jobsCreated(db), 0, 'nothing is created on doubtful evidence');
  for (const g of ['a1', 'a2', 'a3']) {
    assert.equal(feeFor(db, g).job_id, null, g);
    assert.equal(feeFor(db, g).needs_review, true, g);
  }
  assert.deepEqual(res.job_match_reviews.map((r) => [r.id, r.reason]), [
    ['a1', 'existing_duplicates_disagree'], ['a2', 'similar_address'], ['a3', 'similar_name'],
  ]);
  assert.deepEqual(res.job_match_reviews[0].candidate_job_ids, ['t1', 't2']);
  assert.equal(feeFor(db, 'k1').job_id, 'job-c');
  assert.equal(feeFor(db, 'k2').job_id, null);
});

// ── fetchProbuildPosts (published handler) ──────────────────────────────────
test('ProBuild: posts attach to the canonical Job, a new project creates one Job, a project link wins', async () => {
  const post = (projectId, postId, day) => ({ projectId, postId, post: { createdAt: `2026-09-${day}T18:00:00Z`, message: 'Installed windows, all complete.' } });
  globalThis.__testProbuild = {
    projects: [
      { id: 'p1', name: 'Pulte Homes - 2154 Jordanelle Ridge Dr' },
      { id: 'p2', name: 'pulte home - 2154 jordanelle ridge' },
      { id: 'p3', name: 'Holmes Homes - 607 Daybreak' },
      { id: 'p-linked', name: 'Jordanelle punch list' },
      { id: 'p5', name: 'Pulte Home 2154 Jordanelle Ridge' },
    ],
    posts: [post('p1', 'post-1', '02'), post('p1', 'post-2', '05'), post('p2', 'post-3', '03'), post('p3', 'post-4', '02'), post('p3', 'post-5', '03'), post('p3', 'post-6', '04'), post('p-linked', 'post-7', '04'), post('p5', 'post-8', '04')],
  };
  const db = memoryDb({ Jobs: PULTE, ProbuildProjectLink: [{ id: 'l1', project_id: 'p-linked', job_id: 'job-d', updated_date: '2026-09-01' }] });
  const res = await run(probuildHandler, db, WINDOW);
  const fee = (id) => feeFor(db, id, 'probuild_post_id');
  assert.deepEqual(db.bulkCreates.Jobs, [1], 'only the Holmes project is new');
  for (const p of ['post-1', 'post-2', 'post-3']) assert.equal(fee(p).job_id, 'job-a', p);
  const holmes = fee('post-4').job_id;
  assert.ok(holmes && !holmes.startsWith('pending:'));
  assert.equal(fee('post-5').job_id, holmes);
  assert.equal(fee('post-6').job_id, holmes);
  assert.equal(fee('post-7').job_id, 'job-d', 'owner-confirmed project link');
  assert.equal(fee('post-8').job_id, null);
  assert.equal(fee('post-8').needs_review, true);
  assert.deepEqual(res.job_match_reviews.map((r) => [r.post_id, r.reason]), [['post-8', 'similar_name']]);
  // Second run: the same posts plus a new one create nothing more.
  globalThis.__testProbuild.posts.push(post('p3', 'post-9', '10'));
  await run(probuildHandler, db, WINDOW);
  assert.deepEqual(db.bulkCreates.Jobs, [1]);
  assert.equal(fee('post-9').job_id, holmes);
});

// ── resolveFieldReport (published handler) ──────────────────────────────────
test('field report uploads are filed on the canonical Job; doubtful groups keep the given record', async () => {
  const dr = { id: 't1', canonical_name: 'Holmes Homes - 88 Oak Dr', created_date: '2026-01-01' };
  const ct = { id: 't2', canonical_name: 'Holmes Homes - 88 Oak Ct', created_date: '2026-01-02' };
  const db = memoryDb({
    Jobs: [...PULTE, dr, ct],
    CalendarEvents: [{ id: 'ev-1', job_id: 'job-b', job_name: 'Pulte Homes - 2154 Jordanelle Ridge', event_date: '2026-09-02' }],
  });
  let res = await run(fieldReportHandler, db, { action: 'upload', job_id: 'job-c', photos: ['https://files.test/p.jpg'] });
  assert.equal(res.job_id, 'job-a');
  res = await run(fieldReportHandler, db, { action: 'upload', event_id: 'ev-1' });
  assert.equal(res.job_id, 'job-a');
  assert.equal(db.table('CalendarEvents')[0].report_status, 'ok');
  res = await run(fieldReportHandler, db, { action: 'upload', job_id: 't2' });
  assert.equal(res.job_id, 't2', 'Dr vs Ct is not redirected');
  db.fail.add('Jobs');
  res = await run(fieldReportHandler, db, { action: 'upload', job_id: 'job-c' });
  assert.equal(res.job_id, 'job-c', 'if Jobs cannot be read the given record is kept');
  assert.deepEqual(db.table('JobNotes').map((n) => n.job_id), ['job-a', 'job-a', 't2', 'job-c']);
  assert.equal(db.table('Jobs').length, 6, 'no Job record changed');
});
