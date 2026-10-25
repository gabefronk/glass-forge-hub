// A reviewed save settles the import's "Needs review" on a quote that is on a job.
import test from 'node:test';
import assert from 'node:assert/strict';
import { budgetInputPatch } from '../base44/shared/budgetMutationPolicy.mjs';
import { budgetVersion } from '../base44/shared/procurementCore.js';

const inputs = { material_true_cost: 100, labor_cost_sub_pay: 0, labor_sell_price: 0, additional_install_material: 0, additional_equipment: 0, actual_total_sell: 200 };
const save = (record) => budgetInputPatch(record, { expected_version: budgetVersion(record), review_confirmed: true, inputs }, 'gabe@x.com', '2026-10-25T03:00:00Z');

test('a quote on a job leaves "Needs review" when its numbers are saved', () => {
  assert.equal(save({ id: 'b', job_id: 'j', status: 'needs_review', inputs }).status, 'filed');
});

test('an unlinked quote keeps "Needs review"; other statuses are untouched', () => {
  assert.equal(save({ id: 'b', job_id: null, status: 'needs_review', inputs }).status, undefined);
  assert.equal(save({ id: 'b', job_id: 'j', status: 'filed', inputs }).status, undefined);
});
