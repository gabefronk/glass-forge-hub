import test from 'node:test';
import assert from 'node:assert/strict';
import { validateBudgetInputs, reviewCostInputPatch, newJobFromBudget, linkedBudgetPatch, sheetValuesFor } from '../base44/shared/jobBudgetReview.js';

test('validateBudgetInputs: money strings clean up, blanks are 0, material + total sell are required, negatives fail', () => {
  const ok = validateBudgetInputs({ material_true_cost: '$2,748.78', labor_cost_sub_pay: '', labor_sell_price: '1,200', actual_total_sell: '7022.31' });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.values, { material_true_cost: 2748.78, labor_cost_sub_pay: 0, labor_sell_price: 1200, additional_install_material: 0, additional_equipment: 0, actual_total_sell: 7022.31 });

  const bad = validateBudgetInputs({ material_true_cost: '', labor_cost_sub_pay: '-5', actual_total_sell: 'abc' });
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.errors, ['material_true_cost', 'labor_cost_sub_pay', 'actual_total_sell']);

  // a zero material cost is allowed when the sell is there (pure labor / service tickets)
  assert.equal(validateBudgetInputs({ material_true_cost: 0, actual_total_sell: 400 }).ok, true);
  assert.equal(validateBudgetInputs({ material_true_cost: 100, actual_total_sell: 0 }).ok, false);
});

test('reviewCostInputPatch: new row carries identity + product and labor numbers; existing row only gets the numbers; zero labor is left alone', () => {
  const values = { material_true_cost: 2748.78, labor_cost_sub_pay: 900, labor_sell_price: 1850, actual_total_sell: 7022.31 };
  const fresh = reviewCostInputPatch(null, values, { jobId: 'j1', jobNameNorm: 'ammon cabin', month: '2026-09', quoteNumber: '9485142' });
  assert.deepEqual(fresh, { month: '2026-09', job_id: 'j1', job_name_norm: 'ammon cabin', material_source: 'manual', quote_number: '9485142', product_cost: 2748.78, product_sell: 7022.31, actual_labor_cost: 900, installation_revenue: 1850 });
  const patch = reviewCostInputPatch({ id: 'ci1' }, { ...values, labor_cost_sub_pay: 0, labor_sell_price: 0 }, { jobId: 'j1', jobNameNorm: 'ammon cabin', month: '2026-09', quoteNumber: '9485142' });
  assert.deepEqual(patch, { quote_number: '9485142', product_cost: 2748.78, product_sell: 7022.31 });
});

test('newJobFromBudget: name and builder come from the budget unless overridden; blanks drop out', () => {
  const budget = { job_name: 'AMMON CABIN', builder: 'AMMON CABIN', quote: { lot_or_address: 'Highway 150, Evanston WY' } };
  assert.deepEqual(newJobFromBudget(budget, {}), { canonical_name: 'AMMON CABIN', builder: 'AMMON CABIN', address: 'Highway 150, Evanston WY', aliases: [], po_numbers: [], oe_numbers: [] });
  assert.deepEqual(newJobFromBudget(budget, { name: ' Ammon Cabin ', builder: 'Jodi & Ammon', address: '' }), { canonical_name: 'Ammon Cabin', builder: 'Jodi & Ammon', aliases: [], po_numbers: [], oe_numbers: [] });
  assert.throws(() => newJobFromBudget({ job_name: '' }, { name: '  ' }), /name/);
});

test('linkedBudgetPatch: filed, pointed at the job, match reason names who chose it', () => {
  const p = linkedBudgetPatch({ id: 'j9', canonical_name: 'Ammon Cabin', builder: 'Jodi & Ammon' }, 'gabefronk@gmail.com', { id: 'f1', path: 'Glass Forge Jobs/Jodi & Ammon/Ammon Cabin' });
  assert.deepEqual(p, {
    job_id: 'j9', job_name: 'Ammon Cabin', builder: 'Jodi & Ammon', status: 'filed',
    job_match: { status: 'matched', job_id: 'j9', job_name: 'Ammon Cabin', reason: 'chosen on Job Budgets by gabefronk@gmail.com', candidates: [] },
    drive_job_folder_id: 'f1', drive_job_folder_path: 'Glass Forge Jobs/Jodi & Ammon/Ammon Cabin',
  });
});

test('sheetValuesFor: workbook header cells from the budget row and, when linked, the job', () => {
  const budget = { builder: 'AMMON CABIN', quoted_by: 'Gabriel Fronk', manufacturer: 'Andersen', openings_qty: 37, quote: { lot_or_address: 'Highway 150' } };
  assert.deepEqual(sheetValuesFor(budget, null, '2026-09-26'), { sales_rep: 'Gabriel Fronk', date_iso: '2026-09-26', builder: 'AMMON CABIN', manufacturer: 'Andersen', openings_qty: 37, address: 'Highway 150' });
  const withJob = sheetValuesFor(budget, { canonical_name: 'Ammon Cabin', builder: 'Jodi & Ammon', address: '123 Highway 150, Evanston, WY' }, '2026-09-26');
  assert.equal(withJob.builder, 'Jodi & Ammon');
  assert.equal(withJob.address, '123 Highway 150, Evanston, WY');
});
