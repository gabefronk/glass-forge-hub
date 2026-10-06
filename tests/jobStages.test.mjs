import test from 'node:test';
import assert from 'node:assert/strict';
import { STAGES, jobProgress } from '../src/lib/jobStages.js';

const TODAY = '2026-10-03';
const done = { key: 'complete' };
const keys = (p) => Object.fromEntries(p.reached.map((s) => [s.key, s.skipped ? 'skipped' : s.date]));

const OQUIRRH = [
  { id: 'a', event_date: '2026-09-10', scope_notes: 'PO 7323212\nOE 79661924\nSale: $11,436.64\nBrand: Amsco\nOrdered: 2026-09-10\nSales Tracker DAILY SALES row 2539' },
  { id: 'b', event_date: '2026-09-24', report_status: 'ok', scope_notes: 'Amsco direct – 9/23\nQTY.29\n09-2129\nOE 79661924-01\nGabe/Ragen\n\nLabor$1548-win\n' },
  { id: 'c', event_date: '2026-10-02', report_status: 'ok', scope_notes: 'Please install sheetrock windows.\n | Auto-reconciled: field report filed 2026-10-02.' },
];
const OQUIRRH_REPORTS = [{ date: '2026-09-23', message: 'Srw in bed 2', photos: ['1', '2'] }, { date: '2026-10-02', message: '', photos: ['3'] }];

const MITCHELL = [
  { id: '1', event_date: '2026-05-22', report_status: 'pre_compliance', scope_notes: 'Andersen del to BFS – 5/12\nQTY.31 | Here: 5/11/2026\nPO 7155135\n\nWestern del to BFS – 5/6\nQTY.12 - *jobsite mull required/ lift required* | Here: 4/24/2026\n\nWindor del to BFS-5/6\nQTY.1 | Here: 5/04/2026\n' },
  { id: '2', event_date: '2026-05-29', report_status: 'pre_compliance', scope_notes: 'Remaining windows and doors delivered.\n\nPlease finish install.' },
  { id: '3', event_date: '2026-06-22', scope_notes: 'Installer to pull 2 windows in the basement.\n\nLabor - $175\n' },
  { id: '4', event_date: '2026-07-16', scope_notes: 'Andersen del to BFS – 7/14\nQTY.1\nPO 7234932\n*install new window and previous pulled window in basement*' },
  { id: '5', event_date: '2026-07-23', report_status: 'pre_compliance', scope_notes: 'Please install sheetrock windows.' },
  { id: '6', event_date: '2026-09-14', report_status: 'ok', scope_notes: 'Install interior glass wall system.' },
  { id: '7', event_date: '2026-10-08', report_status: 'pending', scope_notes: 'Andersen del to BFS – 10/6\n\n*installer to pull/reinstall new windows on stairs/mull*\n\nQTY.2' },
];
const MITCHELL_REPORTS = ['2026-05-30', '2026-06-22', '2026-07-16', '2026-07-17', '2026-07-23', '2026-09-22', '2026-10-01'].map((date) => ({ date, message: '', photos: ['x'] }));

test('STAGES lists the seven stages in order', () => {
  assert.deepEqual(STAGES.map((s) => s.key), ['ordered', 'received', 'delivered', 'installed', 'sheetrock', 'screens', 'complete']);
  assert.deepEqual(STAGES.map((s) => s.label), ['Ordered', 'Received', 'Delivered', 'Installed', 'Sheetrock windows', 'Screen service', 'Complete']);
});

test('408 Oquirrh: Amsco direct skips Received; sheetrock is current; screens up next', () => {
  const p = jobProgress({ events: OQUIRRH, reports: OQUIRRH_REPORTS, status: done, today: TODAY });
  assert.deepEqual(keys(p), { ordered: '2026-09-10', received: 'skipped', delivered: '2026-09-23', installed: '2026-09-23', sheetrock: '2026-10-02' });
  assert.equal(p.current.key, 'sheetrock');
  assert.equal(p.current.n, 5);
  assert.deepEqual(p.next, { key: 'screens', label: 'Screen service', n: 6, booked: false });
  assert.deepEqual(p.byDate['2026-09-23'].map((s) => s.key), ['delivered', 'installed']);
  assert.equal(p.byDate['2026-10-02'][0].current, true);
  assert.equal(p.byDate['2026-09-10'][0].current, false);
  assert.ok(!('complete' in keys(p)), 'status complete alone does not mark Complete');
});

test('505 Mitchell Farms: received from last Here date, installed from first report after delivery', () => {
  const p = jobProgress({ events: MITCHELL, reports: MITCHELL_REPORTS, status: { key: 'active' }, today: TODAY });
  assert.deepEqual(keys(p), { received: '2026-05-11', delivered: '2026-05-22', installed: '2026-05-30', sheetrock: '2026-07-23' });
  assert.equal(p.current.key, 'sheetrock');
  assert.equal(p.next.key, 'screens');
  assert.equal(p.next.booked, false, 'the Oct 8 add-on install is not a screen service');
});

test('screen service with a report, then complete status, finishes the job', () => {
  const events = [...OQUIRRH, { id: 'd', event_date: '2026-10-20', report_status: 'ok', scope_notes: 'Amsco Screen Service: 12 Window screens\nDeliver / Install all screens.' }];
  const p = jobProgress({ events, reports: OQUIRRH_REPORTS, status: done, today: '2026-10-25' });
  assert.equal(keys(p).screens, '2026-10-20');
  assert.equal(keys(p).complete, '2026-10-20');
  assert.equal(p.current.key, 'complete');
  assert.equal(p.next, null);
});

test('a booked future screen service shows next as booked', () => {
  const events = [...OQUIRRH, { id: 'd', event_date: '2026-10-20', report_status: 'pending', scope_notes: 'Amsco Screen Service: 12 Window screens' }];
  const p = jobProgress({ events, reports: OQUIRRH_REPORTS, status: done, today: TODAY });
  assert.equal(p.current.key, 'sheetrock');
  assert.deepEqual(p.next, { key: 'screens', label: 'Screen service', n: 6, booked: true });
});

test('cancelled events never mark a stage', () => {
  const events = OQUIRRH.map((e) => (e.id === 'c' ? { ...e, source_status: 'cancelled' } : e));
  const p = jobProgress({ events, reports: OQUIRRH_REPORTS.slice(0, 1), status: done, today: TODAY });
  assert.ok(!('sheetrock' in keys(p)));
  assert.equal(p.current.key, 'installed');
});

test('service-only job has no stages and no next step', () => {
  const p = jobProgress({ events: [{ id: 's', event_date: '2026-10-02', report_status: 'ok', scope_notes: '*WARRANTY* - Per Report: SGD sticks (Line#: 4)\nTech Instructions: adjust SGD' }], reports: [{ date: '2026-10-02', message: 'fixed', photos: [] }], status: done, today: TODAY });
  assert.deepEqual(p.reached, []);
  assert.equal(p.current, null);
  assert.equal(p.next, null);
  assert.deepEqual(p.byDate, {});
});

test('no events at all', () => {
  const p = jobProgress({ events: [], reports: [], status: null, today: TODAY });
  assert.equal(p.current, null);
  assert.equal(p.next, null);
});

test('review #6: a complete job with no activity for 30+ days does not nag "Up next"', () => {
  const p = jobProgress({ events: OQUIRRH, reports: OQUIRRH_REPORTS, status: done, today: '2026-11-15' });
  assert.equal(p.current.key, 'sheetrock');
  assert.equal(p.next, null);
  const q = jobProgress({ events: OQUIRRH, reports: OQUIRRH_REPORTS, status: { key: 'active' }, today: '2026-11-15' });
  assert.equal(q.next.key, 'screens');
});
