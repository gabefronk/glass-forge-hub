// Frontend twin of the pure budget/billing helpers needed by the purchasing
// viewmodel. Platform guard blocks new src/lib files from importing
// base44/shared, so the UI keeps a manual inlined twin (same logic, kept in
// sync). Source of truth: base44/shared/jobBudgetMath.js, procurementCore.js,
// billingCore.js. Do not let these drift.

// --- from jobBudgetMath.js ---
export const SALES_TAX_RATE = 0.0745;
export const BUDGET_DEFAULTS = Object.freeze({
  tax_rate: SALES_TAX_RATE,
  material_margin: 0.30,
  labor_margin: 0.27,
  labor_overhead_factor: 0.74,
  overhead_keep_pct: 0.20,
});
export const roundMoney = (n) => Math.round((Number(n) + Number.EPSILON * Math.max(1, Math.abs(Number(n)))) * 100) / 100;
const _num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
export function computeJobBudget(inputs = {}, opts = {}) {
  const taxRate = _num(opts.tax_rate ?? BUDGET_DEFAULTS.tax_rate);
  const matMargin = _num(opts.material_margin ?? BUDGET_DEFAULTS.material_margin);
  const labMargin = _num(opts.labor_margin ?? BUDGET_DEFAULTS.labor_margin);
  const materialTrueCost = _num(inputs.material_true_cost);
  const overheadAdderIn = _num(inputs.overhead_adder);
  const addlInstallMatl = _num(inputs.additional_install_material);
  const addlEquipment = _num(inputs.additional_equipment);
  const laborCostSubPay = _num(inputs.labor_cost_sub_pay);
  const laborSellPrice = _num(inputs.labor_sell_price);
  const actualTotalSell = _num(inputs.actual_total_sell);
  const overheadAdder = overheadAdderIn !== 0 ? overheadAdderIn : (laborCostSubPay ? (laborCostSubPay / BUDGET_DEFAULTS.labor_overhead_factor) - laborCostSubPay : 0);
  const budgetCostTotalMaterial = materialTrueCost + overheadAdder * BUDGET_DEFAULTS.overhead_keep_pct;
  const useTax = (materialTrueCost + addlInstallMatl + addlEquipment) * taxRate;
  const costMaterialTax = budgetCostTotalMaterial + addlInstallMatl + addlEquipment + useTax;
  const sellMaterialTax = matMargin < 1 ? costMaterialTax / (1 - matMargin) : null;
  const laborTargetSell = labMargin < 1 ? laborCostSubPay / (1 - labMargin) : null;
  const totalCost = costMaterialTax + laborCostSubPay + (overheadAdder - overheadAdder * 0.8);
  const actualMarginPct = actualTotalSell > 0 ? 1 - totalCost / actualTotalSell : null;
  const suggestedTotalSell = (sellMaterialTax ?? 0) + (laborSellPrice || laborTargetSell || 0);
  return {
    material_true_cost: roundMoney(materialTrueCost),
    additional_install_material: roundMoney(addlInstallMatl),
    additional_equipment: roundMoney(addlEquipment),
    overhead_adder: roundMoney(overheadAdder),
    budget_cost_total_material: roundMoney(budgetCostTotalMaterial),
    use_tax: roundMoney(useTax),
    cost_material_tax: roundMoney(costMaterialTax),
    sell_material_tax_target: sellMaterialTax === null ? null : roundMoney(sellMaterialTax),
    labor_cost_sub_pay: roundMoney(laborCostSubPay),
    labor_sell_price: roundMoney(laborSellPrice),
    labor_target_sell: laborTargetSell === null ? null : roundMoney(laborTargetSell),
    total_cost_overhead: roundMoney(totalCost),
    actual_total_sell: roundMoney(actualTotalSell),
    actual_margin_pct: actualMarginPct === null ? null : Math.round(actualMarginPct * 10000) / 10000,
    suggested_total_sell: roundMoney(suggestedTotalSell),
    tax_rate: taxRate, material_margin: matMargin, labor_margin: labMargin,
  };
}

// --- from billingCore.js (isIgnoredWorkItem) ---
export function isIgnoredWorkItem(row) {
  const title = typeof row === 'string' ? row : row?.canonical_name || row?.job_name_raw || row?.job_name || row?.summary || row?.job_name_norm || '';
  return String(title).normalize('NFKC').trim().toLowerCase().replace(/[.,;:!?]+$/, '').trim() === 'renta';
}

// --- from procurementCore.js (pure helpers) ---
export const pText = (value) => String(value ?? '').trim();
export const amount = (value) => {
  if (value === null || value === undefined || pText(value) === '') return null;
  const n = Number(pText(value).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? roundMoney(n) : null;
};
export const isLiveBudget = (row) => Boolean(row) && !pText(row.deleted_at);
export const includedBudget = (row) => isLiveBudget(row) && !['reference', 'draft'].includes(row?.budget_usage);
export const budgetVersion = (row) => JSON.stringify([row?.id, row?.job_id, row?.updated_date, row?.budget_usage, row?.replaces_budget_id, row?.quote_number, row?.vendor, row?.manufacturer, row?.inputs, row?.numbers_reviewed_at, row?.deleted_at]);
const _vendorKey = (value) => pText(value).toLowerCase().replace(/\b(windows?|doors?|and|llc|inc|the)\b/g, ' ').replace(/[^a-z0-9]/g, '');
export function sameVendor(a, b) {
  const keys = [a?.vendor, a?.manufacturer].map(_vendorKey).filter(Boolean);
  return [b?.vendor, b?.manufacturer].map(_vendorKey).some((k) => k && keys.includes(k));
}
export function budgetFigures(row = {}) {
  const inputs = row.inputs || {};
  const calculated = computeJobBudget(Object.fromEntries(Object.entries(inputs).map(([key, value]) => [key, amount(value)])));
  const material = amount(inputs.material_true_cost), sell = amount(inputs.actual_total_sell);
  const warnings = [];
  const hasCost = ['material_true_cost', 'labor_cost_sub_pay', 'additional_install_material', 'additional_equipment'].some((k) => (amount(inputs[k]) ?? 0) > 0);
  if (material === null || material < 0 || ((!hasCost || (material === 0 && row.quote?.material_true_cost == null && row.openings_qty > 0)) && !row.numbers_reviewed_at)) warnings.push('Cost needs review');
  if (sell === null || sell <= 0) warnings.push('Customer sell needs review');
  for (const k of ['labor_cost_sub_pay', 'labor_sell_price', 'additional_install_material', 'additional_equipment']) {
    if (pText(inputs[k]) && (amount(inputs[k]) === null || amount(inputs[k]) < 0)) warnings.push(`Check ${k.replaceAll('_', ' ')}`);
  }
  if (row.autofill?.notes?.length && !row.numbers_reviewed_at) warnings.push('Review quote and labor assumptions');
  if (row.budget_usage && !row.numbers_reviewed_at) warnings.push('Numbers not reviewed yet');
  const ready = warnings.length === 0;
  return { cost: ready ? calculated.total_cost_overhead : null, sell, margin_dollars: ready ? roundMoney(sell - calculated.total_cost_overhead) : null, margin_pct: ready ? calculated.actual_margin_pct : null, calculated, warnings, ready };
}
export function activeBudgets(rows = []) {
  const included = rows.filter(includedBudget);
  const replaced = new Set(included.filter((r) => r.replaces_budget_id && rows.some((old) => old.id === r.replaces_budget_id && old.job_id === r.job_id)).map((r) => r.replaces_budget_id));
  return included.filter((r) => !replaced.has(r.id));
}
export function budgetRollup(rows = []) {
  const active = activeBudgets(rows);
  const warnings = [];
  const items = active.map((row) => ({ row, figures: budgetFigures(row) }));
  for (const { row, figures } of items) for (const warning of figures.warnings) warnings.push(`${row.title || row.id}: ${warning}`);
  const ref = (value) => pText(value).toUpperCase();
  for (let i = 0; i < active.length; i++) for (let j = i + 1; j < active.length; j++) {
    const a = active[i], b = active[j];
    if (a.job_id === b.job_id && ((a.source_sha256 && a.source_sha256 === b.source_sha256) || (ref(a.quote_number) && ref(a.quote_number) === ref(b.quote_number) && sameVendor(a, b)))) warnings.push(`Possible duplicate scope: ${a.quote_number || a.title}. Keep one version in the budget.`);
  }
  const complete = active.length > 0 && !warnings.length;
  const sum = (fn) => roundMoney(items.reduce((v, item) => v + (fn(item) || 0), 0));
  const cost = complete ? sum((i) => i.figures.cost) : null;
  const sell = complete ? sum((i) => i.figures.sell) : null;
  return { version: 1, status: complete ? 'ready' : active.length ? 'needs_review' : 'empty', count: active.length,
    source_budget_ids: active.map((r) => r.id), source_versions: active.map(budgetVersion),
    cost, sell, margin_dollars: complete ? roundMoney(sell - cost) : null,
    margin_pct: complete && sell > 0 ? (sell - cost) / sell : null,
    warnings: [...new Set(warnings)] };
}