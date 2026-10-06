// Frontend twin of the create validation in base44/shared/jobCalendarCore.js
// (the client bundle cannot import base44/shared). Same codes, same rules; a
// parity test in tests/jobCalendarCore.test.mjs runs both on the same payloads.

const HEX24 = /^[a-f0-9]{24}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const REQUEST_ID_RE = /^[A-Za-z0-9][A-Za-z0-9-]{7,99}$/;
export const CREATE_FIELDS = ['job_id', 'owner_id', 'request_id', 'all_day', 'start_date', 'end_date', 'start_time', 'end_time', 'time_zone', 'title', 'address', 'notes', 'confirm_no_jobsite'];
export const LIMITS = { title: 200, address: 300, notes: 2000, maxDays: 31 };
export const DEFAULT_TZ = 'America/Denver';

const CURRENCY_RE = /[$€£]|\b(usd|dollars?|bucks)\b|d[oó]lar(es)?/i;
const PRICE_WORD_RE = /\b(labou?r|costs?|prices?|pricing|totals?|fees?|rates?|charges?|amount|paid|pay|invoice|precios?|costos?|cobro|cobrar|tarifas?|pago|pagar|mano de obra)\b/i;
export function notesPricingLines(notes) {
  return String(notes ?? '').split(/\r?\n/).filter((l) => CURRENCY_RE.test(l) || (PRICE_WORD_RE.test(l) && /\d/.test(l)));
}

export function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(0); return true; } catch { return false; }
}
export function isValidDate(s) {
  if (typeof s !== 'string' || !DATE_RE.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}
export function addDays(dateStr, n) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
function daysBetween(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000); }
function partsInTz(ms, tz) {
  const f = new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  const o = {};
  for (const p of f.formatToParts(new Date(ms))) o[p.type] = p.value;
  return o;
}
function offsetAt(ms, tz) {
  const o = partsInTz(ms, tz);
  return Date.UTC(+o.year, +o.month - 1, +o.day, +o.hour, +o.minute) - ms;
}
export function wallTimeToUtc(date, time, tz) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const offsets = new Set([offsetAt(guess - 43200000, tz), offsetAt(guess, tz), offsetAt(guess + 43200000, tz)]);
  const hits = new Set();
  for (const off of offsets) {
    const t = guess - off;
    const o = partsInTz(t, tz);
    if (`${o.year}-${o.month}-${o.day}` === date && `${o.hour}:${o.minute}` === time) hits.add(t);
  }
  if (hits.size === 0) return { ok: false, reason: 'nonexistent' };
  if (hits.size > 1) return { ok: false, reason: 'ambiguous' };
  return { ok: true, ms: [...hits][0] };
}

export function validateReviewed(p, { ownerId } = {}) {
  if (!p || typeof p !== 'object' || Array.isArray(p)) return { ok: false, errors: ['missing_payload'] };
  const errors = [];
  if (Object.keys(p).some((k) => !CREATE_FIELDS.includes(k))) errors.push('unexpected_field');
  if (typeof p.job_id !== 'string' || !HEX24.test(p.job_id)) errors.push('invalid_job_id');
  if (typeof p.owner_id !== 'string' || !HEX24.test(p.owner_id)) errors.push('invalid_owner_id');
  else if (ownerId !== undefined && p.owner_id !== ownerId) errors.push('owner_mismatch');
  if (typeof p.request_id !== 'string' || !REQUEST_ID_RE.test(p.request_id)) errors.push('invalid_request_id');
  if (typeof p.all_day !== 'boolean') errors.push('invalid_all_day');
  if (typeof p.title !== 'string' || !p.title.trim() || p.title.length > LIMITS.title) errors.push('invalid_title');
  if (typeof p.address !== 'string' || p.address.length > LIMITS.address) errors.push('invalid_address');
  if (typeof p.notes !== 'string' || p.notes.length > LIMITS.notes) errors.push('invalid_notes');
  else if (notesPricingLines(p.notes).length) errors.push('notes_contain_pricing');
  if (typeof p.confirm_no_jobsite !== 'boolean') errors.push('invalid_confirm_no_jobsite');
  if (!isValidTimeZone(p.time_zone)) errors.push('invalid_time_zone');
  if (!isValidDate(p.start_date)) errors.push('invalid_start_date');
  if (!isValidDate(p.end_date)) errors.push('invalid_end_date');
  if (errors.length) return { ok: false, errors };
  const span = daysBetween(p.start_date, p.end_date);
  if (span < 0) return { ok: false, errors: ['end_before_start'] };
  if (span > LIMITS.maxDays) return { ok: false, errors: ['range_too_long'] };
  if (p.all_day) {
    if (p.start_time !== null || p.end_time !== null) return { ok: false, errors: ['times_not_allowed_all_day'] };
  } else {
    if (typeof p.start_time !== 'string' || !TIME_RE.test(p.start_time)) errors.push('invalid_start_time');
    if (typeof p.end_time !== 'string' || !TIME_RE.test(p.end_time)) errors.push('invalid_end_time');
    if (errors.length) return { ok: false, errors };
    const s = wallTimeToUtc(p.start_date, p.start_time, p.time_zone);
    const e = wallTimeToUtc(p.end_date, p.end_time, p.time_zone);
    if (!s.ok) errors.push(`start_time_${s.reason}`);
    if (!e.ok) errors.push(`end_time_${e.reason}`);
    if (errors.length) return { ok: false, errors };
    if (e.ms <= s.ms) return { ok: false, errors: ['end_not_after_start'] };
  }
  return { ok: true, errors: [] };
}

// Build the complete reviewed payload from the form. Blank end values get a
// visible default (all-day: same last day; timed: one hour after start, rolling
// the date past midnight; end time at/before start rolls the end date to the next
// day). The result is what the review shows and what is frozen and sent.
const pad = (n) => String(n).padStart(2, '0');
export function buildReviewedPayload({ user, job, form, requestId }) {
  const all_day = form.all_day === true;
  const start_date = form.start_date || '';
  let end_date = form.end_date || '';
  let start_time = null, end_time = null;
  if (all_day) {
    if (!end_date) end_date = start_date;
  } else {
    start_time = form.start_time || '';
    end_time = form.end_time || '';
    const startOk = isValidDate(start_date) && TIME_RE.test(start_time);
    if (!end_time && startOk) {
      const [h, m] = start_time.split(':').map(Number);
      end_time = `${pad((h + 1) % 24)}:${pad(m)}`;
      if (!end_date) end_date = h + 1 >= 24 ? addDays(start_date, 1) : start_date;
    }
    if (!end_date && startOk && TIME_RE.test(end_time)) end_date = end_time <= start_time ? addDays(start_date, 1) : start_date;
  }
  return {
    job_id: job.id,
    owner_id: user.id,
    request_id: requestId,
    all_day,
    start_date,
    end_date,
    start_time,
    end_time,
    time_zone: DEFAULT_TZ,
    title: job.canonical_name || '',
    address: job.address || '',
    notes: typeof form.notes === 'string' ? form.notes : '',
    confirm_no_jobsite: form.confirm_no_jobsite === true,
  };
}

const REVIEW_MESSAGES = {
  notes_contain_pricing: 'Notes contain pricing (a dollar amount, or labor/cost/price with a number). Remove it — notes are never edited for you.',
  invalid_start_date: 'Add a valid start date.',
  invalid_end_date: 'Add a valid end date.',
  end_before_start: 'The end date is before the start date.',
  range_too_long: 'A visit can span at most 31 days.',
  invalid_start_time: 'Add a valid start time.',
  invalid_end_time: 'Add a valid end time.',
  start_time_nonexistent: 'That start time does not exist on that date (daylight-saving change). Pick another time.',
  start_time_ambiguous: 'That start time happens twice on that date (daylight-saving change). Pick another time.',
  end_time_nonexistent: 'That end time does not exist on that date (daylight-saving change). Pick another time.',
  end_time_ambiguous: 'That end time happens twice on that date (daylight-saving change). Pick another time.',
  end_not_after_start: 'The end must be after the start.',
  invalid_title: 'This job has no usable name. Rename it first.',
  invalid_address: 'The jobsite address is too long.',
  invalid_notes: 'Notes are too long (2,000 characters max).',
  invalid_time_zone: 'The timezone is not valid.',
};
export function reviewErrorMessage(errors) {
  for (const c of errors || []) if (REVIEW_MESSAGES[c]) return REVIEW_MESSAGES[c];
  return 'Some details are not valid.';
}

// Rows for the review / locked / done views — rendered from the frozen payload,
// never from the latest job props.
const fmtDay = (d) => { const [y, m, dd] = d.split('-').map(Number); return new Date(y, m - 1, dd).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' }); };
export function describeReviewed(p) {
  const rows = [
    ['Title', p.title],
    ['Jobsite', p.address || (p.confirm_no_jobsite ? 'None (confirmed)' : '—')],
  ];
  if (p.all_day) {
    rows.push(['Start', `${fmtDay(p.start_date)} · all day`]);
    rows.push(['Last day (inclusive)', fmtDay(p.end_date)]);
    rows.push(['Calendar end (exclusive)', fmtDay(addDays(p.end_date, 1))]);
  } else {
    rows.push(['Start', `${fmtDay(p.start_date)} · ${p.start_time}`]);
    const span = daysBetween(p.start_date, p.end_date);
    rows.push(['End', `${fmtDay(p.end_date)} · ${p.end_time}${span === 1 ? ' (overnight)' : span > 1 ? ' (multi-day)' : ''}`]);
  }
  rows.push(['Timezone', p.time_zone]);
  rows.push(['Notes', p.notes || '—']);
  rows.push(['Request id', p.request_id]);
  return rows;
}