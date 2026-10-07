// Pure, injectable core for the scoped job-calendar read + create orchestration.
// No Base44 SDK, no fetch, no crypto — all I/O injected. Tested directly.
//
// Read: returns only the upcoming events that belong to ONE job, price-free,
// minimal (date/time/purpose/location/link). No global calendar dump.
// Match keys (exact only): explicit Google private property hubJobId, an
// allowlisted https Hub job URL in the description, OR a unique normalized exact
// canonical/alias name across the complete Jobs catalog. ALL explicit identities
// are collected; a conflict or malformed identity rejects. A mirror link never
// overrides a foreign/conflicting/malformed explicit identity on the live event.
//
// Create (orchestrated here, staged OFF in the deployed entry): the reviewed
// payload is validated strictly (exact types, bounded strings, real dates, IANA
// zone via Intl, DST gaps/overlaps rejected, no pricing in notes — never silently
// edited) and verified against the re-read job (stale title/address rejected).
// Deterministic base32hex event id from owner+request_id, an immutable
// fingerprint over exactly the provider fields, GET-exact reconciliation before
// any insert. Only an explicit not_found GET allows a POST; anything else freezes
// as unknown. A created result requires the expected id and matching private
// identity + fingerprint. A cancellation tombstone is never recreated. No labor,
// no FeeLines, no attendees/notifications, no installer copy, no Hub writes.

export function denverDate(value = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
}

export const OWNER_IDS = new Set(['6a7f0d834a5f825c724273ea', '6a8229a9801b2aef9278ff47']);
export const isOwner = (user) => !!user && OWNER_IDS.has(user.id);

export const CREW_CALENDAR = 'iryedra@gmail.com';
export const ALLOWED_HOSTS = ['gfglassforge.com', 'glass-forge-hub.base44.app'];
export const HUB_BASE_URL = 'https://gfglassforge.com';
const HEX24 = /^[a-f0-9]{24}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const REQUEST_ID_RE = /^[A-Za-z0-9][A-Za-z0-9-]{7,99}$/;
const B32H = '0123456789abcdefghijklmnopqrstuv';

// ---- merged-into survivor resolution (async, bounded, cycle reject) ----
export async function resolveSurvivor(jobId, getJob, maxHops = 25) {
  let id = String(jobId || '');
  const seen = new Set([id]);
  let job;
  for (let i = 0; i < maxHops; i++) {
    job = await getJob(id);
    if (!job) return { id, job: null, cycled: false, missing: true };
    if (!job.merged_into) return { id, job, cycled: false };
    const next = String(job.merged_into);
    if (seen.has(next)) return { id, job, cycled: true };
    seen.add(next);
    id = next;
  }
  job = await getJob(id);
  return { id, job, cycled: true };
}

// ---- strict URL identity parsing ----
function trimTrailingPunct(t) {
  return t.replace(/[.,;:!?)\]'"]+$/, '');
}
function parseUrlToken(token) {
  let u;
  try { u = new URL(token); } catch { return { kind: 'skip' }; }
  if (u.protocol !== 'https:') return { kind: 'skip' };
  if (!ALLOWED_HOSTS.includes(u.host)) return { kind: 'skip' };
  const path = u.pathname;
  const m = path.match(/^\/jobs\/([a-f0-9]{24})$/);
  if (m) return { kind: 'id', id: m[1], host: u.host };
  if (path === '/jobs/' || path.startsWith('/jobs/')) return { kind: 'malformed', host: u.host, path };
  return { kind: 'skip' };
}

// ---- explicit job identity from a Google event ----
export function extractExplicitJobId(ev) {
  const ids = new Map();
  let malformed = null;
  const priv = ev?.extendedProperties?.private || {};
  if ('hubJobId' in priv) {
    const v = priv.hubJobId;
    if (typeof v === 'string' && HEX24.test(v)) ids.set(v, { source: 'property', host: null });
    else malformed = malformed || { reason: 'property_malformed' };
  }
  const desc = String(ev?.description || '');
  const re = /https:\/\/[^\s"'<>]+/g;
  let m;
  while ((m = re.exec(desc)) !== null) {
    const r = parseUrlToken(trimTrailingPunct(m[0]));
    if (r.kind === 'id') ids.set(r.id, { source: 'url', host: r.host });
    else if (r.kind === 'malformed') malformed = malformed || { reason: 'url_malformed' };
  }
  if (malformed) return { jobId: null, conflict: false, malformed: true, reason: malformed.reason };
  if (ids.size === 0) return null;
  if (ids.size === 1) {
    const [jobId, meta] = [...ids.entries()][0];
    return { jobId, source: meta.source, host: meta.host, conflict: false, malformed: false };
  }
  return { jobId: null, conflict: true, malformed: false, ids: [...ids.keys()] };
}

// True when the event carries an explicit identity that is NOT exactly this job.
export function explicitIdentityBlocks(ev, jobId) {
  const x = extractExplicitJobId(ev);
  if (!x) return false;
  return x.malformed || x.conflict || x.jobId !== jobId;
}

// ---- does this event belong to this job? EXPLICIT identity only ----
// No name fallback, no global Jobs catalog. A live event matches only when it
// carries an explicit identity (private property hubJobId or an allowlisted
// https Hub /jobs/<id> URL) that equals this job's id.
export function matchEventToJob(ev, job) {
  if (!ev || !job) return { match: false, reason: 'invalid' };
  const explicit = extractExplicitJobId(ev);
  if (!explicit) return { match: false, reason: 'no_identity' };
  if (explicit.malformed) return { match: false, reason: 'identity_malformed' };
  if (explicit.conflict) return { match: false, reason: 'identity_conflict' };
  if (explicit.jobId === job.id) return { match: true, reason: explicit.source };
  return { match: false, reason: 'foreign_explicit', foreignId: explicit.jobId };
}

// ---- Denver time helpers ----
export function googleEventDate(ev) {
  const s = ev?.start || {};
  if (s.date) return String(s.date).slice(0, 10);
  if (s.dateTime) return denverDate(s.dateTime);
  return '';
}
export function denverHHMM(iso) {
  if (!iso) return null;
  try {
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso));
    const h = parts.find((p) => p.type === 'hour')?.value;
    const m = parts.find((p) => p.type === 'minute')?.value;
    return (h && m) ? `${h}:${m}` : null;
  } catch { return null; }
}

// ---- upcoming filter (finished-today excluded; all-day today included) ----
export function isUpcoming(ev, now, todayDenver) {
  if (!ev) return false;
  if (ev.status === 'cancelled') return false;
  const s = ev?.start || {}, e = ev?.end || {};
  if (s.date) return String(s.date).slice(0, 10) >= todayDenver;
  if (s.dateTime) {
    const endMs = e.dateTime ? Date.parse(e.dateTime) : Date.parse(s.dateTime) + 3600000;
    return Number.isFinite(endMs) && endMs > now.getTime();
  }
  return false;
}

// ---- price-free sanitization for the crew-facing READ of provider events ----
function htmlToText(html) {
  return String(html || '')
    .replace(/<\s*br\s*\/?>/gi, '\n').replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
}
const READ_PRICING_WORDS = ['labor', 'cost', 'price', 'total'];
function readPricingLine(line) {
  const lower = line.toLowerCase();
  if (!/\d/.test(line)) return false;
  return READ_PRICING_WORDS.some((w) => lower.includes(w));
}
export function sanitizeForRead(text) {
  const kept = [];
  let dropped = false;
  for (const raw of htmlToText(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (line === '') { kept.push(raw); continue; }
    if (line.includes('$') || readPricingLine(line)) { dropped = true; continue; }
    kept.push(raw);
  }
  let out = kept.join('\n').trim();
  let flagged = dropped;
  if (out.includes('$')) { out = ''; flagged = true; }
  return { text: out, flagged };
}

// ---- shape a live Google event into a minimal, price-free read record ----
export function shapeUpcomingEvent(ev, job) {
  const allDay = !ev?.start?.dateTime;
  const { text: purpose, flagged } = sanitizeForRead(ev?.description || '');
  return {
    id: ev?.id || '',
    date: googleEventDate(ev),
    all_day: allDay,
    start_time: allDay ? null : denverHHMM(ev?.start?.dateTime),
    end_time: allDay ? null : denverHHMM(ev?.end?.dateTime),
    purpose,
    flagged,
    location: String(ev?.location || job?.address || '').slice(0, 200),
    link: ev?.htmlLink || '',
    calendar: ev?.organizer?.email || CREW_CALENDAR,
  };
}

// ---- merge live + mirror into the scoped upcoming list (EXPLICIT identity only) ----
// Mirror rows are read-only (never modified). A mirror link may only surface a
// live event whose OWN explicit identity equals this job — no name fallback, no
// mirror-only fallback. With explicit-only matching the live loop already surfaces
// every such event, so the mirror loop is a safe no-op for matches; it is kept to
// preserve the cross-reference plumbing and to reject no-identity / foreign /
// conflicting / malformed mirror links.
export function buildUpcomingRead({ liveAll, mirrorRows, job, now, todayDenver }) {
  const liveById = new Map();
  for (const ev of liveAll || []) if (ev?.id) liveById.set(ev.id, ev);
  const matched = new Set();
  const out = [];
  for (const ev of liveAll || []) {
    if (!ev || ev.status === 'cancelled') continue;
    if (!matchEventToJob(ev, job).match) continue;
    if (!isUpcoming(ev, now, todayDenver)) continue;
    out.push(shapeUpcomingEvent(ev, job));
    matched.add(ev.id);
  }
  for (const mir of mirrorRows || []) {
    if (mir.source_status === 'cancelled') continue;
    const gid = mir.google_event_id;
    if (!gid || matched.has(gid)) continue;
    const live = liveById.get(gid);
    if (!live || live.status === 'cancelled') continue; // stale mirror never a phantom
    const x = extractExplicitJobId(live);
    if (!x || x.malformed || x.conflict || x.jobId !== job.id) continue; // explicit identity required, equal to this job
    if (!isUpcoming(live, now, todayDenver)) continue;
    out.push(shapeUpcomingEvent(live, job));
    matched.add(gid);
  }
  out.sort((a, b) => a.date.localeCompare(b.date) || (a.start_time || '99').localeCompare(b.start_time || '99'));
  return { events: out };
}

// ---- Google events list pagination (bounded, loop reject, shape validate) ----
export async function paginateGoogleEvents(fetchPage, { maxPages = 20 } = {}) {
  const items = [];
  let pageToken = null;
  const seen = new Set();
  for (let p = 0; p < maxPages; p++) {
    const res = await fetchPage(pageToken);
    if (!res.ok) return { items, error: { kind: 'http', status: res.status, page: p } };
    let data;
    try { data = await res.json(); } catch { return { items, error: { kind: 'parse', page: p } }; }
    if (!data || typeof data !== 'object' || Array.isArray(data) || data.error) return { items, error: { kind: 'shape', page: p } };
    if (data.items !== undefined && !Array.isArray(data.items)) return { items, error: { kind: 'shape', page: p } };
    for (const it of data.items || []) {
      if (!it || typeof it !== 'object' || typeof it.id !== 'string') return { items, error: { kind: 'shape', page: p } };
      items.push(it);
    }
    if (!data.nextPageToken) return { items, error: null };
    if (typeof data.nextPageToken !== 'string' || seen.has(data.nextPageToken)) return { items, error: { kind: 'loop', page: p } };
    seen.add(data.nextPageToken);
    pageToken = data.nextPageToken;
  }
  return { items, error: { kind: 'max_pages' } };
}

// ---- deterministic Google event id (base32hex of sha256(owner:request_id)) ----
export function hexToBase32hex(hex, len) {
  let bits = '';
  for (const ch of String(hex || '')) {
    const n = parseInt(ch, 16);
    if (!Number.isFinite(n)) continue;
    bits += n.toString(2).padStart(4, '0');
  }
  let out = '';
  for (let i = 0; i < bits.length && out.length < len; i += 5) {
    out += B32H[parseInt(bits.slice(i, i + 5).padEnd(5, '0'), 2) & 31];
  }
  return out.slice(0, len);
}
export async function deterministicId(ownerId, requestId, { len = 40, sha256 } = {}) {
  if (!sha256) throw new Error('sha256 required');
  return hexToBase32hex(await sha256(`${ownerId}:${requestId}`), len);
}

// ================= create validation (frontend twin: src/lib/jobCalendarShared.js) =================
export const CREATE_FIELDS = ['job_id', 'owner_id', 'request_id', 'all_day', 'start_date', 'end_date', 'start_time', 'end_time', 'time_zone', 'title', 'address', 'notes', 'confirm_no_jobsite'];
export const LIMITS = { title: 200, address: 300, notes: 2000, maxDays: 31 };

// Notes are blocked (never edited) when a line carries a currency mark, or a
// pricing word (English/Spanish) together with a number. Install measurements
// like 36x48, 3/4", 12 ft, 2 screens pass.
const CURRENCY_RE = /[$€£]|\b(usd|dollars?|bucks)\b|d[oó]lar(es)?/i;
const PRICE_WORD_RE = /\b(labou?r|costs?|prices?|pricing|totals?|fees?|rates?|charges?|amount|paid|pay|invoice|precios?|costos?|cobro|cobrar|tarifas?|pago|pagar|mano de obra)\b/i;
export function notesPricingLines(notes) {
  return String(notes ?? '').split(/\r?\n/).filter((l) => CURRENCY_RE.test(l) || (PRICE_WORD_RE.test(l) && /\d/.test(l)));
}

export function isValidTimeZone(tz) {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(0); return true; } catch { return false; }
}
function isValidDate(s) {
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
// Wall-clock date+time in tz -> UTC ms. Rejects times that do not exist (spring
// forward gap) or occur twice (fall back overlap) instead of silently shifting.
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

// Strict validation of the complete reviewed create payload. ownerId (server)
// must equal payload.owner_id. Returns { ok, errors, effective }.
export function validateCreatePayload(p, { ownerId } = {}) {
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
  return { ok: true, errors: [], effective: effectiveDateTime(p) };
}

// The reviewed title/address must still equal the re-read job. Never substitutes.
export function verifyReviewedJob({ payload, job }) {
  if (!job) return { ok: false, error: 'job_not_found' };
  if (job.merged_into) return { ok: false, error: 'job_merged' };
  if (payload.job_id !== job.id) return { ok: false, error: 'stale_review' };
  if (payload.title !== (job.canonical_name || '')) return { ok: false, error: 'stale_review' };
  if (payload.address !== (job.address || '')) return { ok: false, error: 'stale_review' };
  if (!payload.address && payload.confirm_no_jobsite !== true) return { ok: false, error: 'jobsite_required' };
  return { ok: true };
}

// ---- effective provider date/time (payload already validated) ----
// All-day: end_date is the LAST day (inclusive); the provider end is exclusive.
// Timed: explicit start and end wall times in time_zone.
export function effectiveDateTime(p) {
  const tz = p.time_zone;
  const span = daysBetween(p.start_date, p.end_date);
  if (p.all_day) {
    const exclusive = addDays(p.end_date, 1);
    return { all_day: true, time_zone: tz, start: { date: p.start_date }, end: { date: exclusive }, last_day: p.end_date, provider_end_date: exclusive, multiday: span > 0, overnight: false };
  }
  return {
    all_day: false,
    time_zone: tz,
    start: { dateTime: `${p.start_date}T${p.start_time}:00`, timeZone: tz },
    end: { dateTime: `${p.end_date}T${p.end_time}:00`, timeZone: tz },
    last_day: p.end_date,
    provider_end_date: p.end_date,
    overnight: span === 1,
    multiday: span > 1,
  };
}

// ---- exactly the fields the provider event will carry ----
export function providerFields(p) {
  const eff = effectiveDateTime(p);
  return {
    identity: { job: p.job_id, owner: p.owner_id, request: p.request_id },
    summary: p.title,
    location: p.address,
    description: `${p.notes ? p.notes + '\n' : ''}Hub job: ${HUB_BASE_URL}/jobs/${p.job_id}`,
    start: eff.start,
    end: eff.end,
  };
}
export function fingerprintPayload(p) { return JSON.stringify(providerFields(p)); }
export async function fingerprintHash(p, { sha256 } = {}) {
  if (!sha256) throw new Error('sha256 required');
  return sha256(fingerprintPayload(p));
}

// ---- Google event body (price-free; refuses notes with pricing) ----
export function buildCreateEventBody({ payload, fingerprint, eventId }) {
  if (notesPricingLines(payload.notes).length) throw new Error('notes_contain_pricing');
  const f = providerFields(payload);
  return {
    id: eventId,
    summary: f.summary,
    location: f.location,
    description: f.description,
    start: f.start,
    end: f.end,
    attendees: [],
    extendedProperties: { private: {
      appSource: 'glassforge_jobcalendar',
      hubJobId: payload.job_id,
      hubOwnerId: payload.owner_id,
      hubRequestId: payload.request_id,
      hubFingerprint: fingerprint,
    } },
  };
}

// ---- reconcile a provider event against the create request ----
export function reconcileExisting({ existingEvent, fingerprint, jobId, ownerId, requestId }) {
  if (existingEvent.status === 'cancelled') return { kind: 'deleted', event: existingEvent };
  const priv = existingEvent.extendedProperties?.private || {};
  const idsMatch = priv.hubJobId === jobId && priv.hubOwnerId === ownerId && priv.hubRequestId === requestId;
  if (idsMatch && priv.hubFingerprint === fingerprint) return { kind: 'existing_match', event: existingEvent };
  if (idsMatch) return { kind: 'conflict_changed', event: existingEvent };
  return { kind: 'foreign', event: existingEvent };
}

const isEventObject = (ev) => !!ev && typeof ev === 'object' && !Array.isArray(ev) && typeof ev.id === 'string';
const safeLink = (l) => (typeof l === 'string' && l.startsWith('https://') ? l : '');
const minimalEvent = (ev) => ({ id: ev.id, htmlLink: safeLink(ev.htmlLink) });

// ---- create orchestration (injectable transport; staged OFF in the entry) ----
// Transport contract:
//   getEvent(id)     -> { kind: 'found', event } | { kind: 'not_found' }
//                       anything else (null, undefined, malformed, error, throw) = unknown
//   insertEvent(body)-> { ok: true, status, event } | { ok: false, status: 409 }
//                       anything else (throw, 5xx, malformed) = unknown
// Validation + job verification run first: a rejected payload makes ZERO calls.
export async function createEvent({ transport, job, payload, sha256 }) {
  const v = validateCreatePayload(payload);
  if (!v.ok) return { kind: 'rejected', errors: v.errors };
  const rv = verifyReviewedJob({ payload, job });
  if (!rv.ok) return { kind: 'rejected', errors: [rv.error] };

  const eventId = await deterministicId(payload.owner_id, payload.request_id, { sha256 });
  const fingerprint = await fingerprintHash(payload, { sha256 });
  const ids = { fingerprint, jobId: payload.job_id, ownerId: payload.owner_id, requestId: payload.request_id };
  const out = (kind, extra = {}) => ({ kind, event_id: eventId, fingerprint, ...extra });

  const lookup = async () => {
    let got;
    try { got = await transport.getEvent(eventId); } catch { return { unknown: true }; }
    if (got && got.kind === 'not_found') return { absent: true };
    if (!got || got.kind !== 'found' || !isEventObject(got.event) || got.event.id !== eventId) return { unknown: true };
    return { rec: reconcileExisting({ existingEvent: got.event, ...ids }) };
  };

  const first = await lookup();
  if (first.unknown) return out('unknown', { stage: 'get_unknown' });
  if (first.rec) return out(first.rec.kind, { event: minimalEvent(first.rec.event) });

  const body = buildCreateEventBody({ payload, fingerprint, eventId });
  let ins;
  try { ins = await transport.insertEvent(body); } catch { return out('unknown', { stage: 'insert_failed' }); }
  if (ins && ins.ok === true) {
    const ev = ins.event;
    if (!isEventObject(ev) || ev.id !== eventId || !safeLink(ev.htmlLink)) return out('unknown', { stage: 'insert_malformed' });
    const rec = reconcileExisting({ existingEvent: ev, ...ids });
    if (rec.kind !== 'existing_match') return out('unknown', { stage: 'insert_mismatch' });
    return out('created', { event: minimalEvent(ev) });
  }
  if (ins && ins.ok === false && ins.status === 409) {
    const again = await lookup();
    if (!again.rec) return out('unknown', { stage: 'post409_unverified' });
    return out(again.rec.kind, { event: minimalEvent(again.rec.event) });
  }
  return out('unknown', { stage: 'insert_unknown' });
}