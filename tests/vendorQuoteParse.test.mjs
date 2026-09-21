import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseAmscoQuoteText, normalizeVendorQuote, quoteMatchTokens } from "../base44/shared/vendorQuoteParse.js";

const text = readFileSync(new URL("./fixtures/amsco-dealer-quote-3517590.txt", import.meta.url), "utf8");

test("AMSCO dealer quote text parses to the workbook inputs", () => {
  const q = parseAmscoQuoteText(text);
  assert.ok(q, "layout recognized");
  assert.equal(q.vendor, "Amsco");
  assert.equal(q.quote_number, "3517590");
  assert.equal(q.quote_name, "BAXTER - GLASS");
  assert.equal(q.quoted_by, "Israel");
  assert.equal(q.bill_to, "BTB HOME IMPROVEMENTS");
  assert.equal(q.dealer_number, "1798");
  assert.equal(q.openings_qty, 4);              // 3 + 1 across the two lines
  assert.equal(q.material_true_cost, 1256.98);  // dealer sub total -> C15
  assert.equal(q.actual_total_sell, 2411.81);   // customer TOTAL -> B28
  assert.equal(q.customer_sub_total, 2244.59);
  assert.equal(q.customer_tax, 167.22);
});

test("non-Amsco text returns null so the caller falls back to LLM", () => {
  assert.equal(parseAmscoQuoteText("Pella quote\nsome other layout"), null);
});

test("normalizeVendorQuote cleans LLM-shaped JSON", () => {
  const q = normalizeVendorQuote({
    vendor: "Milgard", quote_number: " Q-77 ", material_true_cost: "$1,256.98",
    actual_total_sell: "2411.81", openings_qty: "4", builder: "BAXTER",
  });
  assert.equal(q.manufacturer, "Milgard");
  assert.equal(q.quote_number, "Q-77");
  assert.equal(q.material_true_cost, 1256.98);
  assert.equal(q.openings_qty, 4);
  assert.deepEqual(quoteMatchTokens(q), ["baxter"]);
});
