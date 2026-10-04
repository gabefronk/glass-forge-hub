import { validateBudgetInputs } from './jobBudgetReview.js';
import { computeJobBudget } from './jobBudgetMath.js';
import { budgetVersion } from './procurementCore.js';
import { procurementError } from './procurementLock.mjs';

export function assertBudgetVersion(record, expected) {
  if (record?.deleted_at) throw procurementError(409, 'This quote was deleted. Open the current quote instead.');
  if (!expected || budgetVersion(record) !== expected) throw procurementError(409, 'This budget changed. Reopen it before saving.');
}
export function budgetInputPatch(record, body, userEmail, at) {
  assertBudgetVersion(record, body.expected_version);
  if (body.review_confirmed !== true) throw procurementError(400, 'Review all budget inputs before saving.');
  const checked = validateBudgetInputs(body.inputs || {});
  if (!checked.ok) throw procurementError(400, 'Check the budget input fields.', { fields: checked.errors });
  const v = checked.values;
  if (v.material_true_cost === 0 && body.zero_cost_confirmed !== true) throw procurementError(400, 'Confirm that zero material cost is intentional, not a missing supplier price.');
  return {
    inputs: v, computed: computeJobBudget(v), numbers_reviewed_at: at, numbers_reviewed_by: userEmail,
    input_history: [...(record.input_history || []), { at, by: userEmail, action: 'reviewed numbers', inputs: record.inputs || {}, computed: record.computed || {}, previous_reviewed_at: record.numbers_reviewed_at || '' }],
  };
}
export function rereadPatch(record, quote, fill, at, userEmail) {
  return {
    quote, inputs: fill.inputs, computed: computeJobBudget(fill.inputs), numbers_reviewed_at: '', numbers_reviewed_by: '',
    input_history: [...(record.input_history || []), { at, by: userEmail, action: 're-read source quote', inputs: record.inputs || {}, computed: record.computed || {}, quote: record.quote || {}, previous_reviewed_at: record.numbers_reviewed_at || '' }],
  };
}
