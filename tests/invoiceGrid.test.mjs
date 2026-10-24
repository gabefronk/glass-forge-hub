// Invoicing lines grid and money strip: sorting, day subtotals, the total row, the
// header checkbox state, line status words and the three strip figures all come from
// the same predicates and sums, so a filter's total ties to its strip figure.
import test from 'node:test';
import assert from 'node:assert/strict';
import { groupLines, lineSums, shortDay, sortLines, nextSort, normalizeSort, selectionState } from '../src/lib/invoiceGrid.js';
import { moneyBarSegments, moneyStrip, lineStatus, STATUS_LABELS } from '../src/lib/invoiceMoneyBar.js';

const line = (id, job_date, labor, extra = {}) => ({ id, job_date, job_name_raw: `Job ${id}`, labor_amt: labor, fee_pct: 0.1, manually_adjusted: true, fee_amt: Math.round(labor * 10) / 100, billable: true, ...extra });

test('date sort groups by day with subtotals that add up to the total row', () => {
  const rows = [line('a', '2026-10-03', 350), line('b', '2026-10-01', 200), line('c', '2026-10-03', 125.5)];
  const groups = groupLines(rows, { key: 'date', dir: 'asc' });
  assert.deepEqual(groups.map((g) => g.date), ['2026-10-01', '2026-10-03']);
  assert.deepEqual(groups.map((g) => [g.count, g.labor, g.fee]), [[1, 200, 20], [2, 475.5, 47.55]]);
  const total = lineSums(rows);
  assert.deepEqual([total.count, total.labor, total.fee], [3, 675.5, 67.55]);
  assert.equal(groups.reduce((n, g) => n + g.fee, 0).toFixed(2), total.fee.toFixed(2));
  assert.deepEqual(groupLines(rows, { key: 'date', dir: 'desc' }).map((g) => g.date), ['2026-10-03', '2026-10-01']);
});

test('default sort is Fee, largest first, ungrouped; headers flip direction', () => {
  const rows = [line('a', '2026-10-03', 100), line('b', '2026-10-01', 900), line('c', '2026-10-02', 300)];
  const groups = groupLines(rows);
  assert.equal(groups.length, 1);
  assert.deepEqual(groups[0].rows.map((r) => r.id), ['b', 'c', 'a']);
  assert.deepEqual(normalizeSort({ key: 'nope' }), { key: 'fee', dir: 'desc' });
  assert.deepEqual(nextSort({ key: 'fee', dir: 'desc' }, 'fee'), { key: 'fee', dir: 'asc' });
  assert.deepEqual(nextSort({ key: 'fee', dir: 'desc' }, 'job'), { key: 'job', dir: 'asc' });
  assert.deepEqual(nextSort({ key: 'job', dir: 'asc' }, 'labor'), { key: 'labor', dir: 'desc' });
  assert.deepEqual(sortLines(rows, { key: 'job', dir: 'desc' }).map((r) => r.id), ['c', 'b', 'a']);
});

test('header checkbox state and short dates', () => {
  assert.equal(selectionState(['a', 'b'], new Set()), 'none');
  assert.equal(selectionState(['a', 'b'], new Set(['a'])), 'some');
  assert.equal(selectionState(['a', 'b'], new Set(['a', 'b', 'z'])), 'all');
  assert.equal(shortDay('2026-10-03'), '10/3');
  assert.equal(shortDay(''), '');
});

test('money strip: ready, one needs-attention count, open invoices; ties to the Ready lines', () => {
  const rows = [
    line('a', '2026-10-01', 300), line('b', '2026-10-02', 450),
    line('c', '2026-10-02', 80, { billed_to_bfs: true }),
    line('d', '2026-10-02', 120, { needs_review: true, manually_adjusted: false, fee_amt: null }),
  ];
  const segments = moneyBarSegments(rows, new Map(), new Set(), [{ status: 'open', labor: 80, fee: 8 }]);
  const strip = moneyStrip(segments);
  assert.deepEqual([strip.ready.count, strip.ready.labor, strip.ready.fee], [2, 750, 75]);
  assert.deepEqual([strip.attention.count, strip.attention.labor], [1, 120]);
  assert.deepEqual([strip.unpaid.count, strip.unpaid.fee], [1, 8]);
  const sums = lineSums(rows.filter((r) => lineStatus(r, new Map(), new Set()) === 'ready'));
  assert.deepEqual([sums.count, sums.labor, sums.fee], [strip.ready.count, strip.ready.labor, strip.ready.fee]);
});

test('line status uses the Show vocabulary', () => {
  const s = (r) => STATUS_LABELS[lineStatus(r, new Map(), new Set())];
  assert.equal(s(line('a', '2026-10-01', 300)), 'Ready');
  assert.equal(s(line('b', '2026-10-01', 300, { billed_to_bfs: true })), 'Invoiced');
  assert.equal(s(line('c', '2026-10-01', 300, { billed_to_bfs: true, paid_date: '2026-10-20' })), 'Paid');
  assert.equal(s(line('d', '2026-10-01', 300, { needs_review: true, manually_adjusted: false })), 'Needs decision');
});
