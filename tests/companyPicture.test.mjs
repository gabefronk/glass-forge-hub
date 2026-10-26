import './support/register-src-alias.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

const { earnTiming, importedLaborDiagnostic, cardFigure } = await import('../src/lib/companyPicture.js');
const { BOOKS_PL, QBO_SALES, QBO_UNASSIGNED, QBO_UNASSIGNED_OPEN } = await import('../src/lib/booksSnapshot.js');

test('a multi-scope card reads its scope rows; a missing scope figure stays unknown', () => {
  const multi = { job: { id: 'S' }, windows: { display: { suppressed: true, value: null } }, sale: { display: { suppressed: true, value: null } },
    scopes: [{ windows: { value: 1731.49 }, sale: { value: 3271.38 } }, { windows: { value: 7807 }, sale: { value: 11566.35 } }] };
  assert.deepEqual([cardFigure(multi, 'windows'), cardFigure(multi, 'sale')], [9538.49, 14837.73]);
  multi.scopes[1].sale = { value: null };
  assert.equal(cardFigure(multi, 'sale'), null);
  assert.equal(cardFigure({ sale: { display: { value: null } } }, 'sale'), null);
});

test('earn timing: installed this year, ETA months, December at risk, none unknown', () => {
  assert.equal(earnTiming('installed', []).year, '2026');
  assert.equal(earnTiming('ordered', [{ eta_date: '2026-12-07' }]).year, '2026?');
  assert.equal(earnTiming('ordered', [{ eta_date: '2027-01-10' }]).year, '2027');
  assert.equal(earnTiming('ordered', [{ eta_date: '2026-10-05', received_date: '2026-10-06' }]).year, 'unknown');
  assert.equal(earnTiming('ordered', []).label, 'Unknown (no supplier ETA)');
});

test('July diagnostic: imported sheet lines with stored labor that the earned formula leaves at $0', () => {
  const l = (id, extra) => ({ id, invoice_month: '2026-07', source: 'sheet-import', billable: true, labor_amt: 1000, ...extra });
  const d = importedLaborDiagnostic([
    l('a'), l('b', { labor_amt: 2500 }),
    l('calendar', { calendar_labor_amt: 1000 }), // counted by the earned formula already
    l('hours', { man_hours: 2 }), // ditto
    l('zero', { labor_amt: 0 }), l('gone', { superseded_by: 'x' }), l('nobill', { billable: false }),
    l('probuild', { source: 'probuild' }), l('aug', { invoice_month: '2026-08' }),
  ]);
  assert.deepEqual(d, { month: '2026-07', count: 2, labor: 3500, fee: 350 });
});

test('the QuickBooks snapshot adds up the way the report does', () => {
  const v = (label, i) => BOOKS_PL.rows.find((r) => r[0] === label)[i];
  for (const i of [1, 2]) {
    const income = BOOKS_PL.rows.filter((r) => r[3] === 'income').reduce((n, r) => n + r[i], 0);
    const expenses = BOOKS_PL.rows.filter((r) => r[3] === 'expense').reduce((n, r) => n + r[i], 0);
    assert.equal(Math.round(income * 100) / 100, v('Total income', i));
    assert.equal(Math.round(expenses * 100) / 100, v('Total expenses', i));
    assert.equal(Math.round((income - expenses) * 100) / 100, v('Net income', i));
  }
  // Accrual less cash income is QuickBooks' open receivables ($17,182.53): 1005 + 1013.
  assert.equal(Math.round((v('Total income', 1) - v('Total income', 2)) * 100) / 100, 17182.53);
  const open = [...QBO_SALES, ...QBO_UNASSIGNED].reduce((n, s) => n + s.open, 0);
  assert.equal(Math.round(open * 100) / 100, 17182.53);
  assert.ok(QBO_SALES.every((s) => s.jobId && s.evidence));
  assert.deepEqual(QBO_UNASSIGNED_OPEN.map((s) => s.ref), ['Invoice 1005']);
  // Every QuickBooks invoice 1002–1013 (and the Thomas receipt) is accounted for exactly once.
  const refs = [...QBO_SALES, ...QBO_UNASSIGNED].map((s) => s.ref).filter((r) => r.startsWith('Invoice')).sort();
  assert.deepEqual(refs, ['Invoice 1002', 'Invoice 1003', 'Invoice 1004', 'Invoice 1005', 'Invoice 1006', 'Invoice 1007', 'Invoice 1008', 'Invoice 1009', 'Invoice 1010', 'Invoice 1011', 'Invoice 1012', 'Invoice 1013']);
});
