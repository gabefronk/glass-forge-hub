// Finance-gap regressions for the published ingest handlers:
//   - fetchCalendarEvents reads the "Labor$" notation and creates / upserts one
//     calendar FeeLine per event with labor, without touching manual, billed, app or
//     locked rows and without replacing a recorded amount with nothing;
//   - fetchProbuildPosts fills an explicit man-hour quantity + material ("2 man vinyl
//     hours") into an untouched $0 ProBuild line, and leaves anything else alone.
// Record IDs are the ones from the read-only finance scan and are used as fixture
// labels / provenance only. The event texts are representative "Labor$" shapes: the
// real descriptions were not read. The Base44 SDK and the ProBuild client are stubbed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

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
async function loadHandler(path) {
  const out = await build({ entryPoints: [here(path)], bundle: true, platform: 'neutral', format: 'esm', write: false, logLevel: 'silent', plugins: [stubPlugin] });
  return (await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'))).default;
}
const calendarHandler = await loadHandler('../functions/fetchCalendarEvents/entry.ts');
const probuildHandler = await loadHandler('../functions/fetchProbuildPosts/entry.ts');

function memoryDb(seed = {}) {
  const tables = new Map();
  let seq = 0;
  const table = (name) => {
    if (!tables.has(name)) tables.set(name, (seed[name] || []).map((r) => structuredClone(r)));
    return tables.get(name);
  };
  const entity = (name) => ({
    list: async (_sort, limit = 1000, skip = 0) => table(name).slice(skip, skip + limit).map((r) => structuredClone(r)),
    filter: async (q = {}) => table(name).filter((r) => Object.entries(q).every(([k, v]) => r[k] === v)).map((r) => structuredClone(r)),
    bulkCreate: async (rows) => rows.map((r) => {
      const row = { ...structuredClone(r), id: r.id || `${name.toLowerCase()}-new-${++seq}`, created_date: `2026-09-18T12:00:00.${String(seq).padStart(3, '0')}Z` };
      table(name).push(row);
      return structuredClone(row);
    }),
    bulkUpdate: async (rows) => {
      assert.equal(new Set(rows.map((r) => r.id)).size, rows.length, `one ${name} patch per record`);
      for (const p of rows) Object.assign(table(name).find((x) => x.id === p.id), structuredClone(p));
      return rows;
    },
  });
  const entities = new Proxy({}, { get: (_, name) => entity(String(name)) });
  const client = { entities, asServiceRole: { entities, integrations: { Core: { UploadFile: async () => ({ file_url: 'https://files.test/x' }) } } }, auth: { me: async () => ({ id: 'owner', role: 'admin' }) } };
  return { table, client };
}
async function run(handler, db, body) {
  globalThis.__testBase44 = db.client;
  const json = await (await handler(new Request('http://test.local/fn', { method: 'POST', body: JSON.stringify(body) }))).json();
  assert.equal(json.error, undefined, `handler error: ${json.error}`);
  return json;
}
const byEvent = (db, id) => db.table('FeeLines').filter((f) => f.calendar_event_id === id);
const byId = (db, id) => db.table('FeeLines').find((f) => f.id === id);

// ── The ten calendar events with labor notation and no correct FeeLine ($18,422) ──
const MISSING = [
  ['6a8164447a2945240aaa8f4e', '2026-04-21', 'HARPER & CO - Chynoweth', 'Install windows\nLabor$3,828-win', 3828],
  ['6a8164447a2945240aaa8f9a', '2026-05-08', 'Holmes Homes - 101-107 Daybreak Brownstone', 'Screens\nLabor$75 trip charge', 75],
  ['6a8164457c798c979bfefea5', '2026-07-16', 'Valor - 69 Ridgeview', 'Pull basement window\nLabor$110', 110],
  ['6a8164457c798c979bfefeb9', '2026-07-21', 'Patterson Homes - 506 Mitchell', 'Main floor\nLabor$2,475-win', 2475],
  ['6a8164457c798c979bfefeb6', '2026-07-21', 'Patterson Homes - 506 Mitchell', 'Basement\nLabor$470-win2', 470],
  ['6a8164457c798c979bfefed2', '2026-07-27', 'Huish - Dyer', 'Service\nLabor$100', 100],
  ['6a8164457c798c979bfefed5', '2026-07-28', 'Holmes Homes - 305 Lakeview', 'Upper\nLabor$1240win', 1240],
  ['6a8164457c798c979bfefed4', '2026-07-28', 'Holmes Homes - 305 Lakeview', 'Lower\nLabor$-1,576-win', 1576],
  ['6a8a3b3eb7a590e684f713de', '2026-08-26', 'Holmes Homes - 263-266 Deer Springs', 'Building B\nLabor$5,380.00/win', 5380],
  ['6aa256b0cb0052a931d701e3', '2026-09-15', 'Landscope - 178 Mayflower', 'Install\nLabor$-3168-win', 3168],
];
const event = (id, date, job_name, scope_notes, extra = {}) => ({
  id: `ce-${id}`, source: 'google', source_status: 'confirmed', google_event_id: id, event_date: date, job_name,
  builder: job_name.split(' - ')[0], address: null, po_number: null, oe_number: null, scope_notes, created_by: 'office@example.com', matched_post_ids: [], ...extra,
});
const jobFor = (name) => ({ id: 'job-' + name.toLowerCase().replace(/[^a-z0-9]+/g, '-'), canonical_name: name, builder: name.split(' - ')[0], aliases: [], created_date: '2026-01-01T00:00:00Z' });
const MISSING_JOBS = [...new Map(MISSING.map(([, , name]) => [name, jobFor(name)])).values()];
const RANGE = { start_date: '2026-03-01', end_date: '2026-09-30' };

test('calendar: each missing Labor$ event gets exactly one calendar FeeLine with its labor ($18,422)', async () => {
  const db = memoryDb({ Jobs: MISSING_JOBS, CalendarEvents: MISSING.map(([id, date, name, notes]) => event(id, date, name, notes)) });
  const res = await run(calendarHandler, db, RANGE);
  assert.equal(res.created, 10);
  let total = 0;
  for (const [id, , name, , labor] of MISSING) {
    const rows = byEvent(db, id);
    assert.equal(rows.length, 1, id);
    const [row] = rows;
    assert.equal(row.calendar_labor_amt, labor, `${id} ${name}`);
    assert.equal(row.labor_amt, labor, id);
    assert.equal(row.fee_amt, Math.round(labor * 10) / 100, id);
    assert.equal(row.source, 'calendar');
    assert.equal(row.job_id, jobFor(name).id, id);
    assert.equal(row.needs_review, false, `${id}: a readable Labor$ amount is ready, not held`);
    total += row.labor_amt;
  }
  assert.equal(total, 18422);
  // Upsert on the event id: a second run adds nothing and changes no amount.
  const again = await run(calendarHandler, db, RANGE);
  assert.equal(again.created, 0);
  assert.equal(db.table('FeeLines').length, 10);
  assert.equal(db.table('FeeLines').reduce((s, r) => s + r.labor_amt, 0), 18422);
});

test('calendar: locked months fill a labor gap only when nothing covers it, held for review', async () => {
  const sheetHolmes = { id: 'sheet-holmes-305', source: 'sheet-import', invoice_month: '2026-07', job_date: '2026-07-28', job_name_raw: 'Holmes Homes - 305 Lakeview', labor_amt: 1240, fee_amt: 124, billable: true };
  const db = memoryDb({
    Jobs: MISSING_JOBS,
    CalendarEvents: MISSING.map(([id, date, name, notes]) => event(id, date, name, notes)),
    FeeLines: [sheetHolmes],
    MonthCloseSnapshot: [{ id: 'snap-apr', month: '2026-04' }],
  });
  const res = await run(calendarHandler, db, RANGE);
  const gaps = new Map(res.locked_month_labor_gaps.map((g) => [g.id, g]));
  // Closed month: never written, reported.
  assert.equal(byEvent(db, '6a8164447a2945240aaa8f4e').length, 0);
  assert.equal(gaps.get('6a8164447a2945240aaa8f4e').reason, 'month_closed');
  assert.equal(gaps.get('6a8164447a2945240aaa8f4e').labor, 3828);
  // Sheet row on the same job within the window: ambiguous which visit it bills, so skipped and reported.
  for (const id of ['6a8164457c798c979bfefed5', '6a8164457c798c979bfefed4']) {
    assert.equal(byEvent(db, id).length, 0, id);
    assert.equal(gaps.get(id).reason, 'existing_line_nearby');
    assert.equal(gaps.get(id).covered_by, 'sheet-holmes-305');
  }
  // Other July events: created, held for review (the sheet may have billed them).
  for (const id of ['6a8164457c798c979bfefea5', '6a8164457c798c979bfefeb9', '6a8164457c798c979bfefeb6', '6a8164457c798c979bfefed2']) {
    const [row] = byEvent(db, id);
    assert.ok(row, id);
    assert.equal(row.needs_review, true, id);
    assert.match(row.pricing_review_reason, /imported sheet rows/);
  }
  assert.equal(res.locked_month_labor_filled, 4);
  // Unlocked months are unchanged behaviour.
  for (const id of ['6a8164447a2945240aaa8f9a', '6a8a3b3eb7a590e684f713de', '6aa256b0cb0052a931d701e3']) assert.equal(byEvent(db, id)[0].needs_review, false, id);
  assert.deepEqual(byId(db, 'sheet-holmes-305'), sheetHolmes, 'the sheet row is untouched');
  // Fills are one-time: the filled events now have a line, so a rerun leaves the locked month alone.
  const again = await run(calendarHandler, db, RANGE);
  assert.equal(again.created, 0);
  assert.equal(again.updated, 3, 'only the unlocked-month rows are refreshed');
});

test('calendar: upserts a $0 line to its Labor$ amount; manual, billed, app rows and recorded amounts are preserved', async () => {
  const base = { source: 'calendar', written_by: 'calendar', job_id: 'job-landscope-178-mayflower', invoice_month: '2026-09', billable: true, fee_pct: 0.1 };
  const seeded = [
    // Landscope 178 Mayflower (event ...e3): recorded at $0 because "Labor$-3168-win" was not read.
    { ...base, id: 'fl-ls178', calendar_event_id: '6aa256b0cb0052a931d701e3', job_date: '2026-09-15', calendar_labor_amt: null, labor_amt: 0, fee_amt: 0, needs_review: true, pricing_review_reason: 'Labor amount contains a minus or separator; confirm the amount.' },
    { ...base, id: 'fl-manual', calendar_event_id: 'ev-manual', job_date: '2026-09-10', calendar_labor_amt: null, labor_amt: 450, fee_amt: 45, manually_adjusted: true },
    { ...base, id: 'fl-billed', calendar_event_id: 'ev-billed', job_date: '2026-09-10', calendar_labor_amt: null, labor_amt: 0, fee_amt: 0, billed_to_bfs: true },
    { ...base, id: 'fl-app', calendar_event_id: 'ev-app', job_date: '2026-09-10', written_by: 'app', calendar_labor_amt: 300, labor_amt: 300, fee_amt: 30 },
    { ...base, id: 'fl-lost', calendar_event_id: 'ev-lost', job_date: '2026-09-11', calendar_labor_amt: 2232, labor_amt: 2232, fee_amt: 223.2 },
  ];
  const db = memoryDb({
    Jobs: [jobFor('Landscope - 178 Mayflower')],
    FeeLines: seeded,
    CalendarEvents: [
      event('6aa256b0cb0052a931d701e3', '2026-09-15', 'Landscope - 178 Mayflower', 'Install\nLabor$-3168-win'),
      event('ev-manual', '2026-09-10', 'Landscope - 178 Mayflower', 'Labor$900'),
      event('ev-billed', '2026-09-10', 'Landscope - 178 Mayflower', 'Labor$900'),
      event('ev-app', '2026-09-10', 'Landscope - 178 Mayflower', 'Labor$900'),
      // The notes were edited and no longer show the amount.
      event('ev-lost', '2026-09-11', 'Landscope - 178 Mayflower', 'Crew confirmed for Thursday'),
    ],
  });
  await run(calendarHandler, db, { start_date: '2026-09-01', end_date: '2026-09-30' });
  const ls = byId(db, 'fl-ls178');
  assert.equal(ls.calendar_labor_amt, 3168);
  assert.equal(ls.labor_amt, 3168);
  assert.equal(ls.fee_amt, 316.8);
  assert.equal(ls.needs_review, false);
  assert.equal(ls.pricing_review_reason, null);
  for (const id of ['fl-manual', 'fl-billed', 'fl-app']) assert.deepEqual(byId(db, id), seeded.find((r) => r.id === id), `${id} untouched`);
  const lost = byId(db, 'fl-lost');
  assert.equal(lost.calendar_labor_amt, 2232, 'a valid amount is never overwritten with nothing');
  assert.equal(lost.labor_amt, 2232);
  assert.equal(lost.needs_review, true);
  assert.match(lost.pricing_review_reason, /recorded \$2232 is kept/);
  assert.equal(db.table('FeeLines').length, 5, 'upserts only: no second line per event');
});

test('calendar: a new labor line beside a manually priced ProBuild line on the job is held, not double counted', async () => {
  const manualProbuild = { id: 'pb-manual', source: 'probuild', written_by: 'probuild', probuild_post_id: 'post-pat4', job_id: 'job-patterson-homes-4-belmont-west', job_date: '2026-09-17', invoice_month: '2026-09', labor_amt: 2232, fee_amt: 223.2, fee_pct: 0.1, billable: true, manually_adjusted: true };
  const db = memoryDb({
    Jobs: [jobFor('Patterson Homes - 4 Belmont West')],
    FeeLines: [manualProbuild],
    CalendarEvents: [event('6aa4a8a2e52bec2a00fe3b52', '2026-09-17', 'Patterson Homes - 4 Belmont West', 'Labor$2,232')],
  });
  await run(calendarHandler, db, { start_date: '2026-09-01', end_date: '2026-09-30' });
  const [row] = byEvent(db, '6aa4a8a2e52bec2a00fe3b52');
  assert.equal(row.labor_amt, 2232);
  assert.equal(row.needs_review, true);
  assert.match(row.pricing_review_reason, /manually adjusted ProBuild line/);
  assert.deepEqual(byId(db, 'pb-manual'), manualProbuild, 'the manual line is untouched');
});

// ── ProBuild service reports stored at $0 ───────────────────────────────────
const TOLL = { id: 'job-toll-72', canonical_name: 'Toll Brothers - 72 Jordanelle Ridge', builder: 'Toll Brothers', created_date: '2026-01-01T00:00:00Z' };
const IVORY = { id: 'job-ivory-kale', canonical_name: 'Ivory Homes - Poonam Kale Res 103 Bell Canyon Cove', builder: 'Ivory Homes', created_date: '2026-01-01T00:00:00Z' };
const zeroService = (id, post, job, date, note, extra = {}) => ({
  id, source: 'probuild', written_by: 'probuild', probuild_post_id: post, probuild_project_id: job === TOLL ? 'proj-toll' : 'proj-ivory', job_id: job.id,
  job_date: date, invoice_month: date.slice(0, 7), job_name_raw: job.canonical_name, note_text: note, probuild_note_text: note, man_hours: null, trip_charges: null,
  labor_amt: 0, fee_amt: 0, fee_pct: 0.1, billable: true, needs_review: true, match_confidence: 'high', service_review_status: 'review',
  pricing_review_reason: 'Man-hour quantity is not explicit.', photo_urls: ['https://files.test/p.jpg'], ...extra,
});
const post = (projectId, postId, createdAt, message) => ({ projectId, postId, post: { createdAt, message } });

test('ProBuild: explicit "N man <material> hours" fills an untouched $0 line; everything else is preserved', async () => {
  const seeded = [
    zeroService('6aaa44df2f4c4298172393f1', '-P1c3hAgVRd-pLb-15d2', TOLL, '2026-09-15', 'Replaced sash. 2 man vinyl hours'),
    zeroService('6aa8e96cf314c5e896fd5366', '-P1YIDv0cbb2rknNgzez', IVORY, '2026-09-14', 'Adjusted slider. 5 man vinyl man hour'),
    zeroService('pb-manual', 'post-manual', TOLL, '2026-09-15', '2 man vinyl hours', { manually_adjusted: true }),
    zeroService('pb-billed', 'post-billed', TOLL, '2026-09-15', '2 man vinyl hours', { billed_to_bfs: true }),
    zeroService('pb-locked', 'post-locked', TOLL, '2026-08-20', '2 man vinyl hours'),
    zeroService('pb-priced', 'post-priced', TOLL, '2026-09-15', '2 man vinyl hours', { man_hours: 1, labor_amt: 100, fee_amt: 10, service_material: 'vinyl', service_review_status: 'ready', needs_review: false, pricing_review_reason: null }),
    zeroService('pb-ambiguous', 'post-ambiguous', TOLL, '2026-09-15', '2 man hours'),
    { id: 'sheet-aug', source: 'sheet-import', invoice_month: '2026-08', job_date: '2026-08-02', labor_amt: 500, billable: true },
  ];
  const db = memoryDb({ Jobs: [TOLL, IVORY], FeeLines: seeded });
  globalThis.__testProbuild = {
    projects: [{ id: 'proj-toll', name: 'YA - Toll Brothers - 72 Jordanelle Ridge' }, { id: 'proj-ivory', name: 'Ivory Homes - Poonam Kale Res 103 Bell Canyon Cove' }],
    posts: [
      post('proj-toll', '-P1c3hAgVRd-pLb-15d2', '2026-09-15T20:00:00Z', 'Replaced sash. 2 man vinyl hours'),
      post('proj-ivory', '-P1YIDv0cbb2rknNgzez', '2026-09-14T20:00:00Z', 'Adjusted slider. 5 man vinyl man hour'),
      post('proj-toll', 'post-manual', '2026-09-15T20:00:00Z', '2 man vinyl hours'),
      post('proj-toll', 'post-billed', '2026-09-15T20:00:00Z', '2 man vinyl hours'),
      post('proj-toll', 'post-locked', '2026-08-20T20:00:00Z', '2 man vinyl hours'),
      post('proj-toll', 'post-priced', '2026-09-15T20:00:00Z', '2 man vinyl hours'),
      post('proj-toll', 'post-ambiguous', '2026-09-15T20:00:00Z', '2 man hours'),
      post('proj-toll', 'post-new', '2026-09-16T20:00:00Z', 'Trim repair 3 man composite hours'),
    ],
  };
  const res = await run(probuildHandler, db, { start_date: '2026-08-01', end_date: '2026-09-30' });
  for (const [id, hours, labor] of [['6aaa44df2f4c4298172393f1', 2, 200], ['6aa8e96cf314c5e896fd5366', 5, 500]]) {
    const row = byId(db, id);
    assert.equal(row.man_hours, hours, id);
    assert.equal(row.service_material, 'vinyl', id);
    assert.equal(row.service_rate, 100, id);
    assert.equal(row.labor_amt, labor, id);
    assert.equal(row.fee_amt, labor / 10, id);
    assert.equal(row.needs_review, false, id);
    assert.equal(row.service_review_status, 'ready', id);
    assert.equal(row.pricing_review_reason, null, id);
    assert.equal(row.job_id, seeded.find((r) => r.id === id).job_id, 'the job link is kept');
  }
  assert.deepEqual(res.service_quantity_filled.map((f) => f.id).sort(), ['6aa8e96cf314c5e896fd5366', '6aaa44df2f4c4298172393f1']);
  for (const id of ['pb-manual', 'pb-billed', 'pb-locked', 'pb-priced', 'pb-ambiguous', 'sheet-aug']) {
    assert.deepEqual(byId(db, id), seeded.find((r) => r.id === id), `${id} untouched`);
  }
  // A new post is priced at the configured composite rate.
  const fresh = db.table('FeeLines').find((f) => f.probuild_post_id === 'post-new');
  assert.equal(fresh.man_hours, 3);
  assert.equal(fresh.labor_amt, 375);
  assert.equal(fresh.needs_review, false);
  // Idempotent: the filled lines now have a quantity, so a rerun changes nothing.
  const before = structuredClone(db.table('FeeLines'));
  const again = await run(probuildHandler, db, { start_date: '2026-08-01', end_date: '2026-09-30' });
  assert.deepEqual(again.service_quantity_filled, []);
  assert.deepEqual(db.table('FeeLines'), before);
});
