import test from "node:test";
import assert from "node:assert/strict";
import { upcomingWorkDays, bookedCounts, applyVisitPick, timeKeyOf, visitSummary } from "../src/lib/visitPlanner.js";

const CREWS = [{ key: "israel", email: "iryedra@gmail.com" }, { key: "milan", email: "milanfronk@gmail.com" }];
const EMPTY = { all_day: true, start_date: "", end_date: "", start_time: "", end_time: "", notes: "" };

test("upcomingWorkDays starts tomorrow and skips Sundays", () => {
  // Sat Oct 24 2026: the next day is Sunday, so the list starts Monday.
  assert.deepEqual(upcomingWorkDays("2026-10-24", 6), ["2026-10-26", "2026-10-27", "2026-10-28", "2026-10-29", "2026-10-30", "2026-10-31"]);
});

test("bookedCounts counts live events per crew and leaves unsynced calendars unknown", () => {
  const events = [
    { event_date: "2026-10-26", google_calendar_id: "iryedra@gmail.com" },
    { event_date: "2026-10-26", google_calendar_id: "iryedra@gmail.com", source_status: "cancelled" },
    { event_date: "2026-10-26", end_date: "2026-10-27", google_calendar_id: "iryedra@gmail.com" },
    { event_date: "2026-10-27", google_calendar_id: "someone@else.com" },
  ];
  const out = bookedCounts(events, ["2026-10-26", "2026-10-27", "2026-10-28"], CREWS);
  assert.deepEqual(out["2026-10-26"], { israel: 2, milan: null });
  assert.deepEqual(out["2026-10-27"], { israel: 1, milan: null });
  assert.deepEqual(out["2026-10-28"], { israel: 0, milan: null });
});

test("applyVisitPick sets the fields buildReviewedPayload reads", () => {
  const one = applyVisitPick(EMPTY, { day: "2026-10-27", days: 1, time: "all_day" });
  assert.equal(one.start_date, "2026-10-27");
  assert.equal(one.end_date, "");
  assert.equal(one.all_day, true);
  const three = applyVisitPick(one, { days: 3 });
  assert.equal(three.end_date, "2026-10-29");
  const timed = applyVisitPick(one, { time: "08:00-12:00" });
  assert.equal(timed.all_day, false);
  assert.equal(timed.start_time, "08:00");
  assert.equal(timed.end_time, "12:00");
  assert.equal(timeKeyOf(timed), "08:00-12:00");
  const custom = applyVisitPick(timed, { time: "custom" });
  assert.equal(custom.start_time, "08:00");
  assert.equal(timeKeyOf({ ...custom, end_time: "09:30" }), "custom");
});

test("visitSummary reads like the footer line", () => {
  assert.equal(visitSummary(EMPTY, ["Israel"]), "");
  assert.equal(visitSummary({ ...EMPTY, start_date: "2026-10-27" }, ["Israel"]), "Tue, Oct 27 · all day on Israel's calendar");
  const timed = { ...EMPTY, all_day: false, start_date: "2026-10-27", end_date: "2026-10-28", start_time: "08:00", end_time: "10:00" };
  assert.equal(visitSummary(timed, ["Israel", "Milan"]), "Tue, Oct 27 – Wed, Oct 28 · 08:00–10:00 on Israel and Milan's calendars");
});
