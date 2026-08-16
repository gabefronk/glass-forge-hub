import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';

// Pull Google Calendar events (iryedra@gmail.com) into CalendarEvents as
// source='google' (read-only). Skips app-authored events (marked with an
// extendedProperty) — those are owned by pushCalendarEvent. Upserts on
// google_event_id; never overwrites an existing app-sourced record.
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
    const body = await req.json().catch(() => ({}));
    const today = new Date();
    const endStr = body.end_date || new Date(today.getTime() + 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const startStr = body.start_date || new Date(today.getTime() - 365 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const timeMin = new Date(startStr + 'T00:00:00Z').toISOString();
    const timeMax = new Date(endStr + 'T23:59:59Z').toISOString();

    const { accessToken } = await base44.asServiceRole.connectors.getConnection('googlecalendar');
    const headers = { Authorization: `Bearer ${accessToken}` };

    const baseUrl = `${CAL_API}/calendars/${encodeURIComponent(FULL_CAL)}/events?maxResults=100&singleEvents=true&orderBy=startTime&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`;
    const allItems = [];
    let pageToken = null;
    do {
      let url = baseUrl;
      if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`;
      const res = await fetch(url, { headers });
      if (!res.ok) return Response.json({ error: 'calendar_api_error', detail: await res.text() }, { status: 200 });
      const data = await res.json();
      allItems.push(...(data.items || []));
      pageToken = data.nextPageToken || null;
    } while (pageToken);

    const existing = await base44.asServiceRole.entities.CalendarEvents.list('-created_date', 2000);
    const byGoogleId = new Map();
    for (const e of existing) if (e.google_event_id) byGoogleId.set(e.google_event_id, e);

    let created = 0, updated = 0, skippedApp = 0;
    for (const ev of allItems) {
      if (ev.extendedProperties?.private?.appSource === 'glassforge') { skippedApp++; continue; }
      const startRef = ev.start || {};
      const event_date = startRef.dateTime ? String(startRef.dateTime).slice(0, 10) : (startRef.date || '');
      if (!event_date) continue;
      const start_time = startRef.dateTime ? String(startRef.dateTime).slice(11, 16) : null;
      const row = {
        source: 'google',
        event_date,
        start_time,
        job_name: ev.summary || '(untitled)',
        builder: null,
        address: ev.location || null,
        scope_notes: ev.description || '',
        labor_amt: 0,
        crew: null,
        prerequisites: null,
        google_event_id: ev.id,
        installer_event_id: null,
        sanitize_flagged: false,
        created_by: ev.creator?.email || 'google',
        organizer: ev.organizer?.email || null,
      };
      const ex = byGoogleId.get(ev.id);
      if (ex) {
        if (ex.source === 'app') continue;
        await base44.asServiceRole.entities.CalendarEvents.update(ex.id, row);
        updated++;
      } else {
        await base44.asServiceRole.entities.CalendarEvents.create(row);
        created++;
      }
    }
    return Response.json({ ok: true, fetched: allItems.length, created, updated, skipped_app: skippedApp });
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 200 });
  }
}