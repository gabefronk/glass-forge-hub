// Injectable job-calendar request handler factory. Pure JS: no Base44 SDK, no
// fetch, no crypto imported — base44, transport and sha256 are injected.
//
// The production entry (base44/functions/jobCalendar/entry.ts) wires REAL Google
// adapters (server-side OAuth via the configured googlecalendar connector) and
// createEnabled=false. Tests inject mock transport + mock base44 and may set
// createEnabled=true to exercise the SAME handleCreate code path against mocks.
//
// Production create is hard-off: handleCreate returns disabled BEFORE any
// transport GET/POST, token fetch, or Hub write. Read is owner-gated, scopes to
// one job, returns a price-free minimal projection, and writes nothing to the
// Hub. Explicit-identity-only matching (private property hubJobId or an
// allowlisted https Hub /jobs/<id> URL); no name fallback, no global Jobs
// catalog, no mirror-only fallback.
import * as core from './jobCalendarCore.js';

function out(status, body) { return { status, body }; }

export function createJobCalendarHandler({ base44, transport, createEnabled = false, sha256 }) {
  const api = base44?.asServiceRole?.entities;

  async function handleRead(body) {
    const jobId = String(body?.job_id || '');
    if (!/^[a-f0-9]{24}$/.test(jobId)) return out(400, { error: 'invalid_job_id' });
    const getJob = async (id) => { try { return await api.Jobs.get(id); } catch { return null; } };
    const surv = await core.resolveSurvivor(jobId, getJob);
    if (surv.cycled) return out(409, { error: 'merged_cycle' });
    if (surv.missing || !surv.job) return out(404, { error: 'job_not_found' });

    const now = new Date();
    const todayDenver = core.denverDate(now);
    const timeMin = now.toISOString();
    const timeMax = new Date(now.getTime() + 90 * 86400000).toISOString();
    let r;
    try { r = await transport.listEvents(timeMin, timeMax); } catch { return out(502, { error: 'calendar_read_failed' }); }
    if (!r || r.error) return out(502, { error: r?.error?.kind === 'not_connected' ? 'calendar_not_connected' : 'calendar_read_failed' });
    const liveAll = r.items || [];

    const mirrorRows = await api.CalendarEvents.filter({ job_id: surv.id }, '-event_date', 500).catch(() => []);
    const { events } = core.buildUpcomingRead({ liveAll, mirrorRows, job: surv.job, now, todayDenver });
    return out(200, { ok: true, job_id: surv.id, events });
  }

  async function handleCreate(body, user) {
    const p = body?.payload;
    const v = core.validateCreatePayload(p, { ownerId: user?.id });
    if (!v.ok) {
      const code = v.errors.includes('notes_contain_pricing') ? 'notes_contain_pricing'
        : v.errors.includes('owner_mismatch') ? 'owner_mismatch' : 'invalid_payload';
      return out(400, { error: code, fields: v.errors });
    }
    const job = await api.Jobs.get(p.job_id).catch(() => null);
    const rv = core.verifyReviewedJob({ payload: p, job });
    if (!rv.ok) return out(rv.error === 'job_not_found' ? 404 : (rv.error === 'job_merged' || rv.error === 'stale_review' ? 409 : 400), { error: rv.error });

    const eventId = await core.deterministicId(p.owner_id, p.request_id, { sha256 });
    const fingerprint = await core.fingerprintHash(p, { sha256 });
    const eff = v.effective;

    if (!createEnabled) {
      // Create disabled (createEnabled=false): returns BEFORE any transport GET/POST,
      // token fetch or Hub write. Auth + a Jobs.get read still happen first to verify
      // the reviewed job; no token, no provider call, no Hub write occurs.
      return out(200, { ok: false, disabled: true, stage: 'create_disabled_in_stage', event_id: eventId, fingerprint, reviewed: { ...p, provider_start: eff.start, provider_end: eff.end, last_day: eff.last_day, overnight: eff.overnight, multiday: eff.multiday } });
    }

    // Create path: real createEvent orchestration — deterministic id, frozen retry,
    // GET-exact reconciliation, cancellation never recreated, full live-content
    // compare. The injected transport is the real Google adapter in production,
    // mocked in tests.
    const result = await core.createEvent({ transport, job, payload: p, sha256 });
    return out(200, mapCreateResult(result, eventId, fingerprint));
  }

  async function handle(req) {
    try {
      if (req.method !== 'POST') return out(405, { error: 'method_not_allowed' });
      const body = await req.json().catch(() => ({}));
      if (!body || typeof body !== 'object' || Array.isArray(body)) return out(400, { error: 'invalid_body' });
      const action = String(body.action || '');
      let user = null;
      try { user = await base44.auth.me(); } catch { user = null; }
      if (!user) return out(401, { error: 'sign_in_required' });
      if (!core.isOwner(user)) return out(403, { error: 'owner_access_required' });
      if (action === 'read_upcoming') return await handleRead(body);
      if (action === 'create') return await handleCreate(body, user);
      return out(400, { error: 'unknown_action', actions: ['read_upcoming', 'create'] });
    } catch {
      return out(500, { error: 'job_calendar_failed' });
    }
  }

  return { handle, handleRead, handleCreate };
}

function mapCreateResult(r, eventId, fingerprint) {
  const base = { event_id: eventId, fingerprint };
  if (r.kind === 'created') return { ok: true, kind: 'created', ...base, event: r.event };
  if (r.kind === 'existing_match') return { ok: true, kind: 'existing_match', ...base, event: r.event };
  if (r.kind === 'deleted') return { ok: true, kind: 'deleted', ...base, event: r.event };
  if (r.kind === 'conflict_changed') return { ok: false, kind: 'conflict_changed', ...base, event: r.event };
  if (r.kind === 'foreign') return { ok: false, kind: 'foreign', ...base, event: r.event };
  if (r.kind === 'rejected') return { ok: false, kind: 'rejected', errors: r.errors };
  return { ok: false, kind: 'unknown', ...base, stage: r.stage || '' };
}