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
//   The displayed cost is window material + equipment with use tax, never the budget's
//   cost_material_tax (10885.54, which adds the 140.54 labor overhead adder):
//   10000 * 1.0745 = 10745.00
const CMT = 10745;
// Pre-tax PO/order/dealer amounts display with the 7.45% workbook use tax.
const withTax = (n) => Math.round(n * 1.0745 * 100) / 100;
// b2: material 5000, labor 1000 → overhead 351.351; material+overhead*keep = 5070.2702; tax 372.50; cmt = 5442.77
const CMT_B2 = 5442.77;

test('windowsDisplayCandidate: no direct records -> owner-typed budget review figure (material incl tax), flagged review', () => {
  const d = windowsDisplayCandidate([reviewedBudget({}, { quote: null })], [], []);
  assert.equal(d.value, CMT);
  assert.equal(d.source, 'cost_material_tax');
  assert.equal(d.label, 'Budget material + 7.45% use tax');
  assert.equal(d.review, true);
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

test('windowsDisplayCandidate: multiple scopes -> deterministic candidate + alternatives, never sum, labelled review', () => {
  const b1 = reviewedBudget({}, { quote: null });
  const b2 = { ...reviewedBudget({}, { quote: null }), id: 'b2', inputs: { material_true_cost: 5000, labor_cost_sub_pay: 1000, actual_total_sell: 9000 } };
  const pos = [{ id: 'p1', budget_id: 'b1', amount_dealer: 100, po_number: 'YA-0001' }, { id: 'p2', budget_id: 'b2', amount_dealer: 200, po_number: 'YA-0002' }];
  const d = windowsDisplayCandidate([b1, b2], pos, []);
  assert.equal(d.source, 'multiple_scopes');
  assert.equal(d.review, true);
  assert.equal(d.value, withTax(100)); // b1's scoped PO picked on id tiebreak (same score)
  assert.equal(d.alternatives.length, 1);
  assert.equal(d.alternatives[0].value, withTax(200));
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

test('windowsDisplayCandidate: PO amount_dealer is a candidate (labelled, plus use tax) when no budget cost figure', () => {
  const b = { id: 'b1', job_id: 'j1', budget_usage: 'included', numbers_reviewed_at: '2026-10-01', inputs: {}, quote: null };
  const d = windowsDisplayCandidate([b], [{ id: 'po1', job_id: 'j1', budget_id: 'b1', po_number: 'YA-1', status: 'ordered', amount_dealer: 933.96 }], []);
  assert.equal(d.value, withTax(933.96));
  assert.equal(d.source, 'po_dealer');
  assert.equal(d.review, true);
  assert.equal(d.label, 'PO YA-1 + 7.45% use tax');
});

test('windowsDisplayCandidate: customer_total / actual_total_sell never used as supplier cost; dealer price labelled dealer', () => {
  const b = { id: 'b1', job_id: 'j1', budget_usage: 'included', numbers_reviewed_at: '2026-10-01', inputs: { actual_total_sell: 18000 }, quote: { price_levels: 'dealer_and_customer', dealer_subtotal: 869.2, customer_tax: 64.76, customer_total: 933.96 } };
  const d = windowsDisplayCandidate([b], [], []);
  // dealer_subtotal plus use tax; never actual_total_sell 18000. (Here the fixture's customer
  // total happens to be the same dealer amount plus the same 7.45%.)
  assert.equal(d.value, withTax(869.2));
  assert.equal(d.source, 'dealer_price');
  assert.equal(d.label, 'Dealer price + 7.45% use tax (review)');
  assert.notEqual(d.value, 18000);
});

test('roughDisplayCandidate: the budget wins over the older money entry (Oct 24: budget is the source)', () => {
  const d = roughDisplayCandidate(reviewedBudget(), 3000, false);
  assert.equal(d.value, 2000);
  assert.equal(d.review, false);
  assert.equal(d.source, 'budget_inputs');
});

test('roughDisplayCandidate: the older money entry only fills a budget with no labor figure, flagged', () => {
  const d = roughDisplayCandidate({ inputs: { actual_total_sell: 18000 } }, 0, false);
  assert.equal(d.value, 0);
  assert.equal(d.review, true);
  assert.equal(d.source, 'owner');
});

test('roughDisplayCandidate: budget labor/material shows unflagged', () => {
  const d = roughDisplayCandidate(reviewedBudget(), null, false);
  assert.equal(d.value, 2000);
  assert.equal(d.review, false);
  assert.equal(d.source, 'budget_inputs');
});

test('roughDisplayCandidate: genuinely missing (no budget labor) → dash', () => {
  const d = roughDisplayCandidate({ inputs: { actual_total_sell: 18000 } }, null, false);
  assert.equal(d.value, null);
  assert.equal(d.review, false);
});

test('saleDisplayCandidate: the budget customer sell wins over the older money entry', () => {
  const d = saleDisplayCandidate(reviewedBudget(), 17500, false);
  assert.equal(d.value, 18000);
  assert.equal(d.review, false);
  assert.equal(d.source, 'budget_inputs');
});

test('saleDisplayCandidate: no budget sell -> older money entry, flagged (computed suggestion never shown)', () => {
  const d = saleDisplayCandidate({ inputs: {} }, 18000, false);
  assert.equal(d.value, 18000);
  assert.equal(d.review, true);
  assert.equal(d.source, 'owner');
});

test('profitDisplayCalc: flag propagates when any input is a candidate', () => {
  const p = profitDisplayCalc({ value: CMT, review: true }, { value: 3000, review: false }, { value: 18000, review: false });
  assert.equal(p.value, 4255);
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
  // No direct cost figure -> owner-typed budget review figure, flagged review
  assert.equal(card.windows.display.value, CMT);
  assert.equal(card.windows.display.review, true);
  assert.equal(card.profitDisplay.value, 4255);
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

test('buildPurchasingCards: duplicate money - owner verified withheld, displays dash with duplicate flag', () => {
  const [card] = buildPurchasingCards({ jobs: [{ id: 'j1', canonical_name: 'A' }], budgets: [reviewedBudget()], moneyInputs: [{ job_id: 'j1', rough_labor_material: 3000, sale_price: 18000 }, { job_id: 'j1', rough_labor_material: 1, sale_price: 2 }], today: TODAY });
  assert.equal(card.rough.value, null); // verified owner withheld (duplicate)
  assert.equal(card.rough.duplicate, true);
  assert.equal(card.rough.display.value, 2000); // budget review figure, duplicate-labelled
  assert.equal(card.rough.display.review, true);
  assert.match(card.rough.display.label, /duplicate/);
  assert.equal(card.sale.display.value, 18000);
  assert.equal(card.sale.display.review, true);
  assert.equal(card.profitDisplay.value, 14925.5);
  assert.deepEqual(card.profit, { value: null, tone: 'unknown' }); // verified profit still withheld
});

test('pickDisplayBudget: deterministic — verified source quote beats cost-only budget', () => {
  const verified = reviewedBudget();
  const costOnly = { ...reviewedBudget({}, { quote: null }), id: 'b2' };
  assert.equal(pickDisplayBudget([costOnly, verified]).id, 'b1');
});

test('windowsDisplayCandidate: PO-only job (no budget) falls back to PO dealer amount plus use tax', () => {
  const d = windowsDisplayCandidate([], [{ id: 'po1', job_id: 'j1', po_number: 'YA-1', status: 'ordered', amount_dealer: 933.96 }], []);
  assert.equal(d.value, withTax(933.96));
  assert.equal(d.source, 'po_dealer');
  assert.equal(d.review, true);
  assert.match(d.label, /use tax/);
  assert.equal(d.budgetId, null);
});

test('windowsDisplayCandidate: PO-only job with multiple POs → deterministic pick + alternatives, never sum', () => {
  const d = windowsDisplayCandidate([], [
    { id: 'po2', job_id: 'j1', po_number: 'YA-2', status: 'ordered', amount_dealer: 500 },
    { id: 'po1', job_id: 'j1', po_number: 'YA-1', status: 'ordered', amount_dealer: 933.96 },
  ], []);
  assert.equal(d.value, withTax(933.96)); // po1 picked on id tiebreak
  assert.equal(d.alternatives.length, 1);
  assert.equal(d.alternatives[0].value, withTax(500));
});

test('buildPurchasingCards: PO-only job (no budget) does not crash; shows PO amount candidate; chosenBudget null', () => {
  const [card] = buildPurchasingCards({ jobs: [{ id: 'j1', canonical_name: 'A' }], budgets: [], purchase_orders: [{ id: 'po1', job_id: 'j1', po_number: 'YA-1', status: 'ordered', amount_dealer: 933.96 }], moneyInputs: [], today: TODAY });
  assert.equal(card.windows.display.value, withTax(933.96));
  assert.equal(card.rough.display.value, null);
  assert.equal(card.sale.display.value, null);
  assert.equal(card.chosenBudget, null);
});

test('roughDisplayCandidate: labor-only budget figure shows (his typed sub pay)', () => {
  const d = roughDisplayCandidate({ inputs: { labor_cost_sub_pay: 2000 } }, null, false);
  assert.equal(d.value, 2000);
  assert.equal(d.review, false);
  assert.equal(d.source, 'budget_inputs');
});

test('saleDisplayCandidate: budget review target sell 0 stays 0 (a real typed 0); owner 0 still shows unflagged', () => {
  assert.equal(saleDisplayCandidate({ inputs: { actual_total_sell: 0 } }, null, false).value, 0);
  assert.equal(saleDisplayCandidate({ inputs: {} }, 0, false).value, 0);
});

test('windowsDisplayCandidate: unreviewed draft with a verified supplier quote shows the printed total, flagged review', () => {
  const draft = { ...reviewedBudget(), budget_usage: 'draft', numbers_reviewed_at: '' };
  const d = windowsDisplayCandidate([draft], [], []);
  assert.equal(d.value, 1074.5);
  assert.equal(d.source, 'source_quote');
  assert.equal(d.review, true);
  assert.match(d.label, /Supplier quote total incl tax/);
});

test('windowsDisplayCandidate: rep-issued supplier quote (bill_to missing) shows the printed total, always flagged review', () => {
  const repQuote = { ...supplierQuote, bill_to: null, quoted_by: 'israelyedra' };
  const reviewed = reviewedBudget({}, { quote: repQuote });
  const d = windowsDisplayCandidate([reviewed], [], []);
  assert.equal(d.value, 1074.5);
  assert.equal(d.source, 'source_quote');
  assert.equal(d.review, true); // recipient inferred - never unflagged
  assert.match(d.label, /confirm/);
  // Verified canonical still refuses it (strict recipient proof required).
});

test('windowsDisplayCandidate: own sell quote still never shows as cost', () => {
  const own = { ...supplierQuote, bill_to: null, quoted_by: 'gabrielfronk' };
  const d = windowsDisplayCandidate([reviewedBudget({}, { quote: own })], [], []);
  assert.notEqual(d.value, 1074.5); // the sell total is never the cost
  assert.equal(d.value, CMT); // the owner-typed budget review figure is
  assert.equal(d.source, 'cost_material_tax');
});
