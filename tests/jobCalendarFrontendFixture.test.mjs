// Frontend twin tests: display shaping + the frozen create-request lock, with a
// fixture (upcoming Saturday, create review). No real backend/provider calls.
import test from "node:test";
import assert from "node:assert/strict";
import {
  isJobCalendarOwner, formatUpcomingLine, formatUpcomingPurpose,
  freezeRequest, loadFrozenRequest, clearFrozenRequest, buildCreatePayload, newRequestId,
  UPCOMING_SATURDAY_FIXTURE, CREATE_REVIEW_FIXTURE,
} from "../src/lib/jobCalendarShared.js";

function memStore() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
  };
}

test("isJobCalendarOwner: only the two owner ids", () => {
  assert.equal(isJobCalendarOwner({ id: "6a7f0d834a5f825c724273ea" }), true);
  assert.equal(isJobCalendarOwner({ id: "6a8229a9801b2aef9278ff47" }), true);
  assert.equal(isJobCalendarOwner({ id: "other" }), false);
  assert.equal(isJobCalendarOwner(null), false);
});

test("formatUpcomingLine: all-day fixture (Saturday Oct 10 2026)", () => {
  assert.match(formatUpcomingLine(UPCOMING_SATURDAY_FIXTURE), /Sat.*Oct.*10.*all day/);
});
test("formatUpcomingLine: timed event shows start–end", () => {
  assert.match(formatUpcomingLine({ date: "2026-10-06", all_day: false, start_time: "16:00", end_time: "17:00" }), /16:00–17:00/);
});
test("formatUpcomingPurpose: returns notes or a placeholder", () => {
  assert.match(formatUpcomingPurpose(UPCOMING_SATURDAY_FIXTURE), /Finish up install trim items/);
  assert.equal(formatUpcomingPurpose({ purpose: "" }), "No notes.");
});

test("frozen request: lock persists across a remount and only retries the same id", () => {
  const store = memStore();
  const user = { id: "6a7f0d834a5f825c724273ea" };
  const job = { id: "6a817395914bfa31ecd0f1f6", canonical_name: "Beaver - 412", address: "1497 E 200 N St" };
  const form = { all_day: true, start_date: "2026-10-10", end_date: "", start_time: "", end_time: "", notes: "Finish trim" };
  const rid = newRequestId();
  freezeRequest(store, user, job, { status: "creating", request_id: rid, form });
  // remount: a new modal instance reads the frozen lock
  const frozen = loadFrozenRequest(store, user, job);
  assert.equal(frozen.status, "creating");
  assert.equal(frozen.request_id, rid);
  assert.deepEqual(frozen.form, form);
  // retry builds the SAME payload (same request_id)
  const payload = buildCreatePayload({ user, job, form, requestId: frozen.request_id });
  assert.equal(payload.request_id, rid);
  assert.equal(payload.all_day, true);
  assert.equal(payload.start_date, "2026-10-10");
  assert.equal(payload.title, "Beaver - 412");
  assert.equal(payload.time_zone, "America/Denver");
  // no pricing fields on the payload
  assert.equal(payload.labor_amt, undefined);
  assert.equal(payload.fee_amt, undefined);
  // clear on success
  clearFrozenRequest(store, user, job);
  assert.equal(loadFrozenRequest(store, user, job), null);
});

test("frozen request is scoped per user+job (no cross-job leak)", () => {
  const store = memStore();
  const u = { id: "6a7f0d834a5f825c724273ea" };
  const j1 = { id: "j1" };
  const j2 = { id: "j2" };
  freezeRequest(store, u, j1, { status: "creating", request_id: "r1", form: {} });
  assert.equal(loadFrozenRequest(store, u, j2), null);
  assert.equal(loadFrozenRequest(store, { id: "other" }, j1), null);
});

test("buildCreatePayload: timed payload carries start/end time; all-day clears them", () => {
  const u = { id: "6a7f0d834a5f825c724273ea" };
  const job = { id: "j", canonical_name: "T", address: "A" };
  const timed = buildCreatePayload({ user: u, job, form: { all_day: false, start_date: "2026-10-10", start_time: "09:00", end_time: "11:00", notes: "n" }, requestId: "r" });
  assert.equal(timed.all_day, false);
  assert.equal(timed.start_time, "09:00");
  assert.equal(timed.end_time, "11:00");
  assert.equal(timed.end_date, null);
  const allday = buildCreatePayload({ user: u, job, form: { all_day: true, start_date: "2026-10-10", end_date: "2026-10-12", start_time: "09:00", end_time: "11:00", notes: "n" }, requestId: "r" });
  assert.equal(allday.all_day, true);
  assert.equal(allday.start_time, null);
  assert.equal(allday.end_time, null);
  assert.equal(allday.end_date, "2026-10-12");
});

test("create review fixture has no pricing fields and targets the Beaver job", () => {
  const f = CREATE_REVIEW_FIXTURE;
  assert.equal(f.job_id, "6a817395914bfa31ecd0f1f6");
  assert.equal(f.all_day, true);
  assert.equal(f.start_date, "2026-10-10");
  assert.equal(f.labor_amt, undefined);
  assert.equal(f.fee_amt, undefined);
});

test("newRequestId returns unique-ish strings", () => {
  const a = newRequestId(), b = newRequestId();
  assert.ok(a && b && a !== b);
});