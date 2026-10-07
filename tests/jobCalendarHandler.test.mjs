// Handler-level tests for the injectable job-calendar factory. No live provider,
// no network, no SDK. Mock base44 (auth + entities) and mock transport are
// injected; createEnabled=true exercises the SAME handleCreate code path the
// production entry would run once enabled. Production create is hard-off: it
// returns disabled BEFORE any transport/token call or Hub WRITE (auth + a Jobs.get
// read still happen first; zero token/provider calls and zero Hub WRITES).
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import * as core from "../base44/shared/jobCalendarCore.js";
import { createJobCalendarHandler } from "../base44/shared/jobCalendarHandler.js";
import { createGoogleTransport } from "../base44/shared/jobCalendarGoogleTransport.js";

const sha256 = (s) => createHash("sha256").update(String(s)).digest("hex");
const JOB = { id: "6a817395914bfa31ecd0f1f6", canonical_name: "Beaver - 412", address: "1497 E 200 N St, Beaver, UT 84713" };
const OTHER = { id: "6a8229a9801b2aef9278ff48", canonical_name: "Beaver - 412" };
const OWNER = "6a7f0d834a5f825c724273ea";

function ev({ id = "evt1", summary = "beaver - finish up", description = "", location = "1497 E 200 N St, Beaver, UT 84713", start, end, status, priv } = {}) {
  const e = { id, summary, location, start: start || { date: "2026-10-10" }, end: end || { date: "2026-10-11" }, htmlLink: "https://calendar.google.com/event?eid=x", organizer: { email: "iryedra@gmail.com" } };
  if (status) e.status = status;
  if (description) e.description = description;
  if (priv) e.extendedProperties = { private: priv };
  return e;
}
function pl(over = {}) {
  return { job_id: JOB.id, owner_id: OWNER, request_id: "req-00000001", all_day: true, start_date: "2026-10-10", end_date: "2026-10-10", start_time: null, end_time: null, time_zone: "America/Denver", title: JOB.canonical_name, address: JOB.address, notes: "Finish trim", confirm_no_jobsite: false, ...over };
}
function mockBase44({ me, job = JOB, mirrorRows = [] }) {
  return {
    auth: { me: async () => me },
    asServiceRole: {
      entities: {
        Jobs: { get: async (id) => (id === job?.id ? job : null) },
        CalendarEvents: { filter: async () => mirrorRows },
      },
      connectors: { getConnection: async () => ({ accessToken: "tok" }) },
    },
  };
}
function mockTransport({ list = null, get = null, insert = null } = {}) {
  const calls = { list: 0, get: 0, insert: 0 };
  return {
    calls,
    listEvents: async (a, b) => { calls.list++; return list ? list(a, b) : { items: [], error: null }; },
    getEvent: async (id) => { calls.get++; return get ? get(id) : { kind: "not_found" }; },
    insertEvent: async (body) => { calls.insert++; return insert ? insert(body) : { ok: false, status: 500, unknown: true }; },
  };
}
const h = (opts) => createJobCalendarHandler({ base44: mockBase44({ me: { id: OWNER } }), transport: mockTransport(), createEnabled: false, sha256, ...opts });
const req = (body) => ({ method: "POST", json: async () => body });

// ---- production create hard-off: zero provider/token calls and zero Hub WRITES ----
// (Auth + a Jobs.get read still happen first; no token, no provider call, no Hub write.)
test("handler create: production disabled returns disabled BEFORE any transport/token call or Hub write", async () => {
  const t = mockTransport({ get: () => { throw new Error("should not be called"); }, insert: () => { throw new Error("should not be called"); } });
  const handler = createJobCalendarHandler({ base44: mockBase44({ me: { id: OWNER } }), transport: t, createEnabled: false, sha256 });
  const r = await handler.handleCreate({ payload: pl() }, { id: OWNER });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, false);
  assert.equal(r.body.disabled, true);
  assert.equal(r.body.stage, "create_disabled_in_stage");
  assert.ok(r.body.event_id);
  assert.ok(r.body.fingerprint);
  assert.equal(t.calls.list, 0);
  assert.equal(t.calls.get, 0);
  assert.equal(t.calls.insert, 0);
});

// ---- auth ----
test("handler auth: unauthenticated -> 401 sign_in_required", async () => {
  const handler = createJobCalendarHandler({ base44: mockBase44({ me: null }), transport: mockTransport(), createEnabled: false, sha256 });
  const r = await handler.handle(req({ action: "read_upcoming", job_id: JOB.id }));
  assert.equal(r.status, 401);
  assert.equal(r.body.error, "sign_in_required");
});
test("handler auth: non-owner -> 403 owner_access_required", async () => {
  const handler = createJobCalendarHandler({ base44: mockBase44({ me: { id: "notowner" } }), transport: mockTransport(), createEnabled: false, sha256 });
  const r = await handler.handle(req({ action: "read_upcoming", job_id: JOB.id }));
  assert.equal(r.status, 403);
  assert.equal(r.body.error, "owner_access_required");
});
test("handler auth: non-POST -> 405", async () => {
  const handler = createJobCalendarHandler({ base44: mockBase44({ me: { id: OWNER } }), transport: mockTransport(), createEnabled: false, sha256 });
  const r = await handler.handle({ method: "GET", json: async () => ({}) });
  assert.equal(r.status, 405);
  assert.equal(r.body.error, "method_not_allowed");
});

// ---- read: explicit source mapping, safe, fail-closed ----
test("handler read: surfaces only explicit-identity events for the job (property + url); no-identity and foreign excluded", async () => {
  const live = [
    ev({ id: "p1", priv: { hubJobId: JOB.id } }),
    ev({ id: "u1", description: `https://gfglassforge.com/jobs/${JOB.id}` }),
    ev({ id: "n1", summary: "Beaver - 412" }),
    ev({ id: "f1", priv: { hubJobId: OTHER.id } }),
  ];
  const t = mockTransport({ list: () => ({ items: live, error: null }) });
  const handler = createJobCalendarHandler({ base44: mockBase44({ me: { id: OWNER } }), transport: t, createEnabled: false, sha256 });
  const r = await handler.handleRead({ job_id: JOB.id });
  assert.equal(r.status, 200);
  assert.deepEqual(new Set(r.body.events.map((e) => e.id)), new Set(["p1", "u1"]));
});
test("handler read: pagination failure fail-closed -> 502 calendar_read_failed", async () => {
  const t = mockTransport({ list: () => ({ items: [], error: { kind: "http", status: 503 } }) });
  const handler = createJobCalendarHandler({ base44: mockBase44({ me: { id: OWNER } }), transport: t, createEnabled: false, sha256 });
  const r = await handler.handleRead({ job_id: JOB.id });
  assert.equal(r.status, 502);
  assert.equal(r.body.error, "calendar_read_failed");
});
test("handler read: token missing -> 502 calendar_not_connected", async () => {
  const t = mockTransport({ list: () => ({ items: [], error: { kind: "not_connected" } }) });
  const handler = createJobCalendarHandler({ base44: mockBase44({ me: { id: OWNER } }), transport: t, createEnabled: false, sha256 });
  const r = await handler.handleRead({ job_id: JOB.id });
  assert.equal(r.status, 502);
  assert.equal(r.body.error, "calendar_not_connected");
});
test("handler read: invalid job id -> 400; missing job -> 404", async () => {
  const handler = createJobCalendarHandler({ base44: mockBase44({ me: { id: OWNER }, job: null }), transport: mockTransport(), createEnabled: false, sha256 });
  const r1 = await handler.handleRead({ job_id: "bad" });
  assert.equal(r1.status, 400);
  assert.equal(r1.body.error, "invalid_job_id");
  const r2 = await handler.handleRead({ job_id: "6a817395914bfa31ecd0f1f7" });
  assert.equal(r2.status, 404);
  assert.equal(r2.body.error, "job_not_found");
});

// ---- create (test-only, createEnabled=true exercises real code path with mocks) ----
async function existingEvent(p, fp, over = {}, privOver = {}) {
  const eid = await core.deterministicId(p.owner_id, p.request_id, { sha256 });
  const body = core.buildCreateEventBody({ payload: p, fingerprint: fp, eventId: eid });
  return { ...body, status: "confirmed", htmlLink: "https://calendar.google.com/e", extendedProperties: { private: { ...body.extendedProperties.private, ...privOver } }, ...over };
}

test("handler create(test): existing_match when GET returns matching id+fingerprint, no POST", async () => {
  const p = pl();
  const fp = await core.fingerprintHash(p, { sha256 });
  const ex = await existingEvent(p, fp);
  const t = mockTransport({ get: () => ({ kind: "found", event: ex }) });
  const handler = createJobCalendarHandler({ base44: mockBase44({ me: { id: OWNER } }), transport: t, createEnabled: true, sha256 });
  const r = await handler.handleCreate({ payload: p }, { id: OWNER });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  assert.equal(r.body.kind, "existing_match");
  assert.equal(t.calls.insert, 0);
});
test("handler create(test): conflicting fingerprint -> conflict_changed, no POST", async () => {
  const p = pl();
  const ex = await existingEvent(p, "old-fingerprint");
  const t = mockTransport({ get: () => ({ kind: "found", event: ex }) });
  const handler = createJobCalendarHandler({ base44: mockBase44({ me: { id: OWNER } }), transport: t, createEnabled: true, sha256 });
  const r = await handler.handleCreate({ payload: p }, { id: OWNER });
  assert.equal(r.body.ok, false);
  assert.equal(r.body.kind, "conflict_changed");
  assert.equal(t.calls.insert, 0);
});
test("handler create(test): 409 -> re-GET reconcile -> existing_match", async () => {
  const p = pl();
  const fp = await core.fingerprintHash(p, { sha256 });
  const ex = await existingEvent(p, fp);
  let g = 0;
  const t = mockTransport({ get: () => (++g === 1 ? { kind: "not_found" } : { kind: "found", event: ex }), insert: () => ({ ok: false, status: 409 }) });
  const handler = createJobCalendarHandler({ base44: mockBase44({ me: { id: OWNER } }), transport: t, createEnabled: true, sha256 });
  const r = await handler.handleCreate({ payload: p }, { id: OWNER });
  assert.equal(r.body.ok, true);
  assert.equal(r.body.kind, "existing_match");
  assert.equal(t.calls.get, 2);
});
test("handler create(test): network unknown (GET throw / insert 5xx) -> unknown, no fabricated success", async () => {
  const t1 = mockTransport({ get: () => { throw new Error("net"); } });
  const h1 = createJobCalendarHandler({ base44: mockBase44({ me: { id: OWNER } }), transport: t1, createEnabled: true, sha256 });
  const r1 = await h1.handleCreate({ payload: pl() }, { id: OWNER });
  assert.equal(r1.body.kind, "unknown");
  assert.equal(t1.calls.insert, 0);
  const t2 = mockTransport({ get: () => ({ kind: "not_found" }), insert: () => ({ ok: false, status: 500, unknown: true }) });
  const h2 = createJobCalendarHandler({ base44: mockBase44({ me: { id: OWNER } }), transport: t2, createEnabled: true, sha256 });
  const r2 = await h2.handleCreate({ payload: pl() }, { id: OWNER });
  assert.equal(r2.body.kind, "unknown");
});
test("handler create: rejected pricing payload -> 400 notes_contain_pricing, zero transport calls", async () => {
  const t = mockTransport({ get: () => { throw new Error("no"); }, insert: () => { throw new Error("no"); } });
  const handler = createJobCalendarHandler({ base44: mockBase44({ me: { id: OWNER } }), transport: t, createEnabled: true, sha256 });
  const r = await handler.handleCreate({ payload: pl({ notes: "Labor $500" }) }, { id: OWNER });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, "notes_contain_pricing");
  assert.equal(t.calls.get + t.calls.insert, 0);
});
test("handler create: stale reviewed title -> 409 stale_review, zero transport calls", async () => {
  const t = mockTransport({ get: () => { throw new Error("no"); }, insert: () => { throw new Error("no"); } });
  const handler = createJobCalendarHandler({ base44: mockBase44({ me: { id: OWNER }, job: { ...JOB, canonical_name: "Renamed" } }), transport: t, createEnabled: true, sha256 });
  const r = await handler.handleCreate({ payload: pl() }, { id: OWNER });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, "stale_review");
  assert.equal(t.calls.get + t.calls.insert, 0);
});

// ---- real google transport (mock fetch/connector) wired through the handler:
// disabled and auth-fail must cause ZERO token/fetch/write. The adapter under test
// is the real createGoogleTransport; only fetch + getToken are mocked. ----
test("handler + real google transport: production disabled -> zero token/fetch", async () => {
  let tokenCalls = 0, fetchCalls = 0;
  const transport = createGoogleTransport({
    getToken: async () => { tokenCalls++; return "T"; },
    fetch: async () => { fetchCalls++; return { ok: true, status: 200, json: async () => ({ items: [] }) }; },
    calendar: "iryedra@gmail.com",
  });
  const handler = createJobCalendarHandler({ base44: mockBase44({ me: { id: OWNER } }), transport, createEnabled: false, sha256 });
  const r = await handler.handleCreate({ payload: pl() }, { id: OWNER });
  assert.equal(r.body.disabled, true);
  assert.equal(tokenCalls, 0);
  assert.equal(fetchCalls, 0);
});
test("handler + real google transport: auth fail (non-owner) -> zero token/fetch", async () => {
  let tokenCalls = 0, fetchCalls = 0;
  const transport = createGoogleTransport({
    getToken: async () => { tokenCalls++; return "T"; },
    fetch: async () => { fetchCalls++; return { ok: true, status: 200, json: async () => ({ items: [] }) }; },
    calendar: "iryedra@gmail.com",
  });
  const handler = createJobCalendarHandler({ base44: mockBase44({ me: { id: "notowner" } }), transport, createEnabled: false, sha256 });
  const r = await handler.handle(req({ action: "read_upcoming", job_id: JOB.id }));
  assert.equal(r.status, 403);
  assert.equal(tokenCalls, 0);
  assert.equal(fetchCalls, 0);
});
test("handler + real google transport: unauthenticated -> zero token/fetch", async () => {
  let tokenCalls = 0, fetchCalls = 0;
  const transport = createGoogleTransport({
    getToken: async () => { tokenCalls++; return "T"; },
    fetch: async () => { fetchCalls++; return { ok: true, status: 200, json: async () => ({ items: [] }) }; },
    calendar: "iryedra@gmail.com",
  });
  const handler = createJobCalendarHandler({ base44: mockBase44({ me: null }), transport, createEnabled: false, sha256 });
  const r = await handler.handle(req({ action: "read_upcoming", job_id: JOB.id }));
  assert.equal(r.status, 401);
  assert.equal(tokenCalls, 0);
  assert.equal(fetchCalls, 0);
});

// ---- one-payload exact gate (injectable exactTestPayload; production null) ----
// Gate enables ONLY when every CREATE_FIELDS value strictly equals the injected
// test payload AND the server-computed fingerprint matches AND the caller is the
// payload's owner. Every changed field / other user / other request -> disabled
// (or owner_mismatch 400), zero transport/token/write. Production passes no
// exactTestPayload, so the gate never enables in production.
async function gatePayload() {
  const p = pl();
  const fp = await core.fingerprintHash(p, { sha256 });
  return { ...p, fingerprint: fp };
}
test("gate: exact payload + injected gate -> enabled, create runs (mock) -> existing_match", async () => {
  const gate = await gatePayload();
  const p = pl();
  const ex = await existingEvent(p, gate.fingerprint);
  const t = mockTransport({ get: () => ({ kind: "found", event: ex }) });
  const handler = createJobCalendarHandler({ base44: mockBase44({ me: { id: OWNER } }), transport: t, createEnabled: false, sha256, exactTestPayload: gate });
  const r = await handler.handleCreate({ payload: p }, { id: OWNER });
  assert.equal(r.body.ok, true);
  assert.equal(r.body.kind, "existing_match");
  assert.equal(t.calls.get, 1);
  assert.equal(t.calls.insert, 0);
});
test("gate: no gate (null) + createEnabled=false -> disabled, zero transport", async () => {
  const t = mockTransport({ get: () => { throw new Error("no"); }, insert: () => { throw new Error("no"); } });
  const handler = createJobCalendarHandler({ base44: mockBase44({ me: { id: OWNER } }), transport: t, createEnabled: false, sha256 });
  const r = await handler.handleCreate({ payload: pl() }, { id: OWNER });
  assert.equal(r.body.disabled, true);
  assert.equal(t.calls.get + t.calls.insert, 0);
});
test("gate: every changed field -> disabled, zero transport", async () => {
  const gate = await gatePayload();
  const t = mockTransport({ get: () => { throw new Error("no"); }, insert: () => { throw new Error("no"); } });
  const changes = [
    { request_id: "req-00000002" },
    { start_date: "2026-10-11", end_date: "2026-10-11" },
    { all_day: false, start_time: "09:00", end_time: "10:00" },
    { time_zone: "America/Chicago" },
    { notes: "Different notes" },
    { confirm_no_jobsite: true },
  ];
  for (const over of changes) {
    const handler = createJobCalendarHandler({ base44: mockBase44({ me: { id: OWNER } }), transport: t, createEnabled: false, sha256, exactTestPayload: gate });
    const r = await handler.handleCreate({ payload: pl(over) }, { id: OWNER });
    assert.equal(r.body.disabled, true, `changed ${JSON.stringify(over)}`);
    assert.equal(r.body.stage, "create_disabled_in_stage", `changed ${JSON.stringify(over)}`);
  }
  assert.equal(t.calls.get + t.calls.insert, 0);
});
test("gate: other user (owner_mismatch) -> 400, zero transport", async () => {
  const gate = await gatePayload();
  const t = mockTransport({ get: () => { throw new Error("no"); }, insert: () => { throw new Error("no"); } });
  const handler = createJobCalendarHandler({ base44: mockBase44({ me: { id: OWNER } }), transport: t, createEnabled: false, sha256, exactTestPayload: gate });
  const r = await handler.handleCreate({ payload: pl() }, { id: "6a8229a9801b2aef9278ff47" });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, "owner_mismatch");
  assert.equal(t.calls.get + t.calls.insert, 0);
});
test("gate: fingerprint mismatch (gate.fingerprint tampered) -> disabled, zero transport", async () => {
  const gate = await gatePayload();
  gate.fingerprint = "deadbeef";
  const t = mockTransport({ get: () => { throw new Error("no"); }, insert: () => { throw new Error("no"); } });
  const handler = createJobCalendarHandler({ base44: mockBase44({ me: { id: OWNER } }), transport: t, createEnabled: false, sha256, exactTestPayload: gate });
  const r = await handler.handleCreate({ payload: pl() }, { id: OWNER });
  assert.equal(r.body.disabled, true);
  assert.equal(t.calls.get + t.calls.insert, 0);
});
test("gate: createEnabled=true still works without gate (broader switch independent)", async () => {
  const p = pl();
  const ex = await existingEvent(p, await core.fingerprintHash(p, { sha256 }));
  const t = mockTransport({ get: () => ({ kind: "found", event: ex }) });
  const handler = createJobCalendarHandler({ base44: mockBase44({ me: { id: OWNER } }), transport: t, createEnabled: true, sha256 });
  const r = await handler.handleCreate({ payload: p }, { id: OWNER });
  assert.equal(r.body.ok, true);
  assert.equal(r.body.kind, "existing_match");
});