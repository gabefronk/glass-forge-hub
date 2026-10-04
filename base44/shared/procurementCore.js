// Shared, read-only purchasing helpers. Job identity is never inferred from names.
import { computeJobBudget, roundMoney } from './jobBudgetMath.js';
export const text = value => String(value ?? '').trim();
export const amount = value => {
  if (value === null || value === undefined || text(value) === '') return null;
  const n = Number(text(value).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? roundMoney(n) : null;
};
export const includedBudget = row => !['reference', 'draft'].includes(row?.budget_usage);
export const budgetVersion = row => JSON.stringify([row?.id, row?.job_id, row?.updated_date, row?.budget_usage, row?.quote_number, row?.vendor, row?.manufacturer, row?.inputs, row?.numbers_reviewed_at]);

export function budgetFigures(row = {}) {
  const inputs = row.inputs || {};
  const calculated = computeJobBudget(inputs);
  const material = amount(inputs.material_true_cost), sell = amount(inputs.actual_total_sell);
  const warnings = [];
  const hasCost = ['material_true_cost', 'labor_cost_sub_pay', 'additional_install_material', 'additional_equipment'].some(k => (amount(inputs[k]) ?? 0) > 0);
  if (material === null || material < 0 || (!hasCost && !row.numbers_reviewed_at)) warnings.push('Cost needs review');
  if (sell === null || sell <= 0) warnings.push('Customer sell needs review');
  for (const k of ['labor_cost_sub_pay', 'labor_sell_price', 'additional_install_material', 'additional_equipment']) {
    if (text(inputs[k]) && (amount(inputs[k]) === null || amount(inputs[k]) < 0)) warnings.push(`Check ${k.replaceAll('_', ' ')}`);
  }
  if (row.autofill?.notes?.length && !row.numbers_reviewed_at) warnings.push('Review quote and labor assumptions');
  const ready = warnings.length === 0;
  return { cost: ready ? calculated.total_cost_overhead : null, sell, margin_dollars: ready ? roundMoney(sell - calculated.total_cost_overhead) : null, margin_pct: ready ? calculated.actual_margin_pct : null, calculated, warnings, ready };
}
