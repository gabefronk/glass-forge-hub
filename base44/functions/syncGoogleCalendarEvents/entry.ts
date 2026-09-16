import { denverMidnight, denverDate } from "../../shared/billingCore.js";
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { extractPO, extractOE, extractAddress, extractBuilder, extractLaborAmount, htmlToText } from '../../shared/ingestShared.ts';
import { buildInstallerEvent, upsertInstallerEvent, fetchInstallerEventMap } from '../../shared/installerCalendar.ts';
import { fetchAllPages } from '../../shared/pagination.ts';
import { reportDueAtWithGrace } from '../../shared/reportMatching.ts';

// Pull Google Calendar events (iryedra@gmail.com) into CalendarEvents as
// source='google' (read-only). Skips app-authored events (marked with an
// extendedProperty) — those are owned by pushCalendarEvent. Upserts on
// google_event_id; never overwrites an existing app-sourced record.
// Then pushes sanitized copies to the installer calendar (idempotent on
// sourceGoogleEventId stored in extendedProperties).
const CAL_API = 'https://www.googleapis.com/calendar/v3';
const FULL_CAL = 'iryedra@gmail.com';
const GF_JOBS_CAL = '0236b85aa32e6358ebe5a232e970e6c9c2c47142f8c3f22cadd5b5b0eb34bf67@group.calendar.google.com';
// Read-only Google Calendar sources. The Israel calendar is also pushed to the
// installer calendar; the GF Jobs calendar is display-only (never written to).
const SOURCES = [{ id: FULL_CAL, pushToInstaller: true }, { id: GF_JOBS_CAL, pushToInstaller: false }];

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
    const timeMin = denverMidnight(startStr);
    const timeMax = denverMidnight(new Date(Date.parse(endStr + 'T12:00:00Z') + 86400000).toISOString().slice(0, 10));

    const { accessToken } = await base44.asServiceRole.connectors.getConnection('googlecalendar');
    const headers = { Authorization: `Bearer ${accessToken}` };

    const allItems = [];
    for (const cal of SOURCES) {
      const baseUrl = `${CAL_API}/calendars/${encodeURIComponent(cal.id)}/events?maxResults=100&singleEvents=true&showDeleted=true&orderBy=startTime&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`;
      let pageToken = null;
      do {
        let url = baseUrl;
        if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`;
        const res = await fetch(url, { headers });
        if (!res.ok) return Response.json({ error: 'calendar_api_error', detail: await res.text() }, { status: 502 });
        const data = await res.json();
        for (const item of (data.items || [])) allItems.push({ ...item, _calendarId: cal.id });
        pageToken = data.nextPageToken || null;
      } while (pageToken);
    }

    const existing = await fetchAllPages(base44.asServiceRole.entities.CalendarEvents, '-created_date', 1000);
    const byGoogleId = new Map();
    for (const e of existing) if (e.google_event_id) byGoogleId.set(e.google_event_id, e);

    const toUpdate = [];
    const toCreate = [];
    let skippedApp = 0;
    for (const ev of allItems) {
      if (ev.extendedProperties?.private?.appSource === 'glassforge') { skippedApp++; continue; }
      if (ev.status === 'cancelled') {
        const ex = byGoogleId.get(ev.id);
        if (ex && ex.source !== 'app') toUpdate.push({ id: ex.id, source_status: 'cancelled', report_required: false });
        continue;
      }
      const startRef = ev.start || {};
      const endRef = ev.end || {};
      const event_date = startRef.dateTime ? denverDate(startRef.dateTime) : (startRef.date || '');
      if (!event_date) continue;
      const start_time = startRef.dateTime ? String(startRef.dateTime).slice(11, 16) : null;
      const end_time = endRef.dateTime ? String(endRef.dateTime).slice(11, 16) : null;
      const end_date = (!endRef.dateTime && endRef.date) ? endRef.date : null;
      const row = {
        source: 'google',
        source_status: ev.status || 'confirmed',
        event_date,
        start_time,
        end_time,
        end_date,
        job_name: ev.summary || '(untitled)',
        builder: extractBuilder(ev.summary),
        address: extractAddress(ev.location, ev.description),
        source_location: ev.location || null,
        scope_notes: ev.description || '',
        labor_amt: extractLaborAmount(htmlToText(ev.description || '')) || 0,
        crew: null,
        prerequisites: null,
        google_event_id: ev.id,
        google_calendar_id: ev._calendarId,
        installer_event_id: null,
        sanitize_flagged: false,
        created_by: ev.creator?.email || 'google',
        organizer: ev.organizer?.email || null,
        po_number: extractPO(ev.description || '') || null,
        oe_number: extractOE(ev.description || '') || null,
        report_required: true,
        report_due_at: reportDueAtWithGrace(event_date),
      };
      const ex = byGoogleId.get(ev.id);
      if (ex) {
        if (ex.source === 'app') continue;
        const updateRow = { id: ex.id, ...row, installer_event_id: ex.installer_event_id || null };
        // Detect reschedule: date changed while report is still outstanding
        if (ex.event_date !== event_date) {
          updateRow.report_status = 'rescheduled';
          updateRow.original_scheduled_date = ex.original_scheduled_date || ex.event_date;
          updateRow.reschedule_count = (ex.reschedule_count || 0) + 1;
          updateRow.report_due_at = reportDueAtWithGrace(event_date);
        }
        toUpdate.push(updateRow);
      } else {
        row.report_status = 'pending';
        row.days_late = 0;
        row.reschedule_count = 0;
        row.matched_post_ids = [];
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

    // Push sanitized copies to the installer calendar.
    // Idempotent: match on installer_event_id (stored on row) OR sourceGoogleEventId
    // (stored in extendedProperties on the installer event itself).
    // By default only push NEW or NEVER-PUSHED events to avoid timeout.
    // Pass { force_repush: true } to re-push all events (for repairs).
    const forceRepush = !!body.force_repush;
    const changed = (e) => { const before = byGoogleId.get(e.google_event_id); return before && ['event_date','start_time','end_time','end_date','job_name','scope_notes','address'].some(k => (before[k] ?? '') !== (e[k] ?? '')); };
    const baseCandidates = forceRepush
      ? [...createdRecords, ...toUpdate]
      : [...createdRecords, ...toUpdate.filter(e => e.source_status !== 'cancelled' && (!e.installer_event_id || changed(e)))];
    // GF Jobs is read-only display — never push its events to the installer calendar.
    const pushCandidates = body.pull_only ? [] : baseCandidates.filter(e => e.google_calendar_id !== GF_JOBS_CAL);

    const installerMap = pushCandidates.length ? await fetchInstallerEventMap(headers) : new Map();

    let installerPushed = 0, installerFailed = 0, installerSkipped = 0;
    const installerFailures = [];
    const installerIdUpdates = [];
    for (const ev of pushCandidates) {
      if (!ev.event_date || !ev.job_name) { installerSkipped++; continue; }
      const eventBody = buildInstallerEvent(ev);
      const existingId = ev.installer_event_id || (ev.google_event_id ? installerMap.get(ev.google_event_id) : null);
      const result = await upsertInstallerEvent(existingId, eventBody, headers);
      if (result.error) { installerFailed++; installerFailures.push({ id: ev.id, name: ev.job_name, error: result.error }); continue; }
      installerPushed++;
      if (result.id !== ev.installer_event_id) installerIdUpdates.push({ id: ev.id, installer_event_id: result.id });
    }
    for (const batch of chunk(installerIdUpdates, 500)) await base44.asServiceRole.entities.CalendarEvents.bulkUpdate(batch);

    return Response.json({
      ok: installerFailed === 0,
      fetched: allItems.length,
      created: toCreate.length,
      updated: toUpdate.length,
      skipped_app: skippedApp,
      force_repush: forceRepush,
      push_candidates: pushCandidates.length,
      installer_pushed: installerPushed,
      installer_failed: installerFailed,
      installer_skipped: installerSkipped,
      installer_failures: installerFailures.slice(0, 20),
    });
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 200 });
  }
}