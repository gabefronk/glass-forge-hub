// Pure injected tests for the scoped job-calendar core. No live data, no network.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as core from "../base44/shared/jobCalendarCore.js";

const sha256 = (s) => createHash("sha256").update(String(s)).digest("hex");
const NOW = new Date("2026-10-06T20:00:00Z"); // 14:00 Denver on Tue Oct 6 2026
const TODAY = "2026-10-06";

const JOB = { id: "6a817395914bfa31ecd0f1f6", canonical_name: "Beaver - 412", address: "1497 E 200 N St, Beaver, UT 84713" };
const OTHER = { id: "6a8229a9801b2aef9278ff48", canonical_name: "Beaver - 412" }; // same name, different id → name not unique
const B32H_RE = /^[0-9a-v]+$/;

function ev({ id = "evt1", summary = "beaver - finish up install trim items", description = "", location = "1497 E 200 N St, Beaver, UT 84713", start, end, status, priv } = {}) {
  const e = { id, summary, location, start: start || { date: "2026-10-10" }, end: end || { date: "2026-10-11" }, htmlLink: "https://calendar.google.com/event?eid=x", organizer: { email: "iryedra@gmail.com" } };
  if (status) e.status = status;
  if (description) e.description = description;
  if (priv) e.extendedProperties = { private: priv };
  return e;
}

// ---- auth / owner gate ----
test("isOwner: only the two configured owner ids pass", () => {
  assert.equal(core.isOwner({ id: "6a7f0d834a5f825c724273ea" }), true);
  assert.equal(core.isOwner({ id: "6a8229a9801b2aef9278ff47" }), true);
  assert.equal(core.isOwner({ id: "x" }), false);
  assert.equal(core.isOwner(null), false);
});

// ---- denverDate inlined (no billingCore dependency) ----
test("denverDate: inlined helper converts to America/Denver", () => {
  // 2026-10-06T20:00:00Z = 14:00 Denver Oct 6
  assert.equal(core.denverDate(NOW), "2026-10-06");
});

// ---- explicit job id extraction: collect ALL, reject conflict/malformed ----
test("extractExplicitJobId: private property hubJobId (exact 24-hex)", () => {
  const r = core.extractExplicitJobId(ev({ priv: { hubJobId: JOB.id } }));
  assert.equal(r.jobId, JOB.id);
  assert.equal(r.source, "property");
});
test("extractExplicitJobId: allowlisted gfglassforge.com URL in description", () => {
  const r = core.extractExplicitJobId(ev({ description: `See https://gfglassforge.com/jobs/${JOB.id} for details` }));
  assert.equal(r.jobId, JOB.id);
  assert.equal(r.source, "url");
  assert.equal(r.host, "gfglassforge.com");
});
test("extractExplicitJobId: legacy glass-forge-hub.base44.app URL also allowlisted", () => {
  const r = core.extractExplicitJobId(ev({ description: `Hub: https://glass-forge-hub.base44.app/jobs/${JOB.id}` }));
  assert.equal(r.jobId, JOB.id);
  assert.equal(r.host, "glass-forge-hub.base44.app");
});
test("extractExplicitJobId: property + URL with the SAME id = one identity", () => {
  const r = core.extractExplicitJobId(ev({ priv: { hubJobId: JOB.id }, description: `https://gfglassforge.com/jobs/${JOB.id}` }));
  assert.equal(r.conflict, false);
  assert.equal(r.jobId, JOB.id);
});
test("extractExplicitJobId: two DIFFERENT links = conflict (not first-wins)", () => {
  const r = core.extractExplicitJobId(ev({ description: `https://gfglassforge.com/jobs/${JOB.id} https://gfglassforge.com/jobs/${OTHER.id}` }));
  assert.equal(r.conflict, true);
  assert.equal(r.jobId, null);
  assert.ok(r.ids.includes(JOB.id) && r.ids.includes(OTHER.id));
});
test("extractExplicitJobId: property vs URL conflict", () => {
  const r = core.extractExplicitJobId(ev({ priv: { hubJobId: JOB.id }, description: `https://gfglassforge.com/jobs/${OTHER.id}` }));
  assert.equal(r.conflict, true);
});
test("extractExplicitJobId: malformed suffix /jobs/<id>/edit rejected (not matched)", () => {
  const r = core.extractExplicitJobId(ev({ description: `https://gfglassforge.com/jobs/${JOB.id}/edit` }));
  assert.equal(r.malformed, true);
  assert.equal(r.jobId, null);
});
test("extractExplicitJobId: malformed short path rejected", () => {
  const r = core.extractExplicitJobId(ev({ description: "https://gfglassforge.com/jobs/short" }));
  assert.equal(r.malformed, true);
});
test("extractExplicitJobId: malformed property hubJobId rejected", () => {
  const r = core.extractExplicitJobId(ev({ priv: { hubJobId: "not24hex" } }));
  assert.equal(r.malformed, true);
});
test("extractExplicitJobId: query-embedded redirect URL only matches the outer id", () => {
  const r = core.extractExplicitJobId(ev({ description: `https://gfglassforge.com/jobs/${JOB.id}?next=https://gfglassforge.com/jobs/${OTHER.id}` }));
  assert.equal(r.conflict, false);
  assert.equal(r.malformed, false);
  assert.equal(r.jobId, JOB.id); // inner OTHER id is inside the query, never matched
});
test("extractExplicitJobId: wrong host ignored (not malformed, not matched)", () => {
  assert.equal(core.extractExplicitJobId(ev({ description: "https://example.com/jobs/" + JOB.id })), null);
});
test("extractExplicitJobId: trailing punctuation trimmed", () => {
  const r = core.extractExplicitJobId(ev({ description: `See https://gfglassforge.com/jobs/${JOB.id}).` }));
  assert.equal(r.jobId, JOB.id);
});
test("extractExplicitJobId: non-24-hex inline token ignored (no fallback to title)", () => {
  assert.equal(core.extractExplicitJobId(ev({ description: "see job " + JOB.id + " inline" })), null);
});

// ---- match rules: malformed/conflict reject, never fall back to title ----
test("matchEventToJob: property match", () => {
  assert.equal(core.matchEventToJob(ev({ priv: { hubJobId: JOB.id } }), JOB).match, true);
});
test("matchEventToJob: url match", () => {
  assert.equal(core.matchEventToJob(ev({ description: "https://gfglassforge.com/jobs/" + JOB.id }), JOB).match, true);
});
test("matchEventToJob: foreign explicit link rejected", () => {
  const m = core.matchEventToJob(ev({ priv: { hubJobId: OTHER.id } }), JOB);
  assert.equal(m.match, false);
  assert.equal(m.reason, "foreign_explicit");
});
test("matchEventToJob: identity conflict rejected (no title fallback)", () => {
  const m = core.matchEventToJob(ev({ description: `https://gfglassforge.com/jobs/${JOB.id} https://gfglassforge.com/jobs/${OTHER.id}` }), JOB);
  assert.equal(m.match, false);
  assert.equal(m.reason, "identity_conflict");
});
test("matchEventToJob: malformed identity rejected (no title fallback)", () => {
  const m = core.matchEventToJob(ev({ description: `https://gfglassforge.com/jobs/${JOB.id}/edit` }), JOB);
  assert.equal(m.match, false);
  assert.equal(m.reason, "identity_malformed");
});
test("matchEventToJob: unique exact normalized name matches only when no explicit identity", () => {
  const idx = core.nameUniquenessIndex([JOB, { id: "z9", canonical_name: "Other Job" }]);
  const e = ev({ summary: "Beaver - 412" });
  assert.equal(core.matchEventToJob(e, JOB, idx).match, true);
  assert.equal(core.matchEventToJob(e, JOB, idx).reason, "name_unique");
});
test("matchEventToJob: name shared by two jobs is ambiguous", () => {
  const idx = core.nameUniquenessIndex([JOB, OTHER]);
  assert.equal(core.matchEventToJob(ev({ summary: "Beaver - 412" }), JOB, idx).reason, "name_ambiguous");
});
test("matchEventToJob: substring / query-derived name rejected", () => {
  const idx = core.nameUniquenessIndex([JOB]);
  assert.equal(core.matchEventToJob(ev({ summary: "beaver" }), JOB, idx).match, false);
  assert.equal(core.matchEventToJob(ev({ summary: "Beaver 412 trim" }), JOB, idx).match, false);
});
test("matchEventToJob: alias exact name matches when unique", () => {
  const job = { id: "j1", canonical_name: "Pulte - 12 Elm", aliases: ["Pulte Homes - 12 Elm St"] };
  const idx = core.nameUniquenessIndex([job]);
  assert.equal(core.matchEventToJob(ev({ summary: "Pulte Homes - 12 Elm St" }), job, idx).match, true);
});

// ---- merged-into survivor resolution (async) ----
test("resolveSurvivor: follows a bounded async chain to the survivor", async () => {
  const db = new Map([["a", { id: "a", merged_into: "b" }], ["b", { id: "b", merged_into: "c" }], ["c", { id: "c" }]]);
  const r = await core.resolveSurvivor("a", async (id) => db.get(id));
  assert.equal(r.id, "c");
  assert.equal(r.cycled, false);
});
test("resolveSurvivor: async cycle is rejected, not infinite", async () => {
  const db = new Map([["a", { id: "a", merged_into: "b" }], ["b", { id: "b", merged_into: "a" }]]);
  const r = await core.resolveSurvivor("a", async (id) => db.get(id));
  assert.equal(r.cycled, true);
});
test("resolveSurvivor: async missing job reported", async () => {
  const r = await core.resolveSurvivor("nope", async () => null);
  assert.equal(r.missing, true);
});
test("resolveSurvivor: awaits a real async adapter (promise not treated as truthy)", async () => {
  let calls = 0;
  const getJob = async (id) => { calls++; return { id, merged_into: id === "a" ? "b" : null }; };
  const r = await core.resolveSurvivor("a", getJob);
  assert.equal(r.id, "b");
  assert.equal(calls, 2); // actually followed the chain, not stopped at the first Promise
});

// ---- upcoming / Denver ----
test("isUpcoming: all-day today and future included; past excluded", () => {
  assert.equal(core.isUpcoming(ev({ start: { date: TODAY }, end: { date: "2026-10-07" } }), NOW, TODAY), true);
  assert.equal(core.isUpcoming(ev({ start: { date: "2026-10-10" }, end: { date: "2026-10-11" } }), NOW, TODAY), true);
  assert.equal(core.isUpcoming(ev({ start: { date: "2026-10-05" }, end: { date: "2026-10-06" } }), NOW, TODAY), false);
});
test("isUpcoming: timed finished-today excluded so it never masks the next event", () => {
  const past = ev({ start: { dateTime: "2026-10-06T15:00:00Z" }, end: { dateTime: "2026-10-06T16:00:00Z" } });
  assert.equal(core.isUpcoming(past, NOW, TODAY), false);
  const future = ev({ start: { dateTime: "2026-10-06T22:00:00Z" }, end: { dateTime: "2026-10-06T23:00:00Z" } });
  assert.equal(core.isUpcoming(future, NOW, TODAY), true);
});
test("isUpcoming: cancelled never upcoming", () => {
  assert.equal(core.isUpcoming(ev({ start: { date: "2026-10-10" }, status: "cancelled" }), NOW, TODAY), false);
});
test("googleEventDate: all-day uses date; timed uses Denver conversion", () => {
  assert.equal(core.googleEventDate(ev({ start: { date: "2026-10-10" } })), "2026-10-10");
  assert.equal(core.googleEventDate(ev({ start: { dateTime: "2026-10-06T22:00:00Z" } })), "2026-10-06");
});

// ---- read merge / dedupe / scope ----
test("buildUpcomingRead: only the scoped job's events; no global dump", () => {
  const idx = core.nameUniquenessIndex([JOB, { id: "other", canonical_name: "Other" }]);
  const live = [
    ev({ id: "L1", summary: "Beaver - 412", start: { date: "2026-10-10" }, end: { date: "2026-10-11" } }),
    ev({ id: "L2", summary: "Other", start: { date: "2026-10-11" }, end: { date: "2026-10-12" } }),
  ];
  const { events } = core.buildUpcomingRead({ liveAll: live, mirrorRows: [], job: JOB, nameIndex: idx, now: NOW, todayDenver: TODAY });
  assert.equal(events.length, 1);
  assert.equal(events[0].id, "L1");
});
test("buildUpcomingRead: owner-confirmed mirror link shows when live confirms existence", () => {
  const idx = core.nameUniquenessIndex([JOB, OTHER]);
  const live = [ev({ id: "L1", summary: "beaver - finish up install trim items", start: { date: "2026-10-10" }, end: { date: "2026-10-11" } })];
  const mirror = [{ google_event_id: "L1", job_id: JOB.id, source_status: "confirmed" }];
  const { events } = core.buildUpcomingRead({ liveAll: live, mirrorRows: mirror, job: JOB, nameIndex: idx, now: NOW, todayDenver: TODAY });
  assert.equal(events.length, 1);
  assert.equal(events[0].id, "L1");
});
test("buildUpcomingRead: stale mirror never shows as a phantom", () => {
  const idx = core.nameUniquenessIndex([JOB]);
  const mirror = [{ google_event_id: "GONE", job_id: JOB.id, source_status: "confirmed" }];
  const { events } = core.buildUpcomingRead({ liveAll: [], mirrorRows: mirror, job: JOB, nameIndex: idx, now: NOW, todayDenver: TODAY });
  assert.equal(events.length, 0);
});
test("buildUpcomingRead: live cancelled state hides the mirror copy", () => {
  const idx = core.nameUniquenessIndex([JOB, OTHER]);
  const live = [ev({ id: "L1", summary: "beaver - finish up", start: { date: "2026-10-10" }, end: { date: "2026-10-11" }, status: "cancelled" })];
  const mirror = [{ google_event_id: "L1", job_id: JOB.id, source_status: "confirmed" }];
  const { events } = core.buildUpcomingRead({ liveAll: live, mirrorRows: mirror, job: JOB, nameIndex: idx, now: NOW, todayDenver: TODAY });
  assert.equal(events.length, 0);
});
test("buildUpcomingRead: dedupes the same event matched by rules and by mirror", () => {
  const idx = core.nameUniquenessIndex([JOB]);
  const live = [ev({ id: "L1", summary: "Beaver - 412", start: { date: "2026-10-10" }, end: { date: "2026-10-11" } })];
  const mirror = [{ google_event_id: "L1", job_id: JOB.id, source_status: "confirmed" }];
  const { events } = core.buildUpcomingRead({ liveAll: live, mirrorRows: mirror, job: JOB, nameIndex: idx, now: NOW, todayDenver: TODAY });
  assert.equal(events.length, 1);
});
test("buildUpcomingRead: sorted by date then time; finished-today does not mask next", () => {
  const idx = core.nameUniquenessIndex([JOB]);
  const live = [
    ev({ id: "late", summary: "Beaver - 412", start: { dateTime: "2026-10-06T15:00:00Z" }, end: { dateTime: "2026-10-06T16:00:00Z" } }),
    ev({ id: "next", summary: "Beaver - 412", start: { dateTime: "2026-10-06T22:00:00Z" }, end: { dateTime: "2026-10-06T23:00:00Z" } }),
    ev({ id: "sat", summary: "Beaver - 412", start: { date: "2026-10-10" }, end: { date: "2026-10-11" } }),
  ];
  const { events } = core.buildUpcomingRead({ liveAll: live, mirrorRows: [], job: JOB, nameIndex: idx, now: NOW, todayDenver: TODAY });
  assert.deepEqual(events.map((e) => e.id), ["next", "sat"]);
});
test("shapeUpcomingEvent: price-free purpose; $ lines stripped and flagged", () => {
  const s = core.shapeUpcomingEvent(ev({ description: "Finish trim\nLabor $500\nTotal $750" }), JOB);
  assert.ok(!s.purpose.includes("$"));
  assert.match(s.purpose, /Finish trim/);
});
test("shapeUpcomingEvent: a surviving $ fails closed (empty purpose, flagged)", () => {
  const s = core.shapeUpcomingEvent(ev({ description: "Finish trim $5 mid line" }), JOB);
  assert.equal(s.purpose, "");
  assert.equal(s.flagged, true);
});

// ---- pagination ----
test("paginateGoogleEvents: single page ok", async () => {
  const fetchPage = async () => ({ ok: true, status: 200, json: async () => ({ items: [ev({ id: "a" })] }) });
  const { items, error } = await core.paginateGoogleEvents(fetchPage);
  assert.equal(error, null);
  assert.equal(items.length, 1);
});
test("paginateGoogleEvents: multi-page drains tokens", async () => {
  let call = 0;
  const fetchPage = async (tok) => {
    call++;
    if (!tok) return { ok: true, status: 200, json: async () => ({ items: [ev({ id: "a" })], nextPageToken: "T2" }) };
    return { ok: true, status: 200, json: async () => ({ items: [ev({ id: "b" })] }) };
  };
  const { items, error } = await core.paginateGoogleEvents(fetchPage);
  assert.equal(error, null);
  assert.equal(items.length, 2);
  assert.equal(call, 2);
});
test("paginateGoogleEvents: repeated cursor fails closed (loop)", async () => {
  const fetchPage = async () => ({ ok: true, status: 200, json: async () => ({ items: [ev({ id: "a" })], nextPageToken: "T" }) });
  const { error } = await core.paginateGoogleEvents(fetchPage);
  assert.equal(error.kind, "loop");
});
test("paginateGoogleEvents: http error surfaces", async () => {
  const fetchPage = async () => ({ ok: false, status: 503, json: async () => ({}) });
  const { error } = await core.paginateGoogleEvents(fetchPage);
  assert.equal(error.kind, "http");
  assert.equal(error.status, 503);
});
test("paginateGoogleEvents: malformed page fails closed", async () => {
  const fetchPage = async () => ({ ok: true, status: 200, json: async () => ({ error: { message: "bad" } }) });
  const { error } = await core.paginateGoogleEvents(fetchPage);
  assert.equal(error.kind, "shape");
});

// ---- deterministic id + fingerprint (address now in fingerprint) ----
test("deterministicId: stable, base32hex charset, differs per request", async () => {
  const a = await core.deterministicId("6a7f0d834a5f825c724273ea", "req1", { sha256 });
  const a2 = await core.deterministicId("6a7f0d834a5f825c724273ea", "req1", { sha256 });
  const b = await core.deterministicId("6a7f0d834a5f825c724273ea", "req2", { sha256 });
  assert.equal(a, a2);
  assert.notEqual(a, b);
  assert.match(a, B32H_RE);
});
test("fingerprintHash: same payload same hash; changed address differs", async () => {
  const p = { job_id: "j", owner_id: "o", request_id: "r", all_day: true, start_date: "2026-10-10", title: "T", address: "A", notes: "x" };
  const h1 = await core.fingerprintHash(p, { sha256 });
  const h2 = await core.fingerprintHash({ ...p, address: "B" }, { sha256 });
  assert.equal(h1, await core.fingerprintHash(p, { sha256 }));
  assert.notEqual(h1, h2);
});

// ---- validateCreatePayload: real dates, ordering, timezone ----
test("validateCreatePayload: valid all-day", () => {
  assert.equal(core.validateCreatePayload({ job_id: JOB.id, request_id: "r", all_day: true, start_date: "2026-10-10", time_zone: "America/Denver" }).ok, true);
});
test("validateCreatePayload: valid timed", () => {
  assert.equal(core.validateCreatePayload({ job_id: JOB.id, request_id: "r", all_day: false, start_date: "2026-10-10", start_time: "09:00", end_time: "11:00" }).ok, true);
});
test("validateCreatePayload: invalid date rejected", () => {
  assert.equal(core.validateCreatePayload({ job_id: JOB.id, request_id: "r", all_day: true, start_date: "2026-13-40" }).ok, false);
});
test("validateCreatePayload: all-day end before start rejected", () => {
  const v = core.validateCreatePayload({ job_id: JOB.id, request_id: "r", all_day: true, start_date: "2026-10-10", end_date: "2026-10-09" });
  assert.equal(v.ok, false);
  assert.ok(v.errors.includes("end_before_start"));
});
test("validateCreatePayload: invalid timezone rejected", () => {
  assert.equal(core.validateCreatePayload({ job_id: JOB.id, request_id: "r", all_day: true, start_date: "2026-10-10", time_zone: "Not/A/Zone" }).ok, false);
});
test("validateCreatePayload: overnight timed (end<=start) is VALID", () => {
  assert.equal(core.validateCreatePayload({ job_id: JOB.id, request_id: "r", all_day: false, start_date: "2026-10-10", start_time: "23:30", end_time: "00:30" }).ok, true);
});

// ---- effectiveDateTime: all-day exclusive end, timed overnight, multiday ----
test("effectiveDateTime: all-day single day end is exclusive +1", () => {
  const dt = core.effectiveDateTime({ all_day: true, start_date: "2026-10-10", time_zone: "America/Denver" });
  assert.deepEqual(dt.start, { date: "2026-10-10" });
  assert.deepEqual(dt.end, { date: "2026-10-11" });
  assert.equal(dt.multiday, false);
});
test("effectiveDateTime: all-day multiday end is last_day+1 (inclusive last day)", () => {
  const dt = core.effectiveDateTime({ all_day: true, start_date: "2026-10-10", end_date: "2026-10-12", time_zone: "America/Denver" });
  assert.equal(dt.last_day, "2026-10-12");
  assert.deepEqual(dt.end, { date: "2026-10-13" }); // exclusive
  assert.equal(dt.multiday, true);
});
test("effectiveDateTime: timed same day", () => {
  const dt = core.effectiveDateTime({ all_day: false, start_date: "2026-10-10", start_time: "09:00", end_time: "11:00", time_zone: "America/Denver" });
  assert.equal(dt.start.dateTime, "2026-10-10T09:00:00");
  assert.equal(dt.end.dateTime, "2026-10-10T11:00:00");
  assert.equal(dt.overnight, false);
  assert.equal(dt.end_date, "2026-10-10");
});
test("effectiveDateTime: timed overnight rolls end to next day", () => {
  const dt = core.effectiveDateTime({ all_day: false, start_date: "2026-10-10", start_time: "23:30", end_time: "00:30", time_zone: "America/Denver" });
  assert.equal(dt.overnight, true);
  assert.equal(dt.end.dateTime.startsWith("2026-10-11"), true);
  assert.equal(dt.end_date, "2026-10-11");
});

// ---- buildCreateEventBody: uses effectiveDateTime, address as location, no pricing ----
test("buildCreateEventBody: all-day end exclusive; hubUrl in description; no pricing; no labor/FeeLines", () => {
  const body = core.buildCreateEventBody({ job: JOB, payload: { all_day: true, start_date: "2026-10-10", owner_id: "o", request_id: "r", address: JOB.address, notes: "Finish trim" }, fingerprint: "fp", eventId: "eid", hubBaseUrl: "https://gfglassforge.com" });
  assert.equal(body.summary, "Beaver - 412");
  assert.deepEqual(body.start, { date: "2026-10-10" });
  assert.deepEqual(body.end, { date: "2026-10-11" });
  assert.equal(body.location, JOB.address);
  assert.match(body.description, /Finish trim/);
  assert.match(body.description, /https:\/\/gfglassforge\.com\/jobs\/6a817395914bfa31ecd0f1f6/);
  assert.equal(body.attendees.length, 0);
  assert.equal(body.extendedProperties.private.hubJobId, JOB.id);
  assert.equal(body.extendedProperties.private.hubFingerprint, "fp");
  assert.equal(body.id, "eid");
  assert.equal(body.laborAmt, undefined);
  assert.equal(body.feeAmt, undefined);
});
test("buildCreateEventBody: timed uses America/Denver zone; overnight end next day", () => {
  const body = core.buildCreateEventBody({ job: JOB, payload: { all_day: false, start_date: "2026-10-10", start_time: "23:30", end_time: "00:30", owner_id: "o", request_id: "r", address: "A" }, fingerprint: "fp", eventId: "eid", hubBaseUrl: "https://gfglassforge.com" });
  assert.equal(body.start.timeZone, "America/Denver");
  assert.equal(body.end.dateTime.startsWith("2026-10-11"), true);
});
test("buildCreateEventBody: title from job canonical_name (server re-read), not payload", () => {
  const body = core.buildCreateEventBody({ job: JOB, payload: { all_day: true, start_date: "2026-10-10", title: "WRONG", owner_id: "o", request_id: "r", address: "A" }, fingerprint: "fp", eventId: "eid", hubBaseUrl: "https://gfglassforge.com" });
  assert.equal(body.summary, "Beaver - 412");
});

// ---- create orchestration (injectable transport) ----
function transport({ get = null, insert = null }) {
  const calls = { get: 0, insert: 0 };
  return {
    calls,
    getEvent: async (id) => { calls.get++; if (get) return await get(id); return null; },
    insertEvent: async (body) => { calls.insert++; if (insert) return await insert(body); return { ok: true, status: 200, event: { id: body.id, htmlLink: "https://calendar.google.com/event?eid=new" } }; },
  };
}
const JOB_FULL = { id: "6a817395914bfa31ecd0f1f6", canonical_name: "Beaver - 412", address: "1497 E 200 N St" };
const basePayload = { job_id: JOB_FULL.id, owner_id: "6a7f0d834a5f825c724273ea", request_id: "req1", all_day: true, start_date: "2026-10-10", time_zone: "America/Denver", title: "Beaver - 412", address: JOB_FULL.address, notes: "n" };

test("createEvent: no existing event → one GET then one INSERT → created", async () => {
  const t = transport();
  const r = await core.createEvent({ transport: t, job: JOB_FULL, payload: basePayload, sha256, hubBaseUrl: "https://gfglassforge.com" });
  assert.equal(r.kind, "created");
  assert.equal(t.calls.get, 1);
  assert.equal(t.calls.insert, 1);
  assert.ok(r.event.htmlLink);
});
test("createEvent: response loss (insert throws) → unknown; no fresh id on retry", async () => {
  const t = transport({ insert: async () => { throw new Error("timeout"); } });
  const r = await core.createEvent({ transport: t, job: JOB_FULL, payload: basePayload, sha256, hubBaseUrl: "https://gfglassforge.com" });
  assert.equal(r.kind, "unknown");
  assert.equal(t.calls.insert, 1);
  const id1 = r.event_id;
  // retry: GET first (now the prior partial is still absent) → insert again with SAME id
  const t2 = transport();
  const r2 = await core.createEvent({ transport: t2, job: JOB_FULL, payload: basePayload, sha256, hubBaseUrl: "https://gfglassforge.com" });
  assert.equal(r2.kind, "created");
  assert.equal(r2.event_id, id1); // same deterministic id, never a fresh id to escape
  assert.equal(t2.calls.get, 1);
});
test("createEvent: changed same request (different fingerprint) → conflict_changed, no insert", async () => {
  const existing = { id: "x", status: "confirmed", extendedProperties: { private: { hubJobId: JOB_FULL.id, hubOwnerId: basePayload.owner_id, hubRequestId: basePayload.request_id, hubFingerprint: "old" } } };
  const t = transport({ get: async () => ({ event: existing }) });
  const r = await core.createEvent({ transport: t, job: JOB_FULL, payload: basePayload, sha256, hubBaseUrl: "https://gfglassforge.com" });
  assert.equal(r.kind, "conflict_changed");
  assert.equal(t.calls.insert, 0); // never inserts over a changed request
});
test("createEvent: foreign event (different hubJobId) → foreign, no insert", async () => {
  const existing = { id: "x", status: "confirmed", extendedProperties: { private: { hubJobId: "otherjob", hubOwnerId: basePayload.owner_id, hubRequestId: basePayload.request_id, hubFingerprint: "fp" } } };
  const t = transport({ get: async () => ({ event: existing }) });
  const r = await core.createEvent({ transport: t, job: JOB_FULL, payload: basePayload, sha256, hubBaseUrl: "https://gfglassforge.com" });
  assert.equal(r.kind, "foreign");
  assert.equal(t.calls.insert, 0);
});
test("createEvent: cancelled tombstone → deleted, never recreated", async () => {
  const fp = await core.fingerprintHash(basePayload, { sha256 });
  const existing = { id: "x", status: "cancelled", extendedProperties: { private: { hubJobId: JOB_FULL.id, hubOwnerId: basePayload.owner_id, hubRequestId: basePayload.request_id, hubFingerprint: fp } } };
  const t = transport({ get: async () => ({ event: existing }) });
  const r = await core.createEvent({ transport: t, job: JOB_FULL, payload: basePayload, sha256, hubBaseUrl: "https://gfglassforge.com" });
  assert.equal(r.kind, "deleted");
  assert.equal(t.calls.insert, 0); // cancellation tombstone is NOT recreated
});
test("createEvent: existing exact match → existing_match, no insert", async () => {
  const fp = await core.fingerprintHash(basePayload, { sha256 });
  const existing = { id: "x", status: "confirmed", extendedProperties: { private: { hubJobId: JOB_FULL.id, hubOwnerId: basePayload.owner_id, hubRequestId: basePayload.request_id, hubFingerprint: fp } } };
  const t = transport({ get: async () => ({ event: existing }) });
  const r = await core.createEvent({ transport: t, job: JOB_FULL, payload: basePayload, sha256, hubBaseUrl: "https://gfglassforge.com" });
  assert.equal(r.kind, "existing_match");
  assert.equal(t.calls.insert, 0);
});
test("createEvent: 409 on insert → re-GET and reconcile", async () => {
  let getCalls = 0;
  const fp = await core.fingerprintHash(basePayload, { sha256 });
  const existing = { id: "x", status: "confirmed", extendedProperties: { private: { hubJobId: JOB_FULL.id, hubOwnerId: basePayload.owner_id, hubRequestId: basePayload.request_id, hubFingerprint: fp } } };
  const t = transport({
    get: async () => { getCalls++; return getCalls === 1 ? null : ({ event: existing }); }, // first GET: none; after 409: exists
    insert: async () => ({ ok: false, status: 409 }),
  });
  const r = await core.createEvent({ transport: t, job: JOB_FULL, payload: basePayload, sha256, hubBaseUrl: "https://gfglassforge.com" });
  assert.equal(r.kind, "existing_match");
  assert.equal(t.calls.insert, 1);
  assert.equal(t.calls.get, 2);
});
test("createEvent: malformed success (ok but no event) → unknown, no fresh id", async () => {
  const t = transport({ insert: async () => ({ ok: true, status: 200 }) });
  const r = await core.createEvent({ transport: t, job: JOB_FULL, payload: basePayload, sha256, hubBaseUrl: "https://gfglassforge.com" });
  assert.equal(r.kind, "unknown");
});
test("createEvent: GET throws → unknown (freeze), no insert", async () => {
  const t = transport({ get: async () => { throw new Error("net"); } });
  const r = await core.createEvent({ transport: t, job: JOB_FULL, payload: basePayload, sha256, hubBaseUrl: "https://gfglassforge.com" });
  assert.equal(r.kind, "unknown");
  assert.equal(t.calls.insert, 0);
});
test("createEvent: body has no attendees/copies and no labor/FeeLines", async () => {
  let saved;
  const t = transport({ insert: async (b) => { saved = b; return { ok: true, status: 200, event: { id: b.id, htmlLink: "l" } }; } });
  await core.createEvent({ transport: t, job: JOB_FULL, payload: basePayload, sha256, hubBaseUrl: "https://gfglassforge.com" });
  assert.deepEqual(saved.attendees, []);
  assert.equal(saved.laborAmt, undefined);
  assert.equal(saved.feeAmt, undefined);
  assert.ok(!/fee_line|labor_amt/i.test(JSON.stringify(saved)));
});

// ---- review notes (flag, don't silently delete) ----
test("reviewNotes: keeps safe lines, returns dropped pricing lines, flags", () => {
  const r = core.reviewNotes("Finish trim\nLabor $500\nTotal $750\nInstall screens");
  assert.match(r.text, /Finish trim/);
  assert.match(r.text, /Install screens/);
  assert.ok(!r.text.includes("$"));
  assert.ok(r.dropped.some((l) => /Labor \$500/.test(l)));
  assert.ok(r.dropped.some((l) => /Total \$750/.test(l)));
  assert.equal(r.flagged, true);
});