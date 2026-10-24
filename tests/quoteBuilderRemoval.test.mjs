// Regression: the standalone Quote Builder page was removed (owner Oct 7).
// The Window Quotes tab and the QuoteRequests entity must remain intact. The old
// quoteEngine function and its shared pricing twins were retired (owner Oct 24).
// Static source assertions only — no live data, no function invokes.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

test("QuoteBuilder page file is removed", () => {
  assert.equal(existsSync(join(root, "src/pages/QuoteBuilder.jsx")), false);
});

test("App.jsx no longer imports or routes QuoteBuilder", () => {
  const app = read("src/App.jsx");
  assert.ok(!/import QuoteBuilder/.test(app), "QuoteBuilder import must be gone");
  assert.ok(!/path="\/QuoteBuilder"/.test(app), "/QuoteBuilder route must be gone");
  assert.ok(!/<QuoteBuilder/.test(app), "<QuoteBuilder /> element must be gone");
});

test("WindowQuotes route + import are retained", () => {
  const app = read("src/App.jsx");
  assert.match(app, /import WindowQuotes from ['"]@\/pages\/WindowQuotes['"]/);
  assert.match(app, /path="\/window-quotes"/);
});

test("desktop sidebar no longer exposes Quote Builder and drops unused Calculator icon", () => {
  const sb = read("src/components/YaFeesSidebar.jsx");
  assert.ok(!/QuoteBuilder/.test(sb), "no QuoteBuilder reference in sidebar");
  assert.ok(!/\/QuoteBuilder/.test(sb), "no /QuoteBuilder link in sidebar");
  assert.ok(!/\bCalculator\b/.test(sb), "Calculator icon import removed (now unused)");
  assert.match(sb, /to: "\/window-quotes"/, "Window Quotes nav entry retained");
});

test("mobile bottom nav no longer exposes Quote Builder and drops unused Calculator icon", () => {
  const mb = read("src/components/MobileBottomNav.jsx");
  assert.ok(!/QuoteBuilder/.test(mb), "no QuoteBuilder reference in mobile nav");
  assert.ok(!/\/QuoteBuilder/.test(mb), "no /QuoteBuilder link in mobile nav");
  assert.ok(!/\bCalculator\b/.test(mb), "Calculator icon import removed (now unused)");
  assert.match(mb, /to: "\/window-quotes"/, "Window Quotes nav entry retained");
});

test("the old quoteEngine function and its pricing twins are retired (owner Oct 24)", () => {
  for (const p of ["base44/functions/quoteEngine/entry.ts", "base44/shared/quoteEnginePure.js", "base44/shared/quoteAccess.js", "src/lib/quoteAccess.js"]) {
    assert.equal(existsSync(join(root, p)), false, `${p} removed`);
  }
});

test("QuoteRequests entity schema is untouched", () => {
  const schema = read("base44/entities/QuoteRequests.jsonc");
  assert.match(schema, /"name":\s*"QuoteRequests"/);
  assert.match(schema, /"source":\s*{\s*"type":\s*"object"/);
  assert.match(schema, /"worker_status"/);
});