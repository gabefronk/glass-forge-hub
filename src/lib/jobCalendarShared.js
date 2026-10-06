// Frontend twin for the scoped job-calendar UI. Pure JS, no base44/shared imports
// (platform blocks those from the client bundle). Server twin:
// base44/shared/jobCalendarCore.js — kept in sync manually (same owner ids, same
// Hub base host). Display shaping, the frozen create-request lock, the pure
// create-outcome decision, safe error mapping, and preview fixtures.

export const JOB_CALENDAR_OWNER_IDS = new Set([
  '6a7f0d834a5f825c724273ea',
  '6a8229a9801b2aef9278ff47',
]);
export const isJobCalendarOwner = (user) => !!user && JOB_CALENDAR_OWNER_IDS.has(user.id);

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

// ---- safe error mapping (no raw provider/exception strings in the UI) ----
export const SAFE_ERRORS = {
  sign_in_required: 'Sign in required.',
  owner_access_required: 'Owner access required.',
  invalid_job_id: 'This job could not be found.',
  job_not_found: 'This job could not be found.',
  job_merged: 'This job was combined into another record.',
  jobsite_required: 'Add a jobsite address to this job, or confirm there is none.',
  missing_field: 'A required field is missing.',
  invalid_payload: 'Some details are not valid. Edit and retry.',
  merged_cycle: 'This job has a combine cycle. Contact support.',
  jobs_catalog_unavailable: 'Jobs catalog could not load.',
  calendar_not_connected: 'The crew calendar is not connected.',
  calendar_read_failed: 'The crew calendar could not be read right now.',
  job_calendar_failed: 'Create could not be confirmed. Retry sends the same request.',
};
export function safeError(code) {
  if (code && SAFE_ERRORS[code]) return SAFE_ERRORS[code];
  return 'Something went wrong. Retry sends the same request.';
}
// Proven noncreation: the server rejected before any write, so the frozen request
// is released. job_calendar_failed is NOT here — that is an unknown outcome.
export const PROVEN_NONCREATION = new Set([
  'sign_in_required', 'owner_access_required', 'invalid_job_id', 'job_not_found',
  'job_merged', 'jobsite_required', 'missing_field', 'invalid_payload', 'merged_cycle',
  'unknown_action', 'invalid_body', 'method_not_allowed',
]);
export function isProvenNoncreation(code) { return PROVEN_NONCREATION.has(code); }

// ---- pure create-outcome decision (tested; the modal wires it) ----
// d = the server response body, or null for a network failure. Returns the next
// modal step, whether to release the frozen request, the result kind, and a safe
// error. 'unknown' / network / job_calendar_failed keep the request locked.
export function decideCreateOutcome(d) {
  if (d && d.disabled) return { step: 'done', kind: 'staged', release: true, error: '' };
  if (d && d.ok && (d.kind === 'created' || d.kind === 'existing_match')) {
    return { step: 'done', kind: d.kind === 'existing_match' ? 'existing' : 'created', release: true, error: '', link: d.event?.htmlLink || d.link || '' };
  }
  if (d && d.error && isProvenNoncreation(d.error)) return { step: 'form', kind: '', release: true, error: safeError(d.error) };
  // unknown / network / job_calendar_failed → keep locked, same request id
  return { step: 'locked', kind: '', release: false, error: safeError(d && d.error) };
}

// ---- light form validation before Review (server validates authoritatively) ----
function isValidDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(s || ''))) return false;
  const [y, m, dd] = String(s).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, dd));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === dd;
}
export function reviewFormError(form) {
  if (!form) return 'Add a date.';
  if (!form.start_date || !isValidDate(form.start_date)) return 'Add a valid date.';
  if (form.all_day) {
    if (form.end_date && (!isValidDate(form.end_date) || form.end_date < form.start_date)) return 'End date must be the same as or after the date.';
  } else {
    if (!form.start_time) return 'Add a start time.';
  }
  return '';
}

// ---- frozen create request (tab session, scoped user+job) ----
// Lock before navigation/remount so an unknown outcome can only be retried with the
// same request_id + payload, never a new id. Persist across close, job switch,
// reopen and reload. Only release on proven noncreation or a reconciled outcome.
const keyFor = (user, job) => `jobCalendar:create:${user?.id || ''}:${typeof job === 'string' ? job : job?.id || ''}`;

export function freezeRequest(store, user, job, state) {
  try { store.setItem(keyFor(user, job), JSON.stringify(state)); return true; } catch { return false; }
}
export function loadFrozenRequest(store, user, job) {
  try {
    const raw = store.getItem(keyFor(user, job));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}
export function clearFrozenRequest(store, user, job) {
  try { store.removeItem(keyFor(user, job)); } catch {}
}

// Build the create payload from the form + frozen request_id. Title is locked to
// the job canonical name (server re-reads it); address is the job address (server
// re-reads it); no pricing fields. confirm_no_jobsite is carried for the empty-
// jobsite gate.
export function buildCreatePayload({ user, job, form, requestId }) {
  return {
    job_id: job.id,
    owner_id: user.id,
    request_id: requestId,
    all_day: !!form.all_day,
    start_date: form.start_date || null,
    end_date: form.all_day ? (form.end_date || null) : null,
    start_time: form.all_day ? null : (form.start_time || null),
    end_time: form.all_day ? null : (form.end_time || null),
    time_zone: 'America/Denver',
    title: job.canonical_name,
    address: job.address || '',
    notes: form.notes || '',
    confirm_no_jobsite: !!form.confirm_no_jobsite,
  };
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

export const CREATE_REVIEW_FIXTURE = {
  job_id: '6a817395914bfa31ecd0f1f6',
  owner_id: '6a7f0d834a5f825c724273ea',
  request_id: '00000000-0000-4000-8000-000000000001',
  all_day: true,
  start_date: '2026-10-10',
  end_date: null,
  start_time: null,
  end_time: null,
  time_zone: 'America/Denver',
  title: 'Beaver - 412',
  address: '1497 E 200 N St, Beaver, UT 84713',
  notes: 'Finish up install trim items.',
};

// Result fixtures for the modal done step (staged vs created vs existing) so a
// read-only preview can render every outcome without a real call.
export const CREATE_RESULT_STAGED = { disabled: true, stage: 'create_disabled_in_stage', reviewed: { ...CREATE_REVIEW_FIXTURE, last_day: '2026-10-10', overnight: false, multiday: false } };
export const CREATE_RESULT_CREATED = { ok: true, kind: 'created', event_id: 'evtcreated', event: { htmlLink: 'https://calendar.google.com/calendar/event?eid=created' }, reviewed: { ...CREATE_REVIEW_FIXTURE } };
export const CREATE_RESULT_EXISTING = { ok: true, kind: 'existing_match', event_id: 'evtexisting', event: { htmlLink: 'https://calendar.google.com/calendar/event?eid=existing' }, reviewed: { ...CREATE_REVIEW_FIXTURE } };

// Upcoming card state fixtures (loading / empty / error / list) for pixel preview.
export const UPCOMING_STATES = {
  loading: { loading: true, error: '', events: [] },
  empty: { loading: false, error: '', events: [] },
  error: { loading: false, error: 'calendar_not_connected', events: [] },
  list: { loading: false, error: '', events: [UPCOMING_SATURDAY_FIXTURE] },
};