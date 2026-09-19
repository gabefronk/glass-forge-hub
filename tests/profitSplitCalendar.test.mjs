import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import ts from "typescript";
import { computeFeeAmt, pricingReview } from "../base44/shared/billingCore.js";

async function moduleUrl(url) {
  let source = await readFile(url, "utf8");
  if (!url.pathname.endsWith(".ts")) return url.href;
  for (const match of [...source.matchAll(/from ['"](\.[^'"]+)['"]/g)]) {
    source = source.replace(match[0], "from " + JSON.stringify(await moduleUrl(new URL(match[1], url))));
  }
  source = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext } }).outputText;
  return "data:text/javascript;base64," + Buffer.from(source).toString("base64");
}

async function loadIngestShared() {
  return import(await moduleUrl(new URL("../base44/shared/ingestShared.ts", import.meta.url)));
}

test("calendar sale/cost/profit note becomes product profit split", async () => {
  const { extractProfitSplit } = await loadIngestShared();
  const note = `Pick up from BFS then deliver and install.\n\nCost: $9,880.93\nSale Price: $30,906.03\nProfit: $21,025.10`;
  const split = extractProfitSplit(note);
  assert.deepEqual(split, { sale_price: 30906.03, cost: 9880.93 });
  assert.equal(computeFeeAmt({ fee_type: "profit_split", ...split, split_pct: 0.5 }), 10512.55);
});

test("calendar total/profit/split note derives cost only when the split is confirmed", async () => {
  const { extractProfitSplit } = await loadIngestShared();
  const note = `Half Already Paid: $7,384.80\nRemainder to Invoice: $7,884.80\nTotal: $15,269.60\n\nProfit: $4,605.81\nSplit: $2,302.91`;
  const split = extractProfitSplit(note);
  assert.deepEqual(split, { sale_price: 15269.6, cost: 10663.79 });
  assert.equal(computeFeeAmt({ fee_type: "profit_split", ...split, split_pct: 0.5 }), 2302.91);
});

test("bare or inconsistent profit split notes remain review candidates", async () => {
  const { extractProfitSplit } = await loadIngestShared();
  assert.equal(extractProfitSplit("Profit: $4,605.81\nSplit: $2,302.91"), null);
  assert.equal(extractProfitSplit("Total: $15,269.60\nProfit: $4,605.81\nSplit: $2,000.00"), null);
  assert.equal(pricingReview("Profit: $4,605.81\nSplit: $2,302.91")?.amount, 2302.91);
});
