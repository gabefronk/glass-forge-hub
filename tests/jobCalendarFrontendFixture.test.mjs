// Frontend tests: display shaping, the pure outcome decision, safe errors, the
// reviewed-payload builder, validated frozen storage, and the create controller
// lifecycle the modal uses (no DOM test library is installed, so the modal's
// lifecycle is exercised through its controller). No real backend/provider calls.
import test from "node:test";
import assert from "node:assert/strict";
import {
  isJobCalendarOwner, formatUpcomingLine, formatUpcomingPurpose, newRequestId,
  decideCreateOutcome, isProvenNoncreation, safeError, readFrozen, writeFrozen, frozenKey,
  UPCOMING_SATURDAY_FIXTURE, CREATE_REVIEW_FIXTURE, CREATE_REVIEW_TIMED_FIXTURE, BEAVER_JOB_FIXTURE, OWNER_FIXTURE,
  CREATE_RESULT_STAGED, CREATE_RESULT_CREATED, CREATE_RESULT_EXISTING, UPCOMING_STATES,
} from "../src/lib/jobCalendarShared.js";
import { buildReviewedPayload, validateReviewed, describeReviewed, reviewErrorMessage } from "../src/lib/jobCalendarValidate.js";
import { createVisitController } from "../src/lib/jobCalendarCreateController.js";

function memStore({ failWrites = false } = {}) {
  const m = new Map();
  return {
    m,
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => { if (failWrites) throw new Error("quota"); m.set(k, String(v)); },
    removeItem: (k) => void m.delete(k),
  };
}
const U = OWNER_FIXTURE;
const JOB = BEAVER_JOB_FIXTURE;
const RID = "00000000-0000-4000-8000-0000000000aa";
const form = (over = {}) => ({ all_day: true, start_date: "2026-10-10", end_date: "", start_time: "", end_time: "", notes: "Finish trim", confirm_no_jobsite: false, ...over });
const reviewed = (over = {}, job = JOB) => buildReviewedPayload({ user: U, job, form: form(over), requestId: RID });
function fakeInvoke(responses) {
  const calls = [];
  const invoke = async (name, body) => {
    calls.push(JSON.stringify(body));
    const r = responses.length ? responses.shift() : { data: CREATE_RESULT_STAGED };
    if (r instanceof Error) throw r;
    return r;
  };
  return { invoke, calls };
}

// ---- display ----
test("owner gate and upcoming display", () => {
  assert.equal(isJobCalendarOwner(U), true);
  assert.equal(isJobCalendarOwner({ id: "other" }), false);
  assert.match(formatUpcomingLine(UPCOMING_SATURDAY_FIXTURE), /Sat.*Oct.*10.*all day/);
  assert.match(formatUpcomingLine({ date: "2026-10-06", all_day: false, start_time: "16:00", end_time: "17:00" }), /16:00–17:00/);
  assert.equal(formatUpcomingPurpose({ purpose: "" }), "No notes.");
});

// ---- reviewed payload builder (C) ----
test("buildReviewedPayload: all-day default last day = start; explicit fields", () => {
  const p = reviewed();
  assert.equal(p.end_date, "2026-10-10");
  assert.equal(p.start_time, null);
  assert.equal(p.title, JOB.canonical_name);
  assert.equal(p.address, JOB.address);
  assert.equal(validateReviewed(p).ok, true);
});
test("buildReviewedPayload: timed blank end = +1 hour, visible explicit end date/time", () => {
  const p = reviewed({ all_day: false, start_time: "09:00" });
  assert.equal(p.end_date, "2026-10-10");
  assert.equal(p.end_time, "10:00");
  const late = reviewed({ all_day: false, start_time: "23:30" });
  assert.equal(late.end_date, "2026-10-11");
  assert.equal(late.end_time, "00:30");
  assert.equal(validateReviewed(late).ok, true);
});
test("buildReviewedPayload: end time before start with blank end date = overnight; explicit end date kept", () => {
  assert.equal(reviewed({ all_day: false, start_time: "22:00", end_time: "02:00" }).end_date, "2026-10-11");
  const multi = reviewed({ all_day: false, start_time: "08:00", end_date: "2026-10-12", end_time: "17:00" });
  assert.equal(multi.end_date, "2026-10-12");
  assert.equal(validateReviewed(multi).ok, true);
});
test("buildReviewedPayload: notes never edited; pricing blocked with a visible message", () => {
  const p = reviewed({ notes: "Finish trim\nLabor $500" });
  assert.equal(p.notes, "Finish trim\nLabor $500");
  const v = validateReviewed(p);
  assert.deepEqual(v.errors, ["notes_contain_pricing"]);
  assert.match(reviewErrorMessage(v.errors), /pricing/i);
});
test("describeReviewed: all-day shows inclusive last day and exclusive calendar end; timed shows end date+time", () => {
  const rows = Object.fromEntries(describeReviewed(CREATE_REVIEW_FIXTURE));
  assert.match(rows["Last day (inclusive)"], /Oct 10, 2026/);
  assert.match(rows["Calendar end (exclusive)"], /Oct 11, 2026/);
  const t = Object.fromEntries(describeReviewed(CREATE_REVIEW_TIMED_FIXTURE));
  assert.match(t.End, /Oct 10, 2026 · 11:30/);
  assert.equal(t.Timezone, "America/Denver");
});

// ---- outcome decision (6) ----
test("decideCreateOutcome: staged vs created vs existing are distinct", () => {
  assert.equal(decideCreateOutcome(CREATE_RESULT_STAGED).kind, "staged");
  const c = decideCreateOutcome(CREATE_RESULT_CREATED);
  assert.equal(c.kind, "created");
  assert.match(c.link, /^https:\/\/calendar\.google\.com/);
  assert.equal(decideCreateOutcome(CREATE_RESULT_EXISTING).kind, "existing");
  assert.equal(decideCreateOutcome({ ok: true, kind: "created", event: { htmlLink: "javascript:alert(1)" } }).link, "");
});
test("decideCreateOutcome: unknown/network lock; proven noncreation releases only without a prior unknown", () => {
  assert.equal(decideCreateOutcome(null).release, false);
  assert.equal(decideCreateOutcome({ error: "job_calendar_failed" }).step, "locked");
  assert.equal(decideCreateOutcome({ error: "stale_review" }).release, true);
  assert.equal(decideCreateOutcome({ error: "stale_review" }, { priorUnknown: true }).release, false);
  assert.equal(decideCreateOutcome(CREATE_RESULT_STAGED, { priorUnknown: true }).release, false);
  assert.equal(decideCreateOutcome({ ok: true, kind: "conflict_changed" }).release, false);
  assert.equal(isProvenNoncreation("job_calendar_failed"), false);
});
test("safeError never echoes raw codes or exception text", () => {
  assert.match(safeError("RAW_EXCEPTION: TypeError at x.js:1"), /^Something went wrong/);
  assert.equal(safeError(undefined).includes("undefined"), false);
});

// ---- frozen storage ----
test("readFrozen: malformed JSON, wrong version, invalid payload, other job are damaged", () => {
  const s = memStore();
  const k = frozenKey(U.id, JOB.id);
  s.m.set(k, "{not json");
  assert.equal(readFrozen(s, U.id, JOB.id).state, "damaged");
  s.m.set(k, JSON.stringify({ v: 2, status: "creating", priorUnknown: false, payload: reviewed() }));
  assert.equal(readFrozen(s, U.id, JOB.id).state, "damaged");
  s.m.set(k, JSON.stringify({ v: 1, status: "creating", priorUnknown: false, payload: { ...reviewed(), notes: "Labor $5" } }));
  assert.equal(readFrozen(s, U.id, JOB.id).state, "damaged");
  s.m.set(k, JSON.stringify({ v: 1, status: "creating", priorUnknown: false, payload: { ...reviewed(), job_id: "6a8229a9801b2aef9278ff48" } }));
  assert.equal(readFrozen(s, U.id, JOB.id).state, "damaged");
  assert.equal(writeFrozen(s, U.id, JOB.id, { v: 1, status: "creating", priorUnknown: false, payload: reviewed() }), true);
  assert.equal(readFrozen(s, U.id, JOB.id).state, "locked");
});

// ---- controller lifecycle (B) ----
test("controller: freezes the complete reviewed payload BEFORE the call and sends exactly it", async () => {
  const store = memStore();
  let frozenAtCall = null;
  const invoke = async (name, body) => { frozenAtCall = store.getItem(frozenKey(U.id, JOB.id)); return { data: CREATE_RESULT_STAGED }; };
  const ctrl = createVisitController({ store, invoke });
  const p = reviewed();
  const r = await ctrl.submit(U.id, JOB.id, p);
  assert.equal(JSON.parse(frozenAtCall).payload.title, JOB.canonical_name);
  assert.deepEqual(JSON.parse(frozenAtCall).payload, p);
  assert.equal(r.kind, "staged");
  assert.equal(store.getItem(frozenKey(U.id, JOB.id)), null); // released after a proven outcome
});
test("controller: storage write failure stops before any call", async () => {
  const { invoke, calls } = fakeInvoke([]);
  const r = await createVisitController({ store: memStore({ failWrites: true }), invoke }).submit(U.id, JOB.id, reviewed());
  assert.equal(r.sent, false);
  assert.match(r.error, /nothing was sent/);
  assert.equal(calls.length, 0);
});
test("controller: malformed frozen data stops before any call", async () => {
  const store = memStore();
  store.m.set(frozenKey(U.id, JOB.id), "{broken");
  const { invoke, calls } = fakeInvoke([]);
  const ctrl = createVisitController({ store, invoke });
  assert.equal((await ctrl.retry(U.id, JOB.id)).step, "damaged");
  assert.equal((await ctrl.submit(U.id, JOB.id, reviewed())).step, "damaged");
  assert.equal(calls.length, 0);
});
test("controller: double submit is ignored synchronously (one call)", async () => {
  const { invoke, calls } = fakeInvoke([{ data: CREATE_RESULT_STAGED }]);
  const ctrl = createVisitController({ store: memStore(), invoke });
  const a = ctrl.submit(U.id, JOB.id, reviewed());
  const b = ctrl.submit(U.id, JOB.id, reviewed());
  assert.equal(ctrl.isInflight(), true);
  assert.equal((await b).ignored, true);
  await a;
  assert.equal(calls.length, 1);
});
test("controller: unknown locks; reload + changed job props still retry byte-equivalent payload", async () => {
  const store = memStore();
  const { invoke, calls } = fakeInvoke([new Error("network"), { data: { error: "job_calendar_failed" } }]);
  const first = await createVisitController({ store, invoke }).submit(U.id, JOB.id, reviewed());
  assert.equal(first.step, "locked");
  // "reload": new controller, and the job was renamed / re-addressed meanwhile
  const ctrl2 = createVisitController({ store, invoke });
  assert.equal(ctrl2.load(U.id, JOB.id).state, "locked");
  const renamed = reviewed({}, { ...JOB, canonical_name: "Renamed", address: "Elsewhere" });
  const second = await ctrl2.submit(U.id, JOB.id, renamed); // a new payload cannot replace the frozen one
  assert.equal(second.step, "locked");
  assert.equal(calls.length, 2);
  assert.equal(calls[0], calls[1]); // byte-equivalent
  assert.equal(JSON.parse(calls[1]).payload.title, JOB.canonical_name);
});
test("controller: after an unknown, a rejection does not release (no new id)", async () => {
  const store = memStore();
  const { invoke } = fakeInvoke([null, { data: { error: "stale_review" } }]);
  const ctrl = createVisitController({ store, invoke });
  assert.equal((await ctrl.submit(U.id, JOB.id, reviewed())).step, "locked");
  const r = await ctrl.retry(U.id, JOB.id);
  assert.equal(r.release, false);
  assert.equal(ctrl.load(U.id, JOB.id).record.priorUnknown, true);
});
test("controller: reconciled created releases and returns the provider link", async () => {
  const store = memStore();
  const { invoke } = fakeInvoke([null, { data: CREATE_RESULT_CREATED }]);
  const ctrl = createVisitController({ store, invoke });
  await ctrl.submit(U.id, JOB.id, reviewed());
  const r = await ctrl.retry(U.id, JOB.id);
  assert.equal(r.kind, "created");
  assert.match(r.link, /calendar\.google\.com/);
  assert.equal(ctrl.load(U.id, JOB.id).state, "none");
});
test("controller: results carry the captured user/job key (job switch isolation)", async () => {
  const store = memStore();
  let release;
  const invoke = () => new Promise((res) => { release = () => res({ data: { error: "job_calendar_failed" } }); });
  const ctrl = createVisitController({ store, invoke });
  const pending = ctrl.submit(U.id, JOB.id, reviewed());
  await new Promise((r) => setTimeout(r, 0));
  const otherJob = "6a8229a9801b2aef9278ff48";
  assert.equal(ctrl.load(U.id, otherJob).state, "none"); // new job sees no lock
  release();
  const r = await pending;
  assert.equal(r.key, `${U.id}:${JOB.id}`); // the modal ignores it when a different key is on screen
  assert.equal(ctrl.load(U.id, JOB.id).state, "locked");
  assert.equal(ctrl.load(U.id, otherJob).state, "none");
});
test("controller: invalid reviewed payload or missing store sends nothing", async () => {
  const { invoke, calls } = fakeInvoke([]);
  assert.equal((await createVisitController({ store: memStore(), invoke }).submit(U.id, JOB.id, reviewed({ notes: "Precio 300" }))).sent, false);
  assert.equal((await createVisitController({ store: null, invoke }).submit(U.id, JOB.id, reviewed())).sent, false);
  assert.equal(calls.length, 0);
});

// ---- preview fixtures ----
test("fixtures: valid Beaver review payloads, results, upcoming states", () => {
  assert.equal(validateReviewed(CREATE_REVIEW_FIXTURE).ok, true);
  assert.equal(validateReviewed(CREATE_REVIEW_TIMED_FIXTURE).ok, true);
  assert.equal(CREATE_REVIEW_FIXTURE.job_id, JOB.id);
  assert.equal(CREATE_RESULT_STAGED.disabled, true);
  assert.equal(UPCOMING_STATES.list.events.length, 1);
  assert.ok(newRequestId() !== newRequestId());
});