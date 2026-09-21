import test from "node:test";
import assert from "node:assert/strict";
import { computeJobBudget, excelSerialToIso, isoToExcelSerial } from "../base44/shared/jobBudgetMath.js";

// Numbers come from Gabriel's filled "Window Budget Sheet" for the BAXTER job
// (Amsco quote 3517590): every workbook output must match the template's formulas.
test("workbook replication: BAXTER / Amsco 3517590 matches the filled sheet", () => {
  const b = computeJobBudget({ material_true_cost: 1256.98, actual_total_sell: 2411.81 });
  assert.equal(b.use_tax, 93.65);                    // C20 = 1256.98 * 0.0745
  assert.equal(b.cost_material_tax, 1350.63);        // B21
  assert.equal(b.sell_material_tax_target, 1929.46); // B22 = C21 / (1 - 0.30)
  assert.equal(b.total_cost_overhead, 1350.63);      // B27
  assert.equal(b.actual_margin_pct, 0.44);           // B29
  assert.equal(b.overhead_adder, 0);                 // B16 with no labor sell
});

test("desired margins drive target sells", () => {
  const b = computeJobBudget({ material_true_cost: 1000, labor_cost_sub_pay: 500 });
  // cost = 1000 + 74.50 tax = 1074.50; target sell = 1074.50 / 0.70
  assert.equal(b.sell_material_tax_target, 1535);
  assert.equal(b.labor_target_sell, 684.93); // 500 / 0.73
  assert.equal(b.actual_margin_pct, null);   // no actual sell -> no margin
});

test("labor sell price feeds the workbook overhead adder (B16)", () => {
  const b = computeJobBudget({ material_true_cost: 1000, labor_sell_price: 740 });
  // B16 = 740/0.74 - 740 = 260; B17 = 1000 + 260*0.2 = 1052
  assert.equal(b.overhead_adder, 260);
  assert.equal(b.budget_cost_total_material, 1052);
  // B27 = B21 + C24 + (260 - 208) = (1052+74.5) + 740 + 52
  assert.equal(b.total_cost_overhead, 1918.5);
});

test("excel serial dates round-trip", () => {
  assert.equal(excelSerialToIso(46286), "2026-09-21");
  assert.equal(isoToExcelSerial("2026-09-21"), 46286);
  assert.equal(excelSerialToIso(null), "");
});
