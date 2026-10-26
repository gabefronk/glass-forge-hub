import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { fetchAllPages } from '../../shared/pagination.ts';
import { suggestJobLinks } from '../../shared/jobLinkResolver.js';
import { planUnlinkedLinks } from '../../shared/unlinkedLinkPlan.js';

const OWNERS = new Set(['gabefronk@gmail.com', 'gabriel.fronk.wd@gmail.com']);
const LIMIT = 200;

// Owner-approved additive backfill (2026-09-26 for events and reports; billing lines added
// 2026-10-26). Links a billing line, calendar event or field report that has no job when
// all its evidence agrees on one job (rules in shared/unlinkedLinkPlan.js). Never
// overwrites or clears an existing link. dry_run (default) only counts.
async function backfillLinks(api, dryRun) {
  const [fees, events, reports, jobs, projectLinks] = await Promise.all([
    fetchAllPages(api.FeeLines, '-created_date', 1000),
    fetchAllPages(api.CalendarEvents, '-created_date', 1000),
    fetchAllPages(api.FieldReports, '-created_date', 1000),
    fetchAllPages(api.Jobs, '-created_date', 1000),
    fetchAllPages(api.ProbuildProjectLink, '-created_date', 1000),
  ]);
  const plan = planUnlinkedLinks({ jobs, fees, events, reports, projectLinks });
  const at = new Date().toISOString();
  const linkPatch = (p) => ({ id: p.id, job_id: p.job_id, job_link_source: 'ingest_match', job_linked_at: at });
  const eventUpdates = plan.calendar_events.map(linkPatch);
  const reportUpdates = plan.field_reports.map(linkPatch);
  if (!dryRun) {
    for (let i = 0; i < plan.fee_lines.length; i += 500) await api.FeeLines.bulkUpdate(plan.fee_lines.slice(i, i + 500));
    for (let i = 0; i < eventUpdates.length; i += 500) await api.CalendarEvents.bulkUpdate(eventUpdates.slice(i, i + 500));
    for (let i = 0; i < reportUpdates.length; i += 500) await api.FieldReports.bulkUpdate(reportUpdates.slice(i, i + 500));
  }
  return Response.json({
    dry_run: dryRun,
    fee_lines: { unlinked: fees.filter((f) => !f.job_id && f.billable && !f.billed_to_bfs).length, linked_now: plan.fee_lines.length },
    calendar_events: { unlinked: events.filter((e) => !e.job_id).length, linked_now: eventUpdates.length },
    field_reports: { unlinked: reports.filter((r) => !r.job_id).length, linked_now: reportUpdates.length },
    skipped_ambiguous: plan.skipped_ambiguous,
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
