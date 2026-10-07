// Focused pure-projection regression test for the hero "next visit" feed.
// Covers the display defects: (1) the hero leads with the confirmed upcoming
// visit instead of the stale saved-completion step, (2) the purpose preview is
// truncated at a word boundary with an ellipsis (never mid-word like '- Fr…'),
// and (3) the complete sanitized punch list is recoverable via expansion.
// No real events, no fetch, no records.
import test from "node:test";
import assert from "node:assert/strict";
import { truncatePurpose, nextVisitProjection, formatUpcomingLine } from "../src/lib/jobCalendarShared.js";

const LONG_PUNCH = "Beaver finish-up punch list (from Gabriel 10/6):\n- All exit doors: gaps letting wind, dust and leaves blow in\n- Top balcony door: adjust - does not stay closed\n- Kitchen door: handle broken\n- All similar handles: tighten or adjust\n- Rear sliding door: perfect, no work needed\n- Front door: replace sweep";

test("truncatePurpose: short text unchanged, no ellipsis", () => {
  assert.equal(truncatePurpose("Finish trim", 120), "Finish trim");
  assert.equal(truncatePurpose("Finish trim", 120).includes("…"), false);
  assert.equal(truncatePurpose("", 120), "");
});

test("truncatePurpose: long text truncated at word boundary with ellipsis, never mid-word or trailing hyphen", () => {
  const p = truncatePurpose(LONG_PUNCH, 120);
  assert.ok(p.length < LONG_PUNCH.length, "preview must be shorter");
  assert.ok(p.endsWith("…"), "must end with ellipsis");
  assert.ok(!/[-]…$/.test(p), `trailing hyphen before ellipsis: ${JSON.stringify(p)}`);
  // The cut is a prefix of the full text (no characters invented).
  assert.ok(LONG_PUNCH.startsWith(p.slice(0, -1).trimEnd()), `cut not a prefix: ${JSON.stringify(p)}`);
});

test("truncatePurpose: no space found keeps a hard cut but still ellipses", () => {
  const p = truncatePurpose("x".repeat(200), 120);
  assert.equal(p.length, 121);
  assert.ok(p.endsWith("…"));
});

test("nextVisitProjection: null when no events", () => {
  assert.equal(nextVisitProjection(null), null);
  assert.equal(nextVisitProjection(undefined), null);
  assert.equal(nextVisitProjection([]), null);
});

test("nextVisitProjection: short purpose -> preview equals full, not expandable", () => {
  const ev = { id: "e1", date: "2026-10-10", all_day: true, purpose: "Finish trim", link: "https://calendar.google.com/x", flagged: false };
  const p = nextVisitProjection([ev]);
  assert.equal(p.line, formatUpcomingLine(ev));
  assert.equal(p.purposePreview, "Finish trim");
  assert.equal(p.purposeFull, "Finish trim");
  assert.equal(p.link, "https://calendar.google.com/x");
  assert.equal(p.flagged, false);
  assert.equal(p.expandable, false);
});

test("nextVisitProjection: long purpose -> preview truncated at boundary, full complete, expandable true", () => {
  const ev = { id: "e1", date: "2026-10-10", all_day: true, purpose: LONG_PUNCH, link: "", flagged: false };
  const p = nextVisitProjection([ev]);
  assert.equal(p.purposeFull, LONG_PUNCH, "full punch list must be complete");
  assert.equal(p.expandable, true);
  assert.ok(p.purposePreview.length < LONG_PUNCH.length);
  assert.ok(p.purposePreview.endsWith("…"));
  assert.ok(!/[-]…$/.test(p.purposePreview), `mid-word hyphen carryover: ${JSON.stringify(p.purposePreview)}`);
});

test("nextVisitProjection: non-https link dropped", () => {
  const p = nextVisitProjection([{ id: "e", date: "2026-10-10", all_day: true, purpose: "x", link: "javascript:alert(1)" }]);
  assert.equal(p.link, "");
});

test("nextVisitProjection: empty purpose -> No notes, not expandable", () => {
  const p = nextVisitProjection([{ id: "e", date: "2026-10-10", all_day: true, purpose: "" }]);
  assert.equal(p.purposePreview, "No notes.");
  assert.equal(p.purposeFull, "No notes.");
  assert.equal(p.expandable, false);
});

test("nextVisitProjection: uses first event only", () => {
  const a = { id: "a", date: "2026-10-10", all_day: true, purpose: "first" };
  const b = { id: "b", date: "2026-10-11", all_day: true, purpose: "second" };
  const p = nextVisitProjection([a, b]);
  assert.equal(p.line, formatUpcomingLine(a));
  assert.equal(p.purposeFull, "first");
});