// Pure viewmodel tests for the unified Purchasing page. No React, no SDK.
// Every expected money value below is derived BY HAND from the fixture's
// printed source fields (shown in comments) — never by calling the function
// under test or the budget math. Windows incl tax must come from a supplier's
// printed single-price quote whose subtotal + explicit printed tax reconciles
// to the printed total; the budget's cost_material_tax (which includes the
// labor-driven overhead adder) and PO amount_dealer are never used.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  windowsInclTax, sourceQuoteInclTax, computeProfit, refsForJob, nextActionForJob,
  buildPurchasingCards, unlinkedEntities, cardMatchesSearch,
} from '../src/lib/purchasingViewModel.js';

const TODAY = '2026-10-07';
// Supplier's printed single-price quote: 1000.00 subtotal + 74.50 tax = 1074.50 total.
const supplierQuote = { price_levels: 'single', quoted_by: 'Nu Vista Sales', net_total: 1000, customer_tax: 74.5, customer_total: 1074.5 };
const WIN = 1074.5;
const reviewedBudget = (over = {}, quote = supplierQuote) => ({
  id: 'b1', job_id: 'j1', budget_usage: 'included', numbers_reviewed_at: '2026-10-01',
  vendor: 'AMSCO', quote_number: 'Q1', openings_qty: 12, quote,
  inputs: { material_true_cost: 10000, labor_cost_sub_pay: 2000, actual_total_sell: 18000, ...over },
});

test('sourceQuoteInclTax: printed subtotal + tax reconcile → printed total', () => {
  assert.deepEqual(sourceQuoteInclTax({ quote: supplierQuote }), { value: 1074.5, reason: null });
});

test('sourceQuoteInclTax: explicit zero tax is valid (500 + 0 = 500)', () => {
  assert.equal(sourceQuoteInclTax({ quote: { price_levels: 'single', net_total: 500, customer_tax: 0, customer_total: 500 } }).value, 500);
});

test('sourceQuoteInclTax: Taira-shaped single quote (126085.15 + 5989.04 = 132074.19)', () => {
  const q = { price_levels: 'single', quoted_by: 'Admin Admin', net_total: 126085.15, customer_tax: 5989.04, customer_total: 132074.19 };
  assert.equal(sourceQuoteInclTax({ quote: q }).value, 132074.19);
});

test('sourceQuoteInclTax: absent / null / string tax → withhold (no guessed tax rate)', () => {
  assert.equal(sourceQuoteInclTax({ quote: { ...supplierQuote, customer_tax: undefined } }).reason, 'tax_absent');
  assert.equal(sourceQuoteInclTax({ quote: { ...supplierQuote, customer_tax: null } }).reason, 'tax_absent');
  assert.equal(sourceQuoteInclTax({ quote: { ...supplierQuote, customer_tax: '74.5' } }).reason, 'tax_absent');
});

test('sourceQuoteInclTax: AV24-shaped dealer+customer quote → withhold (customer total is not proven supplier cost)', () => {
  const q = { price_levels: 'dealer_and_customer', dealer_subtotal: 869.2, customer_tax: 64.76, customer_total: 933.96 };
  assert.deepEqual(sourceQuoteInclTax({ quote: q }), { value: null, reason: 'no_single_supplier_total' });
});

test('sourceQuoteInclTax: own Glass Forge quote → withhold', () => {
  assert.equal(sourceQuoteInclTax({ quote: { ...supplierQuote, quoted_by: 'Gabriel Fronk' } }).reason, 'own_quote');
});

test('sourceQuoteInclTax: totals that do not reconcile → withhold (1000 + 74.50 ≠ 1100)', () => {
  assert.equal(sourceQuoteInclTax({ quote: { ...supplierQuote, customer_total: 1100 } }).reason, 'totals_do_not_reconcile');
});

test('sourceQuoteInclTax: missing subtotal → withhold', () => {
  assert.equal(sourceQuoteInclTax({ quote: { price_levels: 'single', customer_tax: 74.5, customer_total: 1074.5 } }).reason, 'subtotal_absent');
});

test('windowsInclTax: empty when no budgets', () => {
  assert.deepEqual(windowsInclTax([]), { value: null, status: 'empty', budgetId: null, provenance: null });
});

test('windowsInclTax: reviewed included budget with verified supplier quote → printed total (provenance source_quote)', () => {
  const w = windowsInclTax([reviewedBudget()]);
  assert.equal(w.status, 'ready');
  assert.equal(w.value, WIN);
  assert.equal(w.provenance, 'source_quote');
});

test('windowsInclTax: legacy budget with labor but no source quote → Needs review, NOT cost_material_tax', () => {
  const w = windowsInclTax([reviewedBudget({}, undefined)]);
  assert.equal(w.status, 'review');
  assert.equal(w.value, null);
  assert.equal(w.reason, 'no_single_supplier_total');
});

test('windowsInclTax: multiple active non-replacement budgets → withheld', () => {
  const a = reviewedBudget(); const b = { ...reviewedBudget(), id: 'b2', quote_number: 'Q2' };
  assert.equal(windowsInclTax([a, b]).status, 'withheld');
});

test('windowsInclTax: replacement chain resolves to survivor', () => {
  const rep = { ...reviewedBudget(), id: 'b2', replaces_budget_id: 'b1' };
  const w = windowsInclTax([reviewedBudget(), rep]);
  assert.equal(w.status, 'ready');
  assert.equal(w.budgetId, 'b2');
});

test('windowsInclTax: draft-only budget → review (a quote exists that needs review)', () => {
  const w = windowsInclTax([{ ...reviewedBudget(), budget_usage: 'draft', numbers_reviewed_at: null }]);
  assert.equal(w.status, 'review');
  assert.equal(w.value, null);
});

test('windowsInclTax: reference-only budget → empty', () => {
  assert.equal(windowsInclTax([{ ...reviewedBudget(), budget_usage: 'reference' }]).status, 'empty');
});

test('windowsInclTax: included but numbers not reviewed → review', () => {
  const w = windowsInclTax([{ ...reviewedBudget(), numbers_reviewed_at: null }]);
  assert.equal(w.status, 'review');
  assert.equal(w.value, null);
});

test('computeProfit: unknown when any input null', () => {
  assert.deepEqual(computeProfit(null, 5, 10), { value: null, tone: 'unknown' });
  assert.deepEqual(computeProfit(5, null, 10), { value: null, tone: 'unknown' });
  assert.deepEqual(computeProfit(5, 5, null), { value: null, tone: 'unknown' });
});

test('computeProfit: positive / negative / zero', () => {
  assert.equal(computeProfit(100, 50, 200).value, 50);
  assert.equal(computeProfit(100, 50, 200).tone, 'positive');
  assert.equal(computeProfit(100, 50, 120).tone, 'negative');
  assert.equal(computeProfit(100, 50, 150).tone, 'zero');
});

test('refsForJob: all none when no records', () => {
  const r = refsForJob('j1', {});
  for (const k of ['quoteStatus', 'poStatus', 'mfrStatus', 'etaStatus', 'payment']) assert.equal(r[k], 'none');
});

test('refsForJob: quote number from a single active reviewed budget', () => {
  const r = refsForJob('j1', { budgets: [reviewedBudget()] });
  assert.equal(r.quoteNumber, 'Q1');
  assert.equal(r.quoteStatus, 'green');
});

test('refsForJob: green when reviewed budget, confirmed PO, paid order with ETA', () => {
  const r = refsForJob('j1', {
    budgets: [reviewedBudget()],
    purchaseOrders: [{ job_id: 'j1', po_number: 'YA-0001', status: 'confirmed' }],
    vendorOrders: [{ job_id: 'j1', order_number: '09-5476', eta_date: '2026-10-10', status: 'paid', paid_at: '2026-10-09' }],
    today: TODAY,
  });
  for (const k of ['quoteStatus', 'poStatus', 'mfrStatus', 'etaStatus', 'payment']) assert.equal(r[k], 'green');
  assert.equal(r.paymentLabel, 'Paid');
});

test('refsForJob: pending PO (issued) → amber', () => {
  const r = refsForJob('j1', { purchaseOrders: [{ job_id: 'j1', po_number: 'YA-1', status: 'issued' }] });
  assert.equal(r.poStatus, 'amber');
  assert.equal(r.yaPo, 'YA-1');
});

test('refsForJob: multiple distinct POs / quotes → "Multiple"', () => {
  const r = refsForJob('j1', { purchaseOrders: [{ job_id: 'j1', po_number: 'YA-1', status: 'confirmed' }, { job_id: 'j1', po_number: 'YA-2', status: 'confirmed' }] });
  assert.equal(r.yaPo, 'Multiple');
  const q = refsForJob('j1', { budgets: [reviewedBudget(), { ...reviewedBudget(), id: 'b2', quote_number: 'Q2' }] });
  assert.equal(q.quoteNumber, 'Multiple');
  assert.equal(q.quoteStatus, 'amber');
});

test('refsForJob: ETA Delivered / overdue / Multiple', () => {
  assert.equal(refsForJob('j1', { vendorOrders: [{ job_id: 'j1', order_number: '1', eta_date: '2026-09-01', received_date: '2026-10-05', status: 'paid' }], today: TODAY }).etaLabel, 'Delivered');
  const overdue = refsForJob('j1', { vendorOrders: [{ job_id: 'j1', order_number: '1', eta_date: '2026-10-01', status: 'eta_set' }], today: TODAY });
  assert.equal(overdue.etaStatus, 'amber');
  const multi = refsForJob('j1', { vendorOrders: [{ job_id: 'j1', order_number: '1', eta_date: '2026-10-10' }, { job_id: 'j1', order_number: '2', eta_date: '2026-10-20' }], today: TODAY });
  assert.equal(multi.etaLabel, 'Multiple');
});

test('refsForJob: payment Partial / Unpaid', () => {
  assert.equal(refsForJob('j1', { vendorOrders: [{ job_id: 'j1', order_number: '1', status: 'paid', paid_at: 'x' }, { job_id: 'j1', order_number: '2', status: 'ordered' }] }).paymentLabel, 'Partial');
  assert.equal(refsForJob('j1', { vendorOrders: [{ job_id: 'j1', order_number: '1', status: 'eta_set' }] }).paymentLabel, 'Unpaid');
});

test('refsForJob: cancelled PO and its vendor order excluded', () => {
  const r = refsForJob('j1', {
    purchaseOrders: [{ id: 'po1', job_id: 'j1', po_number: 'YA-1', status: 'cancelled' }],
    vendorOrders: [{ job_id: 'j1', order_number: '1', status: 'ordered', purchase_order_id: 'po1' }],
  });
  assert.equal(r.poStatus, 'none');
  assert.equal(r.mfrStatus, 'none');
  assert.equal(r.payment, 'none');
});

const linkedPO = { id: 'po1', job_id: 'j1', po_number: 'YA-1', status: 'ordered', vendor: 'AMSCO', vendor_quote_ref: 'Q1' };

test('nextActionForJob: Review numbers when budget draft', () => {
  const a = nextActionForJob('j1', { budgets: [{ ...reviewedBudget(), budget_usage: 'draft', numbers_reviewed_at: null }] });
  assert.equal(a.label, 'Review numbers');
});

test('nextActionForJob: Prepare PO when included budget has no matching PO', () => {
  assert.equal(nextActionForJob('j1', { budgets: [reviewedBudget()] }).label, 'Prepare PO');
});

test('nextActionForJob: Confirm order when PO has no supplier confirmation', () => {
  assert.equal(nextActionForJob('j1', { budgets: [reviewedBudget()], purchaseOrders: [linkedPO] }).label, 'Confirm order');
});

test('nextActionForJob: Record ETA when the linked supplier order has no eta', () => {
  const a = nextActionForJob('j1', { budgets: [reviewedBudget()], purchaseOrders: [linkedPO], vendorOrders: [{ id: 'vo1', job_id: 'j1', order_number: '09-1', status: 'ordered', purchase_order_id: 'po1' }] });
  assert.equal(a.label, 'Record ETA');
});

test('nextActionForJob: Record payment when unpaid and ETA set', () => {
  const a = nextActionForJob('j1', { budgets: [reviewedBudget()], purchaseOrders: [linkedPO], vendorOrders: [{ id: 'vo1', job_id: 'j1', order_number: '09-1', eta_date: '2026-10-10', status: 'eta_set', purchase_order_id: 'po1' }] });
  assert.equal(a.label, 'Record payment');
});

test('nextActionForJob: already paid → Reconcile, not Record payment', () => {
  const a = nextActionForJob('j1', { budgets: [reviewedBudget()], purchaseOrders: [linkedPO], vendorOrders: [{ id: 'vo1', job_id: 'j1', order_number: '09-1', eta_date: '2026-10-10', received_date: '2026-10-11', status: 'paid', paid_at: '2026-10-12', purchase_order_id: 'po1' }] });
  assert.equal(a.label, 'Reconcile');
});

test('nextActionForJob: all complete → Open job', () => {
  const a = nextActionForJob('j1', { budgets: [reviewedBudget()], purchaseOrders: [linkedPO], vendorOrders: [{ id: 'vo1', job_id: 'j1', order_number: '09-1', eta_date: '2026-10-10', received_date: '2026-10-11', status: 'reconciled', paid_at: 'x', reconciled_at: 'y', purchase_order_id: 'po1' }] });
  assert.equal(a.label, 'Open job');
  assert.equal(a.key, 'job');
});

test('nextActionForJob: Resolve PO conflict takes priority', () => {
  assert.equal(nextActionForJob('j1', { budgets: [reviewedBudget()], conflicts: [{ number: 'YA-1', job_ids: ['j1', 'j2'] }] }).label, 'Resolve PO conflict');
});

test('buildPurchasingCards: excludes merged, sample, ignored, inactive jobs', () => {
  const jobs = [
    { id: 'j1', canonical_name: 'Alpha' }, { id: 'j2', canonical_name: 'Beta', merged_into: 'j1' },
    { id: 'j3', canonical_name: 'Gamma', is_sample: true }, { id: 'j4', canonical_name: 'Renta' }, { id: 'j5', canonical_name: 'Delta' },
  ];
  const names = buildPurchasingCards({ jobs, budgets: [reviewedBudget()], moneyInputs: [{ job_id: 'j5', rough_labor_material: 100 }], today: TODAY }).map((c) => c.job.canonical_name);
  assert.deepEqual(names, ['Alpha', 'Delta']);
});

test('buildPurchasingCards: windows from source quote; profit = 18000 − 1074.50 − 3000 = 13925.50', () => {
  const [card] = buildPurchasingCards({ jobs: [{ id: 'j1', canonical_name: 'A' }], budgets: [reviewedBudget()], moneyInputs: [{ job_id: 'j1', rough_labor_material: 3000, sale_price: 18000 }], today: TODAY });
  assert.equal(card.windows.value, 1074.5);
  assert.equal(card.windows.provenance, 'source_quote');
  assert.equal(card.profit.value, 13925.5);
  assert.equal(card.profit.tone, 'positive');
});

test('buildPurchasingCards: PO amount_dealer never fills windows; legacy budget → Needs review, profit withheld', () => {
  const [card] = buildPurchasingCards({
    jobs: [{ id: 'j1', canonical_name: 'A' }], budgets: [reviewedBudget({}, undefined)],
    purchase_orders: [{ ...linkedPO, amount_dealer: 933.96, budget_id: 'b1' }],
    moneyInputs: [{ job_id: 'j1', rough_labor_material: 3000, sale_price: 18000 }], today: TODAY,
  });
  assert.equal(card.windows.value, null);
  assert.equal(card.windows.status, 'review');
  assert.deepEqual(card.profit, { value: null, tone: 'unknown' });
});

test('buildPurchasingCards: conflict job withholds windows AND profit', () => {
  const [card] = buildPurchasingCards({ jobs: [{ id: 'j1', canonical_name: 'A' }], budgets: [reviewedBudget()], moneyInputs: [{ job_id: 'j1', rough_labor_material: 3000, sale_price: 18000 }], conflicts: [{ number: 'YA-1', job_ids: ['j1', 'j2'] }], today: TODAY });
  assert.equal(card.windows.status, 'withheld');
  assert.deepEqual(card.profit, { value: null, tone: 'unknown' });
  assert.equal(card.conflict, true);
});

test('buildPurchasingCards: units count only active included scope', () => {
  const [card] = buildPurchasingCards({ jobs: [{ id: 'j1', canonical_name: 'A' }], budgets: [reviewedBudget(), { ...reviewedBudget(), id: 'b2', budget_usage: 'reference', openings_qty: 5 }], today: TODAY });
  assert.equal(card.units, 12);
});

test('buildPurchasingCards: cancelled PO + its vendor order create no card', () => {
  const cards = buildPurchasingCards({ jobs: [{ id: 'j1', canonical_name: 'A' }], purchase_orders: [{ id: 'po1', job_id: 'j1', po_number: 'YA-1', status: 'cancelled' }], vendor_orders: [{ job_id: 'j1', order_number: '1', status: 'ordered', purchase_order_id: 'po1' }], today: TODAY });
  assert.equal(cards.length, 0);
});

test('buildPurchasingCards: duplicate job money inputs withhold', () => {
  const [card] = buildPurchasingCards({ jobs: [{ id: 'j1', canonical_name: 'A' }], budgets: [reviewedBudget()], moneyInputs: [{ job_id: 'j1', rough_labor_material: 3000, sale_price: 18000 }, { job_id: 'j1', rough_labor_material: 1, sale_price: 2 }], today: TODAY });
  assert.equal(card.rough.value, null);
  assert.equal(card.rough.duplicate, true);
  assert.deepEqual(card.profit, { value: null, tone: 'unknown' });
});

test('unlinkedEntities: shop POs and unlinked quotes surfaced', () => {
  const u = unlinkedEntities({
    budgets: [{ id: 'b1', title: 'T' }, { id: 'b2', job_id: 'j1', title: 'T2' }],
    purchase_orders: [{ id: 'p1', purchase_type: 'shop', status: 'ordered' }, { id: 'p2', purchase_type: 'job', status: 'ordered' }, { id: 'p3', purchase_type: 'shop', status: 'cancelled' }],
  });
  assert.deepEqual(u.unlinkedQuotes.map((b) => b.id), ['b1']);
  assert.deepEqual(u.shopPOs.map((p) => p.id), ['p1']);
});

test('cardMatchesSearch: finds the correct card by name, not cards[0]', () => {
  const cards = buildPurchasingCards({
    jobs: [{ id: 'j2', canonical_name: 'Aaa-First' }, { id: 'j1', canonical_name: 'Aria-Belle' }],
    budgets: [{ ...reviewedBudget(), id: 'b2', job_id: 'j2', quote_number: 'Q9' }, reviewedBudget()],
    purchase_orders: [{ job_id: 'j1', po_number: 'YA-0005', status: 'ordered', vendor: 'AMSCO', vendor_quote_ref: 'Q1' }],
    today: TODAY,
  });
  assert.equal(cards[0].job.canonical_name, 'Aaa-First');
  const aria = cards.find((c) => c.job.canonical_name === 'Aria-Belle');
  assert.ok(cardMatchesSearch(aria, 'aria'));
  assert.ok(cardMatchesSearch(aria, 'YA-0005'));
  assert.ok(cardMatchesSearch(aria, 'amsco'));
  assert.ok(!cardMatchesSearch(aria, 'zzz'));
  assert.ok(!cardMatchesSearch(cards[0], 'YA-0005'));
  assert.ok(cardMatchesSearch(aria, ''));
});