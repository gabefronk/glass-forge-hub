// Pure injected tests for the scoped job-calendar core. No live data, no network.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as core from "../base44/shared/jobCalendarCore.js";
import { validateReviewed } from "../src/lib/jobCalendarValidate.js";

const sha256 = (s) => createHash("sha256").update(String(s)).digest("hex");
const NOW = new Date("2026-10-06T20:00:00Z"); // 14:00 Denver on Tue Oct 6 2026
const TODAY = "2026-10-06";

const JOB = { id: "6a817395914bfa31ecd0f1f6", canonical_name: "Beaver - 412", address: "1497 E 200 N St, Beaver, UT 84713" };
const OTHER = { id: "6a8229a9801b2aef9278ff48", canonical_name: "Beaver - 412" };
const OWNER = "6a7f0d834a5f825c724273ea";
const B32H_RE = /^[0-9a-v]+$/;

function ev({ id = "evt1", summary = "beaver - finish up install trim items", description = "", location = "1497 E 200 N St, Beaver, UT 84713", start, end, status, priv } = {}) {
  const e = { id, summary, location, start: start || { date: "2026-10-10" }, end: end || { date: "2026-10-11" }, htmlLink: "https://calendar.google.com/event?eid=x", organizer: { email: "iryedra@gmail.com" } };
  if (status) e.status = status;
  if (description) e.description = description;
  if (priv) e.extendedProperties = { private: priv };
  return e;
}

// A complete, valid reviewed payload (all-day by default).
function pl(over = {}) {
  return { job_id: JOB.id, owner_id: OWNER, request_id: "req-00000001", all_day: true, start_date: "2026-10-10", end_date: "2026-10-10", start_time: null, end_time: null, time_zone: "America/Denver", title: JOB.canonical_name, address: JOB.address, notes: "Finish trim", confirm_no_jobsite: false, ...over };
}
const timed = (over = {}) => pl({ all_day: false, start_time: "09:00", end_time: "11:00", ...over });

// ---- auth / denver ----
test("isOwner: only the two configured owner ids pass", () => {
  assert.equal(core.isOwner({ id: OWNER }), true);
  assert.equal(core.isOwner({ id: "6a8229a9801b2aef9278ff47" }), true);
  assert.equal(core.isOwner({ id: "x" }), false);
  assert.equal(core.isOwner(null), false);
});
test("denverDate: inlined helper converts to America/Denver", () => {
  assert.equal(core.denverDate(NOW), "2026-10-06");
});

// ---- explicit identities ----
test("extractExplicitJobId: private property hubJobId", () => {
  const r = core.extractExplicitJobId(ev({ priv: { hubJobId: JOB.id } }));
  assert.equal(r.jobId, JOB.id);
  assert.equal(r.source, "property");
});
test("extractExplicitJobId: allowlisted URLs on both hosts", () => {
  assert.equal(core.extractExplicitJobId(ev({ description: `See https://gfglassforge.com/jobs/${JOB.id} now` })).jobId, JOB.id);
  assert.equal(core.extractExplicitJobId(ev({ description: `https://glass-forge-hub.base44.app/jobs/${JOB.id}` })).host, "glass-forge-hub.base44.app");
});
test("extractExplicitJobId: property + URL with the same id = one identity", () => {
  const r = core.extractExplicitJobId(ev({ priv: { hubJobId: JOB.id }, description: `https://gfglassforge.com/jobs/${JOB.id}` }));
  assert.equal(r.conflict, false);
  assert.equal(r.jobId, JOB.id);
});
test("extractExplicitJobId: two different links = conflict", () => {
  const r = core.extractExplicitJobId(ev({ description: `https://gfglassforge.com/jobs/${JOB.id} https://gfglassforge.com/jobs/${OTHER.id}` }));
  assert.equal(r.conflict, true);
  assert.equal(r.jobId, null);
});
test("extractExplicitJobId: property vs URL conflict", () => {
  assert.equal(core.extractExplicitJobId(ev({ priv: { hubJobId: JOB.id }, description: `https://gfglassforge.com/jobs/${OTHER.id}` })).conflict, true);
});
test("extractExplicitJobId: malformed suffix / short path / bad property", () => {
  assert.equal(core.extractExplicitJobId(ev({ description: `https://gfglassforge.com/jobs/${JOB.id}/edit` })).malformed, true);
  assert.equal(core.extractExplicitJobId(ev({ description: "https://gfglassforge.com/jobs/short" })).malformed, true);
  assert.equal(core.extractExplicitJobId(ev({ priv: { hubJobId: "not24hex" } })).malformed, true);
});
test("extractExplicitJobId: query-embedded redirect only matches the outer id", () => {
  const r = core.extractExplicitJobId(ev({ description: `https://gfglassforge.com/jobs/${JOB.id}?next=https://gfglassforge.com/jobs/${OTHER.id}` }));
  assert.equal(r.conflict, false);
  assert.equal(r.jobId, JOB.id);
});
test("extractExplicitJobId: wrong host ignored; inline hex ignored; trailing punct trimmed", () => {
  assert.equal(core.extractExplicitJobId(ev({ description: "https://example.com/jobs/" + JOB.id })), null);
  assert.equal(core.extractExplicitJobId(ev({ description: "see job " + JOB.id })), null);
  assert.equal(core.extractExplicitJobId(ev({ description: `See https://gfglassforge.com/jobs/${JOB.id}).` })).jobId, JOB.id);
});

// ---- match rules ----
test("matchEventToJob: property / url / foreign / conflict / malformed", () => {
  assert.equal(core.matchEventToJob(ev({ priv: { hubJobId: JOB.id } }), JOB).match, true);
  assert.equal(core.matchEventToJob(ev({ description: "https://gfglassforge.com/jobs/" + JOB.id }), JOB).match, true);
  assert.equal(core.matchEventToJob(ev({ priv: { hubJobId: OTHER.id } }), JOB).reason, "foreign_explicit");
  assert.equal(core.matchEventToJob(ev({ description: `https://gfglassforge.com/jobs/${JOB.id} https://gfglassforge.com/jobs/${OTHER.id}` }), JOB).reason, "identity_conflict");
  assert.equal(core.matchEventToJob(ev({ summary: "Beaver - 412", description: `https://gfglassforge.com/jobs/${JOB.id}/edit` }), JOB, core.nameUniquenessIndex([JOB])).reason, "identity_malformed");
});
test("matchEventToJob: unique / ambiguous / substring / alias names", () => {
  assert.equal(core.matchEventToJob(ev({ summary: "Beaver - 412" }), JOB, core.nameUniquenessIndex([JOB, { id: "z9", canonical_name: "Other" }])).reason, "name_unique");
  assert.equal(core.matchEventToJob(ev({ summary: "Beaver - 412" }), JOB, core.nameUniquenessIndex([JOB, OTHER])).reason, "name_ambiguous");
  assert.equal(core.matchEventToJob(ev({ summary: "beaver" }), JOB, core.nameUniquenessIndex([JOB])).match, false);
  const job = { id: "j1", canonical_name: "Pulte - 12 Elm", aliases: ["Pulte Homes - 12 Elm St"] };
  assert.equal(core.matchEventToJob(ev({ summary: "Pulte Homes - 12 Elm St" }), job, core.nameUniquenessIndex([job])).match, true);
});

// ---- survivor (async) ----
test("resolveSurvivor: async chain, cycle, missing, real async adapter", async () => {
  const db = new Map([["a", { id: "a", merged_into: "b" }], ["b", { id: "b", merged_into: "c" }], ["c", { id: "c" }]]);
  assert.equal((await core.resolveSurvivor("a", async (id) => db.get(id))).id, "c");
  const cyc = new Map([["a", { id: "a", merged_into: "b" }], ["b", { id: "b", merged_into: "a" }]]);
  assert.equal((await core.resolveSurvivor("a", async (id) => cyc.get(id))).cycled, true);
  assert.equal((await core.resolveSurvivor("nope", async () => null)).missing, true);
  let calls = 0;
  const r = await core.resolveSurvivor("a", async (id) => { calls++; await new Promise((res) => setTimeout(res, 1)); return { id, merged_into: id === "a" ? "b" : null }; });
  assert.equal(r.id, "b");
  assert.equal(calls, 2);
});

// ---- upcoming ----
test("isUpcoming: all-day today/future in, past out; timed finished out; cancelled out", () => {
  assert.equal(core.isUpcoming(ev({ start: { date: TODAY } }), NOW, TODAY), true);
  assert.equal(core.isUpcoming(ev({ start: { date: "2026-10-05" } }), NOW, TODAY), false);
  assert.equal(core.isUpcoming(ev({ start: { dateTime: "2026-10-06T15:00:00Z" }, end: { dateTime: "2026-10-06T16:00:00Z" } }), NOW, TODAY), false);
  assert.equal(core.isUpcoming(ev({ start: { dateTime: "2026-10-06T22:00:00Z" }, end: { dateTime: "2026-10-06T23:00:00Z" } }), NOW, TODAY), true);
  assert.equal(core.isUpcoming(ev({ status: "cancelled" }), NOW, TODAY), false);
});
test("buildUpcomingRead: scoped, stale mirror, cancelled, dedupe, sort", () => {
  const idx = core.nameUniquenessIndex([JOB, { id: "o", canonical_name: "Other" }]);
  const live = [
    ev({ id: "late", summary: "Beaver - 412", start: { dateTime: "2026-10-06T15:00:00Z" }, end: { dateTime: "2026-10-06T16:00:00Z" } }),
    ev({ id: "next", summary: "Beaver - 412", start: { dateTime: "2026-10-06T22:00:00Z" }, end: { dateTime: "2026-10-06T23:00:00Z" } }),
    ev({ id: "sat", summary: "Beaver - 412" }),
    ev({ id: "oth", summary: "Other" }),
    ev({ id: "cx", summary: "Beaver - 412", status: "cancelled" }),
  ];
  const mirror = [{ google_event_id: "sat", job_id: JOB.id, source_status: "confirmed" }, { google_event_id: "GONE", job_id: JOB.id, source_status: "confirmed" }, { google_event_id: "cx", job_id: JOB.id, source_status: "confirmed" }];
  const { events } = core.buildUpcomingRead({ liveAll: live, mirrorRows: mirror, job: JOB, nameIndex: idx, now: NOW, todayDenver: TODAY });
  assert.deepEqual(events.map((e) => e.id), ["next", "sat"]);
});
test("buildUpcomingRead: owner-confirmed mirror shows a live event with no explicit identity", () => {
  const live = [ev({ id: "L1", summary: "beaver - finish up install trim items" })];
  const mirror = [{ google_event_id: "L1", job_id: JOB.id, source_status: "confirmed" }];
  const { events } = core.buildUpcomingRead({ liveAll: live, mirrorRows: mirror, job: JOB, nameIndex: core.nameUniquenessIndex([JOB, OTHER]), now: NOW, todayDenver: TODAY });
  assert.equal(events.length, 1);
});
test("buildUpcomingRead: mirror link never surfaces a FOREIGN explicit identity", () => {
  const live = [ev({ id: "L1", summary: "x", priv: { hubJobId: OTHER.id } })];
  const mirror = [{ google_event_id: "L1", job_id: JOB.id, source_status: "confirmed" }];
  const before = JSON.stringify(mirror);
  const { events } = core.buildUpcomingRead({ liveAll: live, mirrorRows: mirror, job: JOB, nameIndex: core.nameUniquenessIndex([JOB]), now: NOW, todayDenver: TODAY });
  assert.equal(events.length, 0);
  assert.equal(JSON.stringify(mirror), before); // mirror rows not modified
});
test("buildUpcomingRead: mirror link never surfaces a CONFLICTING or MALFORMED identity", () => {
  const live = [
    ev({ id: "C1", summary: "x", description: `https://gfglassforge.com/jobs/${JOB.id} https://gfglassforge.com/jobs/${OTHER.id}` }),
    ev({ id: "M1", summary: "x", description: `https://gfglassforge.com/jobs/${JOB.id}/edit` }),
  ];
  const mirror = [{ google_event_id: "C1", job_id: JOB.id, source_status: "confirmed" }, { google_event_id: "M1", job_id: JOB.id, source_status: "confirmed" }];
  const { events } = core.buildUpcomingRead({ liveAll: live, mirrorRows: mirror, job: JOB, nameIndex: core.nameUniquenessIndex([JOB]), now: NOW, todayDenver: TODAY });
  assert.equal(events.length, 0);
});
test("shapeUpcomingEvent: read path strips/flags provider pricing; surviving $ fails closed", () => {
  const s = core.shapeUpcomingEvent(ev({ description: "Finish trim\nLabor $500\nTotal $750" }), JOB);
  assert.ok(!s.purpose.includes("$"));
  assert.match(s.purpose, /Finish trim/);
  assert.equal(s.flagged, true);
  const f = core.shapeUpcomingEvent(ev({ description: "Finish trim $5 mid line" }), JOB);
  assert.equal(f.purpose, "");
  assert.equal(f.flagged, true);
});

// ---- pagination ----
test("paginateGoogleEvents: single, multi, loop, http, shape", async () => {
  const ok = (data) => ({ ok: true, status: 200, json: async () => data });
  assert.equal((await core.paginateGoogleEvents(async () => ok({ items: [ev({ id: "a" })] }))).items.length, 1);
  let n = 0;
  const multi = await core.paginateGoogleEvents(async (t) => { n++; return t ? ok({ items: [ev({ id: "b" })] }) : ok({ items: [ev({ id: "a" })], nextPageToken: "T2" }); });
  assert.equal(multi.items.length, 2);
  assert.equal(n, 2);
  assert.equal((await core.paginateGoogleEvents(async () => ok({ items: [], nextPageToken: "T" }))).error.kind, "loop");
  assert.equal((await core.paginateGoogleEvents(async () => ({ ok: false, status: 503 }))).error.status, 503);
  assert.equal((await core.paginateGoogleEvents(async () => ok({ error: { message: "bad" } }))).error.kind, "shape");
});

// ---- deterministic id + fingerprint ----
test("deterministicId: stable, base32hex, differs per request", async () => {
  const a = await core.deterministicId(OWNER, "req-00000001", { sha256 });
  assert.equal(a, await core.deterministicId(OWNER, "req-00000001", { sha256 }));
  assert.notEqual(a, await core.deterministicId(OWNER, "req-00000002", { sha256 }));
  assert.match(a, B32H_RE);
});
test("fingerprint covers exactly provider fields: title, address, notes, start, end", async () => {
  const h = (p) => core.fingerprintHash(p, { sha256 });
  const base = await h(pl());
  assert.equal(base, await h(pl()));
  for (const over of [{ title: "X" }, { address: "B" }, { notes: "other" }, { end_date: "2026-10-11" }]) {
    assert.notEqual(base, await h(pl(over)), JSON.stringify(over));
  }
  assert.equal(base, await h(pl({ confirm_no_jobsite: true }))); // not a provider field
  // timed: the zone is carried on start/end, so it changes the fingerprint; all-day dates carry no zone
  assert.notEqual(await h(timed()), await h(timed({ time_zone: "America/Chicago" })));
  assert.notEqual(await h(timed()), await h(timed({ end_time: "11:30" })));
});

// ---- strict validation (A) ----
test("validateCreatePayload: valid all-day and valid timed", () => {
  assert.equal(core.validateCreatePayload(pl()).ok, true);
  assert.equal(core.validateCreatePayload(timed()).ok, true);
});
test("validateCreatePayload: exact boolean all_day, typed bounded strings, unexpected fields", () => {
  assert.ok(core.validateCreatePayload(pl({ all_day: "true" })).errors.includes("invalid_all_day"));
  assert.ok(core.validateCreatePayload(pl({ request_id: "r" })).errors.includes("invalid_request_id"));
  assert.ok(core.validateCreatePayload(pl({ request_id: 12345678 })).errors.includes("invalid_request_id"));
  assert.ok(core.validateCreatePayload(pl({ title: "" })).errors.includes("invalid_title"));
  assert.ok(core.validateCreatePayload(pl({ title: "x".repeat(201) })).errors.includes("invalid_title"));
  assert.ok(core.validateCreatePayload(pl({ address: 5 })).errors.includes("invalid_address"));
  assert.ok(core.validateCreatePayload(pl({ notes: "x".repeat(2001) })).errors.includes("invalid_notes"));
  assert.ok(core.validateCreatePayload(pl({ labor_amt: 100 })).errors.includes("unexpected_field"));
  assert.ok(core.validateCreatePayload(pl({ confirm_no_jobsite: "yes" })).errors.includes("invalid_confirm_no_jobsite"));
  assert.ok(core.validateCreatePayload(pl(), { ownerId: "6a8229a9801b2aef9278ff47" }).errors.includes("owner_mismatch"));
});
test("validateCreatePayload: IANA zone checked with Intl", () => {
  assert.equal(core.validateCreatePayload(pl({ time_zone: "America/Chicago" })).ok, true);
  assert.ok(core.validateCreatePayload(pl({ time_zone: "Not/A_Zone" })).errors.includes("invalid_time_zone"));
  assert.ok(core.validateCreatePayload(pl({ time_zone: "America/Atlantis" })).errors.includes("invalid_time_zone"));
});
test("validateCreatePayload: real dates, ordering, range", () => {
  assert.ok(core.validateCreatePayload(pl({ start_date: "2026-02-30", end_date: "2026-02-30" })).errors.includes("invalid_start_date"));
  assert.deepEqual(core.validateCreatePayload(pl({ end_date: "2026-10-09" })).errors, ["end_before_start"]);
  assert.deepEqual(core.validateCreatePayload(pl({ end_date: "2026-12-31" })).errors, ["range_too_long"]);
  assert.deepEqual(core.validateCreatePayload(pl({ start_time: "09:00" })).errors, ["times_not_allowed_all_day"]);
});
test("validateCreatePayload: timed needs explicit end; overnight and multiday valid; zero-length rejected", () => {
  assert.ok(core.validateCreatePayload(timed({ end_time: null })).errors.includes("invalid_end_time"));
  assert.equal(core.validateCreatePayload(timed({ start_time: "23:30", end_date: "2026-10-11", end_time: "00:30" })).ok, true);
  assert.equal(core.validateCreatePayload(timed({ end_date: "2026-10-12", end_time: "17:00" })).ok, true);
  assert.deepEqual(core.validateCreatePayload(timed({ end_time: "09:00" })).errors, ["end_not_after_start"]);
  assert.deepEqual(core.validateCreatePayload(timed({ start_time: "23:30", end_time: "00:30" })).errors, ["end_not_after_start"]); // same date, no silent rollover
});
test("validateCreatePayload: DST gap and overlap rejected for explicit correction (Denver 2026)", () => {
  assert.ok(core.validateCreatePayload(timed({ start_date: "2026-03-08", end_date: "2026-03-08", start_time: "02:30", end_time: "04:00" })).errors.includes("start_time_nonexistent"));
  assert.ok(core.validateCreatePayload(timed({ start_date: "2026-11-01", end_date: "2026-11-01", start_time: "01:30", end_time: "03:00" })).errors.includes("start_time_ambiguous"));
  assert.ok(core.validateCreatePayload(timed({ start_date: "2026-03-08", end_date: "2026-03-08", start_time: "01:00", end_time: "02:15" })).errors.includes("end_time_nonexistent"));
  assert.equal(core.validateCreatePayload(timed({ start_date: "2026-03-08", end_date: "2026-03-08", start_time: "01:00", end_time: "03:30" })).ok, true);
});

// ---- notes pricing (D): blocked, never removed ----
test("notes: $, labor cost, Spanish pricing blocked; install measurements pass", () => {
  for (const n of ["Labor $500", "Paid 200 dollars", "Labor cost 450", "Total 750", "Precio 300", "Costo de mano de obra 200", "Cobro 150 al cliente", "Pago 80 dólares"]) {
    assert.ok(core.validateCreatePayload(pl({ notes: n })).errors.includes("notes_contain_pricing"), n);
  }
  for (const n of ["Install 36x48 window, 3/4\" trim", "12 ft header, 2 screens", "Instalar 2 ventanas de 36x48", "Repaso: instalar molduras", "Caulk 4 windows, bring 8ft ladder"]) {
    assert.equal(core.validateCreatePayload(pl({ notes: n })).ok, true, n);
  }
  assert.deepEqual(core.notesPricingLines("Finish trim\nLabor $500"), ["Labor $500"]);
});
test("buildCreateEventBody refuses pricing notes even on a direct call", () => {
  assert.throws(() => core.buildCreateEventBody({ payload: pl({ notes: "Labor $500" }), fingerprint: "fp", eventId: "eid" }), /notes_contain_pricing/);
});

// ---- stale review (A) ----
test("verifyReviewedJob: stale title/address, merged, missing, empty jobsite", () => {
  assert.equal(core.verifyReviewedJob({ payload: pl(), job: JOB }).ok, true);
  assert.equal(core.verifyReviewedJob({ payload: pl(), job: { ...JOB, canonical_name: "Beaver - 412 Renamed" } }).error, "stale_review");
  assert.equal(core.verifyReviewedJob({ payload: pl(), job: { ...JOB, address: "New addr" } }).error, "stale_review");
  assert.equal(core.verifyReviewedJob({ payload: pl(), job: { ...JOB, merged_into: OTHER.id } }).error, "job_merged");
  assert.equal(core.verifyReviewedJob({ payload: pl(), job: null }).error, "job_not_found");
  const nj = { ...JOB, address: "" };
  assert.equal(core.verifyReviewedJob({ payload: pl({ address: "" }), job: nj }).error, "jobsite_required");
  assert.equal(core.verifyReviewedJob({ payload: pl({ address: "", confirm_no_jobsite: true }), job: nj }).ok, true);
});

// ---- effective date/time (C) ----
test("effectiveDateTime: all-day inclusive last day -> exclusive provider end", () => {
  const one = core.effectiveDateTime(pl());
  assert.deepEqual(one.end, { date: "2026-10-11" });
  const multi = core.effectiveDateTime(pl({ end_date: "2026-10-12" }));
  assert.equal(multi.last_day, "2026-10-12");
  assert.deepEqual(multi.end, { date: "2026-10-13" });
  assert.equal(multi.multiday, true);
});
test("effectiveDateTime: timed uses explicit end_date + timezone", () => {
  const t = core.effectiveDateTime(timed({ start_time: "23:30", end_date: "2026-10-11", end_time: "00:30" }));
  assert.deepEqual(t.start, { dateTime: "2026-10-10T23:30:00", timeZone: "America/Denver" });
  assert.deepEqual(t.end, { dateTime: "2026-10-11T00:30:00", timeZone: "America/Denver" });
  assert.equal(t.overnight, true);
  const m = core.effectiveDateTime(timed({ end_date: "2026-10-12", end_time: "17:00" }));
  assert.equal(m.end.dateTime, "2026-10-12T17:00:00");
  assert.equal(m.multiday, true);
});
test("buildCreateEventBody: reviewed title/address, hub url, no attendees, no pricing fields", () => {
  const b = core.buildCreateEventBody({ payload: pl(), fingerprint: "fp", eventId: "eid" });
  assert.equal(b.summary, JOB.canonical_name);
  assert.equal(b.location, JOB.address);
  assert.match(b.description, /^Finish trim\nHub job: https:\/\/gfglassforge\.com\/jobs\/6a817395914bfa31ecd0f1f6$/);
  assert.deepEqual(b.attendees, []);
  assert.equal(b.extendedProperties.private.hubFingerprint, "fp");
  assert.ok(!/labor|fee_|price|cost/i.test(JSON.stringify(b)));
});

// ---- validator twin parity ----
test("frontend validateReviewed matches core validateCreatePayload", () => {
  const cases = [pl(), timed(), pl({ all_day: "true" }), pl({ notes: "Labor $500" }), pl({ end_date: "2026-10-09" }), timed({ end_time: "09:00" }),
    timed({ start_date: "2026-03-08", end_date: "2026-03-08", start_time: "02:30", end_time: "04:00" }), pl({ time_zone: "Bad/Zone" }), pl({ extra: 1 }), pl({ request_id: "short" })];
  for (const c of cases) assert.deepEqual(validateReviewed(c).errors, core.validateCreatePayload(c).errors, JSON.stringify(c));
});

// ---- create orchestration (E) ----
// Fake provider calendar keyed by event id. getEvent follows the contract
// { kind: 'found', event } | { kind: 'not_found' }.
function transport({ get = null, insert = null, store = new Map() } = {}) {
  const calls = { get: 0, insert: 0 };
  return {
    calls,
    store,
    getEvent: async (id) => { calls.get++; if (get) return get(id); return store.has(id) ? { kind: "found", event: store.get(id) } : { kind: "not_found" }; },
    insertEvent: async (body) => {
      calls.insert++;
      if (insert) return insert(body);
      if (store.has(body.id)) return { ok: false, status: 409 };
      const saved = { ...body, status: "confirmed", htmlLink: `https://calendar.google.com/event?eid=${body.id}` };
      store.set(body.id, saved);
      return { ok: true, status: 200, event: saved };
    },
  };
}
const run = (t, payload = pl(), job = JOB) => core.createEvent({ transport: t, job, payload, sha256 });
const fpOf = (p = pl()) => core.fingerprintHash(p, { sha256 });
const idOf = (p = pl()) => core.deterministicId(p.owner_id, p.request_id, { sha256 });
async function existing(over = {}, privOver = {}) {
  const p = pl();
  return { id: await idOf(p), status: "confirmed", htmlLink: "https://calendar.google.com/event?eid=e", extendedProperties: { private: { hubJobId: p.job_id, hubOwnerId: p.owner_id, hubRequestId: p.request_id, hubFingerprint: await fpOf(p), ...privOver } }, ...over };
}

test("createEvent: explicit not_found -> exactly one POST -> created with provider link", async () => {
  const t = transport();
  const r = await run(t);
  assert.equal(r.kind, "created");
  assert.equal(t.calls.get, 1);
  assert.equal(t.calls.insert, 1);
  assert.match(r.event.htmlLink, /^https:\/\/calendar\.google\.com/);
});
test("createEvent: rejected payload (pricing / stale title) makes ZERO transport calls", async () => {
  const t = transport();
  assert.equal((await run(t, pl({ notes: "Labor $500" }))).kind, "rejected");
  assert.deepEqual((await run(t, pl(), { ...JOB, canonical_name: "Renamed" })).errors, ["stale_review"]);
  assert.equal(t.calls.get + t.calls.insert, 0);
});
test("createEvent: malformed / nullish / error GET stays unknown with no POST", async () => {
  for (const g of [() => null, () => undefined, () => ({}), () => ({ kind: "error" }), () => ({ kind: "found" }), () => ({ kind: "found", event: { id: "wrong" } }), () => { throw new Error("net"); }]) {
    const t = transport({ get: g });
    assert.equal((await run(t)).kind, "unknown");
    assert.equal(t.calls.insert, 0);
  }
});
test("createEvent: response loss -> unknown; retry GET-reconciles the SAME id (no second POST)", async () => {
  const store = new Map();
  const lossy = transport({ store, insert: async (body) => { store.set(body.id, { ...body, status: "confirmed", htmlLink: "https://calendar.google.com/e" }); throw new Error("timeout"); } });
  const r1 = await run(lossy);
  assert.equal(r1.kind, "unknown");
  const t2 = transport({ store });
  const r2 = await run(t2);
  assert.equal(r2.kind, "existing_match");
  assert.equal(r2.event_id, r1.event_id);
  assert.equal(t2.calls.insert, 0);
  assert.equal(store.size, 1);
});
test("createEvent: success response must match expected id/identity/fingerprint, else unknown", async () => {
  const eid = await idOf();
  const fp = await fpOf();
  const good = (b) => ({ ...b, htmlLink: "https://calendar.google.com/e" });
  const bad = [
    () => ({ ok: true, status: 200, event: {} }),
    () => ({ ok: true, status: 200 }),
    (b) => ({ ok: true, status: 200, event: { ...good(b), id: "otherid" } }),
    (b) => ({ ok: true, status: 200, event: { ...good(b), extendedProperties: { private: { ...b.extendedProperties.private, hubJobId: OTHER.id } } } }),
    (b) => ({ ok: true, status: 200, event: { ...good(b), extendedProperties: { private: { ...b.extendedProperties.private, hubFingerprint: "x" } } } }),
    (b) => ({ ok: true, status: 200, event: { ...b } }), // no htmlLink
    () => ({ ok: false, status: 500 }),
  ];
  for (const ins of bad) assert.equal((await run(transport({ insert: async (b) => ins(b) }))).kind, "unknown");
  const ok = await run(transport({ insert: async (b) => ({ ok: true, status: 200, event: good(b) }) }));
  assert.equal(ok.kind, "created");
  assert.equal(ok.event_id, eid);
  assert.equal(ok.fingerprint, fp);
});
test("createEvent: changed same request -> conflict_changed, no POST", async () => {
  const ev1 = await existing({}, { hubFingerprint: "old" });
  const t = transport({ get: () => ({ kind: "found", event: ev1 }) });
  assert.equal((await run(t)).kind, "conflict_changed");
  assert.equal(t.calls.insert, 0);
});
test("createEvent: foreign event at the id -> foreign, no POST", async () => {
  const ev1 = await existing({}, { hubJobId: OTHER.id });
  const t = transport({ get: () => ({ kind: "found", event: ev1 }) });
  assert.equal((await run(t)).kind, "foreign");
  assert.equal(t.calls.insert, 0);
});
test("createEvent: cancelled tombstone -> deleted, never recreated", async () => {
  const ev1 = await existing({ status: "cancelled" });
  const t = transport({ get: () => ({ kind: "found", event: ev1 }) });
  assert.equal((await run(t)).kind, "deleted");
  assert.equal(t.calls.insert, 0);
});
test("createEvent: 409 -> re-GET reconcile; 409 with nothing found -> unknown", async () => {
  const ev1 = await existing();
  let g = 0;
  const t = transport({ get: () => (++g === 1 ? { kind: "not_found" } : { kind: "found", event: ev1 }), insert: async () => ({ ok: false, status: 409 }) });
  assert.equal((await run(t)).kind, "existing_match");
  assert.equal(t.calls.get, 2);
  const t2 = transport({ insert: async () => ({ ok: false, status: 409 }) });
  assert.equal((await run(t2)).kind, "unknown");
});
test("createEvent: concurrent same request -> one stored event, one created + one existing_match", async () => {
  const store = new Map();
  const t = transport({ store });
  const [a, b] = await Promise.all([run(t), run(t)]);
  assert.deepEqual([a.kind, b.kind].sort(), ["created", "existing_match"]);
  assert.equal(store.size, 1);
  assert.equal(a.event_id, b.event_id);
});
test("createEvent: POST body has no attendees, copies, labor or FeeLines", async () => {
  let saved;
  const t = transport({ insert: async (b) => { saved = b; return { ok: true, status: 200, event: { ...b, htmlLink: "https://calendar.google.com/e" } }; } });
  await run(t);
  assert.deepEqual(saved.attendees, []);
  assert.ok(!/fee_line|labor|installer/i.test(JSON.stringify(saved)));
});