import { createClientFromRequest } from 'npm:@base44/sdk@0.8.51';
import { copyEventFilesToJobFolders, needsJobFolderCopy } from '../../shared/jobFolderCopy.js';
import { fetchAllPages } from '../../shared/pagination.ts';

// Admin run of the calendar-file copier: a few named events (a test on one
// job), or events dated within the last `days_back` days and forward.
// Calendar sync runs the same copier on new and upcoming events by itself.
export default async function(req) {
  const client = createClientFromRequest(req);
  const user = await client.auth.me().catch(() => null);
  if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
  if (user.role !== 'admin' && user.role !== 'manager') return Response.json({ error: 'forbidden' }, { status: 403 });
  const body = await req.json().catch(() => ({}));
  const limit = Math.max(1, Math.min(Number(body.limit) || 25, 50));
  const api = client.asServiceRole.entities.CalendarEvents;
  let events;
  if (Array.isArray(body.event_ids) && body.event_ids.length) {
    events = (await Promise.all(body.event_ids.slice(0, 50).map((id: string) => api.get(String(id)).catch(() => null)))).filter(Boolean);
  } else {
    const daysBack = Math.max(0, Math.min(Number(body.days_back ?? 7), 400));
    const since = new Date(Date.now() - daysBack * 86400000).toISOString().slice(0, 10);
    events = (await fetchAllPages(api, '-event_date', 5000)).filter((e: any) => (e.event_date || '') >= since);
  }
  events = events.filter((e: any) => e.source_status !== 'cancelled' && e.event_attachments?.some(needsJobFolderCopy));
  const summary = await copyEventFilesToJobFolders({ client, events, limit });
  return Response.json({ ok: true, events_considered: events.length, ...summary });
}
