import test from "node:test";
import assert from "node:assert";
import fs from "node:fs";
import path from "node:path";

// Static source guards for the JobHero footer layout. The status row must wrap on
// narrow viewports (flex-wrap). A booked visit is not repeated in the hero (Gabe,
// Oct 28: the Upcoming card right below already lists it), on desktop or phone. The
// status and the actions share the hero's footer bar, which wraps the actions onto
// their own line when space runs out (44px mobile touch targets via index.css).
// Read-only: asserts source classes only, renders nothing.
test("JobSheet: hero footer wraps on mobile, never repeats the next visit, and actions stay separate", () => {
  const src = fs.readFileSync(path.join(process.cwd(), "src/components/jobs/JobSheet.jsx"), "utf8");
  assert.match(src, /flex min-w-0 flex-1 basis-\[320px\] flex-wrap items-center gap-2\.5/, "projection row has flex-wrap");
  assert.ok(!/>Next visit</.test(src) && !/purposePreview/.test(src), "desktop hero shows no next-visit chip or notes");
  const mobile = fs.readFileSync(path.join(process.cwd(), "src/components/jobs/JobHeroMobile.jsx"), "utf8");
  assert.ok(!/proj\.line|purposePreview/.test(mobile), "phone hero shows no next-visit date or notes");
  assert.match(src, /flex flex-wrap items-center gap-x-4 gap-y-2\.5 rounded-b-\[14px\]/, "footer bar wraps");
  assert.match(src, /hero-actions flex min-w-0 flex-wrap items-center gap-2/, "actions stay in their own hero-actions group");
  assert.ok(!/min-w-\[180px\]/.test(src), "no fixed min-w-[180px] anywhere (was the overflow cause)");
});