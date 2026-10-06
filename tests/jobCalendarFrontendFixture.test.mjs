// Frontend twin tests: display shaping, the frozen create-request lock lifecycle,
// the pure create-outcome decision, safe error mapping, form validation, and the
// preview fixtures. No real backend/provider calls.
import test from "node:test";
import assert from "node:assert/strict";
import {
  isJobCalendarOwner, formatUpcomingLine, formatUpcomingPurpose,
  freezeRequest, loadFrozenRequest, clearFrozenRequest, buildCreatePayload, newRequestId,
  decideCreateOutcome, isProvenNoncreation, safeError, reviewFormError,
  UPCOMING_SATURDAY_FIXTURE, CREATE_REVIEW_FIXTURE,
  CREATE_RESULT_STAGED, CREATE_RESULT_CREATED, CREATE_RESULT_EXISTING, UPCOMING_STATES,
} from "../src/lib/jobCalendarShared.js";

function memStore() {
  const m = new Map();
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => void m.set(k, String(v)),
    removeItem: (k) => void m.delete(k),
  };
}

const U = { id: "6a7f0d834a5f825c724273ea" };
const JOB = { id: "6a817395914bfa31ecd0f1f6", canonical_name: "Beaver - 412", address: "1497 E 200 N St" };

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

// ---- frozen request lifecycle (the modal wires these; tested at the storage layer) ----
test("frozen request: lock persists across a remount and only retries the same id", () => {
  const store = memStore();
  const form = { all_day: true, start_date: "2026-10-10", end_date: "", start_time: "", end_time: "", notes: "Finish trim", confirm_no_jobsite: false };
  const rid = newRequestId();
  freezeRequest(store, U, JOB, { status: "creating", request_id: rid, form });
  const frozen = loadFrozenRequest(store, U, JOB);
  assert.equal(frozen.status, "creating");
  assert.equal(frozen.request_id, rid);
  assert.deepEqual(frozen.form, form);
  const payload = buildCreatePayload({ user: U, job: JOB, form, requestId: frozen.request_id });
  assert.equal(payload.request_id, rid);
  assert.equal(payload.title, "Beaver - 412");
  assert.equal(payload.time_zone, "America/Denver");
  assert.equal(payload.labor_amt, undefined);
  assert.equal(payload.fee_amt, undefined);
  clearFrozenRequest(store, U, JOB);
  assert.equal(loadFrozenRequest(store, U, JOB), null);
});
test("frozen request: close does NOT clear a creating lock (persist across close/reopen)", () => {
  const store = memStore();
  const rid = newRequestId();
  freezeRequest(store, U, JOB, { status: "creating", request_id: rid, form: {} });
  // a close that does not call clearFrozenRequest leaves the lock intact
  assert.equal(loadFrozenRequest(store, U, JOB).status, "creating");
  assert.equal(loadFrozenRequest(store, U, JOB).request_id, rid);
});
test("frozen request is scoped per user+job (no cross-job leak)", () => {
  const store = memStore();
  freezeRequest(store, U, { id: "j1" }, { status: "creating", request_id: "r1", form: {} });
  assert.equal(loadFrozenRequest(store, U, { id: "j2" }), null);
  assert.equal(loadFrozenRequest(store, { id: "other" }, { id: "j1" }), null);
});

// ---- pure create-outcome decision (the modal wires this; lifecycle tested here) ----
test("decideCreateOutcome: staged off → done, release", () => {
  const o = decideCreateOutcome(CREATE_RESULT_STAGED);
  assert.equal(o.step, "done");
  assert.equal(o.kind, "staged");
  assert.equal(o.release, true);
});
test("decideCreateOutcome: created → done, release, link", () => {
  const o = decideCreateOutcome(CREATE_RESULT_CREATED);
  assert.equal(o.step, "done");
  assert.equal(o.kind, "created");
  assert.equal(o.release, true);
  assert.match(o.link, /calendar\.google\.com/);
});
test("decideCreateOutcome: existing_match → done (existing), release, link", () => {
  const o = decideCreateOutcome(CREATE_RESULT_EXISTING);
  assert.equal(o.step, "done");
  assert.equal(o.kind, "existing");
  assert.equal(o.release, true);
  assert.match(o.link, /calendar\.google\.com/);
});
test("decideCreateOutcome: proven noncreation (job_merged) → form, release, safe error", () => {
  const o = decideCreateOutcome({ error: "job_merged" });
  assert.equal(o.step, "form");
  assert.equal(o.release, true);
  assert.match(o.error, /combined/i);
});
test("decideCreateOutcome: unknown (job_calendar_failed) → locked, do NOT release", () => {
  const o = decideCreateOutcome({ error: "job_calendar_failed" });
  assert.equal(o.step, "locked");
  assert.equal(o.release, false);
  assert.match(o.error, /could not be confirmed/i);
});
test("decideCreateOutcome: network failure (null) → locked, do NOT release", () => {
  const o = decideCreateOutcome(null);
  assert.equal(o.step, "locked");
  assert.equal(o.release, false);
});
test("decideCreateOutcome: proven noncreation releases; unknown never releases", () => {
  assert.equal(isProvenNoncreation("job_merged"), true);
  assert.equal(isProvenNoncreation("job_calendar_failed"), false);
  assert.equal(isProvenNoncreation("jobsite_required"), true);
});

// ---- safe error mapping (no raw provider/exception strings) ----
test("safeError: known codes map to safe text; unknown codes get a generic safe message", () => {
  assert.match(safeError("calendar_not_connected"), /crew calendar/i);
  assert.match(safeError("job_calendar_failed"), /could not be confirmed/i);
  assert.match(safeError("RAW_EXCEPTION_LEAK"), /Something went wrong/i);
  assert.equal(safeError(undefined).includes("undefined"), false);
});

// ---- form validation before Review ----
test("reviewFormError: missing date", () => {
  assert.match(reviewFormError({ all_day: true, start_date: "" }), /date/i);
});
test("reviewFormError: invalid date", () => {
  assert.match(reviewFormError({ all_day: true, start_date: "2026-13-40" }), /valid date/i);
});
test("reviewFormError: all-day end before start", () => {
  assert.match(reviewFormError({ all_day: true, start_date: "2026-10-10", end_date: "2026-10-09" }), /End date/);
});
test("reviewFormError: timed missing start time", () => {
  assert.match(reviewFormError({ all_day: false, start_date: "2026-10-10", start_time: "" }), /start time/i);
});
test("reviewFormError: valid all-day and valid timed return empty", () => {
  assert.equal(reviewFormError({ all_day: true, start_date: "2026-10-10" }), "");
  assert.equal(reviewFormError({ all_day: false, start_date: "2026-10-10", start_time: "09:00" }), "");
});

// ---- buildCreatePayload: address + confirm_no_jobsite, no pricing ----
test("buildCreatePayload: carries address and confirm_no_jobsite; no pricing fields", () => {
  const p = buildCreatePayload({ user: U, job: JOB, form: { all_day: true, start_date: "2026-10-10", notes: "n", confirm_no_jobsite: true }, requestId: "r" });
  assert.equal(p.address, JOB.address);
  assert.equal(p.confirm_no_jobsite, true);
  assert.equal(p.title, "Beaver - 412");
  assert.equal(p.labor_amt, undefined);
  assert.equal(p.fee_amt, undefined);
});
test("buildCreatePayload: timed payload carries start/end time; all-day clears them", () => {
  const timed = buildCreatePayload({ user: U, job: JOB, form: { all_day: false, start_date: "2026-10-10", start_time: "09:00", end_time: "11:00", notes: "n" }, requestId: "r" });
  assert.equal(timed.start_time, "09:00");
  assert.equal(timed.end_time, "11:00");
  assert.equal(timed.end_date, null);
  const allday = buildCreatePayload({ user: U, job: JOB, form: { all_day: true, start_date: "2026-10-10", end_date: "2026-10-12", start_time: "09:00", end_time: "11:00", notes: "n" }, requestId: "r" });
  assert.equal(allday.start_time, null);
  assert.equal(allday.end_time, null);
  assert.equal(allday.end_date, "2026-10-12");
});

// ---- fixtures for preview (desktop + mobile pixel verification) ----
test("create review fixture targets the Beaver job and has no pricing", () => {
  assert.equal(CREATE_REVIEW_FIXTURE.job_id, "6a817395914bfa31ecd0f1f6");
  assert.equal(CREATE_REVIEW_FIXTURE.all_day, true);
  assert.equal(CREATE_REVIEW_FIXTURE.labor_amt, undefined);
  assert.equal(CREATE_REVIEW_FIXTURE.fee_amt, undefined);
});
test("result fixtures distinguish staged vs created vs existing", () => {
  assert.equal(CREATE_RESULT_STAGED.disabled, true);
  assert.equal(CREATE_RESULT_CREATED.ok && CREATE_RESULT_CREATED.kind, "created");
  assert.equal(CREATE_RESULT_EXISTING.ok && CREATE_RESULT_EXISTING.kind, "existing_match");
  assert.ok(CREATE_RESULT_CREATED.event.htmlLink);
  assert.ok(CREATE_RESULT_EXISTING.event.htmlLink);
});
test("upcoming state fixtures cover loading/empty/error/list for preview", () => {
  assert.equal(UPCOMING_STATES.loading.loading, true);
  assert.equal(UPCOMING_STATES.empty.events.length, 0);
  assert.equal(UPCOMING_STATES.error.error, "calendar_not_connected");
  assert.equal(UPCOMING_STATES.list.events.length, 1);
});

test("newRequestId returns unique-ish strings", () => {
  const a = newRequestId(), b = newRequestId();
  assert.ok(a && b && a !== b);
});