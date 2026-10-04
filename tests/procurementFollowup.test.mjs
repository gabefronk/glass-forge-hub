import test from 'node:test';
import assert from 'node:assert/strict';
import { budgetVersion, budgetFigures, budgetRollup, setupBudgetSource } from '../base44/shared/procurementCore.js';
import { budgetInputPatch, rereadPatch } from '../base44/shared/budgetMutationPolicy.mjs';
import { inInvoiceScope, selectedInvoiceRows } from '../src/lib/invoiceScope.js';
import { buildSetupDraft } from '../src/lib/jobSetup.js';

const at = '2026-10-04T00:00:00Z';
const screenshotDraft = {
  id: 'av24-budget', job_id: 'av24-job', quote_number: '3523394', budget_usage: 'draft', updated_date: at,
  openings_qty: 4, inputs: { material_true_cost: 869.20, labor_cost_sub_pay: null, labor_sell_price: null, actual_total_sell: null },
  quote: { dealer_subtotal: 869.20, customer_tax: 64.76, customer_total: 933.96 },
};

test('AV24 screenshot preserves known material and unknown final selling price', () => {
  const original = structuredClone(screenshotDraft);
  const figures = budgetFigures(screenshotDraft);
  assert.equal(figures.calculated.material_true_cost, 869.20);
  assert.equal(figures.sell, null);
  assert.equal(figures.cost, null);
  assert.equal(figures.margin_dollars, null);
  assert.equal(figures.margin_pct, null);
  assert.equal(budgetRollup([screenshotDraft]).count, 0);
  assert.deepEqual(screenshotDraft, original);
});

test('a stale draft or unconfirmed review cannot replace budget numbers', () => {
  const inputs = { material_true_cost: 869.20, labor_cost_sub_pay: 200, labor_sell_price: 400, actual_total_sell: 1800 };
  assert.throws(() => budgetInputPatch(screenshotDraft, { inputs, expected_version: 'stale', review_confirmed: true }, 'owner', at), /changed/);
  assert.throws(() => budgetInputPatch(screenshotDraft, { inputs, expected_version: budgetVersion(screenshotDraft) }, 'owner', at), /Review/);
});

test('reviewed budget changes preserve prior values and cannot write job or accounting fields', () => {
  const patch = budgetInputPatch(screenshotDraft, {
    inputs: { material_true_cost: 869.20, labor_cost_sub_pay: 200, labor_sell_price: 400, actual_total_sell: 1800 },
    expected_version: budgetVersion(screenshotDraft), review_confirmed: true,
  }, 'owner', at);
  assert.deepEqual(patch.input_history[0].inputs, screenshotDraft.inputs);
  assert.equal(patch.numbers_reviewed_at, at);
  for (const key of ['job_id', 'po_numbers', 'budget_usage', 'product_sell', 'actual_labor_cost', 'paid_at', 'status']) assert.equal(key in patch, false);
});

test('zero material cost requires an intentional zero confirmation', () => {
  const body = { expected_version: budgetVersion(screenshotDraft), review_confirmed: true, inputs: { material_true_cost: 0, actual_total_sell: 400 } };
  assert.throws(() => budgetInputPatch(screenshotDraft, body, 'owner', at), /zero material/);
  assert.equal(budgetInputPatch(screenshotDraft, { ...body, zero_cost_confirmed: true }, 'owner', at).inputs.material_true_cost, 0);
});

test('rereading a quote retains its earlier numbers and clears prior review', () => {
  const old = { ...screenshotDraft, numbers_reviewed_at: at, quote: { quote_number: '3523394' } };
  const patch = rereadPatch(old, { quote_number: '3523394' }, { inputs: { material_true_cost: 900 } }, at, 'owner');
  assert.equal(patch.numbers_reviewed_at, '');
  assert.deepEqual(patch.input_history[0].quote, old.quote);
  assert.deepEqual(patch.input_history[0].inputs, old.inputs);
});

test('new setup drafts combine only included scopes and omit reference copies', () => {
  const a = { id: 'a', job_id: 'j', quote_number: '1', inputs: { material_true_cost: 100, actual_total_sell: 200 }, quote: { lines: [{ mark: 'a' }] } };
  const b = { id: 'b', job_id: 'j', quote_number: '2', inputs: { material_true_cost: 300, actual_total_sell: 500 }, quote: { lines: [{ mark: 'b' }] } };
  const copy = { ...a, id: 'copy', budget_usage: 'reference' };
  const { budget, warnings } = setupBudgetSource([a, b, copy, screenshotDraft]);
  assert.deepEqual(warnings, []);
  assert.equal(budget.inputs.material_true_cost, 400);
  assert.equal(budget.inputs.actual_total_sell, 700);
  assert.deepEqual(budget.quote.lines.map(line => line.mark), ['a', 'b']);
});

test('tax-inclusive budget total does not become a subtotal taxed again', () => {
  const withTax = buildSetupDraft({ job: { accepted_quote_snapshot: { result: { totals: { tax: 64.76 } } } }, budget: { inputs: { material_true_cost: 869.20, actual_total_sell: 933.96 } } });
  assert.equal(withTax.pricing.contract_total, 933.96);
  assert.equal(withTax.pricing.sell_price, 869.20);
  const unknownTax = buildSetupDraft({ budget: { inputs: { actual_total_sell: 933.96 } } });
  assert.equal(unknownTax.pricing.tax, '');
  assert.equal(unknownTax.pricing.sell_price, '');
  assert.equal(unknownTax.pricing.contract_total, 933.96);
});

test('invoice selection is limited to the exact selected job and month', () => {
  const rows = [
    { id: 'a', job_id: 'j', invoice_month: '2026-10' },
    { id: 'b', job_id: 'other', invoice_month: '2026-10' },
    { id: 'c', job_id: 'j', invoice_month: '2026-09' },
    { id: 'd', job_name_raw: 'j', invoice_month: '2026-10' },
  ];
  assert.equal(inInvoiceScope(rows[3], '2026-10', 'j'), false);
  assert.deepEqual(selectedInvoiceRows(rows, new Set(['a', 'b', 'c', 'd']), '2026-10', 'j').map(r => r.id), ['a']);
  assert.deepEqual(selectedInvoiceRows(rows, new Set(['a', 'b', 'c']), '2026-10').map(r => r.id), ['a', 'b']);
});
