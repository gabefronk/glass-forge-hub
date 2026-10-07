// Frontend twin for the scoped job-calendar UI. Pure JS, no base44/shared imports
// (platform blocks those from the client bundle). Server twin:
// base44/shared/jobCalendarCore.js. Display shaping, safe error mapping, the pure
// create-outcome decision, the validated frozen-request storage, preview fixtures.
import { validateReviewed } from './jobCalendarValidate.js';

export const JOB_CALENDAR_OWNER_IDS = new Set([
  '6a7f0d834a5f825c724273ea',
  '6a8229a9801b2aef9278ff47',
]);
export const isJobCalendarOwner = (user) => !!user && JOB_CALENDAR_OWNER_IDS.has(user.id);

// Create transport availability. ON (RELEASE): the server create path is enabled
// end-to-end (jobCalendar createEnabled=true). Gating the Add-visit button on this
// shows it only for the two owner auth ids; the modal runs the real reviewed create.
export const JOB_CREATE_ENABLED = true;

export const CREW_CALENDAR_LABEL = 'Israel crew calendar (iryedra@gmail.com)';
export const HUB_BASE = 'https://gfglassforge.com';

export function newRequestId() {
  try { return crypto.randomUUID(); } catch { return 'r-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10); }
}

const DAY_FMT = (d) => { if (!d) return ''; const [y, m, dd] = String(d).slice(0, 10).split('-').map(Number); return new Date(y, m - 1, dd).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); };

export function formatUpcomingLine(ev) {
  if (!ev) return '';
  const day = DAY_FMT(ev.date);
  if (ev.all_day) return `${day} · all day`;
  const t = [ev.start_time, ev.end_time].filter(Boolean).join('–');
  return `${day}${t ? ` · ${t}` : ''}`;
}

export function formatUpcomingPurpose(ev) {
  const p = String(ev?.purpose || '').trim();
  return p || 'No notes.';
}

// Word-boundary truncation for the upcoming purpose preview. Never cuts mid-word
// and never leaves a trailing hyphen before the ellipsis (the server used to hard
// cut at 280, producing '- Fr…'). Returns the full text unchanged when it fits.
export function truncatePurpose(text, max = 120) {
  const full = String(text || '').trim();
  if (full.length <= max) return full;
  const slice = full.slice(0, max);
  const boundary = slice.lastIndexOf(' ');
  const cut = boundary > Math.floor(max * 0.4) ? slice.slice(0, boundary) : slice;
  return cut.replace(/[\s,;:.\-]+$/, '').trim() + '…';
}

// Hero "next visit" projection from the first confirmed upcoming event. Pure: no
// fetch, no records. purposePreview is word-boundary truncated; purposeFull is the
// complete sanitized punch list for expansion. Returns null when there are no events.
export function nextVisitProjection(events) {
  if (!Array.isArray(events) || events.length === 0) return null;
  const ev = events[0];
  if (!ev) return null;
  const full = String(ev.purpose || '').trim();
  const preview = truncatePurpose(full, 120);
  return {
    line: formatUpcomingLine(ev),
    purposePreview: preview || 'No notes.',
    purposeFull: full || 'No notes.',
    link: safeLink(ev.link),
    flagged: !!ev.flagged,
    expandable: preview !== full && full.length > 0,
  };
}

// ---- safe error mapping (no raw provider/exception strings in the UI) ----
export const SAFE_ERRORS = {
  sign_in_required: 'Sign in required.',
  owner_access_required: 'Owner access required.',
  owner_mismatch: 'This request belongs to a different sign-in.',
  invalid_job_id: 'This job could not be found.',
  job_not_found: 'This job could not be found.',
  job_merged: 'This job was combined into another record.',
  stale_review: 'This job changed since you reviewed it. Review again.',
  jobsite_required: 'Add a jobsite address to this job, or confirm there is none.',
  notes_contain_pricing: 'Notes contain pricing. Remove it and review again.',
  invalid_payload: 'Some details are not valid. Edit and review again.',
  merged_cycle: 'This job has a combine cycle. Contact support.',
  jobs_catalog_unavailable: 'Jobs catalog could not load.',
  calendar_not_connected: 'The crew calendar is not connected.',
  calendar_read_failed: 'The crew calendar could not be read right now.',
  job_calendar_failed: 'Create could not be confirmed. Retry sends the same request.',
  prior_unknown: 'An earlier attempt for this request is still unconfirmed. Retry sends the same request.',
  conflict: 'The crew calendar holds a different event for this request. Nothing was changed.',
  lock_failed: 'This device could not save a lock for the request, so nothing was sent.',
  damaged: 'The saved request on this device is damaged, so nothing was sent. Check the crew calendar before adding another visit.',
};
export function safeError(code) {
  if (code && SAFE_ERRORS[code]) return SAFE_ERRORS[code];
  return 'Something went wrong. Retry sends the same request.';
}
// Proven noncreation: the server rejected this call before any write.
export const PROVEN_NONCREATION = new Set([
  'sign_in_required', 'owner_access_required', 'owner_mismatch', 'invalid_job_id', 'job_not_found',
  'job_merged', 'stale_review', 'jobsite_required', 'notes_contain_pricing', 'missing_field',
  'invalid_payload', 'merged_cycle', 'unknown_action', 'invalid_body', 'method_not_allowed',
]);
export function isProvenNoncreation(code) { return PROVEN_NONCREATION.has(code); }

export const safeLink = (l) => (typeof l === 'string' && l.startsWith('https://') ? l : '');

// ---- pure create-outcome decision ----
// d = server response body (null = network failure). priorUnknown = an earlier
// attempt of this frozen request had an unknown outcome: a rejection of THIS call
// does not prove the earlier one created nothing, so the lock is kept.
export function decideCreateOutcome(d, { priorUnknown = false } = {}) {
  const locked = (code) => ({ step: 'locked', kind: '', release: false, error: safeError(code) });
  if (d && d.disabled === true) {
    return priorUnknown ? locked('prior_unknown') : { step: 'done', kind: 'staged', release: true, error: '', link: '' };
  }
  if (d && d.ok === true && (d.kind === 'created' || d.kind === 'existing_match')) {
    return { step: 'done', kind: d.kind === 'created' ? 'created' : 'existing', release: true, error: '', link: safeLink(d.event?.htmlLink) };
  }
  if (d && d.ok === true && d.kind === 'deleted') return { step: 'done', kind: 'deleted', release: true, error: '', link: '' };
  if (d && d.ok === true && (d.kind === 'conflict_changed' || d.kind === 'foreign')) return locked('conflict');
  if (d && typeof d.error === 'string' && isProvenNoncreation(d.error)) {
    return priorUnknown ? locked('prior_unknown') : { step: 'form', kind: '', release: true, error: safeError(d.error) };
  }
  return locked(d && d.error);
}

// ---- frozen create request (tab session, scoped to user+job) ----
// Record: { v: 1, status: 'creating', priorUnknown: boolean, payload }. The payload
// is the complete reviewed payload; it is validated on every read, and retries send
// exactly the stored bytes.
export const frozenKey = (userId, jobId) => `jobCalendar:create:v1:${userId}:${jobId}`;

export function readFrozen(store, userId, jobId) {
  let raw;
  try { raw = store.getItem(frozenKey(userId, jobId)); } catch { return { state: 'damaged' }; }
  if (raw == null) return { state: 'none' };
  let rec;
  try { rec = JSON.parse(raw); } catch { return { state: 'damaged' }; }
  const p = rec && rec.payload;
  const valid = rec && typeof rec === 'object' && rec.v === 1 && rec.status === 'creating'
    && typeof rec.priorUnknown === 'boolean' && validateReviewed(p).ok
    && p.job_id === jobId && p.owner_id === userId;
  return valid ? { state: 'locked', record: rec, raw } : { state: 'damaged' };
}
export function writeFrozen(store, userId, jobId, record) {
  const s = JSON.stringify(record);
  try {
    store.setItem(frozenKey(userId, jobId), s);
    return store.getItem(frozenKey(userId, jobId)) === s;
  } catch { return false; }
}
export function clearFrozen(store, userId, jobId) {
  try { store.removeItem(frozenKey(userId, jobId)); } catch {}
}

// ---- fixtures for tests / read-only preview (desktop + mobile pixel verification) ----
export const UPCOMING_SATURDAY_FIXTURE = {
  id: 'j07huir7q8nhpnm733dehffc4k',
  date: '2026-10-10',
  all_day: true,
  start_time: null,
  end_time: null,
  purpose: 'Finish up install trim items. Repaso: instalar molduras.',
  flagged: false,
  location: '1497 E 200 N St, Beaver, UT 84713',
  link: 'https://calendar.google.com/calendar/event?eid=fixture',
  calendar: 'iryedra@gmail.com',
};

export const BEAVER_JOB_FIXTURE = { id: '6a817395914bfa31ecd0f1f6', canonical_name: 'Beaver - 412', address: '1497 E 200 N St, Beaver, UT 84713' };
export const OWNER_FIXTURE = { id: '6a7f0d834a5f825c724273ea' };

export const CREATE_REVIEW_FIXTURE = {
  job_id: '6a817395914bfa31ecd0f1f6',
  owner_id: '6a7f0d834a5f825c724273ea',
  request_id: '00000000-0000-4000-8000-000000000001',
  all_day: true,
  start_date: '2026-10-10',
  end_date: '2026-10-10',
  start_time: null,
  end_time: null,
  time_zone: 'America/Denver',
  title: 'Beaver - 412',
  address: '1497 E 200 N St, Beaver, UT 84713',
  notes: 'Finish up install trim items.',
  confirm_no_jobsite: false,
};
export const CREATE_REVIEW_TIMED_FIXTURE = { ...CREATE_REVIEW_FIXTURE, request_id: '00000000-0000-4000-8000-000000000002', all_day: false, start_time: '09:00', end_time: '11:30' };

export const CREATE_RESULT_STAGED = { ok: false, disabled: true, stage: 'create_disabled_in_stage', reviewed: { ...CREATE_REVIEW_FIXTURE } };
export const CREATE_RESULT_CREATED = { ok: true, kind: 'created', event_id: 'evtcreated', event: { id: 'evtcreated', htmlLink: 'https://calendar.google.com/calendar/event?eid=created' } };
export const CREATE_RESULT_EXISTING = { ok: true, kind: 'existing_match', event_id: 'evtexisting', event: { id: 'evtexisting', htmlLink: 'https://calendar.google.com/calendar/event?eid=existing' } };

export const UPCOMING_STATES = {
  loading: { loading: true, error: '', events: [] },
  empty: { loading: false, error: '', events: [] },
  error: { loading: false, error: 'calendar_not_connected', events: [] },
  list: { loading: false, error: '', events: [UPCOMING_SATURDAY_FIXTURE] },
};