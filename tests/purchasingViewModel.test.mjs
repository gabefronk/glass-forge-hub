// Pure viewmodel tests for the unified Purchasing page. No React, no SDK.
// Covers tiles (sums/unknown/null/zero/tax), profit, refs/status/date, next
// action availability, multiple/superseded/conflicting budgets, search, and
// merged/sample/ignored job exclusion.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  windowsInclTax, computeProfit, refsForJob, nextActionForJob,
  buildPurchasingCards, cardMatchesSearch,
} from '../src/lib/purchasingViewModel.js';

const TODAY = '2026-10-07';
const reviewedBudget = (over = {}) => ({
  id: 'b1', job_id: 'j1', budget_usage: 'included', numbers_reviewed_at: '2026-10-01',
  vendor: 'AMSCO', quote_number: 'Q1', openings_qty: 12,
  inputs: { material_true_cost: 10000, labor_cost_sub_pay: 2000, actual_total_sell: 18000, ...over },
});

test('windowsInclTax: empty when no budgets', () => {
  assert.deepEqual(windowsInclTax([]), { value: null, status: 'empty', budgetId: null });
});

test('windowsInclTax: withheld when multiple active budgets', () => {
  const a = reviewedBudget(); const b = reviewedBudget({ material_true_cost: 9000 });
  b.id = 'b2';
  assert.equal(windowsInclTax([a, b]).status, 'withheld');
  assert.equal(windowsInclTax([a, b]).value, null);
});

test('windowsInclTax: review when budget not ready (draft / unreviewed)', () => {
  const draft = { ...reviewedBudget(), budget_usage: 'draft', numbers_reviewed_at: null };
  assert.equal(windowsInclTax([draft]).status, 'review');
  assert.equal(windowsInclTax([draft]).value, null);
});

test('windowsInclTax: ready returns cost_material_tax from the workbook (incl tax, no guess)', () => {
  const w = windowsInclTax([reviewedBudget()]);
  assert.equal(w.status, 'ready');
  // material 10000 + overhead + additional 0 + use_tax(10000*0.0745=745) = 10000 + 0 + 0 + 745 = 10745 (overhead 0 since no labor overhead adder beyond labor)
  assert.equal(w.value, 10745);
});

test('computeProfit: unknown when any input null', () => {
  assert.deepEqual(computeProfit(null, 5, 10), { value: null, tone: 'unknown' });
  assert.deepEqual(computeProfit(5, null, 10), { value: null, tone: 'unknown' });
  assert.deepEqual(computeProfit(5, 5, null), { value: null, tone: 'unknown' });
});

test('computeProfit: positive / negative / zero', () => {
  assert.equal(computeProfit(100, 50, 200).tone, 'positive');
  assert.equal(computeProfit(100, 50, 200).value, 50);
  assert.equal(computeProfit(100, 50, 120).tone, 'negative');
  assert.equal(computeProfit(100, 50, 120).value, -30);
  assert.equal(computeProfit(100, 50, 150).tone, 'zero');
  assert.equal(computeProfit(100, 50, 150).value, 0);
});

test('refsForJob: all none when no records', () => {
  const r = refsForJob('j1', {});
  assert.equal(r.quoteStatus, 'none');
  assert.equal(r.poStatus, 'none');
  assert.equal(r.mfrStatus, 'none');
  assert.equal(r.etaStatus, 'none');
  assert.equal(r.payment, 'none');
});

test('refsForJob: green when reviewed budget, issued PO, confirmed order, ETA set, paid', () => {
  const r = refsForJob('j1', {
    budgets: [reviewedBudget()],
    purchaseOrders: [{ job_id: 'j1', po_number: 'YA-0001', status: 'ordered' }],
    vendorOrders: [{ job_id: 'j1', order_number: '09-5476', eta_date: '2026-10-10', status: 'paid' }],
    today: TODAY,
  });
  assert.equal(r.quoteStatus, 'green');
  assert.equal(r.poStatus, 'green');
  assert.equal(r.mfrStatus, 'green');
  assert.equal(r.etaStatus, 'green');
  assert.equal(r.payment, 'green');
});

test('refsForJob: amber ETA when overdue, amber payment when unpaid', () => {
  const r = refsForJob('j1', {
    vendorOrders: [{ job_id: 'j1', order_number: '09-1', eta_date: '2026-10-01', status: 'ordered' }],
    today: TODAY,
  });
  assert.equal(r.etaStatus, 'amber');
  assert.equal(r.payment, 'amber');
});

test('nextActionForJob: Review numbers when budget draft', () => {
  const a = nextActionForJob('j1', { budgets: [{ ...reviewedBudget(), budget_usage: 'draft', numbers_reviewed_at: null }] });
  assert.equal(a.label, 'Review numbers');
  assert.equal(a.key, 'budgets');
});

test('nextActionForJob: Prepare PO when included budget has no matching PO', () => {
  const a = nextActionForJob('j1', { budgets: [reviewedBudget()] });
  assert.equal(a.label, 'Prepare PO');
});

test('nextActionForJob: Confirm order when PO missing supplier confirmation', () => {
  const a = nextActionForJob('j1', { budgets: [reviewedBudget()], purchaseOrders: [{ job_id: 'j1', po_number: 'YA-1', status: 'ordered', vendor: 'AMSCO', vendor_quote_ref: 'Q1' }] });
  assert.equal(a.label, 'Confirm order');
});

test('nextActionForJob: Record payment when awaiting delivery', () => {
  const a = nextActionForJob('j1', {
    budgets: [reviewedBudget()],
    purchaseOrders: [{ job_id: 'j1', po_number: 'YA-1', status: 'ordered', vendor: 'AMSCO', vendor_quote_ref: 'Q1' }],
    vendorOrders: [{ job_id: 'j1', order_number: '09-1', eta_date: '2026-10-10', status: 'ordered', purchase_order_id: 'p1' }],
  });
  assert.equal(a.label, 'Record payment');
});

test('nextActionForJob: Resolve PO conflict takes priority', () => {
  const a = nextActionForJob('j1', { budgets: [reviewedBudget()], conflicts: [{ number: 'YA-1', job_ids: ['j1', 'j2'] }] });
  assert.equal(a.label, 'Resolve PO conflict');
});

test('buildPurchasingCards: excludes merged, sample, ignored, and inactive jobs', () => {
  const jobs = [
    { id: 'j1', canonical_name: 'Alpha' },
    { id: 'j2', canonical_name: 'Beta', merged_into: 'j1' },
    { id: 'j3', canonical_name: 'Gamma', is_sample: true },
    { id: 'j4', canonical_name: 'Renta' },
    { id: 'j5', canonical_name: 'Delta' },
  ];
  const cards = buildPurchasingCards({ jobs, budgets: [{ job_id: 'j1', ...reviewedBudget() }], moneyInputs: [{ job_id: 'j5', rough_labor_material: 100 }], today: TODAY });
  const names = cards.map((c) => c.job.canonical_name);
  assert.ok(names.includes('Alpha'));
  assert.ok(names.includes('Delta'));
  assert.ok(!names.includes('Beta'));
  assert.ok(!names.includes('Gamma'));
  assert.ok(!names.includes('Renta'));
});

test('buildPurchasingCards: profit dash until money + budget all resolve', () => {
  const cards = buildPurchasingCards({ jobs: [{ id: 'j1', canonical_name: 'A' }], budgets: [reviewedBudget()], today: TODAY });
  assert.equal(cards[0].windows.value, 10745);
  assert.equal(cards[0].rough.value, null);
  assert.equal(cards[0].sale.value, null);
  assert.deepEqual(cards[0].profit, { value: null, tone: 'unknown' });
});

test('buildPurchasingCards: profit computed when money + budget resolve', () => {
  const cards = buildPurchasingCards({
    jobs: [{ id: 'j1', canonical_name: 'A' }],
    budgets: [reviewedBudget()],
    moneyInputs: [{ job_id: 'j1', rough_labor_material: 3000, sale_price: 18000 }],
    today: TODAY,
  });
  assert.equal(cards[0].rough.value, 3000);
  assert.equal(cards[0].sale.value, 18000);
  assert.equal(cards[0].profit.value, 18000 - 10745 - 3000);
  assert.equal(cards[0].profit.tone, 'positive');
});

test('buildPurchasingCards: conflicting active budgets withhold windows', () => {
  const a = reviewedBudget(); const b = reviewedBudget({ material_true_cost: 9000 }); b.id = 'b2';
  const cards = buildPurchasingCards({ jobs: [{ id: 'j1', canonical_name: 'A' }], budgets: [a, b], today: TODAY });
  assert.equal(cards[0].windows.status, 'withheld');
  assert.equal(cards[0].windows.value, null);
});

test('buildPurchasingCards: superseded (replaced) budget excluded from active', () => {
  const old = reviewedBudget(); const rep = { ...reviewedBudget(), id: 'b2', replaces_budget_id: 'b1' };
  const cards = buildPurchasingCards({ jobs: [{ id: 'j1', canonical_name: 'A' }], budgets: [old, rep], today: TODAY });
  assert.equal(cards[0].windows.status, 'ready');
  assert.equal(cards[0].windows.budgetId, 'b2');
});

test('cardMatchesSearch: matches job name, quote, PO, supplier', () => {
  const cards = buildPurchasingCards({
    jobs: [{ id: 'j1', canonical_name: 'Aria-Belle' }],
    budgets: [reviewedBudget()],
    purchaseOrders: [{ job_id: 'j1', po_number: 'YA-0005', status: 'ordered', vendor: 'AMSCO', vendor_quote_ref: 'Q1' }],
    today: TODAY,
  });
  assert.ok(cardMatchesSearch(cards[0], 'aria'));
  assert.ok(cardMatchesSearch(cards[0], 'YA-0005'));
  assert.ok(cardMatchesSearch(cards[0], 'amsco'));
  assert.ok(!cardMatchesSearch(cards[0], 'zzz'));
  assert.ok(cardMatchesSearch(cards[0], ''));
});