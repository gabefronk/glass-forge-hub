// Display-candidate tests for the unified Purchasing page (DISPLAY ONLY — no
// datastore writes). The verified canonical value is kept separate; these
// cover the best-known candidate shown in the tile when verified is null.
// Expected money values are derived by hand from the fixture's printed /
// computed fields (shown in comments), never by calling the function under test.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  windowsDisplayCandidate, roughDisplayCandidate, saleDisplayCandidate,
  profitDisplayCalc, pickDisplayBudget, buildPurchasingCards,
} from '../src/lib/purchasingViewModel.js';

const TODAY = '2026-10-07';
const supplierQuote = {
  price_levels: 'single', vendor: 'AMSCO', quoted_by: 'Nu Vista Sales', bill_to: 'YA Windows and Doors',
  lines: [{ kind: 'window', qty: 12, extended: 1000 }], net_total: 1000, customer_tax: 74.5, customer_total: 1074.5,
};
const reviewedBudget = (over = {}, opts = {}) => ({
  id: 'b1', job_id: 'j1', budget_usage: 'included', numbers_reviewed_at: '2026-10-01',
  vendor: 'AMSCO', quote_number: 'Q1', openings_qty: 12,
  quote: Object.prototype.hasOwnProperty.call(opts, 'quote') ? opts.quote : supplierQuote,
  inputs: { material_true_cost: 10000, labor_cost_sub_pay: 2000, actual_total_sell: 18000, ...over },
});
// cost_material_tax for reviewedBudget inputs:
//   overheadAdder = 2000/0.74 - 2000 = 702.7027; budgetCostTotalMaterial = 10000 + 702.7027*0.20 = 10140.5405
//   useTax = 10000 * 0.0745 = 745.00; costMaterialTax = 10140.5405 + 745.00 = 10885.54
const CMT = 10885.54;
// b2: material 5000, labor 1000 → overhead 351.351; material+overhead*keep = 5070.2702; tax 372.50; cmt = 5442.77
const CMT_B2 = 5442.77;

test('windowsDisplayCandidate: known-unverified (legacy budget, no source quote) shows cost_material_tax amber', () => {
  const d = windowsDisplayCandidate([reviewedBudget({}, { quote: null })], [], []);
  assert.equal(d.value, CMT);
  assert.equal(d.review, true);
  assert.equal(d.source, 'cost_material_tax');
  assert.match(d.label, /overhead/);
});

test('windowsDisplayCandidate: genuinely missing (no inputs, no PO, no order) → dash', () => {
  const b = { id: 'b1', job_id: 'j1', budget_usage: 'included', numbers_reviewed_at: '2026-10-01', inputs: {}, quote: null };
  assert.equal(windowsDisplayCandidate([b], [], []).value, null);
});

test('windowsDisplayCandidate: zero verified quote total (0 + 0 = 0) stays 0, not dash', () => {
  const q = { ...supplierQuote, lines: [{ kind: 'window', extended: 0 }], net_total: 0, customer_tax: 0, customer_total: 0 };
  const d = windowsDisplayCandidate([reviewedBudget({}, { quote: q })], [], []);
  assert.equal(d.value, 0);
  assert.equal(d.review, false);
  assert.equal(d.source, 'source_quote');
});

test('windowsDisplayCandidate: multiple scopes → deterministic candidate + alternatives, never sum, labelled review', () => {
  const b1 = reviewedBudget({}, { quote: null });
  const b2 = { ...reviewedBudget({}, { quote: null }), id: 'b2', inputs: { material_true_cost: 5000, labor_cost_sub_pay: 1000, actual_total_sell: 9000 } };
  const d = windowsDisplayCandidate([b1, b2], [], []);
  assert.equal(d.source, 'multiple_scopes');
  assert.equal(d.review, true);
  assert.equal(d.value, CMT); // b1 picked on id tiebreak (same score)
  assert.equal(d.alternatives.length, 1);
  assert.equal(d.alternatives[0].value, CMT_B2);
  assert.match(d.label, /1 of 2 scopes/);
});

test('windowsDisplayCandidate: conflict shows candidate with po_conflict provenance + review flag', () => {
  const d = windowsDisplayCandidate([reviewedBudget()], [], [], { conflict: true });
  assert.equal(d.source, 'po_conflict');
  assert.equal(d.review, true);
  assert.equal(d.value, 1074.5); // verified source quote is still the best-known figure
  assert.match(d.label, /PO conflict/);
});

test('windowsDisplayCandidate: conflict with no cost figure → dash + po_conflict label', () => {
  const b = { id: 'b1', job_id: 'j1', budget_usage: 'included', numbers_reviewed_at: '2026-10-01', inputs: {}, quote: null };
  const d = windowsDisplayCandidate([b], [], [], { conflict: true });
  assert.equal(d.value, null);
  assert.equal(d.source, 'po_conflict');
  assert.equal(d.review, true);
});

test('windowsDisplayCandidate: PO amount_dealer is a candidate (labelled, no tax) when no budget cost figure', () => {
  const b = { id: 'b1', job_id: 'j1', budget_usage: 'included', numbers_reviewed_at: '2026-10-01', inputs: {}, quote: null };
  const d = windowsDisplayCandidate([b], [{ id: 'po1', job_id: 'j1', budget_id: 'b1', po_number: 'YA-1', status: 'ordered', amount_dealer: 933.96 }], []);
  assert.equal(d.value, 933.96);
  assert.equal(d.source, 'po_dealer');
  assert.equal(d.review, true);
  assert.match(d.label, /no tax/);
});

test('windowsDisplayCandidate: customer_total / actual_total_sell never used as supplier cost; dealer price labelled dealer', () => {
  const b = { id: 'b1', job_id: 'j1', budget_usage: 'included', numbers_reviewed_at: '2026-10-01', inputs: { actual_total_sell: 18000 }, quote: { price_levels: 'dealer_and_customer', dealer_subtotal: 869.2, customer_tax: 64.76, customer_total: 933.96 } };
  const d = windowsDisplayCandidate([b], [], []);
  assert.equal(d.value, 869.2); // dealer_subtotal, not customer_total 933.96, not actual_total_sell 18000
  assert.equal(d.source, 'dealer_price');
  assert.match(d.label, /Dealer/);
  assert.notEqual(d.value, 933.96);
  assert.notEqual(d.value, 18000);
});

test('roughDisplayCandidate: owner-entered value shown, not review', () => {
  const d = roughDisplayCandidate(reviewedBudget(), 3000, false);
  assert.equal(d.value, 3000);
  assert.equal(d.review, false);
  assert.equal(d.source, 'owner');
});

test('roughDisplayCandidate: owner-entered 0 stays 0 (not dash, not invented)', () => {
  const d = roughDisplayCandidate(reviewedBudget(), 0, false);
  assert.equal(d.value, 0);
  assert.equal(d.review, false);
});

test('roughDisplayCandidate: absent owner → budget labor+material estimate, labelled estimate (not owner-entered)', () => {
  const d = roughDisplayCandidate(reviewedBudget(), null, false);
  assert.equal(d.value, 2000); // labor_cost_sub_pay 2000 + additional_install_material 0
  assert.equal(d.review, true);
  assert.equal(d.source, 'budget_estimate');
  assert.match(d.label, /estimate/);
  assert.doesNotMatch(d.label, /owner/i);
});

test('roughDisplayCandidate: genuinely missing (no budget labor) → dash', () => {
  const d = roughDisplayCandidate({ inputs: { actual_total_sell: 18000 } }, null, false);
  assert.equal(d.value, null);
  assert.equal(d.review, false);
});

test('saleDisplayCandidate: owner-entered value shown, not review', () => {
  const d = saleDisplayCandidate(reviewedBudget(), 18000, false);
  assert.equal(d.value, 18000);
  assert.equal(d.review, false);
  assert.equal(d.source, 'owner');
});

test('saleDisplayCandidate: absent owner → budget target sell estimate, labelled estimate (not owner-entered)', () => {
  const d = saleDisplayCandidate(reviewedBudget(), null, false);
  assert.equal(d.value, 18000);
  assert.equal(d.review, true);
  assert.equal(d.source, 'budget_estimate');
  assert.match(d.label, /estimate/);
  assert.doesNotMatch(d.label, /owner/i);
});

test('profitDisplayCalc: flag propagates when any input is a candidate', () => {
  const p = profitDisplayCalc({ value: CMT, review: true }, { value: 3000, review: false }, { value: 18000, review: false });
  assert.equal(p.value, 4114.46);
  assert.equal(p.review, true);
});

test('profitDisplayCalc: no flag when all three verified', () => {
  const p = profitDisplayCalc({ value: 1074.5, review: false }, { value: 3000, review: false }, { value: 18000, review: false });
  assert.equal(p.value, 13925.5);
  assert.equal(p.review, false);
});

test('profitDisplayCalc: dash when any display input absent', () => {
  assert.deepEqual(profitDisplayCalc({ value: null, review: false }, { value: 3000, review: false }, { value: 18000, review: false }), { value: null, tone: 'unknown', review: false });
});

test('buildPurchasingCards: verified canonical preserved separate; display candidate added; no storage mutation', () => {
  const jobs = [{ id: 'j1', canonical_name: 'A' }];
  const budgets = [reviewedBudget({}, { quote: null })];
  const moneyInputs = [{ job_id: 'j1', rough_labor_material: 3000, sale_price: 18000 }];
  const before = JSON.parse(JSON.stringify({ jobs, budgets, moneyInputs }));
  const [card] = buildPurchasingCards({ jobs, budgets, moneyInputs, today: TODAY });
  // Verified canonical unchanged (separate)
  assert.equal(card.windows.value, null);
  assert.equal(card.windows.status, 'review');
  assert.deepEqual(card.profit, { value: null, tone: 'unknown' }); // verified profit withheld (windows unverified)
  // Display candidate present
  assert.equal(card.windows.display.value, CMT);
  assert.equal(card.windows.display.review, true);
  assert.equal(card.profitDisplay.value, 4114.46);
  assert.equal(card.profitDisplay.review, true);
  // No mutation of inputs
  assert.deepEqual({ jobs, budgets, moneyInputs }, before);
});

test('buildPurchasingCards: all-verified job — display equals verified, profit unflagged', () => {
  const [card] = buildPurchasingCards({ jobs: [{ id: 'j1', canonical_name: 'A' }], budgets: [reviewedBudget()], moneyInputs: [{ job_id: 'j1', rough_labor_material: 3000, sale_price: 18000 }], today: TODAY });
  assert.equal(card.windows.value, 1074.5);
  assert.equal(card.windows.display.value, 1074.5);
  assert.equal(card.windows.display.review, false);
  assert.equal(card.profitDisplay.value, 13925.5);
  assert.equal(card.profitDisplay.review, false);
  assert.equal(card.profit.value, 13925.5);
});

test('buildPurchasingCards: duplicate money — owner verified withheld, budget estimates shown flagged', () => {
  const [card] = buildPurchasingCards({ jobs: [{ id: 'j1', canonical_name: 'A' }], budgets: [reviewedBudget()], moneyInputs: [{ job_id: 'j1', rough_labor_material: 3000, sale_price: 18000 }, { job_id: 'j1', rough_labor_material: 1, sale_price: 2 }], today: TODAY });
  assert.equal(card.rough.value, null); // verified owner withheld (duplicate)
  assert.equal(card.rough.duplicate, true);
  assert.equal(card.rough.display.value, 2000); // budget labor estimate
  assert.equal(card.rough.display.review, true);
  assert.equal(card.sale.display.value, 18000); // budget target sell estimate
  assert.equal(card.sale.display.review, true);
  assert.equal(card.profitDisplay.review, true);
  assert.deepEqual(card.profit, { value: null, tone: 'unknown' }); // verified profit still withheld
});

test('pickDisplayBudget: deterministic — verified source quote beats cost-only budget', () => {
  const verified = reviewedBudget();
  const costOnly = { ...reviewedBudget({}, { quote: null }), id: 'b2' };
  assert.equal(pickDisplayBudget([costOnly, verified]).id, 'b1');
});

test('windowsDisplayCandidate: PO-only job (no budget) falls back to PO dealer amount, no tax verified', () => {
  const d = windowsDisplayCandidate([], [{ id: 'po1', job_id: 'j1', po_number: 'YA-1', status: 'ordered', amount_dealer: 933.96 }], []);
  assert.equal(d.value, 933.96);
  assert.equal(d.source, 'po_dealer');
  assert.equal(d.review, true);
  assert.match(d.label, /no tax/);
  assert.equal(d.budgetId, null);
});

test('windowsDisplayCandidate: PO-only job with multiple POs → deterministic pick + alternatives, never sum', () => {
  const d = windowsDisplayCandidate([], [
    { id: 'po2', job_id: 'j1', po_number: 'YA-2', status: 'ordered', amount_dealer: 500 },
    { id: 'po1', job_id: 'j1', po_number: 'YA-1', status: 'ordered', amount_dealer: 933.96 },
  ], []);
  assert.equal(d.value, 933.96); // po1 picked on id tiebreak
  assert.equal(d.alternatives.length, 1);
  assert.equal(d.alternatives[0].value, 500);
});

test('buildPurchasingCards: PO-only job (no budget) does not crash; shows PO amount candidate; chosenBudget null', () => {
  const [card] = buildPurchasingCards({ jobs: [{ id: 'j1', canonical_name: 'A' }], budgets: [], purchase_orders: [{ id: 'po1', job_id: 'j1', po_number: 'YA-1', status: 'ordered', amount_dealer: 933.96 }], moneyInputs: [], today: TODAY });
  assert.equal(card.windows.display.value, 933.96);
  assert.equal(card.rough.display.value, null);
  assert.equal(card.sale.display.value, null);
  assert.equal(card.chosenBudget, null);
});

test('roughDisplayCandidate: partial estimate when one component missing (labor only)', () => {
  const d = roughDisplayCandidate({ inputs: { labor_cost_sub_pay: 2000 } }, null, false);
  assert.equal(d.value, 2000);
  assert.equal(d.review, true);
  assert.match(d.label, /partial/);
  assert.match(d.label, /labor/);
});

test('saleDisplayCandidate: explicit 0 target sell stays 0 (not invented, not dropped)', () => {
  const d = saleDisplayCandidate({ inputs: { actual_total_sell: 0 } }, null, false);
  assert.equal(d.value, 0);
  assert.equal(d.review, true);
  assert.equal(d.source, 'budget_estimate');
});