// FeeLine companion selection and service/labor extraction regressions.
// Fixture IDs are the ones from the read-only finance scan, used as labels and
// provenance only (no production data is read). Dates and note texts are modelled on
// the scan's description; amounts are the scan's.
import './support/register-src-alias.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

// Loaded after the alias hook is registered (static imports would resolve first).
const core = await import('../base44/shared/billingCore.js');
const { withCompanions, buildSupersededSet, isReady, isMatchBlocked } = await import('../src/lib/invoicingFilters.js');
const { invoicingStats } = await import('../src/lib/invoicingStats.js');
const { withComputedAmounts } = await import('../src/lib/feeMath.js');
const { statusTag } = await import('../src/lib/feeUI.js');

// closeMonthSnapshot (published handler), bundled and run in memory as a dry run: no writes.
const SDK_STUB = { name: 'sdk-stub', setup(b) {
  b.onResolve({ filter: /^npm:@base44\/sdk/ }, () => ({ path: 'sdk', namespace: 'stub' }));
  b.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const createClientFromRequest = () => globalThis.__snapClient;', loader: 'js' }));
} };
const snapshotBundle = await build({ entryPoints: [fileURLToPath(new URL('../base44/functions/closeMonthSnapshot/entry.ts', import.meta.url))], bundle: true, platform: 'neutral', format: 'esm', write: false, logLevel: 'silent', plugins: [SDK_STUB] });
const snapshotHandler = (await import('data:text/javascript;base64,' + Buffer.from(snapshotBundle.outputFiles[0].text).toString('base64'))).default;
async function closeMonth(fees, events) {
  const list = (rows) => ({ list: async (_s, limit = 1000, skip = 0) => rows.slice(skip, skip + limit).map((r) => ({ ...r })), create: async () => { throw new Error('dry run must not write'); } });
  const entities = { FeeLines: list(fees), CalendarEvents: list(events), MonthCloseSnapshot: list([]) };
  globalThis.__snapClient = { auth: { me: async () => ({ id: 'owner', role: 'admin' }) }, asServiceRole: { entities } };
  const json = await (await snapshotHandler(new Request('http://test.local/fn', { method: 'POST', body: JSON.stringify({ month: '2026-09', dry_run: true }) }))).json();
  assert.equal(json.error, undefined, json.error);
  return json;
}

// ── Service-report extraction ────────────────────────────────────────────────
const priced = (note) => {
  const ext = core.extractExplicitService(note);
  const service = core.parseServiceBilling(note, ext.man_hours, ext.trip_charges);
  return { ext, service, labor: core.computeLaborAmt({ man_hours: ext.man_hours, trip_charges: ext.trip_charges, service_material: service.material }) };
};

test('ProBuild "N man <material> hours" reports are priced at the material rate', () => {
  // FeeLine 6aaa44df2f4c4298172393f1, YA Toll Brothers 72 Jordanelle Ridge, 9/15, post -P1c3hAgVRd-pLb-15d2
  // FeeLine 6aa8e96cf314c5e896fd5366, Ivory Poonam Kale Res 103 Bell Canyon Cove, 9/14, post -P1YIDv0cbb2rknNgzez
  for (const [note, hours, material, rate, labor] of [
    ['2 man vinyl hours', 2, 'vinyl', 100, 200],
    ['5 man vinyl man hour', 5, 'vinyl', 100, 500],
    ['Replaced sash. 2 man vinyl hours', 2, 'vinyl', 100, 200],
    ['3 man composite hours', 3, 'composite', 125, 375],
    ['2 man composite man hours', 2, 'composite', 125, 250],
    ['1 man wood hour', 1, 'wood', 150, 150],
    ['2 man-wood-man-hours', 2, 'wood', 150, 300],
  ]) {
    const result = priced(note);
    assert.equal(result.ext.man_hours, hours, note);
    assert.equal(result.ext.needs_review, false, note);
    assert.equal(result.service.material, material, note);
    assert.equal(result.service.rate, rate, note);
    assert.equal(result.service.review, false, note);
    assert.equal(result.service.labor, labor, note);
    assert.equal(result.labor, labor, `${note}: the stored line computes the same labor`);
  }
});

test('ambiguous service quantity or material stays in review and is never guessed', () => {
  for (const note of ['man vinyl hours', 'two man vinyl hours', '2 man vinyl hours and 1 man composite hour', '2 man hours', '2 man vinyl composite hours', 'no charge 2 man vinyl hours']) {
    const { ext, service } = priced(note);
    assert.ok(ext.needs_review || service.review, `${note} must be held for review`);
  }
  // Only explicit quantities: a crew size is not a man-hour count.
  assert.equal(core.extractExplicitService('2 man crew set the windows').man_hours, null);
});

test('calendar "Labor$" notation is read, and a stray minus still goes to review', () => {
  for (const [text, amount] of [
    ['Labor$3,828-win', 3828], ['Labor$75 trip charge', 75], ['Labor$110', 110], ['Labor$2,475-win', 2475],
    ['Labor$470-win2', 470], ['Labor$100', 100], ['Labor$1240win', 1240], ['Labor$-1,576-win', 1576],
    ['Labor$5,380.00/win', 5380], ['Labor$-3168-win', 3168], ['Labor $-3168 – win', 3168], ['LABOR$2232', 2232],
    // A thousands comma is not the end of the amount (was read as $3).
    ['Labor $3,168.00win', 3168],
  ]) assert.equal(core.extractLaborAmount(text), amount, text);
  assert.equal(core.pricingReview('Labor$-3168-win'), null, 'the ticket notation is not a pricing question');
  for (const text of ['Labor$-3168', 'Labor $-50 credit', 'Labor 3 hours']) {
    assert.equal(core.extractLaborAmount(text), null, text);
  }
  assert.ok(core.pricingReview('Labor$-3168')?.reason);
  assert.ok(core.pricingReview('Install\nLabor $-50 credit')?.reason);
});

// ── Companion selection: calendar labor line vs. $0 ProBuild twin ─────────────
const cal = (id, event, job, date, labor, extra = {}) => ({
  id, source: 'calendar', written_by: 'calendar', calendar_event_id: event, job_id: job, job_date: date, invoice_month: date.slice(0, 7),
  calendar_labor_amt: labor, note_text: `Labor $${labor}`, calendar_note_text: `Labor $${labor}`, labor_amt: labor, fee_amt: labor / 10,
  fee_pct: 0.1, billable: true, needs_review: false, match_confidence: 'high', ...extra,
});
const twin = (id, job, date, extra = {}) => ({
  id, source: 'probuild', written_by: 'probuild', probuild_post_id: `post-${id}`, job_id: job, job_date: date, invoice_month: date.slice(0, 7),
  note_text: 'Install complete, photos attached', man_hours: null, trip_charges: null, labor_amt: 0, fee_amt: 0, fee_pct: 0.1, billable: true,
  needs_review: false, service_review_status: 'ready', pricing_review_reason: null, match_confidence: 'high', ...extra,
});
// calendar nonzero line -> zero ProBuild twin(s), CalendarEvent, labor
const PAIRS = [
  { cal: cal('6aa4d305d0136dac8aa846b9', '6aa4a8a2e52bec2a00fe3b52', 'job-patterson-4-belmont', '2026-09-17', 2232), twins: [twin('6aacdc983d73219e708bb7a9', 'job-patterson-4-belmont', '2026-09-17')] },
  { cal: cal('6aac6919b86581bf7968e564', '6aac690f749381d99253fdab', 'job-holmes-342-346', '2026-09-16', 75, { note_text: 'Labor $75 trip charge', calendar_note_text: 'Labor $75 trip charge' }), twins: [twin('6aacdc983d73219e708bb7a7', 'job-holmes-342-346', '2026-09-17')] },
  { cal: cal('6aa82f17196fe9720fc51fd5', '6aa82f100986537c888597d7', 'job-cadence-159-beacon', '2026-09-15', 1503), twins: [twin('6aacdc983d73219e708bb7a8', 'job-cadence-159-beacon', '2026-09-15')] },
  { cal: cal('6aa3a79dea182b49ae07f29d', '6aa3a742b0c5ab87730d87c7', 'job-pulte-18-wasatch', '2026-09-10', 1293), twins: [twin('6aab8c3e1a5a28f90c498d93', 'job-pulte-18-wasatch', '2026-09-11')] },
  // Post identity: the calendar line merged this post; the twin sits on a duplicate job record.
  { cal: cal('6aa3a79dea182b49ae07f29c', '6aa3a742b0c5ab87730d87c6', 'job-cadence-151-beacon', '2026-09-10', 75, { source: 'both', probuild_post_id: 'post-cadence-151' }), twins: [twin('6aab8c3e1a5a28f90c498d92', 'job-cadence-151-beacon-dup', '2026-09-10', { probuild_post_id: 'post-cadence-151' })] },
  // Landscope Lakeview 177: two calendar lines, two twins. 94 is nearest the install; 95 is equidistant (ambiguous owner).
  { cal: cal('6aa256c5a7be826ab5a396a8', '6aa256b0cb0052a931d701e5', 'job-landscope-177', '2026-09-15', 3168), twins: [twin('6aab8c3e1a5a28f90c498d94', 'job-landscope-177', '2026-09-15'), twin('6aab8c3e1a5a28f90c498d95', 'job-landscope-177', '2026-09-13')] },
  { cal: cal('6aa3a79dea182b49ae07f29a', '6aa3a742b0c5ab87730d87c4', 'job-landscope-177', '2026-09-11', 250), twins: [] },
  // Event identity: the twin has no job link; the audit matched its post to event ...c3.
  { cal: cal('6aa3a79dea182b49ae07f299', '6aa3a742b0c5ab87730d87c3', 'job-landscope-178', '2026-09-11', 250), twins: [twin('6aa256c5a7be826ab5a396a6', null, '2026-09-12', { probuild_post_id: 'post-landscope-178-service', match_confidence: 'unmatched' })] },
];
const ROWS = PAIRS.flatMap((p) => [p.cal, ...p.twins]);
const CAL_IDS = PAIRS.map((p) => p.cal.id);
const TWIN_IDS = PAIRS.flatMap((p) => p.twins.map((t) => t.id));
const AUDIT_MATCHES = { '6aa3a742b0c5ab87730d87c3': ['post-landscope-178-service'] };
const EVENTS = PAIRS.map((p) => ({ google_event_id: p.cal.calendar_event_id, report_status: 'ok', matched_post_ids: AUDIT_MATCHES[p.cal.calendar_event_id] || [] }));
const RSM = new Map(EVENTS.map((e) => [e.google_event_id, e.report_status]));
const EXPECTED_FEE = 884.6; // (2232 + 75 + 1503 + 1293 + 75 + 3168 + 250 + 250) × 10%

// The Invoicing page pipeline (Invoicing.jsx): computed amounts, companions, supersession.
function invoicingView(rows, events) {
  const billingRows = withCompanions(withComputedAmounts(rows), events);
  const superseded = buildSupersededSet(billingRows, events);
  const visible = billingRows.filter((r) => !superseded.has(r.id));
  return { billingRows, superseded, visible, stats: invoicingStats(billingRows, RSM, superseded) };
}

test('each calendar labor line is shown and billed; its $0 ProBuild twin is folded into it', () => {
  const { billingRows, superseded, visible, stats } = invoicingView(ROWS, EVENTS);
  assert.deepEqual(visible.map((r) => r.id).sort(), [...CAL_IDS].sort(), 'only the calendar lines are listed');
  for (const id of TWIN_IDS) assert.ok(superseded.has(id), `${id} folded`);
  assert.equal(stats.readyCount, 8);
  assert.equal(stats.readyTotal, EXPECTED_FEE);
  assert.equal(stats.matchBlockedCount, 0);
  const of = new Map(billingRows.filter((r) => r._companion_folded).map((r) => [r.id, r._companion_of]));
  assert.deepEqual(Object.fromEntries(of), {
    '6aacdc983d73219e708bb7a9': '6aa4d305d0136dac8aa846b9',
    '6aacdc983d73219e708bb7a7': '6aac6919b86581bf7968e564',
    '6aacdc983d73219e708bb7a8': '6aa82f17196fe9720fc51fd5',
    '6aab8c3e1a5a28f90c498d93': '6aa3a79dea182b49ae07f29d',
    '6aab8c3e1a5a28f90c498d92': '6aa3a79dea182b49ae07f29c',
    '6aab8c3e1a5a28f90c498d94': '6aa256c5a7be826ab5a396a8',
    '6aab8c3e1a5a28f90c498d95': null,
    '6aa256c5a7be826ab5a396a6': '6aa3a79dea182b49ae07f299',
  });
  assert.deepEqual(billingRows.find((r) => r.id === '6aa4d305d0136dac8aa846b9')._companion_ids, ['6aacdc983d73219e708bb7a9']);
  // Folding is display-only: the raw rows are not changed.
  assert.equal(ROWS.some((r) => '_companion_folded' in r || '_companion_ids' in r), false);
});

test('an unlinked twin is folded only through event/post identity, never guessed', () => {
  const { visible, stats } = invoicingView(ROWS, []);
  assert.deepEqual(visible.filter((r) => !CAL_IDS.includes(r.id)).map((r) => r.id), ['6aa256c5a7be826ab5a396a6'], 'without the audit match it stays visible');
  assert.equal(stats.readyTotal, EXPECTED_FEE, 'a $0 line never changes the total either way');
});

test('Dashboard, sidebar, statement export and month close agree with Invoicing', async () => {
  const { stats } = invoicingView(ROWS, EVENTS);
  // Dashboard: companion rows, default supersession (reads the fold flags).
  const dashboard = invoicingStats(withCompanions(withComputedAmounts(ROWS), EVENTS), RSM);
  assert.equal(dashboard.readyTotal, stats.readyTotal);
  assert.equal(dashboard.readyCount, stats.readyCount);
  // Sidebar and statement export: ready rows with the event-aware set.
  const rows = withCompanions(withComputedAmounts(ROWS), EVENTS);
  const ss = buildSupersededSet(rows, EVENTS);
  const ready = rows.filter((r) => isReady(r, RSM, ss));
  assert.deepEqual(ready.map((r) => r.id).sort(), [...CAL_IDS].sort());
  // closeMonthSnapshot (published handler, dry run).
  const snap = await closeMonth(ROWS, EVENTS);
  assert.equal(snap.invoiced_subtotal, EXPECTED_FEE);
  assert.equal(snap.invoiced_line_count, 8);
  assert.equal(snap.total_rows, ROWS.length);
});

// ── Double counting and preservation ─────────────────────────────────────────
test('a priced ProBuild line beside calendar notes labor is held, not counted twice, until confirmed', () => {
  const calToll = cal('cal-toll-72', 'ev-toll-72', 'job-toll-72', '2026-09-15', 1000);
  // 6aaa44df... after the "2 man vinyl hours" fill: $200.
  const pb = twin('6aaa44df2f4c4298172393f1', 'job-toll-72', '2026-09-15', { man_hours: 2, service_material: 'vinyl', service_rate: 100, labor_amt: 200, fee_amt: 20 });
  const held = invoicingView([calToll, pb], []);
  const row = held.billingRows.find((r) => r.id === pb.id);
  assert.match(row._companion_review, /Calendar labor \(\$1000 on 2026-09-15\)/);
  assert.equal(isMatchBlocked(row), true);
  assert.equal(statusTag(row).label, 'Review');
  assert.equal(held.stats.readyTotal, 100, 'only the calendar line is ready');
  assert.equal(held.stats.matchBlockedTotal, 20, 'the held line is visible in Needs review');
  // Once someone confirms (manual adjustment), both bill.
  const confirmed = invoicingView([calToll, { ...pb, manually_adjusted: true }], []);
  assert.equal(confirmed.stats.readyTotal, 120);
  // Month close holds it too.
  return closeMonth([calToll, pb], []).then((snap) => assert.equal(snap.invoiced_subtotal, 100));
});

test('complementary lines are not held: trip-charge calendar amount, merged-hours calendar line', () => {
  const trip = cal('cal-trip', 'ev-trip', 'job-a', '2026-09-10', 75, { note_text: 'Labor $75 trip charge', calendar_note_text: 'Labor $75 trip charge' });
  const hours = twin('pb-hours', 'job-a', '2026-09-10', { man_hours: 2, service_material: 'vinyl', labor_amt: 200 });
  const merged = cal('cal-merged', 'ev-merged', 'job-b', '2026-09-10', null, { source: 'both', probuild_post_id: 'post-merged', man_hours: 3, labor_amt: 300, note_text: 'Visit', calendar_note_text: 'Visit' });
  const other = twin('pb-other', 'job-b', '2026-09-11', { man_hours: 1, service_material: 'vinyl', labor_amt: 100 });
  const { stats, billingRows } = invoicingView([trip, hours, merged, other], []);
  assert.equal(billingRows.some((r) => r._companion_review), false);
  assert.equal(stats.readyTotal, 67.5);
});

test('manual, billed, reviewed and unrelated lines are never folded', () => {
  const calLine = cal('cal-x', 'ev-x', 'job-x', '2026-09-10', 1200);
  const keep = [
    twin('pb-manual', 'job-x', '2026-09-10', { manually_adjusted: true }),
    twin('pb-billed', 'job-x', '2026-09-10', { billed_to_bfs: true }),
    // Unreadable quantity: may be billable work, so it stays in Needs review.
    twin('pb-question', 'job-x', '2026-09-10', { needs_review: true, service_review_status: 'review', pricing_review_reason: 'Man-hour quantity is not explicit.' }),
    twin('pb-far', 'job-x', '2026-09-20'),
    twin('pb-other-job', 'job-y', '2026-09-10'),
  ];
  const zeroCal = cal('cal-zero', 'ev-zero', 'job-z', '2026-09-10', null, { labor_amt: 0, note_text: 'Punch list', calendar_note_text: 'Punch list' });
  const zeroTwin = twin('pb-zero', 'job-z', '2026-09-10');
  const { superseded, visible, stats } = invoicingView([calLine, ...keep, zeroCal, zeroTwin], []);
  for (const r of [...keep, zeroTwin]) assert.equal(superseded.has(r.id), false, r.id);
  assert.equal(visible.length, 8);
  assert.equal(stats.readyTotal, 120, 'the calendar line still bills once');
  assert.equal(stats.matchBlockedCount, 1, 'the open quantity question stays in review');
});
