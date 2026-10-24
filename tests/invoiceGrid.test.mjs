// Invoicing lines grid: day subtotal rows and the total row add labor and fee the same
// way the money bar does, so a filter's total ties to its money bar segment.
import test from 'node:test';
import assert from 'node:assert/strict';
import { groupLines, lineSums, shortDay, cellPatch } from '../src/lib/invoiceGrid.js';
import { moneyBarSegments } from '../src/lib/invoiceMoneyBar.js';

const line = (id, job_date, labor, extra = {}) => ({ id, job_date, labor_amt: labor, fee_pct: 0.1, manually_adjusted: true, fee_amt: Math.round(labor * 10) / 100, billable: true, ...extra });

test('date sort groups by day, oldest first, each with its subtotal', () => {
  const rows = [line('a', '2026-10-03', 350), line('b', '2026-10-01', 200), line('c', '2026-10-03', 125.5), line('d', null, 40)];
  const groups = groupLines(rows, 'date');
  assert.deepEqual(groups.map((g) => g.date), ['2026-10-01', '2026-10-03', '—']);
  assert.deepEqual(groups.map((g) => [g.count, g.labor, g.fee]), [[1, 200, 20], [2, 475.5, 47.55], [1, 40, 4]]);
  const total = lineSums(rows);
  assert.deepEqual([total.count, total.labor, total.fee], [4, 715.5, 71.55]);
  assert.equal(groups.reduce((n, g) => n + g.fee, 0).toFixed(2), total.fee.toFixed(2), 'day subtotals add up to the total row');
});

test('fee sort is one ungrouped list, largest fee first', () => {
  const groups = groupLines([line('a', '2026-10-03', 100), line('b', '2026-10-01', 900), line('c', '2026-10-02', 300)], 'fee');
  assert.equal(groups.length, 1);
  assert.equal(groups[0].date, null);
  assert.deepEqual(groups[0].rows.map((r) => r.id), ['b', 'c', 'a']);
});

test('the total of the Ready lines equals the Ready to invoice segment of the money bar', () => {
  const rows = [line('a', '2026-10-01', 300), line('b', '2026-10-02', 450), line('c', '2026-10-02', 80, { billed_to_bfs: true })];
  const ready = moneyBarSegments(rows, new Map(), new Set()).find((s) => s.key === 'ready');
  const sums = lineSums(rows.filter((r) => !r.billed_to_bfs));
  assert.deepEqual([sums.count, sums.labor, sums.fee], [ready.count, ready.labor, ready.fee]);
});

test('short day label and in-cell edit parsing', () => {
  assert.equal(shortDay('2026-10-03'), 'Oct 3');
  assert.equal(shortDay(''), '—');
  assert.deepEqual(cellPatch('labor', '$1,250.555'), { labor_amt: 1250.56 });
  assert.deepEqual(cellPatch('fee_pct', '12.5%'), { fee_pct: 0.125 });
  assert.deepEqual(cellPatch('fee_pct', '10'), { fee_pct: 0.1 });
  assert.deepEqual(cellPatch('fee_pct', '0'), { fee_pct: 0 });
  assert.equal(cellPatch('fee_pct', '150'), null);
  assert.equal(cellPatch('labor', '-5'), null);
  assert.equal(cellPatch('labor', 'abc'), null);
  assert.equal(cellPatch('labor', ''), null);
});
