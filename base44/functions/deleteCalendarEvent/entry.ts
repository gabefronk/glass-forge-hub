import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { secrets } from 'base44:runtime';

// Delete an APP-authored event from both Google calendars, the CalendarEvents
// record, and its app-authored FeeLine. Refuses to touch google-sourced events.
const CAL_API = 'https://www.googleapis.com/calendar/v3';
const FULL_CAL = 'iryedra@gmail.com';

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin' && user.role !== 'manager') {
      return Response.json({ error: 'forbidden' }, { status: 403 });
    }
    const body = await req.json();
    const record = await base44.asServiceRole.entities.CalendarEvents.get(body.id);
    if (!record) return Response.json({ error: 'not_found' }, { status: 200 });
    if (record.source !== 'app') {
      return Response.json({ error: 'not_app_event', detail: 'Only app-authored events can be deleted from here.' }, { status: 200 });
    }

    const installerCal = secrets.get('INSTALLER_CALENDAR_ID');
    const { accessToken } = await base44.asServiceRole.connectors.getConnection('googlecalendar');
    const headers = { Authorization: `Bearer ${accessToken}` };

    if (record.google_event_id) {
      await fetch(`${CAL_API}/calendars/${encodeURIComponent(FULL_CAL)}/events/${record.google_event_id}`, { method: 'DELETE', headers });
    }
    if (record.installer_event_id && installerCal) {
      await fetch(`${CAL_API}/calendars/${encodeURIComponent(installerCal)}/events/${record.installer_event_id}`, { method: 'DELETE', headers });
    }
    await base44.asServiceRole.entities.CalendarEvents.delete(body.id);

    const fees = await base44.asServiceRole.entities.FeeLines.filter({ calendar_event_id: record.google_event_id }, '-created_date', 10);
    for (const f of fees) {
      if (f.written_by === 'app') await base44.asServiceRole.entities.FeeLines.delete(f.id);
    }
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 200 });
  }
}