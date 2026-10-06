// Scoped job-calendar function: owner-gated read of upcoming crew-calendar events
// for ONE job (price-free, minimal), and a staged create that is DISABLED in the
// deployed entry (no Google writes). The real create orchestration lives in the
// pure injectable core (base44/shared/jobCalendarCore.js createEvent) and is
// covered by tests; the entry never calls it yet.
//
// Auth: only the two owner auth ids may call either action. Read does not widen
// existing CalendarEvents access — it scopes to the job and returns a sanitized,
// minimal projection. No Hub writes on read. Create makes no Google calls and no
// FeeLines/labor; it validates the payload, re-reads the job for title/address,
// rejects a merged job and an empty jobsite (unless the user confirmed none), and
// returns only safe error codes (no raw provider/exception strings).

import { createClientFromRequest } from 'npm:@base44/sdk@0.8.48';
import * as core from '../../shared/jobCalendarCore.js';

const CAL_API = 'https://www.googleapis.com/calendar/v3';
const CREW_CAL = core.CREW_CALENDAR;
const HUB_BASE = 'https://gfglassforge.com';

function json(body: any, status = 200) {
  return Response.json(body, { status, headers: { 'content-type': 'application/json', 'Cache-Control': 'no-store' } });
}

async function loadAllJobs(api: any) {
  const jobs: any[] = [];
  for (let skip = 0; skip < 50000; skip += 1000) {
    const page = await api.Jobs.list('-created_date', 1000, skip);
    if (!Array.isArray(page) || page.length > 1000) throw new Error('jobs_catalog_incomplete');
    jobs.push(...page);
    if (page.length < 1000) return jobs;
  }
  throw new Error('jobs_catalog_incomplete');
}

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export default async function (req: Request) {
  try {
    if (req.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);
    const body = await req.json().catch(() => ({}));
    if (!body || typeof body !== 'object' || Array.isArray(body)) return json({ error: 'invalid_body' }, 400);
    const action = String(body.action || '');
    const base44 = createClientFromRequest(req);
    let user: any = null;
    try { user = await base44.auth.me(); } catch { user = null; }
    if (!user) return json({ error: 'sign_in_required' }, 401);
    if (!core.isOwner(user)) return json({ error: 'owner_access_required' }, 403);

    if (action === 'read_upcoming') return await handleRead(base44, body);
    if (action === 'create') return await handleCreate(base44, body, user);
    return json({ error: 'unknown_action', actions: ['read_upcoming', 'create'] }, 400);
  } catch {
    // No raw exception strings reach the UI.
    return json({ error: 'job_calendar_failed' }, 500);
  }
}

async function handleRead(base44: any, body: any) {
  const jobId = String(body.job_id || '');
  if (!/^[a-f0-9]{24}$/.test(jobId)) return json({ error: 'invalid_job_id' }, 400);
  const api = base44.asServiceRole.entities;
  // resolveSurvivor is async; await the real async Jobs.get adapter.
  const getJob = async (id: string) => { try { return await api.Jobs.get(id); } catch { return null; } };
  const surv = await core.resolveSurvivor(jobId, getJob);
  if (surv.cycled) return json({ error: 'merged_cycle' }, 409);
  if (surv.missing || !surv.job) return json({ error: 'job_not_found' }, 404);

  let jobsAll: any[];
  try { jobsAll = await loadAllJobs(api); } catch { return json({ error: 'jobs_catalog_unavailable' }, 503); }
  const nameIndex = core.nameUniquenessIndex(jobsAll);

  let token: string;
  try { ({ accessToken: token } = await base44.asServiceRole.connectors.getConnection('googlecalendar')); }
  catch { return json({ error: 'calendar_not_connected' }, 502); }
  if (!token) return json({ error: 'calendar_not_connected' }, 502);
  const headers = { Authorization: `Bearer ${token}` };

  const now = new Date();
  const todayDenver = core.denverDate(now);
  const timeMin = now.toISOString();
  const timeMax = new Date(now.getTime() + 90 * 86400000).toISOString();
  const base = `${CAL_API}/calendars/${encodeURIComponent(CREW_CAL)}/events?singleEvents=true&orderBy=startTime&maxResults=2500&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`;
  const fetchPage = async (pageToken: string | null) => {
    const res = await fetch(base + (pageToken ? `&pageToken=${encodeURIComponent(pageToken)}` : ''), { headers });
    return { ok: res.ok, status: res.status, json: () => res.json() };
  };
  const { items: liveAll, error: pageErr } = await core.paginateGoogleEvents(fetchPage);
  if (pageErr) return json({ error: 'calendar_read_failed' }, 502);

  const mirrorRows = await api.CalendarEvents.filter({ job_id: surv.id }, '-event_date', 500).catch(() => []);
  const { events } = core.buildUpcomingRead({ liveAll, mirrorRows, job: surv.job, nameIndex, now, todayDenver });
  return json({ ok: true, job_id: surv.id, events });
}

async function handleCreate(base44: any, body: any, user: any) {
  // STAGED: no Google writes. Validate, re-read the job, compute the deterministic
  // id + fingerprint + effective dates locally so the UI can lock the review. The
  // real create/reconcile orchestration is in the pure core (createEvent).
  const p = body.payload || {};
  if (!p || typeof p !== 'object') return json({ error: 'invalid_payload', fields: ['missing_payload'] }, 400);
  if (!p.job_id) return json({ error: 'missing_field', field: 'job_id' }, 400);
  if (!p.request_id) return json({ error: 'missing_field', field: 'request_id' }, 400);
  const v = core.validateCreatePayload({ ...p, owner_id: user.id });
  if (!v.ok) return json({ error: 'invalid_payload', fields: v.errors }, 400);

  const api = base44.asServiceRole.entities;
  // Server re-reads Jobs for title/address — reject stale reviewed facts, never silent.
  const job = await api.Jobs.get(String(p.job_id)).catch(() => null);
  if (!job) return json({ error: 'job_not_found' }, 404);
  if (job.merged_into) return json({ error: 'job_merged' }, 409);
  // Reject an empty jobsite unless the user explicitly reviewed the absence.
  const jobsite = job.address || '';
  if (!jobsite && !p.confirm_no_jobsite) return json({ error: 'jobsite_required' }, 400);

  const payload = { ...p, owner_id: user.id, title: job.canonical_name, address: jobsite };
  const eventId = await core.deterministicId(user.id, String(p.request_id), { sha256: sha256Hex });
  const fingerprint = await core.fingerprintHash(payload, { sha256: sha256Hex });
  const eff = core.effectiveDateTime(payload);
  return json({
    ok: false,
    disabled: true,
    stage: 'create_disabled_in_stage',
    event_id: eventId,
    fingerprint,
    reviewed: {
      title: job.canonical_name,
      address: jobsite,
      job_id: job.id,
      all_day: !!payload.all_day,
      start_date: payload.start_date,
      end_date: eff.all_day ? eff.end.date : eff.end_date, // effective provider end date
      last_day: eff.all_day ? eff.last_day : undefined, // all-day: last day inclusive
      start_time: payload.all_day ? null : (payload.start_time || null),
      end_time: payload.all_day ? null : (payload.end_time || null),
      time_zone: payload.time_zone || 'America/Denver',
      overnight: eff.overnight || false,
      multiday: eff.multiday || false,
      notes: payload.notes || '',
    },
  });
}