import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { fetchAllPages } from '../../shared/pagination.ts';
import { resolveJobLink, suggestJobLinks } from '../../shared/jobLinkResolver.js';

const OWNERS = new Set(['gabefronk@gmail.com', 'gabriel.fronk.wd@gmail.com']);
const LIMIT = 200;

// Owner-approved 2026-09-26: one-time additive backfill. Copies the job from a
// high-confidence FeeLine onto the CalendarEvent / FieldReport it was built from, only
// where that record has no job_id and every confident FeeLine agrees on one job.
// Never overwrites or clears an existing link. dry_run (default) only counts.
async function backfillLinks(api, dryRun) {
  const [fees, events, reports] = await Promise.all([
    fetchAllPages(api.FeeLines, '-created_date', 1000),
    fetchAllPages(api.CalendarEvents, '-created_date', 1000),
    fetchAllPages(api.FieldReports, '-created_date', 1000),
  ]);
  const byEvent = new Map(), byPost = new Map();
  for (const f of fees) {
    if (f.match_confidence !== 'high' || !f.job_id || f.superseded_by) continue;
    if (f.calendar_event_id) byEvent.set(f.calendar_event_id, (byEvent.get(f.calendar_event_id) || new Set()).add(f.job_id));
    if (f.probuild_post_id) byPost.set(f.probuild_post_id, (byPost.get(f.probuild_post_id) || new Set()).add(f.job_id));
  }
  const one = (set) => (set && set.size === 1 ? [...set][0] : null);
  const at = new Date().toISOString();
  let ambiguous = 0;
  const pick = (rows, key, map) => rows.filter((r) => !r.job_id && r[key]).flatMap((r) => {
    const set = map.get(r[key]);
    if (set && set.size > 1) { ambiguous++; return []; }
    const job = one(set);
    return job ? [{ id: r.id, job_id: job, job_link_source: 'ingest_match', job_linked_at: at }] : [];
  });
  const eventUpdates = pick(events, 'google_event_id', byEvent);
  const reportUpdates = pick(reports, 'post_id', byPost);
  if (!dryRun) {
    for (let i = 0; i < eventUpdates.length; i += 500) await api.CalendarEvents.bulkUpdate(eventUpdates.slice(i, i + 500));
    for (let i = 0; i < reportUpdates.length; i += 500) await api.FieldReports.bulkUpdate(reportUpdates.slice(i, i + 500));
  }
  return Response.json({
    dry_run: dryRun,
    calendar_events: { unlinked: events.filter((e) => !e.job_id).length, linked_now: eventUpdates.length },
    field_reports: { unlinked: reports.filter((r) => !r.job_id).length, linked_now: reportUpdates.length },
    skipped_ambiguous: ambiguous,
  });
}

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin' || !OWNERS.has(String(user.email || '').trim().toLowerCase())) {
      return Response.json({ error: 'not_found' }, { status: 404 });
    }
    const body = await req.json().catch(() => ({}));
    const api = base44.asServiceRole.entities;
    if (body.action === 'backfill_links') return backfillLinks(api, body.dry_run !== false);
    if (body.action !== 'list') return Response.json({ error: 'Review only; record repair requires separate approval.' }, { status: 403 });
    const [jobs, reports, events] = await Promise.all([
      fetchAllPages(api.Jobs, '-created_date', 1000),
      fetchAllPages(api.FieldReports, '-created_date', 1000),
      fetchAllPages(api.CalendarEvents, '-created_date', 1000),
    ]);
    // Existing FieldReports are append-only under the owner's recorded restriction.
    // This owner queue does not bulk-link existing records; a distinct approval is
    // needed before introducing any bulk repair of existing CalendarEvents.
    const decorate = (kind, row) => ({ kind, row, suggestions: suggestJobLinks(row, jobs, 3) });
    return Response.json({
      field_reports: reports.filter((r) => !r.job_id).slice(0, LIMIT).map((r) => decorate('field_report', r)),
      calendar_events: events.filter((e) => !e.job_id).slice(0, LIMIT).map((e) => decorate('calendar_event', e)),
      truncated: reports.filter((r) => !r.job_id).length > LIMIT || events.filter((e) => !e.job_id).length > LIMIT,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}
