// Scoped job-calendar function: owner-gated read of upcoming crew-calendar events
// for ONE job (price-free, minimal), and a staged create that is HARD OFF in the
// deployed entry — it returns disabled BEFORE any transport GET/POST, token fetch
// or Hub WRITE. The real create orchestration (core.createEvent), the request
// handler and the Google transport live in pure injectable modules tested with
// mocked transport/fetch/connector:
//   - base44/shared/jobCalendarHandler.js         (createJobCalendarHandler factory)
//   - base44/shared/jobCalendarGoogleTransport.js (real Google adapter, injectable)
//   - base44/shared/jobCalendarCore.js            (pure matching + create orchestration)
//
// This entry wires REAL adapters: the googlecalendar connector token (server-side)
// and the real fetch, via createGoogleTransport; createEnabled=false. Tests import
// the factory + the transport directly with mocks and set createEnabled=true to
// exercise the same handleCreate code path. No client ever sees the token; no
// provider reads/writes happen during test/build.
//
// Auth: only the two owner auth ids may call either action. Read does not widen
// existing CalendarEvents access — it scopes to the job and returns a sanitized,
// minimal projection. No Hub writes on read. Create validates the payload,
// re-reads the job (a Hub READ) and rejects a stale reviewed title/address
// (stale_review), a merged job and an empty jobsite (unless confirmed), then
// returns disabled — zero token/provider calls and zero Hub WRITES.
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
  // TEMPORARY one-payload test gate (remove after the single live test). createEnabled
  // stays false; this enables ONLY the exact frozen payload below for the owner.
  const exactTestPayload = {
    job_id: '6abcb461cfe73db4bc147b24',
    owner_id: '6a7f0d834a5f825c724273ea',
    request_id: '9b4a7f63-56d2-4f43-8d8a-276dfd94514a',
    all_day: false,
    start_date: '2026-10-07',
    end_date: '2026-10-07',
    start_time: '18:00',
    end_time: '18:05',
    time_zone: 'America/Denver',
    title: 'concord homes - 5-8 sunset village',
    address: '931-937 N 240 W Spanish Fork, UT 84660',
    notes: 'TEMPORARY TEST ONLY',
    confirm_no_jobsite: false,
    fingerprint: 'd629918057c10dd1099debc6b2c53ee4af5eef201ca3c5dc8ca97af0f7fcc5dc',
  };
  const handler = createJobCalendarHandler({ base44, transport: realTransport(base44), createEnabled: false, sha256: sha256Hex, exactTestPayload });
  const r = await handler.handle(req);
  return json(r.body, r.status);
}