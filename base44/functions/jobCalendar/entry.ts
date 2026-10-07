// Scoped job-calendar function: owner-gated read of upcoming crew-calendar events
// for ONE job (price-free, minimal), and a staged create that is HARD OFF in the
// deployed entry — it returns disabled BEFORE any transport GET/POST, token fetch
// or Hub write. The real create orchestration (core.createEvent) and the request
// handler live in pure injectable modules tested with mocked transport:
//   - base44/shared/jobCalendarHandler.js  (createJobCalendarHandler factory)
//   - base44/shared/jobCalendarCore.js     (pure matching + create orchestration)
//
// This entry wires REAL Google adapters (server-side OAuth via the configured
// googlecalendar connector) and createEnabled=false. Tests import the factory
// directly with mock transport + mock base44 and set createEnabled=true to
// exercise the same handleCreate code path against mocks. No client ever sees
// the token; no provider reads/writes happen during test/build.
//
// Auth: only the two owner auth ids may call either action. Read does not widen
// existing CalendarEvents access — it scopes to the job and returns a sanitized,
// minimal projection. No Hub writes on read. Create validates the payload,
// re-reads the job and rejects a stale reviewed title/address (stale_review), a
// merged job and an empty jobsite (unless confirmed), then returns disabled.
// Explicit-identity-only matching: private property hubJobId or an allowlisted
// https Hub /jobs/<id> URL. No name fallback, no global Jobs catalog, no
// mirror-only fallback.

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';
import * as core from '../../shared/jobCalendarCore.js';
import { createJobCalendarHandler } from '../../shared/jobCalendarHandler.js';

const CAL_API = 'https://www.googleapis.com/calendar/v3';
const CREW_CAL = core.CREW_CALENDAR;

function json(body: any, status = 200) {
  return Response.json(body, { status, headers: { 'content-type': 'application/json', 'Cache-Control': 'no-store' } });
}

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// Real Google Calendar transport. OAuth token is fetched server-side via the
// configured googlecalendar connector; no client ever sees it. Network-unknown
// semantics: a non-OK status, malformed body, or throw is never fabricated as
// success — it maps to the core's unknown outcomes (no retry POST unless a GET
// proves the event is missing).
function realTransport(base44: any) {
  const getToken = async () => {
    const { accessToken } = await base44.asServiceRole.connectors.getConnection('googlecalendar');
    if (!accessToken) throw new Error('calendar_not_connected');
    return accessToken;
  };
  return {
    listEvents: async (timeMin: string, timeMax: string) => {
      let token;
      try { token = await getToken(); } catch { return { items: [], error: { kind: 'not_connected' } }; }
      const base = `${CAL_API}/calendars/${encodeURIComponent(CREW_CAL)}/events?singleEvents=true&orderBy=startTime&maxResults=2500&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`;
      const fetchPage = async (pageToken: string | null) => {
        const res = await fetch(base + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''), { headers: { Authorization: `Bearer ${token}` } });
        return { ok: res.ok, status: res.status, json: () => res.json() };
      };
      return core.paginateGoogleEvents(fetchPage);
    },
    getEvent: async (id: string) => {
      const token = await getToken();
      let res;
      try { res = await fetch(`${CAL_API}/calendars/${encodeURIComponent(CREW_CAL)}/events/${encodeURIComponent(id)}`, { headers: { Authorization: `Bearer ${token}` } }); }
      catch { return { kind: 'unknown' }; }
      if (res.status === 404) return { kind: 'not_found' };
      if (!res.ok) return { kind: 'unknown' };
      let ev;
      try { ev = await res.json(); } catch { return { kind: 'unknown' }; }
      if (!ev || typeof ev !== 'object' || typeof ev.id !== 'string') return { kind: 'unknown' };
      return { kind: 'found', event: ev };
    },
    insertEvent: async (body: any) => {
      const token = await getToken();
      let res;
      try { res = await fetch(`${CAL_API}/calendars/${encodeURIComponent(CREW_CAL)}/events`, { method: 'POST', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
      catch { return { ok: false, status: 0, unknown: true }; }
      if (res.status === 409) return { ok: false, status: 409 };
      if (!res.ok) return { ok: false, status: res.status, unknown: true };
      let ev;
      try { ev = await res.json(); } catch { return { ok: false, status: res.status, unknown: true }; }
      if (!ev || typeof ev !== 'object' || typeof ev.id !== 'string') return { ok: false, status: res.status, unknown: true };
      return { ok: true, status: res.status, event: ev };
    },
  };
}

export default async function (req: Request) {
  const base44 = createClientFromRequest(req);
  const handler = createJobCalendarHandler({ base44, transport: realTransport(base44), createEnabled: false, sha256: sha256Hex });
  const r = await handler.handle(req);
  return json(r.body, r.status);
}