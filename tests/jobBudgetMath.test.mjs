import test from "node:test";
import assert from "node:assert/strict";
import { computeJobBudget, excelSerialToIso, isoToExcelSerial } from "../base44/shared/jobBudgetMath.js";

// Numbers come from Gabriel's filled "Window Budget Sheet" for the BAXTER job
// (Amsco quote 3517590): every workbook output must match the template's formulas.
test("workbook replication: BAXTER / Amsco 3517590 matches the filled sheet", () => {
  const b = computeJobBudget({ material_true_cost: 1256.98, actual_total_sell: 2411.81 });
  // No use tax (Gabriel, Oct 24 2026): the material cost already carries the tax.
  assert.equal(b.use_tax, undefined);
  assert.equal(b.cost_material_tax, 1256.98);        // B21
  assert.equal(b.sell_material_tax_target, 1795.69); // B22 = C21 / (1 - 0.30)
  assert.equal(b.total_cost_overhead, 1256.98);      // B27
  assert.equal(b.actual_margin_pct, 0.4788);         // B29
  assert.equal(b.overhead_adder, 0);                 // B16 with no labor cost
});

test("desired margins drive target sells", () => {
  const b = computeJobBudget({ material_true_cost: 1000, labor_cost_sub_pay: 500 });
  // No overhead (Gabriel, Oct 30 2026): target sell = 1000 / 0.70
  assert.equal(b.overhead_adder, 0);
  assert.equal(b.sell_material_tax_target, 1428.57);
  assert.equal(b.labor_target_sell, 684.93); // 500 / 0.73
  assert.equal(b.actual_margin_pct, null);   // no actual sell -> no margin
});

test("labor cost (sub pay, C24) adds to the total cost once, with no overhead; labor sell (C25) is price only", () => {
  const b = computeJobBudget({ material_true_cost: 1000, labor_cost_sub_pay: 740, labor_sell_price: 1200, actual_total_sell: 3000 });
  assert.equal(b.overhead_adder, 0);
  assert.equal(b.budget_cost_total_material, 1000);
  assert.equal(b.cost_material_tax, 1000);
  assert.equal(b.total_cost_overhead, 1740); // 1000 + 740
  assert.equal(b.labor_cost_sub_pay, 740);
  assert.equal(b.labor_sell_price, 1200);
  assert.equal(b.labor_target_sell, 1013.7); // 740 / 0.73
  assert.equal(b.actual_margin_pct, 0.42);   // 1 - 1740 / 3000
  // the sell price never changes the cost side
  const same = computeJobBudget({ material_true_cost: 1000, labor_cost_sub_pay: 740, actual_total_sell: 3000 });
  assert.equal(same.total_cost_overhead, b.total_cost_overhead);
  assert.equal(same.actual_margin_pct, b.actual_margin_pct);
});

test("Campbell Addition (AMSCO 3608034): material + sub pay = cost, nothing added", () => {
  const b = computeJobBudget({ material_true_cost: 1291.13, labor_cost_sub_pay: 489, actual_total_sell: 2496.03 });
  assert.equal(b.cost_material_tax, 1291.13);
  assert.equal(b.total_cost_overhead, 1780.13);
  assert.equal(b.actual_margin_pct, 0.2868); // 1 - 1780.13 / 2496.03
  // an old stored overhead_adder input is ignored too
  assert.equal(computeJobBudget({ material_true_cost: 1291.13, labor_cost_sub_pay: 489, overhead_adder: 50 }).total_cost_overhead, 1780.13);
});

test("excel serial dates round-trip", () => {
  assert.equal(excelSerialToIso(46286), "2026-09-21");
  assert.equal(isoToExcelSerial("2026-09-21"), 46286);
  assert.equal(excelSerialToIso(null), "");
});
