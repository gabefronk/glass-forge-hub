import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { fetchAllPages } from '../../shared/pagination.ts';
import { resolveJobLink, suggestJobLinks } from '../../shared/jobLinkResolver.js';

const OWNERS = new Set(['gabefronk@gmail.com', 'gabriel.fronk.wd@gmail.com']);
const LIMIT = 200;

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (user?.role !== 'admin' || !OWNERS.has(String(user.email || '').trim().toLowerCase())) {
      return Response.json({ error: 'not_found' }, { status: 404 });
    }
    const body = await req.json().catch(() => ({}));
    if (body.action !== 'list') return Response.json({ error: 'Review only; record repair requires separate approval.' }, { status: 403 });
    const api = base44.asServiceRole.entities;
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
