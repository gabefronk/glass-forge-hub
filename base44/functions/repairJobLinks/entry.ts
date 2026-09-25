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
    const api = base44.asServiceRole.entities;
    const [jobs, reports, events, projectLinks] = await Promise.all([
      fetchAllPages(api.Jobs, '-created_date', 1000),
      fetchAllPages(api.FieldReports, '-created_date', 1000),
      fetchAllPages(api.CalendarEvents, '-created_date', 1000),
      fetchAllPages(api.ProbuildProjectLink, '-updated_date', 1000).catch(() => []),
    ]);
    if (body.action === 'link') {
      if (!body.id || !body.job_id || !['field_report', 'calendar_event'].includes(body.kind) || !jobs.some((j) => j.id === body.job_id)) {
        return Response.json({ error: 'invalid_link' }, { status: 400 });
      }
      const entity = body.kind === 'field_report' ? api.FieldReports : api.CalendarEvents;
      const current = await entity.get(body.id).catch(() => null);
      if (!current) return Response.json({ error: 'not_found' }, { status: 404 });
      if (current.job_id) return Response.json({ ok: true, unchanged: true, job_id: current.job_id });
      await entity.update(body.id, { job_id: body.job_id, job_link_source: 'owner', job_linked_at: new Date().toISOString() });
      return Response.json({ ok: true, job_id: body.job_id });
    }
    if (body.action === 'backfill') {
      const now = new Date().toISOString();
      const candidates = [
        ...reports.filter((r) => !r.job_id).map((row) => ({ kind: 'field_report', row, entity: api.FieldReports })),
        ...events.filter((e) => !e.job_id).map((row) => ({ kind: 'calendar_event', row, entity: api.CalendarEvents })),
      ].slice(0, Math.min(Number(body.limit) || LIMIT, LIMIT));
      const counts = { scanned: candidates.length, linked: 0, ambiguous: 0, unmatched: 0, remaining: 0 };
      for (const item of candidates) {
        const link = resolveJobLink(item.row, jobs, projectLinks);
        if (link.job_id) {
          await item.entity.update(item.row.id, { job_id: link.job_id, job_link_source: link.source, job_linked_at: now });
          counts.linked++;
        } else if (link.ambiguous) counts.ambiguous++;
        else counts.unmatched++;
      }
      counts.remaining = reports.filter((r) => !r.job_id).length + events.filter((e) => !e.job_id).length - counts.linked;
      return Response.json({ ok: true, counts, batch_limit: LIMIT });
    }
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
