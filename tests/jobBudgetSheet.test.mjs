import test from "node:test";
import assert from "node:assert/strict";
import { unzipSync, zipSync, strFromU8, strToU8 } from "fflate";
import { computeJobBudget } from "../base44/shared/jobBudgetMath.js";
import { buildBudgetCsv, fillBudgetXlsx } from "../base44/shared/jobBudgetSheet.js";
import { BUDGET_TEMPLATE_XLSX_B64 } from "../base44/shared/jobBudgetTemplateXlsx.js";

const budget = computeJobBudget({ material_true_cost: 1256.98, actual_total_sell: 2411.81 });
const quote = { manufacturer: "Amsco", quote_number: "3517590", quote_name: "BAXTER - GLASS", quoted_by: "Israel", openings_qty: 4 };

test("budget CSV carries the workbook lines", () => {
  const csv = buildBudgetCsv({ quote, budget, fields: { builder: "BAXTER", sales_rep: "GSF" } });
  assert.match(csv, /Builder Name,BAXTER/);
  assert.match(csv, /Material True Cost from Quote,1256.98/);
  assert.match(csv, /Margin %,44.00%/);
  assert.match(csv, /Vendor Quote #,3517590/);
});

test("filled workbook keeps template structure and writes values + cached formulas", () => {
  const tpl = Buffer.from(BUDGET_TEMPLATE_XLSX_B64, "base64");
  const out = fillBudgetXlsx(new Uint8Array(tpl), {
    sales_rep: "GSF", builder: "BAXTER", manufacturer: "Amsco", openings_qty: 4, date_iso: "2026-09-21",
  }, budget, { unzipSync, zipSync, strFromU8, strToU8 });
  const files = unzipSync(out);
  assert.ok(files["xl/worksheets/sheet1.xml"], "sheet1 survives");
  assert.ok(files["xl/sharedStrings.xml"], "shared strings survive");
  const xml = strFromU8(files["xl/worksheets/sheet1.xml"]);
  assert.match(xml, /<c r="B5"[^>]*t="inlineStr"><is><t>BAXTER<\/t><\/is><\/c>/);
  assert.match(xml, /<c r="B12"[^>]*t="inlineStr"><is><t>Amsco<\/t><\/is><\/c>/);
  assert.match(xml, /<c r="C14"[^>]*><v>4<\/v><\/c>/);
  assert.match(xml, /<c r="C15"[^>]*><v>1256.98<\/v><\/c>/);
  assert.match(xml, /<c r="C28"[^>]*><v>2411.81<\/v><\/c>/);
  assert.match(xml, /<c r="C21"[^>]*>(?:<f>[^<]*<\/f>)?<v>1350.63<\/v><\/c>/);
  assert.match(xml, /<c r="C29"[^>]*>(?:<f>[^<]*<\/f>)?<v>0.44<\/v><\/c>/);
  // Formulas still present so Excel recalculates live.
  assert.match(xml, /<c r="C17"[^>]*><f>C15\+\(C16\*0\.2\)<\/f><v>1256.98<\/v><\/c>/);
});
