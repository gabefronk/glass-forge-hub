// Frontend twin for the scoped job-calendar UI. Pure JS, no base44/shared imports
// (platform blocks those from the client bundle). Server twin:
// base44/shared/jobCalendarCore.js — kept in sync manually (same owner ids, same
// Hub base host). Display shaping + the frozen create-request lock only.

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

// ---- frozen create request (tab session, scoped user+job) ----
// Lock before navigation/remount so an unknown outcome can only be retried with the
// same request_id + payload, never a new id.
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
// the job canonical name (server re-reads it); no pricing fields.
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
    notes: form.notes || '',
  };
}

// ---- fixtures for tests / no-real-call preview ----
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
  notes: 'Finish up install trim items.',
};