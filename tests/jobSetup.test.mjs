import test from "node:test";
import assert from "node:assert/strict";
import { buildSetupDraft, computeSetupTotals, contractTermsReady, toContractViewModel } from "../src/lib/jobSetup.js";
import { computeJobBudget } from "../base44/shared/jobBudgetMath.js";

test("setup totals use the existing job budget computation", () => {
  const sheet = buildSetupDraft({ budget: { inputs: { material_true_cost: 1000, labor_cost_sub_pay: 500, additional_install_material: 100, additional_equipment: 50 } } });
  const totals = computeSetupTotals(sheet);
  const expected = computeJobBudget({ material_true_cost: 1000, labor_cost_sub_pay: 500, additional_install_material: 100, additional_equipment: 50 });
  assert.equal(totals.cost_budget, expected.total_cost_overhead);
  assert.equal(totals.sell_price, expected.suggested_total_sell);
  assert.equal(totals.tax, ""); // Internal use tax is not customer sales tax.
});

test("contract model has an explicit customer-safe shape without cost or margin", () => {
  const model = toContractViewModel({
    customer: { name: "Ada", product_cost: 999 }, costs: { material_product: 999, labor: 100 },
    pricing: { sell_price: 1500, tax: 100, contract_total: 1600, gross_margin: 0.3 },
    sources: { material_product: "secret" }, scope_lines: [{ mark: "A", qty: 1, dealer_cost: 800, customer_price: 1500 }], terms: { deposit_pct: 50 },
  }, { canonical_name: "Sample job" });
  const serialized = JSON.stringify(model);
  for (const forbidden of ["costs", "material_product", "dealer_cost", "gross_margin", "profit", "sources"]) assert.equal(serialized.includes(forbidden), false, forbidden);
  assert.equal(model.scope_lines[0].customer_price, 1500);
  assert.equal(model.deposit_amount, 800);
});

test("missing source data maps to editable blanks, never NaN", () => {
  const sheet = buildSetupDraft({ job: { id: "job-1" } });
  assert.equal(sheet.costs.material_product, "");
  assert.equal(sheet.pricing.contract_total, "");
  assert.equal(JSON.stringify(sheet).includes("NaN"), false);
  const model = toContractViewModel(sheet, {});
  assert.equal(JSON.stringify(model).includes("NaN"), false);
  assert.equal(model.contract_total, "");
  assert.equal(model.deposit_amount, null);
});

test("accepted quote schedule is preferred and normalized", () => {
  const sheet = buildSetupDraft({ job: { accepted_quote_snapshot: { result: { lines: [{ mark: "W1", quantity: 2, width: 36, height: 48, style: "Slider", customer_extended: 1200 }] } } } });
  assert.deepEqual(sheet.scope_lines[0], { mark: "W1", qty: 2, size: "36 × 48", product: "Slider", description: "", customer_price: 1200 });
});


test("contract terms start blank and require job-specific completion", () => {
  const sheet = buildSetupDraft({ job: { id: "job-1" } });
  assert.equal(sheet.terms.deposit_pct, "");
  assert.equal(sheet.terms.quote_valid_days, "");
  assert.equal(contractTermsReady(sheet), false);
  sheet.terms = { deposit_pct: 50, quote_valid_days: 14, payment_schedule: "50% at signing, balance at completion", estimated_lead_time: "6 weeks", warranty_text: "See attached manufacturer warranty" };
  assert.equal(contractTermsReady(sheet), false); // Terms alone never make an empty customer contract ready.
  sheet.customer = { name: "Ada", job_site_address: "123 Main St" };
  sheet.scope_lines = [{ qty: 1, product: "Window", customer_price: 1000 }];
  sheet.pricing = { sell_price: 1000, tax: 0, contract_total: 1000 };
  assert.equal(contractTermsReady(sheet), true);
  sheet.pricing.tax = "";
  assert.equal(contractTermsReady(sheet), false); // Internal use tax cannot fill customer tax.
  sheet.pricing.tax = 0;
  sheet.terms.warranty_text = "PLACEHOLDER - add warranty";
  assert.equal(contractTermsReady(sheet), false);
});

test("internal workbook use tax never becomes customer contract tax", () => {
  const sheet = buildSetupDraft({ budget: { inputs: { material_true_cost: 1000 } } });
  assert.equal(sheet.pricing.tax, "");
  assert.equal(toContractViewModel(sheet).tax, "");
});
