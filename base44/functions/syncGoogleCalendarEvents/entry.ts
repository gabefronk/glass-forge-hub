import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { extractPO, extractOE, extractAddress, extractBuilder } from '../../shared/ingestShared.ts';
import { buildInstallerEvent, upsertInstallerEvent } from '../../shared/installerCalendar.ts';
import { fetchAllPages } from '../../shared/pagination.ts';

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

    const existing = await fetchAllPages(base44.asServiceRole.entities.CalendarEvents, '-created_date', 1000);
    const byGoogleId = new Map();
    for (const e of existing) if (e.google_event_id) byGoogleId.set(e.google_event_id, e);

    const toUpdate = [];
    const toCreate = [];
    let skippedApp = 0;
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
        address: extractAddress(ev.location, ev.description),
        builder: extractBuilder(ev.summary),
        scope_notes: ev.description || '',
        labor_amt: 0,
        crew: null,
        prerequisites: null,
        google_event_id: ev.id,
        installer_event_id: null,
        sanitize_flagged: false,
        created_by: ev.creator?.email || 'google',
        organizer: ev.organizer?.email || null,
        po_number: extractPO(ev.description || '') || null,
        oe_number: extractOE(ev.description || '') || null,
      };
      const ex = byGoogleId.get(ev.id);
      if (ex) {
        if (ex.source === 'app') continue;
        // Preserve installer_event_id — it's managed by pushCalendarEvent, not sync
        toUpdate.push({ id: ex.id, ...row, installer_event_id: ex.installer_event_id || null });
      } else {
        toCreate.push(row);
      }
    }
    // Chunk to stay under the 500-item bulk limit
    const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
    for (const batch of chunk(toUpdate, 500)) await base44.asServiceRole.entities.CalendarEvents.bulkUpdate(batch);
    const createdRecords = [];
    for (const batch of chunk(toCreate, 500)) {
      const batchCreated = await base44.asServiceRole.entities.CalendarEvents.bulkCreate(batch);
      createdRecords.push(...batchCreated);
    }

    // Push sanitized copies to the installer calendar (upsert on installer_event_id)
    let installerPushed = 0, installerFailed = 0;
    const installerFailures = [];
    const installerIdUpdates = [];
    for (const ev of [...createdRecords, ...toUpdate]) {
      if (!ev.event_date || !ev.job_name) continue;
      const eventBody = buildInstallerEvent(ev);
      const result = await upsertInstallerEvent(ev.installer_event_id, eventBody, headers);
      if (result.error) { installerFailed++; installerFailures.push({ id: ev.id, name: ev.job_name, error: result.error }); continue; }
      installerPushed++;
      if (result.id !== ev.installer_event_id) installerIdUpdates.push({ id: ev.id, installer_event_id: result.id });
    }
    for (const batch of chunk(installerIdUpdates, 500)) await base44.asServiceRole.entities.CalendarEvents.bulkUpdate(batch);

    return Response.json({ ok: true, fetched: allItems.length, created: toCreate.length, updated: toUpdate.length, skipped_app: skippedApp, installer_pushed: installerPushed, installer_failed: installerFailed, installer_failures: installerFailures });
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 200 });
  }
}