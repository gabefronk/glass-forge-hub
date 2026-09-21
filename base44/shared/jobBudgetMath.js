// Job budget math - a faithful port of Gabriel's "Window Budget Sheet" workbook
// (Window Budget Sheet.xlsx). Pure functions, no I/O, shared by the browser page
// and the jobBudgetIngest backend function.
//
// Workbook cells this mirrors (sheet1):
//   C15  Material True Cost from Quote (includes delivery)
//   C16  Overhead Adder (INSTLAB, $/unit put in qty; 20% of it feeds B17)
//   C18  Additional Install Material
//   C19  Additional Equipment
//   C23  Labor Cost (sub pay, non taxable)
//   C24  Labor Sell Price (non taxable)
//   B28  Total Sell to Customer, includes tax (actual sell, yellow input)
//   D22  Desired material margin (0.30)     C25  Desired labor margin (0.27)
//   B16  =(C24/0.74)-C24   overhead adder from labor sell
//   B17  =C15+(C16*0.2)    budget cost total (material)
//   C20  =(C15+C18+C19)*0.0745  use tax
//   B21  =C17+C18+C19+C20  cost material/tax   (note: workbook uses C17..C19,
//        where C17 mirrors B17 - we pass the same value through)
//   B22  =C21/(1-E22)      sell material/tax at desired margin
//   B27  =C21+C24+(C16-(C16*0.8))  total cost of material and labor (overhead)
//   B29  =(C27/C28-1)*-1   actual margin % vs the real sell

export const BUDGET_DEFAULTS = Object.freeze({
  tax_rate: 0.0745,          // workbook use-tax rate
  material_margin: 0.30,     // desired margin on material
  labor_margin: 0.27,        // desired margin on labor
  labor_overhead_factor: 0.74, // B16 divisor
  overhead_keep_pct: 0.20,   // B17 keeps 20% of the overhead adder
});

export const roundMoney = (n) =>
  Math.round((Number(n) + Number.EPSILON) * 100) / 100;

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

// Excel serial date (workbook stores the date as a serial, e.g. 46286) -> ISO yyyy-mm-dd.
export function excelSerialToIso(serial) {
  const n = Number(serial);
  if (!Number.isFinite(n) || n < 1) return '';
  const ms = Math.round(n - 25569) * 86400000; // 25569 = 1970-01-01
  return new Date(ms).toISOString().slice(0, 10);
}
export function isoToExcelSerial(iso) {
  const t = Date.parse(`${iso}T00:00:00Z`);
  if (!Number.isFinite(t)) return null;
  return Math.round(t / 86400000) + 25569;
}

// inputs: material_true_cost, overhead_adder (C16, usually 0), additional_install_material,
// additional_equipment, labor_cost_sub_pay, labor_sell_price, actual_total_sell (B28),
// tax_rate / material_margin / labor_margin overrides.
// Returns every workbook output plus convenience target-sell figures.
export function computeJobBudget(inputs = {}, opts = {}) {
  const taxRate = num(opts.tax_rate ?? BUDGET_DEFAULTS.tax_rate);
  const matMargin = num(opts.material_margin ?? BUDGET_DEFAULTS.material_margin);
  const labMargin = num(opts.labor_margin ?? BUDGET_DEFAULTS.labor_margin);

  const materialTrueCost = num(inputs.material_true_cost);
  const overheadAdderIn = num(inputs.overhead_adder); // C16 manual override, normally 0
  const addlInstallMatl = num(inputs.additional_install_material);
  const addlEquipment = num(inputs.additional_equipment);
  const laborCostSubPay = num(inputs.labor_cost_sub_pay);
  const laborSellPrice = num(inputs.labor_sell_price);
  const actualTotalSell = num(inputs.actual_total_sell);

  // B16 - overhead adder derived from labor sell unless manually entered.
  const overheadAdder = overheadAdderIn !== 0
    ? overheadAdderIn
    : (laborSellPrice ? (laborSellPrice / BUDGET_DEFAULTS.labor_overhead_factor) - laborSellPrice : 0);
  // B17 - budget cost total (material).
  const budgetCostTotalMaterial = materialTrueCost + overheadAdder * BUDGET_DEFAULTS.overhead_keep_pct;
  // C20 - use tax.
  const useTax = (materialTrueCost + addlInstallMatl + addlEquipment) * taxRate;
  // B21 - cost material/tax.
  const costMaterialTax = budgetCostTotalMaterial + addlInstallMatl + addlEquipment + useTax;
  // B22 - sell material/tax at desired margin.
  const sellMaterialTax = matMargin < 1 ? costMaterialTax / (1 - matMargin) : null;
  // Labor target sell at desired labor margin (workbook leaves labor sell manual).
  const laborTargetSell = labMargin < 1 ? laborCostSubPay / (1 - labMargin) : null;
  // B27 - total cost of material and labor (overhead).
  const totalCost = costMaterialTax + laborSellPrice + (overheadAdder - overheadAdder * 0.8);
  // B29 - actual margin vs the real customer sell.
  const actualMarginPct = actualTotalSell > 0 ? 1 - totalCost / actualTotalSell : null;
  // Convenience: suggested total sell = material target + labor target.
  const suggestedTotalSell = (sellMaterialTax ?? 0) + (laborSellPrice || laborTargetSell || 0);

  return {
    material_true_cost: roundMoney(materialTrueCost),
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
    tax_rate: taxRate,
    material_margin: matMargin,
    labor_margin: labMargin,
  };
}
