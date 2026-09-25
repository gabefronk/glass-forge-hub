import { denverMidnight, denverDate } from "../../shared/billingCore.js";
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { extractPO, extractOE, extractAddress, extractBuilder, extractLaborAmount, htmlToText } from '../../shared/ingestShared.ts';
import { buildInstallerEvent, upsertInstallerEvent, fetchInstallerEventMap } from '../../shared/installerCalendar.ts';
import { fetchAllPages } from '../../shared/pagination.ts';
import { reportDueAtWithGrace } from '../../shared/reportMatching.ts';
import { preserveAttachmentMetadata } from '../../shared/eventAttachments.js';
import { rehostEventAttachments } from '../../shared/rehostEventAttachments.js';
import { resolveJobLink } from '../../shared/jobLinkResolver.js';

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

    // The same Google event id can appear on both sourced calendars (an event
    // shared with the GF Jobs calendar reuses the id). The CalendarEvents model
    // stores one record per google_event_id, so dedupe by id — first calendar
    // (iryedra, pushToInstaller: true) wins.
    const seenIds = new Set();
    const items = allItems.filter((it) => (seenIds.has(it.id) ? false : (seenIds.add(it.id), true)));

    const existing = await fetchAllPages(base44.asServiceRole.entities.CalendarEvents, '-created_date', 1000);
    const jobs = await fetchAllPages(base44.asServiceRole.entities.Jobs, '-created_date', 1000);
    const byGoogleId = new Map();
    for (const e of existing) if (e.google_event_id) byGoogleId.set(e.google_event_id, e);

    const toUpdate = [];
    const toCreate = [];
    let skippedApp = 0;
    for (const ev of items) {
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
        event_attachments: (ev.attachments || []).map((a) => ({ title: a.title || '', file_url: a.fileUrl || '', mime_type: a.mimeType || '' })).filter((a) => a.file_url),
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
        // Admin items (COI requests etc.) are not field work - no report obligation.
        report_required: !/\bcoi\b/i.test(ev.summary || ''),
        report_due_at: reportDueAtWithGrace(event_date),
      };
      const ex = byGoogleId.get(ev.id);
      // New rows may carry an exact identity; never backfill an existing event during sync.
      if (!ex) {
        const link = resolveJobLink({ job_name: row.job_name, po_number: row.po_number, oe_number: row.oe_number }, jobs);
        if (link.job_id) Object.assign(row, { job_id: link.job_id, job_link_source: link.source, job_linked_at: new Date().toISOString() });
      }
      if (ex) {
        if (ex.source === 'app') continue;
        row.event_attachments = preserveAttachmentMetadata(row.event_attachments, ex.event_attachments || []);
        const updateRow = { id: ex.id, ...row, installer_event_id: ex.installer_event_id || null };
        // report_required is create-only: manual waivers, audit retirements and
        // supersessions set it false deliberately - never re-derive it on update.
        delete updateRow.report_required;
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
    // Reconcile jobs-import duplicates: those rows carry synthetic gfjobs*
    // google_event_ids and duplicate the live Google row for the same job. The
    // live row resolves the due date from the actual event; supersede the
    // synthetic duplicate so a reschedule stops leaving a stale late entry.
    const OUT_RECONCILE = ['pending', 'missing_photos', 'missing_notes', 'missing_all', 'rescheduled'];
    const liveByJob = new Map();
    for (const e of existing) {
      const gid = e.google_event_id || '';
      if (!gid || gid.startsWith('gfjobs') || !e.job_name) continue;
      const cur = liveByJob.get(e.job_name);
      if (!cur || String(e.event_date || '') > String(cur.event_date || '')) liveByJob.set(e.job_name, e);
    }
    const toSupersede = [];
    for (const e of existing) {
      const gid = e.google_event_id || '';
      if (!gid.startsWith('gfjobs')) continue;
      if (e.report_required === false || !OUT_RECONCILE.includes(e.report_status)) continue;
      const live = liveByJob.get(e.job_name);
      if (!live) continue;
      toSupersede.push({
        id: e.id,
        report_required: false,
        scope_notes: ((e.scope_notes || '') + ` | Superseded by live Google event ${live.google_event_id} (${live.event_date}); live row carries the report.`).slice(0, 4000),
      });
    }
    for (const batch of chunk(toSupersede, 500)) await base44.asServiceRole.entities.CalendarEvents.bulkUpdate(batch);

    // Report-match sweep: outstanding rows whose field report (ProBuild post)
    // was filed but never linked get cleared here. Conservative match: exact
    // normalized job_name, report job_date within [event_date - 3d, today].
    const normName = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();
    const allReports = await fetchAllPages(base44.asServiceRole.entities.FieldReports, '-job_date', 1000);
    const reportsByJob = new Map();
    for (const r of allReports) {
      if (!r.job_name || !r.job_date) continue;
      const k = normName(r.job_name);
      if (!reportsByJob.has(k)) reportsByJob.set(k, []);
      reportsByJob.get(k).push(r);
    }
    const todayStr = denverDate(new Date().toISOString());
    const ADMIN_RE = /\bcoi\b/i;
    const toAdminExempt = [];
    for (const e of existing) {
      if (e.report_required === false || !ADMIN_RE.test(e.job_name || '')) continue;
      toAdminExempt.push({
        id: e.id,
        report_required: false,
        scope_notes: ((e.scope_notes || '') + ' | Auto-exempted: admin item (COI), not field work.').slice(0, 4000),
      });
    }
    for (const batch of chunk(toAdminExempt, 500)) await base44.asServiceRole.entities.CalendarEvents.bulkUpdate(batch);
    const supersededIds = new Set(toSupersede.map((x) => x.id));
    const toReportMatch = [];
    for (const e of existing) {
      if (supersededIds.has(e.id)) continue;
      if (e.report_required === false || !OUT_RECONCILE.includes(e.report_status)) continue;
      if (!e.event_date || e.event_date > todayStr) continue;
      const lo = new Date(Date.parse(e.event_date + 'T12:00:00Z') - 3 * 86400000).toISOString().slice(0, 10);
      const cands = (reportsByJob.get(normName(e.job_name)) || []).filter((r) => r.job_date >= lo && r.job_date <= todayStr);
      if (!cands.length) continue;
      toReportMatch.push({
        id: e.id,
        report_status: 'ok',
        matched_post_ids: [...new Set([...(e.matched_post_ids || []), ...cands.map((r) => r.post_id).filter(Boolean)])],
        match_method: 'auto-reconcile',
        match_confidence: 1,
        report_checked_at: new Date().toISOString(),
        scope_notes: ((e.scope_notes || '') + ` | Auto-reconciled: field report filed ${cands.map((r) => r.job_date).join(', ')}.`).slice(0, 4000),
      });
    }
    for (const batch of chunk(toReportMatch, 500)) await base44.asServiceRole.entities.CalendarEvents.bulkUpdate(batch);

    for (const batch of chunk(installerIdUpdates, 500)) await base44.asServiceRole.entities.CalendarEvents.bulkUpdate(batch);

    try {
      const eventIds = createdRecords
        .filter(event => event.source_status !== 'cancelled' && event.event_attachments?.some(a => !a.hub_file_uri))
        .map(event => event.id)
        .filter(Boolean);
      if (eventIds.length) await rehostEventAttachments({ client: base44, eventIds, limit: 20 });
    } catch (error) {
      // Rehosting is best effort: calendar data must remain successfully synced.
      console.error('post-sync attachment rehost failed', error);
    }

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
      superseded: toSupersede.length,
      report_matched: toReportMatch.length,
      admin_exempted: toAdminExempt.length,
      installer_failures: installerFailures.slice(0, 20),
    });
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 200 });
  }
}
