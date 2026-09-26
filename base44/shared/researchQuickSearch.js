// Synchronous fast path for the research section: answer "what's the address for
// 412 Oquirrh West", "what's on tomorrow", "when are we back at Brewer" inline instead
// of queueing work for the local Hermes worker, and move a visit through the one
// existing implementation (the moveCalendarEvent function).
// Output reuses jobFinder, so it never carries money (labor, fees, scope notes).
import { findJobs, findEvents, denverDate, norm, safeEvent } from './jobFinder.js';

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
const SHORT_DAYS = { sun: 0, mon: 1, tue: 2, tues: 2, wed: 3, thu: 4, thur: 4, thurs: 4, fri: 5, sat: 6 };
// Conversational words that are not part of a job name. Without stripping them a
// sentence like "what's the jobsite address for 412 oquirrh west" scores below the
// job finder's match threshold.
const FILLER = new Set([
  'what', 'whats', 's', 'is', 'are', 'was', 'the', 'a', 'an', 'for', 'at', 'on', 'of', 'to', 'in', 'we', 'our', 'us', 'i', 'me', 'my',
  'where', 'when', 'who', 'which', 'do', 'does', 'did', 'have', 'has', 'any', 'anything', 'there', 'going', 'back', 'up', 'get', 'give',
  'show', 'find', 'tell', 'look', 'lookup', 'please', 'can', 'you', 'need', 'jobsite', 'address', 'addresses', 'site', 'job', 'location',
  'schedule', 'scheduled', 'calendar', 'visit', 'visits', 'next', 'last', 'this', 'week', 'deck', 'today', 'tomorrow', 'yesterday',
  'tonight', 'morning', 'afternoon', 'install', 'installs', 'appointment', 'appointments', 'events', 'event', 'and', 'with', 'it', 'be',
  ...WEEKDAYS, ...Object.keys(SHORT_DAYS),
]);
const SCHEDULE_HINT = /\b(today|tomorrow|yesterday|tonight|schedule[ds]?|calendar|on deck|this week|next week|visits?|when|appointments?|sunday|monday|tuesday|wednesday|thursday|friday|saturday)\b/i;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const ID_RE = /^[A-Za-z0-9_-]{1,120}$/;

const bad = (message) => Object.assign(new Error(message), { status: 400 });
const addDays = (d, n) => { const t = new Date(d + 'T12:00:00Z'); t.setUTCDate(t.getUTCDate() + n); return t.toISOString().slice(0, 10); };
const weekday = (d) => new Date(d + 'T12:00:00Z').getUTCDay();
function field(v, max, name) {
  if (v === undefined || v === null || v === '') return '';
  if (typeof v !== 'string' || v.length > max || /[\u0000-\u001f\u007f]/.test(v)) throw bad(`Invalid ${name}.`);
  return v.trim();
}

// Dates mentioned in the sentence itself ("what's on tomorrow", "thursday", "next week").
export function datesFromQuery(query, today) {
  const q = ' ' + norm(query) + ' ';
  if (/ today | tonight /.test(q)) return { date: today };
  if (/ tomorrow /.test(q)) return { date: addDays(today, 1) };
  if (/ yesterday /.test(q)) return { date: addDays(today, -1) };
  if (/ this week /.test(q)) return { from: today, to: addDays(today, 6 - weekday(today)) };
  if (/ next week /.test(q)) { const mon = addDays(today, ((8 - weekday(today)) % 7) || 7); return { from: mon, to: addDays(mon, 6) }; }
  for (const t of q.trim().split(' ')) {
    const dow = WEEKDAYS.includes(t) ? WEEKDAYS.indexOf(t) : SHORT_DAYS[t];
    if (dow !== undefined) return { date: addDays(today, (dow - weekday(today) + 7) % 7) };
  }
  return {};
}

// The part of the sentence that names a job (name, lot, street, builder, PO/OE).
export const jobWords = (query) => norm(query).split(' ').filter((t) => t && !FILLER.has(t)).join(' ');

function when(v) { return [v.date, v.start_time].filter(Boolean).join(' '); }

function answerText(jobs, events, scope) {
  const lines = [];
  for (const j of jobs.slice(0, 3)) {
    const next = j.next_visits[0];
    lines.push(`${j.name}: ${j.address || 'no address on file'}${next ? ` (next visit ${when(next)})` : ''}`);
  }
  if (events) {
    const range = scope.from === scope.to ? (scope.from ? `on ${scope.from}` : '') : `${scope.from || '…'} to ${scope.to || '…'}`;
    lines.push(`${events.count} visit${events.count === 1 ? '' : 's'}${range ? ' ' + range : ''}` + (events.events.length ? ': ' + events.events.slice(0, 6).map((e) => `${e.title}${e.start_time ? ' ' + e.start_time : ''}${scope.from === scope.to ? '' : ' (' + e.date + ')'}`).join('; ') : '.'));
  }
  return lines.join('\n') || 'No matching job or visit.';
}

// Pure: input {query?, date?, from?, to?, limit?} + loaded rows → inline answer.
export function runQuickSearch({ input = {}, jobs = [], events = [], now = new Date().toISOString() }) {
  const today = denverDate(0, new Date(now));
  const query = field(input.query, 200, 'query');
  const given = { date: field(input.date, 20, 'date'), from: field(input.from, 20, 'from'), to: field(input.to, 20, 'to') };
  const words = jobWords(query);
  const spoken = query ? datesFromQuery(query, today) : {};
  const hasGiven = !!(given.date || given.from || given.to);
  const scope = hasGiven ? given : spoken;
  const scheduleAsk = hasGiven || !!(scope.date || scope.from) || SCHEDULE_HINT.test(query);
  if (!words && !scheduleAsk) throw bad('Pass a query (job name, address, lot, PO or OE) or a date.');
  const limit = Math.min(10, Math.max(1, Number(input.limit) || 5));
  const jobResult = words ? findJobs({ query: words, limit, today }, jobs, events) : null;
  const eventResult = scheduleAsk
    ? findEvents({ query: words || undefined, date: scope.date, from: scope.from, to: scope.to, limit: 25, today }, events)
    : null;
  const found = jobResult?.results || [];
  return {
    ok: true,
    kind: 'quick_search',
    query: query || null,
    interpreted: { job_words: words || null, date: scope.date || null, from: scope.from || null, to: scope.to || null, today },
    jobs: found,
    ambiguous: !!jobResult?.ambiguous,
    events: eventResult,
    answer: answerText(found, eventResult, eventResult ? { from: eventResult.from, to: eventResult.to } : {}),
    money_free: true,
  };
}

// 60s warm cache of Jobs + CalendarEvents, same as the jobFinder function.
export function makeFinderLoader({ ttl = 60000, clock = () => Date.now() } = {}) {
  let cache = { at: 0, jobs: null, events: null };
  async function all(entity, sort) {
    const out = [];
    for (let skip = 0; skip < 50000; skip += 1000) {
      const page = await entity.list(sort, 1000, skip);
      out.push(...page);
      if (page.length < 1000) return out;
    }
    throw new Error('pagination_limit');
  }
  const load = async (api, fresh = false) => {
    if (!fresh && cache.jobs && clock() - cache.at < ttl) return cache;
    const [jobs, events] = await Promise.all([all(api.Jobs, '-created_date'), all(api.CalendarEvents, '-event_date')]);
    cache = { at: clock(), jobs, events };
    return cache;
  };
  load.invalidate = () => { cache = { at: 0, jobs: null, events: null }; };
  return load;
}

const MOVE_STATUS = { bad_request: 400, forbidden: 403, Unauthorized: 401, not_found: 404, no_google_event: 409, all_day_event: 409, unsupported_event_shape: 409, google_read_failed: 502, google_write_failed: 502 };

// Moves a visit by invoking the existing moveCalendarEvent function with the caller's
// own token (single implementation of the Google + installer + Hub move). Returns a
// money-free view of the moved visit.
export async function moveVisitThroughHub({ client, input = {} }) {
  const id = field(input.event_id ?? input.id, 120, 'event_id');
  const newDate = field(input.new_date, 20, 'new_date');
  const newTime = field(input.new_start_time, 5, 'new_start_time');
  if (!ID_RE.test(id) || !DATE_RE.test(newDate)) throw bad('event_id and new_date (YYYY-MM-DD) are required.');
  if (newTime && !TIME_RE.test(newTime)) throw bad('new_start_time must be HH:MM (24h).');
  let data;
  try {
    const r = await client.functions.invoke('moveCalendarEvent', { id, new_date: newDate, ...(newTime ? { new_start_time: newTime } : {}) });
    data = r && typeof r === 'object' && 'data' in r ? r.data : r;
  } catch (e) {
    const status = e?.response?.status || e?.status || 502;
    const d = e?.response?.data || {};
    return { status, body: { ok: false, error: d.error || 'move_failed', detail: String(d.detail || e?.message || 'Move failed.').slice(0, 300) } };
  }
  data = data || {};
  if (data.error) return { status: MOVE_STATUS[data.error] || 409, body: { ok: false, error: data.error, detail: data.detail ? String(data.detail).slice(0, 300) : null } };
  if (data.unchanged) return { status: 200, body: { ok: true, unchanged: true, event_id: id } };
  return { status: 200, body: { ok: true, event_id: id, visit: data.record ? safeEvent(data.record) : null, installer_warning: data.installer_warning || null } };
}
