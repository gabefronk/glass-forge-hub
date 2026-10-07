// Tests for the pure Google Calendar transport factory. No live provider, no
// network. The EXACT production adapter (createGoogleTransport) is exercised with
// a mock fetch and mock getToken — the adapter under test is never mocked away.
// Asserts: list paginated URLs/auth/time bounds/page tokens + HTTP/JSON/missing
// token errors; get 404->not_found, 401/403/500/throws/malformed/wrong-id->unknown;
// insert exact calendar URL + sendUpdates=none + body + content-type, 409,
// non-OK/parse/missing-id/throws->unknown.
import test from "node:test";
import assert from "node:assert/strict";
import { createGoogleTransport } from "../base44/shared/jobCalendarGoogleTransport.js";

const CAL = "iryedra@gmail.com";
const okToken = async () => "TOKEN";

function mockFetch(responses) {
  const calls = [];
  let i = 0;
  const f = async (url, opts) => {
    calls.push({ url, method: opts?.method || "GET", headers: opts?.headers || {}, body: opts?.body });
    const r = responses[i++] || responses[responses.length - 1];
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.body };
  };
  f.calls = calls;
  return f;
}

// ---- list ----
test("transport list: paginated URLs with auth, time bounds, page tokens", async () => {
  const f = mockFetch([
    { status: 200, body: { items: [{ id: "a" }], nextPageToken: "T2" } },
    { status: 200, body: { items: [{ id: "b" }] } },
  ]);
  const t = createGoogleTransport({ getToken: okToken, fetch: f, calendar: CAL });
  const r = await t.listEvents("2026-10-07T00:00:00.000Z", "2027-01-07T00:00:00.000Z");
  assert.equal(r.error, null);
  assert.deepEqual(r.items.map((e) => e.id), ["a", "b"]);
  assert.equal(f.calls.length, 2);
  assert.match(f.calls[0].url, /\/calendars\/iryedra%40gmail\.com\/events\?singleEvents=true&orderBy=startTime&maxResults=2500&timeMin=2026-10-07T00%3A00%3A00\.000Z&timeMax=2027-01-07T00%3A00%3A00\.000Z$/);
  assert.match(f.calls[1].url, /&pageToken=T2$/);
  assert.equal(f.calls[0].headers.Authorization, "Bearer TOKEN");
});
test("transport list: HTTP error -> error.http", async () => {
  const f = mockFetch([{ status: 503, body: {} }]);
  const r = await createGoogleTransport({ getToken: okToken, fetch: f, calendar: CAL }).listEvents("a", "b");
  assert.equal(r.error.kind, "http");
  assert.equal(r.error.status, 503);
});
test("transport list: provider error body -> error.shape", async () => {
  const f = mockFetch([{ status: 200, body: { error: { message: "bad" } } }]);
  const r = await createGoogleTransport({ getToken: okToken, fetch: f, calendar: CAL }).listEvents("a", "b");
  assert.equal(r.error.kind, "shape");
});
test("transport list: missing token -> error.not_connected, zero fetch", async () => {
  const f = mockFetch([]);
  const r = await createGoogleTransport({ getToken: async () => "", fetch: f, calendar: CAL }).listEvents("a", "b");
  assert.equal(r.error.kind, "not_connected");
  assert.equal(f.calls.length, 0);
});
test("transport list: getToken throws -> error.not_connected, zero fetch", async () => {
  const f = mockFetch([]);
  const r = await createGoogleTransport({ getToken: async () => { throw new Error("no"); }, fetch: f, calendar: CAL }).listEvents("a", "b");
  assert.equal(r.error.kind, "not_connected");
  assert.equal(f.calls.length, 0);
});

// ---- get ----
test("transport get: 404 -> not_found", async () => {
  const f = mockFetch([{ status: 404, body: {} }]);
  assert.equal((await createGoogleTransport({ getToken: okToken, fetch: f, calendar: CAL }).getEvent("eid")).kind, "not_found");
});
test("transport get: 401/403/500 -> unknown", async () => {
  for (const s of [401, 403, 500]) {
    const f = mockFetch([{ status: s, body: {} }]);
    assert.equal((await createGoogleTransport({ getToken: okToken, fetch: f, calendar: CAL }).getEvent("eid")).kind, "unknown", String(s));
  }
});
test("transport get: fetch throw -> unknown", async () => {
  const f = async () => { throw new Error("net"); };
  assert.equal((await createGoogleTransport({ getToken: okToken, fetch: f, calendar: CAL }).getEvent("eid")).kind, "unknown");
});
test("transport get: malformed body / wrong id -> unknown", async () => {
  const f1 = mockFetch([{ status: 200, body: { not: "an event" } }]);
  assert.equal((await createGoogleTransport({ getToken: okToken, fetch: f1, calendar: CAL }).getEvent("eid")).kind, "unknown");
  const f2 = mockFetch([{ status: 200, body: { id: "other" } }]);
  assert.equal((await createGoogleTransport({ getToken: okToken, fetch: f2, calendar: CAL }).getEvent("eid")).kind, "unknown");
});
test("transport get: 200 matching id -> found", async () => {
  const f = mockFetch([{ status: 200, body: { id: "eid", summary: "x" } }]);
  const r = await createGoogleTransport({ getToken: okToken, fetch: f, calendar: CAL }).getEvent("eid");
  assert.equal(r.kind, "found");
  assert.equal(r.event.id, "eid");
});
test("transport get: missing token -> unknown, zero fetch", async () => {
  const f = mockFetch([]);
  assert.equal((await createGoogleTransport({ getToken: async () => "", fetch: f, calendar: CAL }).getEvent("eid")).kind, "unknown");
  assert.equal(f.calls.length, 0);
});

// ---- insert ----
test("transport insert: exact calendar URL + sendUpdates=none + body + content-type + auth", async () => {
  const f = mockFetch([{ status: 200, body: { id: "eid", status: "confirmed" } }]);
  const r = await createGoogleTransport({ getToken: okToken, fetch: f, calendar: CAL }).insertEvent({ id: "eid", summary: "x" });
  assert.equal(r.ok, true);
  assert.match(f.calls[0].url, /\/calendars\/iryedra%40gmail\.com\/events\?sendUpdates=none$/);
  assert.equal(f.calls[0].method, "POST");
  assert.equal(f.calls[0].headers["Content-Type"], "application/json");
  assert.equal(f.calls[0].headers.Authorization, "Bearer TOKEN");
  assert.equal(f.calls[0].body, JSON.stringify({ id: "eid", summary: "x" }));
});
test("transport insert: 409 -> { ok:false, status:409 }", async () => {
  const f = mockFetch([{ status: 409, body: {} }]);
  const r = await createGoogleTransport({ getToken: okToken, fetch: f, calendar: CAL }).insertEvent({ id: "eid" });
  assert.equal(r.ok, false);
  assert.equal(r.status, 409);
  assert.equal(r.unknown, undefined);
});
test("transport insert: 500 -> unknown", async () => {
  const f = mockFetch([{ status: 500, body: {} }]);
  const r = await createGoogleTransport({ getToken: okToken, fetch: f, calendar: CAL }).insertEvent({ id: "eid" });
  assert.equal(r.ok, false);
  assert.equal(r.unknown, true);
});
test("transport insert: parse error / missing id -> unknown", async () => {
  const f1 = mockFetch([{ status: 200, body: { nope: true } }]);
  const r1 = await createGoogleTransport({ getToken: okToken, fetch: f1, calendar: CAL }).insertEvent({ id: "eid" });
  assert.equal(r1.ok, false);
  assert.equal(r1.unknown, true);
});
test("transport insert: fetch throw -> unknown", async () => {
  const f = async () => { throw new Error("net"); };
  const r = await createGoogleTransport({ getToken: okToken, fetch: f, calendar: CAL }).insertEvent({ id: "eid" });
  assert.equal(r.ok, false);
  assert.equal(r.unknown, true);
});
test("transport insert: missing token -> unknown, zero fetch", async () => {
  const f = mockFetch([]);
  const r = await createGoogleTransport({ getToken: async () => "", fetch: f, calendar: CAL }).insertEvent({ id: "eid" });
  assert.equal(r.ok, false);
  assert.equal(r.unknown, true);
  assert.equal(f.calls.length, 0);
});