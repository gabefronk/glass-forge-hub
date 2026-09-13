// Pure calendar coverage evidence. No provider calls, credentials, or business writes.
// A database updated_date is deliberately not accepted as source observation time.
const DAY = 86_400_000;

export function isCalendarDate(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const ms = Date.parse(value + 'T12:00:00Z');
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === value;
}

function instant(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return NaN;
  if (!isCalendarDate(value.slice(0, 10))) return NaN;
  return Date.parse(value);
}

export function denverCalendarDate(now) {
  const ms = now instanceof Date ? now.getTime() : instant(now);
  if (!Number.isFinite(ms)) throw new Error('Explicit valid current time required');
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function sourceFreshness({ observedAt, now, maxAgeHours = 36 }) {
  const current = now instanceof Date ? now.getTime() : instant(now);
  if (!Number.isFinite(current) || !Number.isFinite(maxAgeHours) || maxAgeHours <= 0) throw new Error('Invalid freshness policy');
  if (!observedAt) return { status: 'missing', observed_at: null, age_hours: null };
  const captured = instant(observedAt);
  if (!Number.isFinite(captured) || captured > current + 300_000) return { status: 'invalid', observed_at: null, age_hours: null };
  const age = Math.max(0, current - captured) / 3_600_000;
  return { status: age <= maxAgeHours ? 'fresh' : 'stale', observed_at: new Date(captured).toISOString(), age_hours: Math.round(age * 100) / 100 };
}

function days(start, end) {
  if (!isCalendarDate(start) || !isCalendarDate(end) || start > end) throw new Error('Invalid inclusive date range');
  const first = Date.parse(start + 'T12:00:00Z');
  const count = Math.round((Date.parse(end + 'T12:00:00Z') - first) / DAY) + 1;
  if (count > 732) throw new Error('Coverage range exceeds 732 days');
  return Array.from({ length: count }, (_, i) => new Date(first + i * DAY).toISOString().slice(0, 10));
}

function validSnapshot(snapshot, calendarName, now, maxAgeHours) {
  if (!snapshot || snapshot.calendar_name !== calendarName || snapshot.timezone !== 'America/Denver') return null;
  if (!isCalendarDate(snapshot.range_start) || !isCalendarDate(snapshot.range_end) || snapshot.range_start > snapshot.range_end) return null;
  if (!Array.isArray(snapshot.events) || !Number.isInteger(snapshot.event_count) || snapshot.event_count !== snapshot.events.length) return null;
  if (snapshot.events.some(e => !e || !isCalendarDate(e.event_date) || e.event_date < snapshot.range_start || e.event_date > snapshot.range_end)) return null;
  const freshness = sourceFreshness({ observedAt: snapshot.captured_at, now, maxAgeHours });
  if (!['fresh', 'stale'].includes(freshness.status)) return null;
  return { ...snapshot, freshness };
}

/**
 * Complete snapshots can prove empty days too; event presence alone cannot.
 * A complete batch may combine partial chunks, but every named chunk must exist,
 * have a matching calendar/range and valid event count. Batch evidence is not a
 * live connector check. Latest incomplete evidence suppresses readiness for its
 * range rather than silently falling back to an older complete snapshot.
 */
export function assessCalendarCoverage({ calendarName, snapshots = [], batches = [], rangeStart, rangeEnd, now, maxAgeHours = 36 }) {
  if (!calendarName || !Array.isArray(snapshots) || !Array.isArray(batches)) throw new Error('Calendar and collections required');
  const requested = days(rangeStart, rangeEnd);
  sourceFreshness({ now, maxAgeHours });
  const candidates = [];
  const reasons = [];
  const byId = new Map();
  const duplicateIds = new Set();
  for (const snapshot of snapshots) {
    if (snapshot?.id && byId.has(snapshot.id)) duplicateIds.add(snapshot.id);
    if (snapshot?.id) byId.set(snapshot.id, snapshot);
    if (snapshot?.calendar_name !== calendarName) continue;
    const value = validSnapshot(snapshot, calendarName, now, maxAgeHours);
    if (!value) { reasons.push('invalid_snapshot'); continue; }
    candidates.push({ start: value.range_start, end: value.range_end, captured_at: value.captured_at, complete: value.complete === true, freshness: value.freshness, kind: 'snapshot' });
  }
  for (const batch of batches) {
    if (batch?.calendar_name !== calendarName) continue;
    const freshness = sourceFreshness({ observedAt: batch.captured_at, now, maxAgeHours });
    const ids = batch.snapshot_ids;
    let valid = batch.timezone === 'America/Denver' && isCalendarDate(batch.range_start) && isCalendarDate(batch.range_end) && batch.range_start <= batch.range_end && ['fresh', 'stale'].includes(freshness.status) && Array.isArray(ids) && ids.length > 0 && new Set(ids).size === ids.length && Number.isInteger(batch.event_count) && batch.event_count >= 0;
    const chunks = valid ? ids.map(id => duplicateIds.has(id) ? null : validSnapshot(byId.get(id), calendarName, now, maxAgeHours)) : [];
    valid = valid && chunks.every(chunk => chunk && chunk.range_start >= batch.range_start && chunk.range_end <= batch.range_end && instant(chunk.captured_at) <= instant(batch.captured_at) + 300_000) && chunks.reduce((n, chunk) => n + (chunk?.event_count || 0), 0) === batch.event_count;
    // The collector must capture all chunks within the same freshness window.
    valid = valid && chunks.every(chunk => instant(batch.captured_at) - instant(chunk.captured_at) <= maxAgeHours * 3_600_000);
    if (!valid) { reasons.push('invalid_or_missing_batch_chunks'); continue; }
    const combinedFreshness = chunks.some(chunk => chunk.freshness.status === 'stale') ? { ...freshness, status: 'stale' } : freshness;
    candidates.push({ start: batch.range_start, end: batch.range_end, captured_at: batch.captured_at, complete: batch.complete === true, freshness: combinedFreshness, kind: 'batch' });
  }
  const missing = [], stale = [], incomplete = [], available = [];
  for (const date of requested) {
    const matching = candidates.filter(x => x.start <= date && x.end >= date).sort((a, b) => instant(b.captured_at) - instant(a.captured_at) || Number(b.kind === 'batch') - Number(a.kind === 'batch'));
    const latest = matching[0];
    if (!latest) { missing.push(date); continue; }
    if (!latest.complete) { incomplete.push(date); continue; }
    available.push(date);
    if (latest.freshness.status !== 'fresh') stale.push(date);
  }
  if (missing.length) reasons.push('uncovered_dates');
  if (incomplete.length) reasons.push('latest_capture_incomplete');
  if (stale.length) reasons.push('stale_capture');
  const relevant = candidates.filter(x => x.start <= rangeEnd && x.end >= rangeStart);
  const latest = relevant.sort((a, b) => instant(b.captured_at) - instant(a.captured_at))[0];
  return {
    calendar_name: calendarName, range_start: rangeStart, range_end: rangeEnd,
    coverage_complete: available.length === requested.length,
    fresh_complete: available.length === requested.length && stale.length === 0,
    covered_day_count: available.length, total_day_count: requested.length,
    missing_dates: missing, incomplete_dates: incomplete, stale_dates: stale,
    latest_capture_at: latest ? new Date(instant(latest.captured_at)).toISOString() : null,
    reasons: [...new Set(reasons)],
    evidence_type: 'captured_snapshot', upstream_live_verified: false
  };
}
