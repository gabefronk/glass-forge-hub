import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";

// Static source guards for the JobHero upcoming-projection layout. The projection
// row must wrap on narrow viewports (flex-wrap) and the purpose must drop its fixed
// min-width and take a full-width second row on mobile (max-[699px]:w-full +
// max-[699px]:flex-none), so the nowrap "Next visit" chip + nowrap time + purpose
// never overflow 320/390px. The compact actions stay in their own full-width
// hero-actions row (44px mobile touch targets via index.css). Read-only: asserts
// source classes only, renders nothing.
test("JobSheet: hero projection row wraps on mobile; purpose is full-width second row; actions stay separate", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "src/components/jobs/JobSheet.jsx"), "utf8");
  assert.match(src, /flex w-full min-w-0 flex-none flex-wrap items-center gap-2\.5/, "projection row has flex-wrap");
  assert.match(src, /min-w-0 flex-1 text-\[14\.5px\] font-semibold leading-\[20px\] max-\[699px\]:w-full max-\[699px\]:flex-none/, "purpose is min-w-0 + mobile full-width second row");
  assert.match(src, /hero-actions flex w-full min-w-0 flex-wrap items-center gap-2/, "actions stay in their own hero-actions row");
  assert.ok(!/min-w-\[180px\]/.test(src), "no fixed min-w-[180px] anywhere (was the overflow cause)");
});