import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { buildInstallerEvent, upsertInstallerEvent, fetchInstallerEventMap } from '../../shared/installerCalendar.ts';

// One-time backfill: push a sanitized copy of every CalendarEvents record
// from 7 days ago forward to the installer calendar. Idempotent — matches on
// installer_event_id OR sourceGoogleEventId (stored in extendedProperties).
// Stores installer_event_id back on each record. Never sends labor_amt,
// organizer, or creator email.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin' && user.role !== 'manager') {
      return Response.json({ error: 'forbidden' }, { status: 403 });
    }
    const body = await req.json().catch(() => ({}));
    const today = new Date();
    const startStr = body.start_date || new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    const { accessToken } = await base44.asServiceRole.connectors.getConnection('googlecalendar');
    const headers = { Authorization: `Bearer ${accessToken}` };

    const allEvents = await base44.asServiceRole.entities.CalendarEvents.list('-created_date', 2000);
    const events = allEvents.filter(e => (e.event_date || '') >= startStr);

    // Fetch existing installer events for idempotent matching.
    const installerMap = await fetchInstallerEventMap(headers);

    let pushed = 0, failed = 0;
    const failures = [];
    const idUpdates = [];

    for (const ev of events) {
      if (!ev.event_date || !ev.job_name) continue;
      const eventBody = buildInstallerEvent(ev);
      const existingId = ev.installer_event_id || (ev.google_event_id ? installerMap.get(ev.google_event_id) : null);
      const result = await upsertInstallerEvent(existingId, eventBody, headers);
      if (result.error) {
        failed++;
        failures.push({ id: ev.id, name: ev.job_name, date: ev.event_date, error: result.error, status: result.status, detail: (result.detail || '').slice(0, 200) });
        continue;
      }
      pushed++;
      if (result.id !== ev.installer_event_id) {
        idUpdates.push({ id: ev.id, installer_event_id: result.id });
      }
    }

    const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
    for (const batch of chunk(idUpdates, 500)) {
      await base44.asServiceRole.entities.CalendarEvents.bulkUpdate(batch);
    }

    return Response.json({
      ok: true,
      start_date: startStr,
      events_scanned: events.length,
      pushed,
      failed,
      failures,
      installer_ids_stored: idUpdates.length,
    });
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 200 });
  }
}