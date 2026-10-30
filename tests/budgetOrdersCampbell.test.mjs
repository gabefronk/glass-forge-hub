import test from 'node:test';
import assert from 'node:assert/strict';
import { budgetRollup, budgetVersion, countedBudgets, shouldCountOnReview } from '../base44/shared/procurementCore.js';
import { budgetInputPatch } from '../base44/shared/budgetMutationPolicy.mjs';
import { budgetSummary, scopeCountLabel } from '../src/lib/budgetSummary.js';
import { purchasingBoardCards } from '../src/lib/purchasingScopes.js';
import { jobMoneyHeadline } from '../src/lib/jobMoneyPanel.js';
import { existingPOsForQuote } from '../src/lib/purchaseOrderSetup.js';

// Campbell Addition (Pride Construction), Oct 30: the AMSCO quote Gabriel uploaded, with his
// sub pay and customer sell saved, still a Draft. Trimmed from the live record.
const job = { id: 'campbell', canonical_name: 'CAMPBELL ADDITION', manual_budget_cost: null, manual_customer_total: null };
const campbell = {
  id: 'b-campbell', job_id: 'campbell', title: 'CAMPBELL RES (AMSCO 3608034)', budget_usage: 'draft', status: 'filed',
  vendor: 'AMSCO', manufacturer: 'AMSCO', quote_number: '3608034', openings_qty: 8, updated_date: '2026-10-30T11:24:39.931000',
  numbers_reviewed_at: '2026-10-30T11:24:39.725Z', source_sha256: 'a'.repeat(64),
  inputs: { material_true_cost: 1291.13, labor_cost_sub_pay: 489, labor_sell_price: 0, additional_install_material: 0, additional_equipment: 0, actual_total_sell: 2496.03 },
  quote: {
    vendor: 'AMSCO', manufacturer: 'AMSCO', quote_number: '3608034', quoted_by: 'israelyedra', bill_to: null, price_levels: 'single',
    customer_sub_total: 1201.61, customer_tax: 89.52, customer_total: 1291.13, net_total: 1201.61,
    lines: [91.04, 238.71, 84.84, 197.48, 173.55, 250.97, 165.02].map((extended) => ({ kind: 'window', extended })),
  },
};

test('the Budget & Orders header adds up the draft scope he built: $1,291.13 + $489 = $1,780.13 against $2,496.03', () => {
  const rollup = budgetRollup([campbell], { draftFallback: true });
  assert.equal(rollup.status, 'ready');
  assert.equal(rollup.count, 1);
  assert.equal(rollup.drafts, 1);
  assert.equal(rollup.cost, 1780.13);
  assert.equal(rollup.sell, 2496.03);
  assert.equal(rollup.margin_dollars, 715.9);
  const s = budgetSummary(job, rollup);
  assert.deepEqual([s.cost, s.sell, s.marginDollars, s.reviewWarning], [1780.13, 2496.03, 715.9, false]);
  assert.equal(scopeCountLabel(rollup), '1 scope · draft');
  // A typed figure still wins.
  assert.equal(budgetSummary({ ...job, manual_customer_total: 2600 }, rollup).sell, 2600);
  // Other callers keep the old rule: only counted quotes.
  assert.equal(budgetRollup([campbell]).count, 0);
});

test('drafts are the header pool only while no quote is counted', () => {
  const counted = { ...campbell, id: 'b-counted', budget_usage: 'included', source_sha256: 'b'.repeat(64), quote_number: '1' };
  assert.deepEqual(countedBudgets([campbell, counted]).rows.map((b) => b.id), ['b-counted']);
  assert.equal(countedBudgets([campbell, counted]).drafts, 0);
  assert.deepEqual(countedBudgets([campbell, { ...campbell, id: 'gone', deleted_at: '2026-10-29' }]).rows.map((b) => b.id), ['b-campbell']);
  assert.equal(scopeCountLabel({ count: 2, drafts: 0 }), '2 scopes counted');
  assert.equal(scopeCountLabel({ count: 0 }), 'No scope yet');
});

test('Purchasing, the job page and the 50/50 split read the same Campbell figures (no overhead anywhere)', () => {
  const data = { jobs: [job], budgets: [campbell], purchase_orders: [], vendor_orders: [], conflicts: [] };
  const [card] = purchasingBoardCards(data, '2026-10-30');
  assert.equal(card.windows.display.value, 1291.13);
  assert.equal(card.rough.display.value, 489);
  assert.equal(card.sale.display.value, 2496.03);
  assert.equal(card.profitDisplay.value, 715.9);
  const headline = jobMoneyHeadline('campbell', [], { jobs: [job], budgets: [campbell], purchaseOrders: [], vendorOrders: [], today: '2026-10-30' });
  assert.equal(headline.cost + headline.laborMaterial, 1780.13);
  assert.equal(headline.sale, 2496.03);
  assert.equal(headline.profit, 715.9);
  assert.equal(budgetRollup([campbell], { draftFallback: true }).cost, 1780.13);
});

test('the first reviewed save of a job\'s only quote counts it in the budget', () => {
  const fresh = { ...campbell, numbers_reviewed_at: '' };
  assert.equal(shouldCountOnReview(fresh, [fresh]), true);
  assert.equal(shouldCountOnReview(fresh, [fresh, { ...campbell, id: 'ref', budget_usage: 'reference' }]), true);
  assert.equal(shouldCountOnReview(fresh, [fresh, { ...campbell, id: 'old', deleted_at: '2026-10-01' }]), true);
  // Already reviewed once (he may have set it back to Draft), another live scope, not a draft, no job.
  assert.equal(shouldCountOnReview(campbell, [campbell]), false);
  assert.equal(shouldCountOnReview(fresh, [fresh, { ...campbell, id: 'other', budget_usage: 'draft' }]), false);
  assert.equal(shouldCountOnReview(fresh, [fresh, { ...campbell, id: 'other', budget_usage: 'included' }]), false);
  assert.equal(shouldCountOnReview({ ...fresh, budget_usage: 'reference' }, [fresh]), false);
  assert.equal(shouldCountOnReview({ ...fresh, job_id: '' }, []), false);

  const body = { expected_version: budgetVersion(fresh), review_confirmed: true, inputs: fresh.inputs };
  assert.equal(budgetInputPatch(fresh, body, 'gabe', '2026-10-30T12:00:00Z', { siblings: [fresh] }).budget_usage, 'included');
  assert.equal('budget_usage' in budgetInputPatch(fresh, body, 'gabe', '2026-10-30T12:00:00Z'), false);
  assert.equal('budget_usage' in budgetInputPatch(fresh, body, 'gabe', '2026-10-30T12:00:00Z', { siblings: [fresh, { ...campbell, id: 'other' }] }), false);
});

test('the PO form asks why only when the quote already has a live PO', () => {
  const form = { budget_id: 'b-campbell', vendor: 'AMSCO', vendor_quote_ref: '3608034' };
  const po = { id: 'po1', po_number: 'YA-0022', job_id: 'campbell', budget_id: 'b-campbell', vendor: 'AMSCO', vendor_quote_ref: '3608034', status: 'issued' };
  assert.deepEqual(existingPOsForQuote([], form, 'campbell'), []);
  assert.deepEqual(existingPOsForQuote([po], form, 'campbell').map((p) => p.po_number), ['YA-0022']);
  assert.deepEqual(existingPOsForQuote([{ ...po, status: 'cancelled' }], form, 'campbell'), []);
  assert.deepEqual(existingPOsForQuote([{ ...po, job_id: 'other' }], form, 'campbell'), []);
  // Same quote number and supplier on a manual PO (no budget) still counts.
  assert.equal(existingPOsForQuote([{ ...po, budget_id: '' }], { ...form, budget_id: '' }, 'campbell').length, 1);
  assert.equal(existingPOsForQuote([{ ...po, budget_id: '', vendor: 'Pella' }], { ...form, budget_id: '' }, 'campbell').length, 0);
});
