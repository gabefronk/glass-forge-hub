import test from 'node:test';
import assert from 'node:assert/strict';
import { validateLaborEntry, laborMargin, buildCostInputPatch, summarizeJobCosts } from '../base44/shared/jobLaborEntry.js';

test('validateLaborEntry: sell + cost are money numbers, note is short, month defaults and is checked', () => {
  const ok = validateLaborEntry({ installation_revenue: '1,850', actual_labor_cost: 900, notes: ' 2 guys, 1 day ' }, { today: '2026-09-26' });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.values, { installation_revenue: 1850, actual_labor_cost: 900, notes: '2 guys, 1 day', month: '2026-09' });
  const later = validateLaborEntry({ installation_revenue: 100, actual_labor_cost: 0, month: '2026-10' }, { today: '2026-09-26' });
  assert.equal(later.values.month, '2026-10');
  assert.equal(later.values.notes, '');
  const bad = validateLaborEntry({ installation_revenue: 'lots', actual_labor_cost: -5, month: 'Sept' }, { today: '2026-09-26' });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.errors.sort(), ['actual_labor_cost', 'installation_revenue', 'month'].sort());
  const empty = validateLaborEntry({}, { today: '2026-09-26' });
  assert.equal(empty.ok, false, 'at least one number is required');
  assert.ok(empty.errors.includes('installation_revenue'));
  const onlyCost = validateLaborEntry({ actual_labor_cost: 400 }, { today: '2026-09-26' });
  assert.equal(onlyCost.ok, true, 'cost alone is fine (sell comes later)');
  assert.equal(onlyCost.values.installation_revenue, null);
  const big = validateLaborEntry({ installation_revenue: 1, notes: 'x'.repeat(600) }, { today: '2026-09-26' });
  assert.equal(big.values.notes.length, 500);
});

test('laborMargin: profit and percent, null when either side is missing or sell is zero', () => {
  assert.deepEqual(laborMargin(1850, 900), { profit: 950, margin_pct: 0.5135 });
  assert.deepEqual(laborMargin(1000, 1200), { profit: -200, margin_pct: -0.2 });
  assert.deepEqual(laborMargin(0, 500), { profit: null, margin_pct: null });
  assert.deepEqual(laborMargin(null, 500), { profit: null, margin_pct: null });
  assert.deepEqual(laborMargin(500, null), { profit: null, margin_pct: null });
});

test('buildCostInputPatch: new row gets month/job/route/manual, existing row keeps its other fields and only the given numbers change', () => {
  const fresh = buildCostInputPatch(null, { installation_revenue: 1850, actual_labor_cost: 900, notes: 'crew of 2', month: '2026-09' }, { jobId: 'job1', jobNameNorm: 'aspen spring' });
  assert.deepEqual(fresh, { month: '2026-09', job_id: 'job1', job_name_norm: 'aspen spring', route: 'bfs_installed_sale', material_source: 'manual', installation_revenue: 1850, actual_labor_cost: 900, notes: 'crew of 2' });
  const existing = { id: 'ci1', month: '2026-09', job_id: 'job1', route: 'bfs_to_ya_turnkey', product_cost: 5000, installation_revenue: 1500, actual_labor_cost: 700, notes: 'old' };
  const patch = buildCostInputPatch(existing, { installation_revenue: 1850, actual_labor_cost: null, notes: '', month: '2026-09' }, { jobId: 'job1', jobNameNorm: 'aspen spring' });
  assert.deepEqual(patch, { installation_revenue: 1850 }, 'blank fields are left alone, route and product cost untouched');
  const noteOnly = buildCostInputPatch(existing, { installation_revenue: null, actual_labor_cost: 650, notes: 'new note', month: '2026-09' }, { jobId: 'job1', jobNameNorm: 'aspen spring' });
  assert.deepEqual(noteOnly, { actual_labor_cost: 650, notes: 'new note' });
});

test('summarizeJobCosts: one card-ready object from the cost input row and the newest budget', () => {
  const s = summarizeJobCosts({ costInput: { id: 'ci1', month: '2026-09', installation_revenue: 1850, actual_labor_cost: 900, notes: 'crew of 2', updated_date: '2026-09-26T10:00:00Z' }, budget: { id: 'b1', status: 'filed', quote_number: 'Q-1', vendor: 'AMSCO', source_pdf_name: 'q.pdf', inputs: { material_true_cost: 4200, labor_sell_price: 1850 }, computed: { cost_material_tax: 4512.9, sell_material_tax: 6447, actual_margin_pct: 0.31 }, created_date: '2026-09-25T10:00:00Z' } });
  assert.deepEqual(s.labor, { installation_revenue: 1850, actual_labor_cost: 900, profit: 950, margin_pct: 0.5135, notes: 'crew of 2', month: '2026-09', updated_at: '2026-09-26T10:00:00Z' });
  assert.deepEqual(s.budget, { id: 'b1', status: 'filed', vendor: 'AMSCO', quote_number: 'Q-1', file_name: 'q.pdf', material_cost: 4200, material_cost_with_tax: 4512.9, material_sell: 6447, margin_pct: 0.31, created_at: '2026-09-25T10:00:00Z' });
  const none = summarizeJobCosts({ costInput: null, budget: null });
  assert.equal(none.labor, null);
  assert.equal(none.budget, null);
  const costOnly = summarizeJobCosts({ costInput: { actual_labor_cost: 400 }, budget: null });
  assert.equal(costOnly.labor.installation_revenue, null);
  assert.equal(costOnly.labor.profit, null);
});
