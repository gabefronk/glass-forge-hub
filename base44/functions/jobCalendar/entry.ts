// Scoped job-calendar function: owner-gated read of upcoming crew-calendar events
// for ONE job (price-free, minimal), and an owner-gated create route that is ON in
// the deployed entry. Create is gated by: the two owner auth ids (owner_id == user.id),
// strict reviewed-payload validation, exact reviewed title/address with stale/merged
// rejection, price-free notes (no attendees/attachments/copy/PDF), a deterministic
// event id with frozen retry, GET-exact reconciliation, and cancellation-never-
// recreated semantics. The real create orchestration (core.createEvent), the request
// handler and the Google transport live in pure injectable modules tested with
// mocked transport/fetch/connector:
//   - base44/shared/jobCalendarHandler.js         (createJobCalendarHandler factory)
//   - base44/shared/jobCalendarGoogleTransport.js (real Google adapter, injectable)
//   - base44/shared/jobCalendarCore.js            (pure matching + create orchestration)
//
// This entry wires REAL adapters: the googlecalendar connector token (server-side)
// and the real fetch, via createGoogleTransport; createEnabled=true (RELEASE). Tests
// import the factory + the transport directly with mocks and set createEnabled=true
// or false to exercise the same handleCreate code path. No client ever sees the token;
// no provider reads/writes happen during test/build.
//
// Auth: only the two owner auth ids may call either action. Read does not widen
// existing CalendarEvents access — it scopes to the job and returns a sanitized,
// minimal projection. No Hub writes on read. Create validates the payload, re-reads
// the job (a Hub READ) and rejects a stale reviewed title/address (stale_review), a
// merged job and an empty jobsite (unless confirmed), then runs the real create
// orchestration. No temporary test gate (exactTestPayload) is present; the handler
// factory no longer accepts one.
// Explicit-identity-only matching: private property hubJobId or an allowlisted
// https Hub /jobs/<id> URL. No name fallback, no global Jobs catalog, no
// mirror-only fallback.

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';
import * as core from '../../shared/jobCalendarCore.js';
import { createJobCalendarHandler } from '../../shared/jobCalendarHandler.js';
import { createGoogleTransport } from '../../shared/jobCalendarGoogleTransport.js';

function json(body: any, status = 200) {
  return Response.json(body, { status, headers: { 'content-type': 'application/json', 'Cache-Control': 'no-store' } });
}

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function realTransport(base44: any) {
  return createGoogleTransport({
    getToken: async () => {
      const { accessToken } = await base44.asServiceRole.connectors.getConnection('googlecalendar');
      if (!accessToken) throw new Error('calendar_not_connected');
      return accessToken;
    },
    fetch,
    calendar: core.CREW_CALENDAR,
  });
}

export default async function (req: Request) {
  const base44 = createClientFromRequest(req);
  // RELEASE GUARD: normal create route is ON. No temporary test gate may be present.
  const RELEASE_CREATE_ENABLED = true;
  const handler = createJobCalendarHandler({ base44, transport: realTransport(base44), createEnabled: RELEASE_CREATE_ENABLED, sha256: sha256Hex });
  const r = await handler.handle(req);
  return json(r.body, r.status);
}