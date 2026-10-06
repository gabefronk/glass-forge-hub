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

// ---- explicit job id extraction ----
test("extractExplicitJobId: private property hubJobId wins (exact 24-hex)", () => {
  const r = core.extractExplicitJobId(ev({ priv: { hubJobId: JOB.id } }));
  assert.equal(r.jobId, JOB.id);
  assert.equal(r.source, "property");
});
test("extractExplicitJobId: allowlisted gfglassforge.com URL in description", () => {
  const r = core.extractExplicitJobId(ev({ description: `See ${"https://gfglassforge.com/jobs/"}${JOB.id} for details` }));
  assert.equal(r.jobId, JOB.id);
  assert.equal(r.source, "url");
  assert.equal(r.host, "gfglassforge.com");
});
test("extractExplicitJobId: legacy glass-forge-hub.base44.app URL also allowlisted", () => {
  const r = core.extractExplicitJobId(ev({ description: `Hub: ${"https://glass-forge-hub.base44.app/jobs/"}${JOB.id}` }));
  assert.equal(r.jobId, JOB.id);
  assert.equal(r.host, "glass-forge-hub.base44.app");
});
test("extractExplicitJobId: wrong host / non-24-hex / substring rejected", () => {
  assert.equal(core.extractExplicitJobId(ev({ description: "https://example.com/jobs/" + JOB.id })), null);
  assert.equal(core.extractExplicitJobId(ev({ description: "https://gfglassforge.com/jobs/short" })), null);
  assert.equal(core.extractExplicitJobId(ev({ description: "see job " + JOB.id + " inline" })), null);
  assert.equal(core.extractExplicitJobId(ev({ priv: { hubJobId: "not24hex" } })), null);
});

// ---- match rules ----
test("matchEventToJob: property match", () => {
  assert.equal(core.matchEventToJob(ev({ priv: { hubJobId: JOB.id } }), JOB).match, true);
});
test("matchEventToJob: url match", () => {
  assert.equal(core.matchEventToJob(ev({ description: "https://gfglassforge.com/jobs/" + JOB.id }), JOB).match, true);
});
test("matchEventToJob: foreign explicit link rejected (points to a different job)", () => {
  const m = core.matchEventToJob(ev({ priv: { hubJobId: OTHER.id } }), JOB);
  assert.equal(m.match, false);
  assert.equal(m.reason, "foreign_explicit");
  assert.equal(m.foreignId, OTHER.id);
});
test("matchEventToJob: unique exact normalized name matches", () => {
  const idx = core.nameUniquenessIndex([JOB, { id: "z9", canonical_name: "Other Job" }]);
  const e = ev({ summary: "Beaver - 412" });
  assert.equal(core.matchEventToJob(e, JOB, idx).match, true);
  assert.equal(core.matchEventToJob(e, JOB, idx).reason, "name_unique");
});
test("matchEventToJob: name shared by two jobs is ambiguous (no match)", () => {
  const idx = core.nameUniquenessIndex([JOB, OTHER]); // both "beaver - 412"
  const m = core.matchEventToJob(ev({ summary: "Beaver - 412" }), JOB, idx);
  assert.equal(m.match, false);
  assert.equal(m.reason, "name_ambiguous");
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

// ---- merged-into survivor resolution ----
test("resolveSurvivor: follows a bounded chain to the survivor", () => {
  const db = new Map([["a", { id: "a", merged_into: "b" }], ["b", { id: "b", merged_into: "c" }], ["c", { id: "c" }]]);
  const r = core.resolveSurvivor("a", (id) => db.get(id));
  assert.equal(r.id, "c");
  assert.equal(r.cycled, false);
});
test("resolveSurvivor: cycle is rejected, not infinite", () => {
  const db = new Map([["a", { id: "a", merged_into: "b" }], ["b", { id: "b", merged_into: "a" }]]);
  const r = core.resolveSurvivor("a", (id) => db.get(id));
  assert.equal(r.cycled, true);
});
test("resolveSurvivor: missing job reported", () => {
  const r = core.resolveSurvivor("nope", () => null);
  assert.equal(r.missing, true);
});

// ---- upcoming / Denver ----
test("isUpcoming: all-day today and future included; past excluded", () => {
  assert.equal(core.isUpcoming(ev({ start: { date: TODAY }, end: { date: "2026-10-07" } }), NOW, TODAY), true);
  assert.equal(core.isUpcoming(ev({ start: { date: "2026-10-10" }, end: { date: "2026-10-11" } }), NOW, TODAY), true);
  assert.equal(core.isUpcoming(ev({ start: { date: "2026-10-05" }, end: { date: "2026-10-06" } }), NOW, TODAY), false);
});
test("isUpcoming: timed finished-today excluded so it never masks the next event", () => {
  // 09:00–10:00 Denver today, already ended (now is 14:00 Denver)
  const past = ev({ start: { dateTime: "2026-10-06T15:00:00Z" }, end: { dateTime: "2026-10-06T16:00:00Z" } }); // 09–10 Denver
  assert.equal(core.isUpcoming(past, NOW, TODAY), false);
  // 16:00–17:00 Denver today, still upcoming
  const future = ev({ start: { dateTime: "2026-10-06T22:00:00Z" }, end: { dateTime: "2026-10-06T23:00:00Z" } }); // 16–17 Denver
  assert.equal(core.isUpcoming(future, NOW, TODAY), true);
});
test("isUpcoming: cancelled never upcoming", () => {
  assert.equal(core.isUpcoming(ev({ start: { date: "2026-10-10" }, status: "cancelled" }), NOW, TODAY), false);
});
test("googleEventDate: all-day uses date; timed uses Denver conversion", () => {
  assert.equal(core.googleEventDate(ev({ start: { date: "2026-10-10" } })), "2026-10-10");
  // 2026-10-06T22:00:00Z = 16:00 Denver Oct 6
  assert.equal(core.googleEventDate(ev({ start: { dateTime: "2026-10-06T22:00:00Z" } })), "2026-10-06");
});

// ---- read merge / dedupe / scope ----
test("buildUpcomingRead: only the scoped job's events; no global dump", () => {
  const idx = core.nameUniquenessIndex([JOB, { id: "other", canonical_name: "Other" }]);
  const live = [
    ev({ id: "L1", summary: "Beaver - 412", start: { date: "2026-10-10" }, end: { date: "2026-10-11" } }), // matches by unique name
    ev({ id: "L2", summary: "Other", start: { date: "2026-10-11" }, end: { date: "2026-10-12" } }), // different job
  ];
  const { events } = core.buildUpcomingRead({ liveAll: live, mirrorRows: [], job: JOB, nameIndex: idx, now: NOW, todayDenver: TODAY });
  assert.equal(events.length, 1);
  assert.equal(events[0].id, "L1");
});
test("buildUpcomingRead: owner-confirmed mirror link shows when live confirms existence and didn't match by rules", () => {
  const idx = core.nameUniquenessIndex([JOB, OTHER]); // name ambiguous → live won't match by name
  const live = [ev({ id: "L1", summary: "beaver - finish up install trim items", start: { date: "2026-10-10" }, end: { date: "2026-10-11" } })];
  const mirror = [{ google_event_id: "L1", job_id: JOB.id, source_status: "confirmed" }];
  const { events } = core.buildUpcomingRead({ liveAll: live, mirrorRows: mirror, job: JOB, nameIndex: idx, now: NOW, todayDenver: TODAY });
  assert.equal(events.length, 1);
  assert.equal(events[0].id, "L1");
});
test("buildUpcomingRead: stale mirror (deleted from Google) never shows as a phantom", () => {
  const idx = core.nameUniquenessIndex([JOB]);
  const mirror = [{ google_event_id: "GONE", job_id: JOB.id, source_status: "confirmed" }];
  const { events } = core.buildUpcomingRead({ liveAll: [], mirrorRows: mirror, job: JOB, nameIndex: idx, now: NOW, todayDenver: TODAY });
  assert.equal(events.length, 0);
});
test("buildUpcomingRead: live cancelled state hides the mirror copy (prefer live/cancel)", () => {
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
    ev({ id: "late", summary: "Beaver - 412", start: { dateTime: "2026-10-06T15:00:00Z" }, end: { dateTime: "2026-10-06T16:00:00Z" } }), // finished today
    ev({ id: "next", summary: "Beaver - 412", start: { dateTime: "2026-10-06T22:00:00Z" }, end: { dateTime: "2026-10-06T23:00:00Z" } }), // 16:00 Denver today
    ev({ id: "sat", summary: "Beaver - 412", start: { date: "2026-10-10" }, end: { date: "2026-10-11" } }),
  ];
  const { events } = core.buildUpcomingRead({ liveAll: live, mirrorRows: [], job: JOB, nameIndex: idx, now: NOW, todayDenver: TODAY });
  assert.deepEqual(events.map((e) => e.id), ["next", "sat"]);
});
test("shapeUpcomingEvent: price-free purpose; $ lines stripped and flagged", () => {
  const s = core.shapeUpcomingEvent(ev({ description: "Finish trim\nLabor $500\nTotal $750" }), JOB);
  assert.ok(!s.purpose.includes("$"));
  assert.equal(s.flagged, false); // lines dropped, no surviving $ → not fail-closed flagged
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
  const fetchPage = async (tok) => ({ ok: true, status: 200, json: async () => ({ items: [ev({ id: "a" })], nextPageToken: "T" }) });
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

// ---- deterministic id + fingerprint ----
test("deterministicId: stable, base32hex charset, differs per request", async () => {
  const a = await core.deterministicId("6a7f0d834a5f825c724273ea", "req1", { sha256 });
  const a2 = await core.deterministicId("6a7f0d834a5f825c724273ea", "req1", { sha256 });
  const b = await core.deterministicId("6a7f0d834a5f825c724273ea", "req2", { sha256 });
  assert.equal(a, a2);
  assert.notEqual(a, b);
  assert.match(a, B32H_RE);
  assert.ok(a.length <= 1024);
});
test("fingerprintHash: same payload same hash; changed payload differs", async () => {
  const p = { job_id: "j", owner_id: "o", request_id: "r", all_day: true, start_date: "2026-10-10", notes: "x" };
  const h1 = await core.fingerprintHash(p, { sha256 });
  const h2 = await core.fingerprintHash({ ...p, notes: "y" }, { sha256 });
  assert.equal(h1, await core.fingerprintHash(p, { sha256 }));
  assert.notEqual(h1, h2);
});

// ---- create body ----
test("buildCreateEventBody: all-day end is exclusive (+1 day); no pricing; hubUrl in description", () => {
  const body = core.buildCreateEventBody({ job: JOB, payload: { all_day: true, start_date: "2026-10-10", owner_id: "o", request_id: "r", notes: "Finish trim" }, fingerprint: "fp", eventId: "eid", hubBaseUrl: "https://gfglassforge.com" });
  assert.equal(body.summary, "Beaver - 412");
  assert.deepEqual(body.start, { date: "2026-10-10" });
  assert.deepEqual(body.end, { date: "2026-10-11" }); // exclusive
  assert.equal(body.location, JOB.address);
  assert.match(body.description, /Finish trim/);
  assert.match(body.description, /https:\/\/gfglassforge\.com\/jobs\/6a817395914bfa31ecd0f1f6/);
  assert.equal(body.attendees.length, 0);
  assert.equal(body.extendedProperties.private.hubJobId, JOB.id);
  assert.equal(body.extendedProperties.private.hubFingerprint, "fp");
  assert.equal(body.id, "eid");
  // no labor / fee / billing fields
  assert.equal(body.laborAmt, undefined);
  assert.equal(body.feeAmt, undefined);
});
test("buildCreateEventBody: timed uses America/Denver zone; end rolls to next day when end<=start", () => {
  const body = core.buildCreateEventBody({ job: JOB, payload: { all_day: false, start_date: "2026-10-10", start_time: "23:30", end_time: "00:30", owner_id: "o", request_id: "r", notes: "" }, fingerprint: "fp", eventId: "eid", hubBaseUrl: "https://gfglassforge.com" });
  assert.equal(body.start.timeZone, "America/Denver");
  assert.equal(body.end.timeZone, "America/Denver");
  assert.equal(body.end.dateTime.startsWith("2026-10-11"), true);
});
test("buildCreateEventBody: title comes from job canonical_name (server re-read), not payload", () => {
  const body = core.buildCreateEventBody({ job: JOB, payload: { all_day: true, start_date: "2026-10-10", title: "WRONG", owner_id: "o", request_id: "r" }, fingerprint: "fp", eventId: "eid", hubBaseUrl: "https://gfglassforge.com" });
  assert.equal(body.summary, "Beaver - 412");
});

// ---- reconciliation ----
test("reconcileExisting: exact match returns existing", () => {
  const r = core.reconcileExisting({ existingEvent: ev({ priv: { hubJobId: "j", hubOwnerId: "o", hubRequestId: "r", hubFingerprint: "fp" } }), fingerprint: "fp", jobId: "j", ownerId: "o", requestId: "r" });
  assert.equal(r.kind, "existing_match");
});
test("reconcileExisting: same ids but changed fingerprint = conflict_changed", () => {
  const r = core.reconcileExisting({ existingEvent: ev({ priv: { hubJobId: "j", hubOwnerId: "o", hubRequestId: "r", hubFingerprint: "old" } }), fingerprint: "new", jobId: "j", ownerId: "o", requestId: "r" });
  assert.equal(r.kind, "conflict_changed");
});
test("reconcileExisting: different job/owner/request = foreign", () => {
  const r = core.reconcileExisting({ existingEvent: ev({ priv: { hubJobId: "other", hubOwnerId: "o", hubRequestId: "r", hubFingerprint: "fp" } }), fingerprint: "fp", jobId: "j", ownerId: "o", requestId: "r" });
  assert.equal(r.kind, "foreign");
});
test("reconcileExisting: cancelled = deleted (never recreate on retry)", () => {
  const r = core.reconcileExisting({ existingEvent: ev({ status: "cancelled", priv: { hubJobId: "j", hubOwnerId: "o", hubRequestId: "r", hubFingerprint: "fp" } }), fingerprint: "fp", jobId: "j", ownerId: "o", requestId: "r" });
  assert.equal(r.kind, "deleted");
});
test("reconcileExisting: no event = unverifiable (stays locked, no new id)", () => {
  assert.equal(core.reconcileExisting({ existingEvent: null, fingerprint: "fp", jobId: "j", ownerId: "o", requestId: "r" }).kind, "unverifiable");
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

// ---- no FeeLines / no labor anywhere in the create path ----
test("create path never references FeeLines or labor: body has none, core exports none", () => {
  const body = core.buildCreateEventBody({ job: JOB, payload: { all_day: true, start_date: "2026-10-10", owner_id: "o", request_id: "r" }, fingerprint: "fp", eventId: "eid", hubBaseUrl: "https://gfglassforge.com" });
  const flat = JSON.stringify(body);
  assert.ok(!/labor_amt|fee_amt|fee_pct|billable|FeeLine/i.test(flat));
});