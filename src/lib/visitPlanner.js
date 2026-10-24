// Day and time picks for the Add visit form: the next working days, how many visits
// each crew calendar already has on them, and the form fields a pick sets. Pure, so
// it can be tested; the modal does the fetching. The reviewed payload is still built
// by buildReviewedPayload from these same form fields.
import { addDays } from './jobCalendarValidate.js';

const dayOfWeek = (day) => { const [y, m, d] = day.split('-').map(Number); return new Date(y, m - 1, d).getDay(); };

// The next `count` days after `today`, skipping Sundays (crews do work Saturdays).
export function upcomingWorkDays(today, count = 6) {
  const out = [];
  for (let day = addDays(today, 1); out.length < count; day = addDays(day, 1)) {
    if (dayOfWeek(day) !== 0) out.push(day);
  }
  return out;
}

// { [day]: { [crewKey]: n | null } }. A crew whose calendar has no events at all in
// `events` isn't synced into the hub, so its count is null (unknown), never 0.
// Cancelled events don't count; a multi-day event counts on each day it covers.
export function bookedCounts(events, days, crews) {
  const live = (events || []).filter((e) => e?.event_date && e.source_status !== 'cancelled');
  const synced = new Set(crews.filter((c) => live.some((e) => e.google_calendar_id === c.email)).map((c) => c.key));
  const out = {};
  for (const day of days) {
    out[day] = {};
    for (const c of crews) {
      out[day][c.key] = synced.has(c.key)
        ? live.filter((e) => e.google_calendar_id === c.email && String(e.event_date).slice(0, 10) <= day && String(e.end_date || e.event_date).slice(0, 10) >= day).length
        : null;
    }
  }
  return out;
}

export const TIME_PRESETS = [
  { key: 'all_day', label: 'All day' },
  { key: '08:00-10:00', label: '08:00–10:00', start: '08:00', end: '10:00' },
  { key: '08:00-12:00', label: '08:00–12:00', start: '08:00', end: '12:00' },
  { key: '13:00-17:00', label: '13:00–17:00', start: '13:00', end: '17:00' },
  { key: 'custom', label: 'Pick times…' },
];

// The time preset a form's fields match, else "custom" (a timed visit with other times).
export function timeKeyOf(form) {
  if (form.all_day) return 'all_day';
  const p = TIME_PRESETS.find((t) => t.start && t.start === form.start_time && t.end === form.end_time);
  return p ? p.key : 'custom';
}

// Form fields after picking a day, a number of days and a time. A one-day visit leaves
// end_date blank so buildReviewedPayload fills it, as the old form did.
export function applyVisitPick(form, { day = form.start_date, days = 1, time = timeKeyOf(form) } = {}) {
  const preset = TIME_PRESETS.find((t) => t.key === time) || TIME_PRESETS[0];
  const all_day = preset.key === 'all_day';
  const start_date = day || '';
  const end_date = start_date && days > 1 ? addDays(start_date, days - 1) : '';
  if (all_day) return { ...form, all_day, start_date, end_date, start_time: '', end_time: '' };
  if (preset.key === 'custom') return { ...form, all_day, start_date, end_date };
  return { ...form, all_day, start_date, end_date, start_time: preset.start, end_time: preset.end };
}

// "Tue Oct 27 · all day on Israel's calendar" for the form's footer.
export function visitSummary(form, crewNames) {
  if (!form.start_date) return '';
  const fmt = (d) => { const [y, m, dd] = d.split('-').map(Number); return new Date(y, m - 1, dd).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }); };
  const when = form.end_date && form.end_date !== form.start_date ? `${fmt(form.start_date)} – ${fmt(form.end_date)}` : fmt(form.start_date);
  const time = form.all_day ? 'all day' : [form.start_time, form.end_time].filter(Boolean).join('–') || 'time not set';
  const who = crewNames.length > 1 ? `${crewNames.slice(0, -1).join(', ')} and ${crewNames[crewNames.length - 1]}'s calendars` : `${crewNames[0]}'s calendar`;
  return `${when} · ${time} on ${who}`;
}
