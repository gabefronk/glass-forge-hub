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

test("openings_qty is recomputed from line quantities when the extractor undercounts", () => {
  // The LLM often returns a top-level openings_qty that is neither the line count
  // nor the sum of quantities (e.g. Taira Res: 8 lines, 19 units, LLM said 14).
  // The real unit count is the sum of the line quantities, excluding parts.
  const q = normalizeVendorQuote({
    vendor: "Nu Vista", quote_number: "1050", openings_qty: 14,
    lines: [
      { qty: 1, kind: "door", description: "Multi Slider" },
      { qty: 4, kind: "glass", description: "Glass D19" },
      { qty: 1, kind: "door", description: "Multi Slider" },
      { qty: 4, kind: "glass", description: "Glass D8" },
      { qty: 1, kind: "door", description: "Multi Slider" },
      { qty: 4, kind: "glass", description: "Glass D8" },
      { qty: 2, kind: "door", description: "Patio Door" },
      { qty: 2, kind: "door", description: "Patio Door" },
      { qty: 3, kind: "part", description: "Mull kit" },
    ],
  });
  assert.equal(q.lines.length, 9);
  assert.equal(q.openings_qty, 19); // 1+4+1+4+1+4+2+2, parts excluded
});

test("openings_qty falls back to the raw value when there are no lines", () => {
  const q = normalizeVendorQuote({ vendor: "Amsco", openings_qty: 7 });
  assert.equal(q.openings_qty, 7);
});

test("openings_qty is corrected down when the extractor overcounts", () => {
  const q = normalizeVendorQuote({
    vendor: "Amsco", openings_qty: 99,
    lines: [{ qty: 2, kind: "door" }, { qty: 3, kind: "glass" }],
  });
  assert.equal(q.openings_qty, 5); // lines win over the extractor's guess
});

test("openings_qty stays when lines already sum to the reported count", () => {
  const q = normalizeVendorQuote({
    vendor: "Amsco", openings_qty: 19,
    lines: [
      { qty: 1, kind: "door" }, { qty: 4, kind: "glass" }, { qty: 1, kind: "door" },
      { qty: 4, kind: "glass" }, { qty: 1, kind: "door" }, { qty: 4, kind: "glass" },
      { qty: 2, kind: "door" }, { qty: 2, kind: "door" }, { qty: 3, kind: "part" },
    ],
  });
  assert.equal(q.openings_qty, 19);
});

test("all-parts lines keep the raw openings_qty (lineUnits is zero)", () => {
  const q = normalizeVendorQuote({
    vendor: "Amsco", openings_qty: 6,
    lines: [{ qty: 2, kind: "part" }, { qty: 4, kind: "part" }],
  });
  assert.equal(q.openings_qty, 6);
});

test("duplicate/grouped line descriptions are summed per-quantity, not double-counted", () => {
  // Three identical "Multi Slider" lines (qty 1 each) + one "Glass D8" line
  // (qty 4) must count 3 + 4 = 7, not 4 (line count) or 3+1+4 (line+qty).
  const q = normalizeVendorQuote({
    vendor: "Nu Vista", openings_qty: 0,
    lines: [
      { qty: 1, kind: "door", description: "Multi Slider" },
      { qty: 1, kind: "door", description: "Multi Slider" },
      { qty: 1, kind: "door", description: "Multi Slider" },
      { qty: 4, kind: "glass", description: "Glass D8" },
    ],
  });
  assert.equal(q.openings_qty, 7);
  assert.equal(q.lines.length, 4);
});

test("cost, sell and tax are independent of the openings_qty recompute", () => {
  const q = normalizeVendorQuote({
    vendor: "Amsco", quote_number: "Q1",
    material_true_cost: "$1,256.98",
    actual_total_sell: "2411.81",
    customer_tax: "167.22",
    openings_qty: 14,
    lines: [{ qty: 4, kind: "door" }, { qty: 4, kind: "glass" }],
  });
  assert.equal(q.openings_qty, 8);       // recomputed from lines
  assert.equal(q.material_true_cost, 1256.98); // untouched
  assert.equal(q.actual_total_sell, 2411.81);  // untouched
  assert.equal(q.customer_tax, 167.22);        // untouched
});

test("extractor contract: per-line-item qty, null = not printed, parts excluded (source-grounded)", () => {
  // Contract from vendorQuoteSchema.js QUOTE_SCHEMA + QUOTE_PROMPT:
  // lines = "One entry per quote line item"; qty = integer|null with
  // "Use null for anything not printed; never guess"; openings_qty =
  // "Total window/door/glass units across all lines"; kind 'part' =
  // screens/mull/hardware/freight/fees. The recompute sums reliably-quantified
  // non-part line quantities; null qty is never invented as 1.
  const q = normalizeVendorQuote({
    vendor: "Amsco", openings_qty: 10,
    lines: [
      { qty: 3, kind: "window", description: "Single Hung" },
      { qty: 2, kind: "glass", description: "Glass Only" },
      { qty: 1, kind: "part", description: "Screen" },
    ],
  });
  assert.equal(q.openings_qty, 5);
  assert.equal(q.openings_qty_review, false);
});

test("explicit qty 0 is zero, not defaulted to 1", () => {
  const q = normalizeVendorQuote({
    vendor: "Amsco", openings_qty: 5,
    lines: [{ qty: 0, kind: "door", description: "Info only" }, { qty: 3, kind: "glass" }],
  });
  assert.equal(q.lines[0].qty, 0);
  assert.equal(q.openings_qty, 3);        // 0 + 3, not 1 + 3
  assert.equal(q.openings_qty_review, false);
});

test("unknown/missing qty does not invent 1 — raw count kept, review flagged", () => {
  const q = normalizeVendorQuote({
    vendor: "Amsco", openings_qty: 6,
    lines: [{ qty: null, kind: "door", description: "Single Hung" }, { qty: 2, kind: "glass" }],
  });
  assert.equal(q.lines[0].qty, null);
  assert.equal(q.openings_qty, 6);
  assert.equal(q.openings_qty_review, true);
});

test("group-summary plus detail lines does not double-count — raw kept, review flagged", () => {
  const q = normalizeVendorQuote({
    vendor: "Amsco", openings_qty: 4,
    lines: [
      { qty: 4, kind: "door", description: "Single Hung" },
      { qty: 1, kind: "door", description: "Single Hung" },
      { qty: 1, kind: "door", description: "Single Hung" },
      { qty: 1, kind: "door", description: "Single Hung" },
      { qty: 1, kind: "door", description: "Single Hung" },
    ],
  });
  assert.equal(q.openings_qty, 4);       // not 8 (4+1+1+1+1)
  assert.equal(q.openings_qty_review, true);
});

test("distinct rows with same description and same qty are summed, not deduped", () => {
  const q = normalizeVendorQuote({
    vendor: "Amsco", openings_qty: 0,
    lines: [
      { qty: 2, kind: "door", description: "Slider" },
      { qty: 2, kind: "door", description: "Slider" },
    ],
  });
  assert.equal(q.openings_qty, 4);
  assert.equal(q.openings_qty_review, false);
});