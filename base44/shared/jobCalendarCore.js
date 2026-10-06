// Pure, injectable core for the scoped job-calendar read + staged create.
// No Base44 SDK, no fetch, no crypto — all I/O injected. Tested directly.
//
// Read: returns only the upcoming events that belong to ONE job, price-free,
// minimal (date/time/purpose/location/link). No global calendar dump.
// Match keys (exact only): explicit Google private property hubJobId, an
// allowlisted https Hub job URL in the description, OR a unique normalized exact
// canonical/alias name across the complete Jobs catalog. Foreign explicit links,
// substring names, wrong hosts and ambiguous names never match.
//
// Create (staged off in the deployed entry): deterministic base32hex Google event
// id from owner+request_id (NOT content), an immutable fingerprint private property
// so a changed same request conflicts, and GET-exact reconciliation on 409/unknown.
// No labor, no FeeLines, no attendees/notifications, no installer copy.

import { denverDate } from './billingCore.js';

export const OWNER_IDS = new Set(['6a7f0d834a5f825c724273ea', '6a8229a9801b2aef9278ff47']);
export const isOwner = (user) => !!user && OWNER_IDS.has(user.id);

export const CREW_CALENDAR = 'iryedra@gmail.com';
export const ALLOWED_HOSTS = ['gfglassforge.com', 'glass-forge-hub.base44.app'];
const HEX24 = /^[a-f0-9]{24}$/;
const B32H = '0123456789abcdefghijklmnopqrstuv';

// ---- name normalization ----
export function normalizeName(v) {
  return String(v ?? '').normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}

// ---- merged-into survivor resolution (bounded, cycle reject) ----
export function resolveSurvivor(jobId, getJob, maxHops = 25) {
  let id = String(jobId || '');
  const seen = new Set([id]);
  for (let i = 0; i < maxHops; i++) {
    const job = getJob(id);
    if (!job) return { id, job: null, cycled: false, missing: true };
    if (!job.merged_into) return { id, job, cycled: false };
    const next = String(job.merged_into);
    if (seen.has(next)) return { id, job, cycled: true };
    seen.add(next);
    id = next;
  }
  return { id, job: getJob(id), cycled: true };
}

// ---- explicit job identity from a Google event ----
export function extractExplicitJobId(ev) {
  const priv = ev?.extendedProperties?.private || {};
  const propId = priv.hubJobId;
  if (typeof propId === 'string' && HEX24.test(propId)) return { jobId: propId, source: 'property', host: null };
  const desc = String(ev?.description || '');
  const re = new RegExp('https://(' + ALLOWED_HOSTS.map((h) => h.replace(/\./g, '\\.')).join('|') + ')/jobs/([a-f0-9]{24})\\b', 'gi');
  const m = [...desc.matchAll(re)][0];
  if (m) return { jobId: m[2], source: 'url', host: m[1] };
  return null;
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
export function matchEventToJob(ev, job, nameIndex) {
  if (!ev || !job) return { match: false, reason: 'invalid' };
  const explicit = extractExplicitJobId(ev);
  if (explicit) {
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
  for (const raw of lines) {
    const line = raw.trim();
    if (line === '') { kept.push(raw); continue; }
    if (line.includes('$')) continue;
    if (pricingWordAdjacentToNumber(line)) continue;
    kept.push(raw);
  }
  let out = kept.join('\n').trim();
  let flagged = false;
  if (out.includes('$')) { out = ''; flagged = true; }
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
// Live is authoritative for existence/cancel state and times. A mirror row linked
// to the job is only shown when live confirms the event exists and is not cancelled,
// and only when the live event did not already match via the exact rules — this
// respects owner-confirmed links without letting stale/finished duplicates mask.
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

// ---- build the Google event body for create (price-free, no labor, no FeeLines) ----
export function buildCreateEventBody({ job, payload, fingerprint, eventId, hubBaseUrl }) {
  const title = job?.canonical_name || payload.title || '';
  const allDay = !!payload.all_day;
  let start, end;
  if (allDay) {
    start = { date: payload.start_date };
    end = { date: payload.end_date || addDay(payload.start_date) }; // Google all-day end is exclusive
  } else {
    const tz = payload.time_zone || 'America/Denver';
    const st = payload.start_time;
    const et = payload.end_time || addHour(st);
    const endDay = et <= st ? addDay(payload.start_date) : payload.start_date;
    start = { dateTime: `${payload.start_date}T${st}:00`, timeZone: tz };
    end = { dateTime: `${endDay}T${et}:00`, timeZone: tz };
  }
  const hubUrl = `${hubBaseUrl}/jobs/${job.id}`;
  const desc = [payload.notes || '', `Hub job: ${hubUrl}`].filter(Boolean).join('\n');
  return {
    id: eventId,
    summary: title,
    location: job?.address || '',
    description: desc,
    start,
    end,
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