// Pure, injectable core for the scoped job-calendar read + create orchestration.
// No Base44 SDK, no fetch, no crypto — all I/O injected. Tested directly.
//
// Read: returns only the upcoming events that belong to ONE job, price-free,
// minimal (date/time/purpose/location/link). No global calendar dump.
// Match keys (exact only): explicit Google private property hubJobId, an
// allowlisted https Hub job URL in the description, OR a unique normalized exact
// canonical/alias name across the complete Jobs catalog. ALL explicit identities
// are collected; a conflict (two different job ids) or a malformed identity
// rejects the match instead of selecting the first or falling back to title.
// Foreign explicit links, substring names, wrong hosts and ambiguous names never
// match.
//
// Create (orchestrated here, staged OFF in the deployed entry): deterministic
// base32hex Google event id from owner+request_id (NOT content), an immutable
// fingerprint private property so a changed same request conflicts, and
// GET-exact reconciliation before any insert (and before any retry after an
// unknown outcome). A cancellation tombstone is never recreated. 409/timeout/
// malformed-success/provider failures freeze (unknown) or reconcile; a fresh id
// is NEVER generated to escape. No labor, no FeeLines, no attendees/notifications,
// no installer copy, no Hub writes.

// Inlined Denver date helper (removes the cross-file billingCore.js dependency so
// the core is self-contained and its tests import one file).
export function denverDate(value = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));
}

export const OWNER_IDS = new Set(['6a7f0d834a5f825c724273ea', '6a8229a9801b2aef9278ff47']);
export const isOwner = (user) => !!user && OWNER_IDS.has(user.id);

export const CREW_CALENDAR = 'iryedra@gmail.com';
export const ALLOWED_HOSTS = ['gfglassforge.com', 'glass-forge-hub.base44.app'];
const HEX24 = /^[a-f0-9]{24}$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^\d{2}:\d{2}$/;
const IANA_TZ = /^(America|Europe|Asia|Pacific|Africa|Atlantic|Indian)\/[A-Za-z_]+(\/[A-Za-z_]+)?$/;
const B32H = '0123456789abcdefghijklmnopqrstuv';

// ---- name normalization ----
export function normalizeName(v) {
  return String(v ?? '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// ---- merged-into survivor resolution (async, bounded, cycle reject) ----
// getJob is async (returns a Promise). The entry passes the real async Jobs.get;
// tests pass an async adapter so the await path is exercised, not just a sync map.
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
// A token is a non-whitespace run starting with https://. Trailing terminal
// punctuation is trimmed so "https://h/jobs/<id>)." still parses. Each token is
// parsed with the URL constructor: only its pathname is considered, so an
// embedded redirect URL inside a query value (e.g. ?next=https://h/jobs/<other>)
// is never independently matched — it is part of the outer token's query string.
function trimTrailingPunct(t) {
  return t.replace(/[.,;:!?)\]'"]+$/, '');
}
function parseUrlToken(token) {
  let u;
  try { u = new URL(token); } catch { return { kind: 'skip' }; }
  if (u.protocol !== 'https:') return { kind: 'skip' };
  if (!ALLOWED_HOSTS.includes(u.host)) return { kind: 'skip' }; // wrong host: ignore, not malformed
  const path = u.pathname;
  const m = path.match(/^\/jobs\/([a-f0-9]{24})$/);
  if (m) return { kind: 'id', id: m[1], host: u.host };
  // allowlisted host, /jobs/ path, but not exactly a 24-hex id (suffix, short, …)
  if (path === '/jobs/' || path.startsWith('/jobs/')) return { kind: 'malformed', host: u.host, path };
  return { kind: 'skip' }; // allowlisted host, unrelated path — not an identity
}

// ---- explicit job identity from a Google event ----
// Collects ALL identities (private hubJobId + every allowlisted /jobs/<24hex>
// URL). Returns conflict if two different job ids appear, malformed if any
// identity is malformed, the single id if exactly one, or null if none.
export function extractExplicitJobId(ev) {
  const ids = new Map(); // id -> { source, host }
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
    const token = trimTrailingPunct(m[0]);
    const r = parseUrlToken(token);
    if (r.kind === 'id') ids.set(r.id, { source: 'url', host: r.host });
    else if (r.kind === 'malformed') malformed = malformed || { reason: 'url_malformed', host: r.host, path: r.path };
  }
  if (malformed) return { jobId: null, conflict: false, malformed: true, reason: malformed.reason };
  if (ids.size === 0) return null;
  if (ids.size === 1) {
    const [jobId, meta] = [...ids.entries()][0];
    return { jobId, source: meta.source, host: meta.host, conflict: false, malformed: false };
  }
  return { jobId: null, conflict: true, malformed: false, ids: [...ids.keys()] };
}

// ---- name uniqueness across the complete Jobs catalog ----
export function nameUniquenessIndex(jobs) {
  const idx = new Map();
  for (const j of jobs || []) {
    const names = [j.canonical_name, ...(j.aliases || [])].map(normalizeName).filter(Boolean);
    for (const n of names) {
      if (!idx.has(n)) idx.set(n, new Set());
      idx.get(n).add(j.id);
    }
  }
  return idx;
}

// ---- does this event belong to this job? strict exact-match rules ----
// An explicit identity that is malformed or conflicts NEVER falls back to a
// title match: it rejects. Name match only runs when there is no explicit identity.
export function matchEventToJob(ev, job, nameIndex) {
  if (!ev || !job) return { match: false, reason: 'invalid' };
  const explicit = extractExplicitJobId(ev);
  if (explicit) {
    if (explicit.malformed) return { match: false, reason: 'identity_malformed' };
    if (explicit.conflict) return { match: false, reason: 'identity_conflict' };
    if (explicit.jobId === job.id) return { match: true, reason: explicit.source };
    return { match: false, reason: 'foreign_explicit', foreignId: explicit.jobId };
  }
  const evName = normalizeName(ev?.summary || ev?.job_name || '');
  if (!evName) return { match: false, reason: 'no_identity' };
  const jobNames = new Set([job.canonical_name, ...(job.aliases || [])].map(normalizeName).filter(Boolean));
  if (!jobNames.has(evName)) return { match: false, reason: 'name_mismatch' };
  const owners = nameIndex ? nameIndex.get(evName) : undefined;
  if (owners && owners.size === 1 && owners.has(job.id)) return { match: true, reason: 'name_unique' };
  if (owners && owners.size === 1) return { match: false, reason: 'name_other_job' };
  return { match: false, reason: 'name_ambiguous' };
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
    const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(new Date(iso));
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

// ---- price-free sanitization for the crew-facing read ----
function htmlToText(html) {
  return String(html || '')
    .replace(/<\s*br\s*\/?>/gi, '\n').replace(/<\/(p|div|li)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
}
const PRICING_WORDS = ['labor', 'cost', 'price', 'total'];
function pricingWordAdjacentToNumber(line) {
  const lower = line.toLowerCase();
  if (!/\d/.test(line)) return false;
  for (const w of PRICING_WORDS) if (lower.indexOf(w) !== -1) return true;
  return false;
}
export function sanitizeForRead(text) {
  const plain = htmlToText(text);
  const lines = plain.split(/\r?\n/);
  const kept = [];
  let droppedPricing = false;
  for (const raw of lines) {
    const line = raw.trim();
    if (line === '') { kept.push(raw); continue; }
    if (line.includes('$')) { droppedPricing = true; continue; }
    if (pricingWordAdjacentToNumber(line)) { droppedPricing = true; continue; }
    kept.push(raw);
  }
  let out = kept.join('\n').trim();
  let flagged = false;
  if (out.includes('$')) { out = ''; flagged = true; }
  if (droppedPricing) flagged = true; // pricing was stripped — flag so the UI shows "Notes trimmed"
  return { text: out, flagged };
}
// For create review: keep the dropped lines so the user sees what's removed (no silent delete).
export function reviewNotes(notes) {
  const orig = String(notes || '').split(/\r?\n/);
  const { text: cleaned, flagged } = sanitizeForRead(notes);
  const keptSet = new Set(cleaned.split(/\r?\n/));
  const dropped = orig.filter((l) => l.trim() && !keptSet.has(l));
  return { text: cleaned, dropped, flagged: flagged || dropped.length > 0 };
}

// ---- shape a live Google event into a minimal, price-free read record ----
export function shapeUpcomingEvent(ev, job) {
  const allDay = !ev?.start?.dateTime;
  const date = googleEventDate(ev);
  const start_time = allDay ? null : denverHHMM(ev?.start?.dateTime);
  const end_time = allDay ? null : denverHHMM(ev?.end?.dateTime);
  const { text: purpose, flagged } = sanitizeForRead(ev?.description || '');
  const location = ev?.location || job?.address || '';
  return {
    id: ev?.id || '',
    date,
    all_day: allDay,
    start_time,
    end_time,
    purpose: purpose.slice(0, 280).trim(),
    flagged,
    location: String(location).slice(0, 200),
    link: ev?.htmlLink || '',
    calendar: ev?.organizer?.email || CREW_CALENDAR,
  };
}

// ---- merge live + mirror into the scoped upcoming list ----
export function buildUpcomingRead({ liveAll, mirrorRows, job, nameIndex, now, todayDenver }) {
  const liveById = new Map();
  const liveCancelledIds = new Set();
  for (const ev of liveAll || []) {
    if (!ev?.id) continue;
    liveById.set(ev.id, ev);
    if (ev.status === 'cancelled') liveCancelledIds.add(ev.id);
  }
  const matched = new Set();
  const out = [];
  for (const ev of liveAll || []) {
    if (ev.status === 'cancelled') continue;
    const m = matchEventToJob(ev, job, nameIndex);
    if (!m.match) continue;
    if (!isUpcoming(ev, now, todayDenver)) continue;
    out.push(shapeUpcomingEvent(ev, job));
    matched.add(ev.id);
  }
  for (const mir of mirrorRows || []) {
    if (mir.source_status === 'cancelled') continue;
    const gid = mir.google_event_id;
    if (!gid) continue;
    if (matched.has(gid)) continue;
    if (liveCancelledIds.has(gid)) continue;
    const live = liveById.get(gid);
    if (!live) continue; // stale mirror (deleted from Google) — never a phantom
    if (live.status === 'cancelled') continue;
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
  const hash = await sha256(`${ownerId}:${requestId}`);
  return hexToBase32hex(hash, len);
}

// ---- immutable fingerprint of the reviewed create payload ----
// Covers exactly the fields that define the eventual provider event: title,
// jobsite (address), the effective date/time fields, timezone, and notes. Address
// is included so a changed jobsite is a changed request.
export function fingerprintPayload(payload) {
  return JSON.stringify({
    job_id: payload.job_id,
    owner_id: payload.owner_id,
    request_id: payload.request_id,
    all_day: !!payload.all_day,
    start_date: payload.start_date || null,
    end_date: payload.end_date || null,
    start_time: payload.start_time || null,
    end_time: payload.end_time || null,
    time_zone: payload.time_zone || 'America/Denver',
    title: payload.title || '',
    address: payload.address || '',
    notes: payload.notes || '',
  });
}
export async function fingerprintHash(payload, { sha256 } = {}) {
  if (!sha256) throw new Error('sha256 required');
  return sha256(fingerprintPayload(payload));
}

// ---- date/time helpers for the create body ----
function addDay(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}
function addHour(hhmm) {
  const [h, m] = String(hhmm).split(':').map(Number);
  const h2 = (h + 1) % 24;
  return String(h2).padStart(2, '0') + ':' + String(m).padStart(2, '0');
}
function isValidDate(s) {
  if (!DATE_RE.test(String(s || ''))) return false;
  const [y, m, d] = String(s).split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

// ---- effective provider date/time for a reviewed payload ----
// All-day: start=date, end=exclusive date (user end_date is the LAST day
// inclusive, so the provider end is end_date + 1 day). Timed: start/end dateTime
// in the timezone; if end_time <= start_time the event is overnight and the end
// rolls to the next day. Returns the effective end_date (provider end day) too.
export function effectiveDateTime(payload) {
  const tz = payload.time_zone || 'America/Denver';
  if (payload.all_day) {
    const start = payload.start_date;
    const lastDay = (payload.end_date && payload.end_date >= start) ? payload.end_date : start;
    const exclusiveEnd = addDay(lastDay);
    return { start: { date: start }, end: { date: exclusiveEnd }, all_day: true, time_zone: tz, overnight: false, multiday: lastDay > start, end_date: exclusiveEnd, last_day: lastDay };
  }
  const st = payload.start_time;
  const et = payload.end_time || addHour(st);
  const overnight = et <= st;
  const endDay = overnight ? addDay(payload.start_date) : payload.start_date;
  return {
    start: { dateTime: `${payload.start_date}T${st}:00`, timeZone: tz },
    end: { dateTime: `${endDay}T${et}:00`, timeZone: tz },
    all_day: false,
    time_zone: tz,
    overnight,
    multiday: false,
    end_date: endDay,
  };
}

// ---- validate a create payload: real dates, ordering, timezone, no pricing ----
export function validateCreatePayload(payload) {
  const errors = [];
  if (!payload || typeof payload !== 'object') return { ok: false, errors: ['missing_payload'] };
  if (!payload.job_id || !HEX24.test(payload.job_id)) errors.push('invalid_job_id');
  if (!payload.request_id) errors.push('missing_request_id');
  if (!payload.start_date || !isValidDate(payload.start_date)) errors.push('invalid_start_date');
  const tz = payload.time_zone || 'America/Denver';
  if (!IANA_TZ.test(tz)) errors.push('invalid_time_zone');
  if (payload.all_day) {
    if (payload.end_date != null && payload.end_date !== '') {
      if (!isValidDate(payload.end_date)) errors.push('invalid_end_date');
      else if (payload.end_date < payload.start_date) errors.push('end_before_start');
    }
  } else {
    if (!payload.start_time || !TIME_RE.test(payload.start_time)) errors.push('invalid_start_time');
    if (payload.end_time != null && payload.end_time !== '' && !TIME_RE.test(payload.end_time)) errors.push('invalid_end_time');
  }
  if (errors.length) return { ok: false, errors };
  return { ok: true, effective: effectiveDateTime(payload) };
}

// ---- build the Google event body for create (price-free, no labor, no FeeLines) ----
export function buildCreateEventBody({ job, payload, fingerprint, eventId, hubBaseUrl }) {
  const title = job?.canonical_name || payload.title || '';
  const dt = effectiveDateTime(payload);
  const hubUrl = `${hubBaseUrl}/jobs/${job.id}`;
  const desc = [payload.notes || '', `Hub job: ${hubUrl}`].filter(Boolean).join('\n');
  return {
    id: eventId,
    summary: title,
    location: job?.address || '',
    description: desc,
    start: dt.start,
    end: dt.end,
    attendees: [],
    extendedProperties: { private: {
      appSource: 'glassforge_jobcalendar',
      hubJobId: job.id,
      hubOwnerId: payload.owner_id,
      hubRequestId: payload.request_id,
      hubFingerprint: fingerprint,
    } },
  };
}

// ---- reconcile an existing Google event against the create request ----
export function reconcileExisting({ existingEvent, fingerprint, jobId, ownerId, requestId }) {
  if (!existingEvent) return { kind: 'unverifiable' };
  if (existingEvent.status === 'cancelled') return { kind: 'deleted', event: existingEvent };
  const priv = existingEvent.extendedProperties?.private || {};
  const idsMatch = priv.hubJobId === jobId && priv.hubOwnerId === ownerId && priv.hubRequestId === requestId;
  const fpMatch = priv.hubFingerprint === fingerprint;
  if (idsMatch && fpMatch) return { kind: 'existing_match', event: existingEvent };
  if (idsMatch && !fpMatch) return { kind: 'conflict_changed', event: existingEvent };
  return { kind: 'foreign', event: existingEvent };
}

// ---- create orchestration (injectable transport; staged OFF in the entry) ----
// transport: { getEvent(id) -> { event } | null (404), insertEvent(body) -> { ok, status, event } }
// Always GETs the deterministic id first. If an event exists it is reconciled and
// NEVER recreated (a cancellation tombstone stays deleted). Only if no event is
// found does it insert. 409 re-reconciles. Timeout / malformed success / provider
// failure return 'unknown' (freeze) so a retry re-GETs with the SAME id — never a
// fresh id. No Hub writes, no FeeLines, no attendees/copies.
export async function createEvent({ transport, job, payload, sha256, hubBaseUrl }) {
  const ownerId = payload.owner_id;
  const requestId = payload.request_id;
  const eventId = await deterministicId(ownerId, requestId, { sha256 });
  const fingerprint = await fingerprintHash(payload, { sha256 });

  let got;
  try { got = await transport.getEvent(eventId); }
  catch { return { kind: 'unknown', stage: 'get_failed', event_id: eventId, fingerprint }; }
  const existing = got?.event ?? got;
  const rec = reconcileExisting({ existingEvent: existing, fingerprint, jobId: job.id, ownerId, requestId });
  if (rec.kind !== 'unverifiable') {
    return { kind: rec.kind, event_id: eventId, fingerprint, event: rec.event };
  }

  const body = buildCreateEventBody({ job, payload, fingerprint, eventId, hubBaseUrl });
  let ins;
  try { ins = await transport.insertEvent(body); }
  catch { return { kind: 'unknown', stage: 'insert_failed', event_id: eventId, fingerprint }; }
  if (ins && ins.ok && ins.event) {
    return { kind: 'created', event_id: eventId, fingerprint, event: ins.event };
  }
  if (ins && ins.status === 409) {
    let got2;
    try { got2 = await transport.getEvent(eventId); }
    catch { return { kind: 'unknown', stage: 'reget_failed', event_id: eventId, fingerprint }; }
    const ex2 = got2?.event ?? got2;
    const rec2 = reconcileExisting({ existingEvent: ex2, fingerprint, jobId: job.id, ownerId, requestId });
    if (rec2.kind === 'unverifiable') return { kind: 'unknown', stage: 'post409_no_event', event_id: eventId, fingerprint };
    return { kind: rec2.kind, event_id: eventId, fingerprint, event: rec2.event };
  }
  return { kind: 'unknown', stage: 'insert_unknown', event_id: eventId, fingerprint };
}