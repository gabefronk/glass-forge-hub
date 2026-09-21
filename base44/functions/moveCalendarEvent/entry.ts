import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { secrets } from 'base44:runtime';
import { reportDueAtWithGrace } from '../../shared/reportMatching.ts';

// Two-way calendar move: drag on the Hub writes the new date to the REAL Google
// calendar first, then mirrors it onto the CalendarEvents row. Guardrails:
//  - only rows backed by a real Google event are movable (synthetic gfjobs* ids refused);
//  - if the Google write fails, nothing on the Hub changes (frontend rolls back);
//  - the installer-calendar copy moves too when present; its failure is a warning,
//    never a silent desync of the main calendar.
const CAL_API = 'https://www.googleapis.com/calendar/v3';
const FULL_CAL = 'iryedra@gmail.com';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const daySpan = (a, b) => Math.round((new Date(b + 'T00:00:00Z').getTime() - new Date(a + 'T00:00:00Z').getTime()) / 86400000);
const addDays = (d, n) => {
  const t = new Date(d + 'T00:00:00Z');
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
};

// Shift a Google event to new_date, preserving all-day vs timed shape, times and duration.
function shiftedStartEnd(ev, newDate) {
  const s = ev.start || {};
  const e = ev.end || {};
  if (s.dateTime) {
    const oldDay = String(s.dateTime).slice(0, 10);
    const delta = daySpan(oldDay, newDate);
    const shift = (dt) => {
      const day = String(dt).slice(0, 10);
      const rest = String(dt).slice(10); // keeps THH:MM(:SS)(offset) exactly
      return addDays(day, delta) + rest;
    };
    return { start: { dateTime: shift(s.dateTime), timeZone: s.timeZone }, end: { dateTime: shift(e.dateTime), timeZone: e.timeZone } };
  }
  if (s.date && e.date) {
    const span = Math.max(1, daySpan(s.date, e.date)); // Google all-day end is exclusive
    return { start: { date: newDate }, end: { date: addDays(newDate, span) } };
  }
  return null;
}

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    if (user.role !== 'admin' && user.role !== 'manager') {
      return Response.json({ error: 'forbidden' }, { status: 403 });
    }
    const body = await req.json().catch(() => ({}));
    const id = String(body.id || '');
    const newDate = String(body.new_date || '');
    if (!id || !DATE_RE.test(newDate)) return Response.json({ error: 'bad_request', detail: 'id and new_date (YYYY-MM-DD) are required.' });

    const record = await base44.asServiceRole.entities.CalendarEvents.get(id).catch(() => null);
    if (!record) return Response.json({ error: 'not_found' });
    const gid = record.google_event_id || '';
    if (!gid || gid.startsWith('gfjobs')) {
      return Response.json({ error: 'no_google_event', detail: 'This row is not backed by a real Google event, so there is nothing to move on the calendar.' });
    }
    if (record.event_date === newDate) return Response.json({ ok: true, unchanged: true });

    const { accessToken } = await base44.asServiceRole.connectors.getConnection('googlecalendar');
    const headers = { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' };

    // 1) Read the live Google event (source of truth for times/all-day shape).
    const getRes = await fetch(`${CAL_API}/calendars/${encodeURIComponent(FULL_CAL)}/events/${encodeURIComponent(gid)}`, { headers });
    if (!getRes.ok) {
      return Response.json({ error: 'google_read_failed', detail: `Google returned ${getRes.status} reading the event. Nothing was changed.` });
    }
    const gEvent = await getRes.json();
    const patch = shiftedStartEnd(gEvent, newDate);
    if (!patch) return Response.json({ error: 'unsupported_event_shape', detail: 'Could not determine the event start/end shape. Nothing was changed.' });

    // 2) Write the REAL calendar first. Hub only updates after this succeeds.
    const patchRes = await fetch(`${CAL_API}/calendars/${encodeURIComponent(FULL_CAL)}/events/${encodeURIComponent(gid)}`, {
      method: 'PATCH', headers, body: JSON.stringify(patch),
    });
    if (!patchRes.ok) {
      const txt = await patchRes.text().catch(() => '');
      return Response.json({ error: 'google_write_failed', detail: `Google returned ${patchRes.status}. The Hub was not changed. ${txt.slice(0, 300)}` });
    }

    // 3) Mirror onto the Hub row with the sync's reschedule semantics.
    const update = { id, event_date: newDate };
    if (record.end_date) {
      const span = Math.max(0, daySpan(record.event_date, record.end_date));
      update.end_date = addDays(newDate, span);
    }
    if (record.report_required !== false) {
      update.report_status = 'rescheduled';
      update.original_scheduled_date = record.original_scheduled_date || record.event_date;
      update.reschedule_count = (record.reschedule_count || 0) + 1;
      update.report_due_at = reportDueAtWithGrace(newDate);
    }
    await base44.asServiceRole.entities.CalendarEvents.update(id, update);

    // 4) Keep the installer-calendar copy in lockstep when one exists.
    let installer_warning = null;
    const installerCal = secrets.get('INSTALLER_CALENDAR_ID');
    if (record.installer_event_id && installerCal) {
      try {
        const iGet = await fetch(`${CAL_API}/calendars/${encodeURIComponent(installerCal)}/events/${encodeURIComponent(record.installer_event_id)}`, { headers });
        if (iGet.ok) {
          const iEvent = await iGet.json();
          const iPatch = shiftedStartEnd(iEvent, newDate);
          if (iPatch) {
            const iRes = await fetch(`${CAL_API}/calendars/${encodeURIComponent(installerCal)}/events/${encodeURIComponent(record.installer_event_id)}`, {
              method: 'PATCH', headers, body: JSON.stringify(iPatch),
            });
            if (!iRes.ok) installer_warning = `installer calendar returned ${iRes.status}`;
          }
        } else {
          installer_warning = `installer calendar read returned ${iGet.status}`;
        }
      } catch (e) {
        installer_warning = String(e?.message || e);
      }
    }

    const record2 = await base44.asServiceRole.entities.CalendarEvents.get(id);
    return Response.json({ ok: true, record: record2, installer_warning });
  } catch (error) {
    return Response.json({ error: String(error?.message || error) }, { status: 200 });
  }
}
