// Pure viewmodel tests for the unified Purchasing page. No React, no SDK.
// Covers: windows-incl-tax grounding/provenance/withhold (confirmed order vs
// budget, no gross substitution, conflict withhold), profit, refs aggregation
// (Multiple, delivered ETA, real payment, cancelled exclusion), next action
// (real workflow, no dead invoicing), units (active scope only), duplicate
// money withhold, unlinked entities, search, and job exclusions.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  windowsInclTax, computeProfit, refsForJob, nextActionForJob,
  buildPurchasingCards, unlinkedEntities, cardMatchesSearch,
} from '../src/lib/purchasingViewModel.js';
import { computeJobBudget, roundMoney } from '../base44/shared/jobBudgetMath.js';

const TODAY = '2026-10-07';
const reviewedBudget = (over = {}) => ({
  id: 'b1', job_id: 'j1', budget_usage: 'included', numbers_reviewed_at: '2026-10-01',
  vendor: 'AMSCO', quote_number: 'Q1', openings_qty: 12,
  inputs: { material_true_cost: 10000, labor_cost_sub_pay: 2000, actual_total_sell: 18000, ...over },
});
const confirmedPO = (over = {}) => ({
  id: 'po1', job_id: 'j1', po_number: 'YA-0001', status: 'ordered', budget_id: 'b1',
  vendor: 'AMSCO', vendor_quote_ref: 'Q1', amount_dealer: 933.96,
  budget_snapshot: { calculated: { cost_material_tax: 933.96 } },
  ...over,
});
// Independent expected derivation from the real schema tax math (material +
// labor-driven overhead keep + use tax). Never a bent literal — the viewmodel
// uses this same computeJobBudget, so the assertion tracks the actual math.
const EXPECTED_WIN = computeJobBudget({ material_true_cost: 10000, labor_cost_sub_pay: 2000, actual_total_sell: 18000 }).cost_material_tax;

test('windowsInclTax: empty when no budgets', () => {
  assert.deepEqual(windowsInclTax([]), { value: null, status: 'empty', budgetId: null, provenance: null });
});

test('windowsInclTax: ready budget fallback (provenance budget) returns cost_material_tax', () => {
  const w = windowsInclTax([reviewedBudget()]);
  assert.equal(w.status, 'ready');
  assert.equal(w.value, EXPECTED_WIN);
  assert.equal(w.provenance, 'budget');
});

test('windowsInclTax: confirmed scoped order preferred over budget (provenance order)', () => {
  const w = windowsInclTax([reviewedBudget()], [confirmedPO()]);
  assert.equal(w.status, 'ready');
  assert.equal(w.value, 933.96);
  assert.equal(w.provenance, 'order');
  assert.equal(w.poId, 'po1');
});

test('windowsInclTax: does NOT substitute gross dealer_amount as incl tax', () => {
  // PO with no budget_snapshot cost_material_tax → must fall back to budget, not amount_dealer.
  const poNoSnapshot = { ...confirmedPO(), budget_snapshot: null };
  const w = windowsInclTax([reviewedBudget()], [poNoSnapshot]);
  assert.equal(w.provenance, 'budget');
  assert.equal(w.value, EXPECTED_WIN);
});

test('windowsInclTax: multiple confirmed orders same value → one value', () => {
  const a = confirmedPO(); const b = confirmedPO({ id: 'po2' });
  const w = windowsInclTax([reviewedBudget()], [a, b]);
  assert.equal(w.status, 'ready');
  assert.equal(w.value, 933.96);
});

test('windowsInclTax: multiple confirmed orders different values → withheld (no double-count)', () => {
  const a = confirmedPO(); const b = confirmedPO({ id: 'po2', budget_snapshot: { calculated: { cost_material_tax: 1732 } } });
  const w = windowsInclTax([reviewedBudget()], [a, b]);
  assert.equal(w.status, 'withheld');
  assert.equal(w.value, null);
});

test('windowsInclTax: multiple active non-replacement budgets, no confirmed order → withheld', () => {
  const a = reviewedBudget(); const b = reviewedBudget({ material_true_cost: 9000 }); b.id = 'b2';
  const w = windowsInclTax([a, b], []);
  assert.equal(w.status, 'withheld');
});

test('windowsInclTax: replacement chain resolves to survivor', () => {
  const old = reviewedBudget(); const rep = { ...reviewedBudget(), id: 'b2', replaces_budget_id: 'b1' };
  const w = windowsInclTax([old, rep], []);
  assert.equal(w.status, 'ready');
  assert.equal(w.budgetId, 'b2');
});

test('windowsInclTax: draft budget → empty (not an active scope)', () => {
  // A draft budget is excluded from totals (includedBudget), so it is not an
  // active scope — windows incl tax has nothing to ground on → empty.
  const draft = { ...reviewedBudget(), budget_usage: 'draft', numbers_reviewed_at: null };
  const w = windowsInclTax([draft], []);
  assert.equal(w.status, 'empty');
  assert.equal(w.value, null);
});

test('windowsInclTax: included but numbers not reviewed → review (ready/review semantics)', () => {
  // Included scope that is not ready (numbers not reviewed) → review, not empty.
  const unreviewed = { ...reviewedBudget(), numbers_reviewed_at: null };
  const w = windowsInclTax([unreviewed], []);
  assert.equal(w.status, 'review');
  assert.equal(w.value, null);
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
  assert.equal(computeProfit(100, 50, 150).tone, 'zero');
});

test('refsForJob: all none when no records', () => {
  const r = refsForJob('j1', {});
  assert.equal(r.quoteStatus, 'none');
  assert.equal(r.poStatus, 'none');
  assert.equal(r.mfrStatus, 'none');
  assert.equal(r.etaStatus, 'none');
  assert.equal(r.payment, 'none');
});

test('refsForJob: green when reviewed budget, confirmed PO, paid order with ETA', () => {
  const r = refsForJob('j1', {
    budgets: [reviewedBudget()],
    purchaseOrders: [{ job_id: 'j1', po_number: 'YA-0001', status: 'confirmed' }],
    vendorOrders: [{ job_id: 'j1', order_number: '09-5476', eta_date: '2026-10-10', status: 'paid', paid_at: '2026-10-09' }],
    today: TODAY,
  });
  assert.equal(r.quoteStatus, 'green');
  assert.equal(r.poStatus, 'green');
  assert.equal(r.mfrStatus, 'green');
  assert.equal(r.etaStatus, 'green');
  assert.equal(r.payment, 'green');
  assert.equal(r.paymentLabel, 'Paid');
});

test('refsForJob: pending PO (issued) → amber poStatus', () => {
  const r = refsForJob('j1', { purchaseOrders: [{ job_id: 'j1', po_number: 'YA-1', status: 'issued' }] });
  assert.equal(r.poStatus, 'amber');
  assert.equal(r.yaPo, 'YA-1');
});

test('refsForJob: multiple distinct POs → "Multiple" label', () => {
  const r = refsForJob('j1', { purchaseOrders: [
    { job_id: 'j1', po_number: 'YA-1', status: 'confirmed' },
    { job_id: 'j1', po_number: 'YA-2', status: 'confirmed' },
  ] });
  assert.equal(r.yaPo, 'Multiple');
});

test('refsForJob: multiple distinct quotes → "Multiple"', () => {
  const a = reviewedBudget(); const b = reviewedBudget({ material_true_cost: 9000 }); b.id = 'b2'; b.quote_number = 'Q2';
  const r = refsForJob('j1', { budgets: [a, b] });
  assert.equal(r.quoteNumber, 'Multiple');
  assert.equal(r.quoteStatus, 'amber');
});

test('refsForJob: ETA Delivered when received_date set (not past amber)', () => {
  const r = refsForJob('j1', { vendorOrders: [{ job_id: 'j1', order_number: '09-1', eta_date: '2026-09-01', received_date: '2026-10-05', status: 'paid' }], today: TODAY });
  assert.equal(r.etaLabel, 'Delivered');
  assert.equal(r.etaStatus, 'green');
});

test('refsForJob: ETA overdue (no received) → amber', () => {
  const r = refsForJob('j1', { vendorOrders: [{ job_id: 'j1', order_number: '09-1', eta_date: '2026-10-01', status: 'eta_set' }], today: TODAY });
  assert.equal(r.etaStatus, 'amber');
  assert.equal(r.etaLabel, '2026-10-01');
});

test('refsForJob: multiple conflicting ETAs (no received) → "Multiple" + amber', () => {
  const r = refsForJob('j1', { vendorOrders: [
    { job_id: 'j1', order_number: '09-1', eta_date: '2026-10-10', status: 'eta_set' },
    { job_id: 'j1', order_number: '09-2', eta_date: '2026-10-20', status: 'eta_set' },
  ], today: TODAY });
  assert.equal(r.etaLabel, 'Multiple');
  assert.equal(r.etaStatus, 'amber');
});

test('refsForJob: payment mixed paid/unpaid → amber "Partial"', () => {
  const r = refsForJob('j1', { vendorOrders: [
    { job_id: 'j1', order_number: '09-1', status: 'paid', paid_at: '2026-10-01' },
    { job_id: 'j1', order_number: '09-2', status: 'ordered' },
  ] });
  assert.equal(r.payment, 'amber');
  assert.equal(r.paymentLabel, 'Partial');
});

test('refsForJob: payment all unpaid → amber "Unpaid"', () => {
  const r = refsForJob('j1', { vendorOrders: [{ job_id: 'j1', order_number: '09-1', status: 'eta_set' }] });
  assert.equal(r.payment, 'amber');
  assert.equal(r.paymentLabel, 'Unpaid');
});

test('refsForJob: cancelled PO excluded', () => {
  const r = refsForJob('j1', { purchaseOrders: [{ job_id: 'j1', po_number: 'YA-1', status: 'cancelled' }] });
  assert.equal(r.poStatus, 'none');
  assert.equal(r.yaPo, null);
});

test('refsForJob: vendor order whose linked PO is cancelled → excluded', () => {
  const r = refsForJob('j1', {
    purchaseOrders: [{ id: 'po1', job_id: 'j1', po_number: 'YA-1', status: 'cancelled' }],
    vendorOrders: [{ job_id: 'j1', order_number: '09-1', status: 'ordered', purchase_order_id: 'po1' }],
  });
  assert.equal(r.mfrStatus, 'none');
  assert.equal(r.payment, 'none');
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

test('nextActionForJob: Record ETA when order has no eta', () => {
  const a = nextActionForJob('j1', {
    budgets: [reviewedBudget()],
    purchaseOrders: [{ job_id: 'j1', po_number: 'YA-1', status: 'ordered', vendor: 'AMSCO', vendor_quote_ref: 'Q1' }],
    vendorOrders: [{ job_id: 'j1', order_number: '09-1', status: 'ordered', purchase_order_id: 'po1' }],
  });
  assert.equal(a.label, 'Record ETA');
});

test('nextActionForJob: Record payment only when NOT paid and progressed (eta_set)', () => {
  const a = nextActionForJob('j1', {
    budgets: [reviewedBudget()],
    purchaseOrders: [{ id: 'po1', job_id: 'j1', po_number: 'YA-1', status: 'ordered', vendor: 'AMSCO', vendor_quote_ref: 'Q1' }],
    vendorOrders: [{ job_id: 'j1', order_number: '09-1', eta_date: '2026-10-10', status: 'eta_set', purchase_order_id: 'po1' }],
  });
  assert.equal(a.label, 'Record payment');
});

test('nextActionForJob: already paid → NOT Record payment (reconcile or open job)', () => {
  const a = nextActionForJob('j1', {
    budgets: [reviewedBudget()],
    purchaseOrders: [{ id: 'po1', job_id: 'j1', po_number: 'YA-1', status: 'ordered', vendor: 'AMSCO', vendor_quote_ref: 'Q1' }],
    vendorOrders: [{ job_id: 'j1', order_number: '09-1', eta_date: '2026-10-10', received_date: '2026-10-11', status: 'paid', paid_at: '2026-10-12', purchase_order_id: 'po1' }],
  });
  assert.notEqual(a.label, 'Record payment');
  assert.equal(a.label, 'Reconcile');
});

test('nextActionForJob: all complete → Open job (not dead invoicing)', () => {
  const a = nextActionForJob('j1', {
    budgets: [reviewedBudget()],
    purchaseOrders: [{ id: 'po1', job_id: 'j1', po_number: 'YA-1', status: 'ordered', vendor: 'AMSCO', vendor_quote_ref: 'Q1' }],
    vendorOrders: [{ job_id: 'j1', order_number: '09-1', eta_date: '2026-10-10', received_date: '2026-10-11', status: 'reconciled', paid_at: '2026-10-12', reconciled_at: '2026-10-13', purchase_order_id: 'po1' }],
  });
  assert.equal(a.label, 'Open job');
  assert.equal(a.key, 'job');
});

test('nextActionForJob: Resolve PO conflict takes priority', () => {
  const a = nextActionForJob('j1', { budgets: [reviewedBudget()], conflicts: [{ number: 'YA-1', job_ids: ['j1', 'j2'] }] });
  assert.equal(a.label, 'Resolve PO conflict');
});

test('buildPurchasingCards: excludes merged, sample, ignored, inactive jobs', () => {
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

test('buildPurchasingCards: conflict job withholds windows AND profit', () => {
  const cards = buildPurchasingCards({
    jobs: [{ id: 'j1', canonical_name: 'A' }],
    budgets: [reviewedBudget()],
    moneyInputs: [{ job_id: 'j1', rough_labor_material: 3000, sale_price: 18000 }],
    conflicts: [{ number: 'YA-1', job_ids: ['j1', 'j2'] }],
    today: TODAY,
  });
  assert.equal(cards[0].windows.status, 'withheld');
  assert.equal(cards[0].windows.value, null);
  assert.deepEqual(cards[0].profit, { value: null, tone: 'unknown' });
  assert.equal(cards[0].conflict, true);
});

test('buildPurchasingCards: units count only active included scope (not reference/replaced)', () => {
  const cards = buildPurchasingCards({
    jobs: [{ id: 'j1', canonical_name: 'A' }],
    budgets: [reviewedBudget({ openings_qty: 12 }), { ...reviewedBudget(), id: 'b2', budget_usage: 'reference', openings_qty: 5 }],
    today: TODAY,
  });
  assert.equal(cards[0].units, 12);
});

test('buildPurchasingCards: cancelled vendor order does not create a card', () => {
  const cards = buildPurchasingCards({
    jobs: [{ id: 'j1', canonical_name: 'A' }],
    purchaseOrders: [{ id: 'po1', job_id: 'j1', po_number: 'YA-1', status: 'cancelled' }],
    vendorOrders: [{ job_id: 'j1', order_number: '09-1', status: 'ordered', purchase_order_id: 'po1' }],
    today: TODAY,
  });
  assert.equal(cards.length, 0);
});

test('buildPurchasingCards: duplicate job money inputs withhold (null + duplicate flag)', () => {
  const cards = buildPurchasingCards({
    jobs: [{ id: 'j1', canonical_name: 'A' }],
    budgets: [reviewedBudget()],
    moneyInputs: [{ job_id: 'j1', rough_labor_material: 3000, sale_price: 18000 }, { job_id: 'j1', rough_labor_material: 1, sale_price: 2 }],
    today: TODAY,
  });
  assert.equal(cards[0].rough.value, null);
  assert.equal(cards[0].sale.value, null);
  assert.equal(cards[0].rough.duplicate, true);
  assert.deepEqual(cards[0].profit, { value: null, tone: 'unknown' });
});

test('buildPurchasingCards: confirmed order grounds windows incl tax', () => {
  const cards = buildPurchasingCards({
    jobs: [{ id: 'j1', canonical_name: 'A' }],
    budgets: [reviewedBudget()],
    purchase_orders: [confirmedPO()],
    moneyInputs: [{ job_id: 'j1', rough_labor_material: 0, sale_price: 18000 }],
    today: TODAY,
  });
  assert.equal(cards[0].windows.value, 933.96);
  assert.equal(cards[0].windows.provenance, 'order');
  assert.equal(cards[0].profit.value, 18000 - 933.96 - 0);
});

test('buildPurchasingCards: profit computed from budget windows incl tax', () => {
  const cards = buildPurchasingCards({
    jobs: [{ id: 'j1', canonical_name: 'A' }],
    budgets: [reviewedBudget()],
    moneyInputs: [{ job_id: 'j1', rough_labor_material: 3000, sale_price: 18000 }],
    today: TODAY,
  });
  assert.equal(cards[0].windows.value, EXPECTED_WIN);
  assert.equal(cards[0].rough.value, 3000);
  assert.equal(cards[0].sale.value, 18000);
  assert.equal(cards[0].profit.value, roundMoney(18000 - EXPECTED_WIN - 3000));
  assert.equal(cards[0].profit.tone, 'positive');
});

test('unlinkedEntities: shop POs and unlinked quotes surfaced', () => {
  const u = unlinkedEntities({
    budgets: [{ id: 'b1', title: 'T', status: 'draft' }, { id: 'b2', job_id: 'j1', title: 'T2', status: 'draft' }],
    purchase_orders: [{ id: 'p1', purchase_type: 'shop', status: 'ordered' }, { id: 'p2', purchase_type: 'job', status: 'ordered' }, { id: 'p3', purchase_type: 'shop', status: 'cancelled' }],
  });
  assert.equal(u.unlinkedQuotes.length, 1);
  assert.equal(u.unlinkedQuotes[0].id, 'b1');
  assert.equal(u.shopPOs.length, 1);
  assert.equal(u.shopPOs[0].id, 'p1');
});

test('cardMatchesSearch: matches job name, quote, PO, supplier (find correct card, not cards[0])', () => {
  // Two active jobs: an alphabetically-earlier one without the PO, and Aria.
  // Cards sort by canonical name, so cards[0] is NOT the Aria card.
  const cards = buildPurchasingCards({
    jobs: [{ id: 'j2', canonical_name: 'Aaa-First' }, { id: 'j1', canonical_name: 'Aria-Belle' }],
    budgets: [{ ...reviewedBudget(), job_id: 'j2', id: 'b2', quote_number: 'Q9' }, reviewedBudget()],
    purchase_orders: [{ job_id: 'j1', po_number: 'YA-0005', status: 'ordered', vendor: 'AMSCO', vendor_quote_ref: 'Q1' }],
    today: TODAY,
  });
  assert.notEqual(cards[0].job.canonical_name, 'Aria-Belle');
  const aria = cards.find((c) => c.job.canonical_name === 'Aria-Belle');
  assert.ok(aria, 'Aria card present');
  assert.ok(cardMatchesSearch(aria, 'aria'));
  assert.ok(cardMatchesSearch(aria, 'YA-0005'));
  assert.ok(cardMatchesSearch(aria, 'amsco'));
  assert.ok(!cardMatchesSearch(aria, 'zzz'));
  assert.ok(cardMatchesSearch(aria, ''));
});