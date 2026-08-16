import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { normalizeJobName, matchJob, computeLaborAmt, computeFeeAmt, invoiceMonthFromDate, extractLaborAmount, mergeReviewFlags } from '../../shared/ingestShared.ts';

// Ingest Google Calendar events (iryedra@gmail.com) into FeeLines.
// One row per event. Extracts an EXPLICIT labor dollar amount from the
// description only — never invents one. Upserts on calendar_event_id;
// never overwrites a manually_adjusted row.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const today = new Date();
    const endStr = body.end_date || today.toISOString().slice(0, 10);
    const startStr = body.start_date || new Date(today.getTime() - 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const timeMin = new Date(startStr + 'T00:00:00Z').toISOString();
    const timeMax = new Date(endStr + 'T23:59:59Z').toISOString();

    const { accessToken } = await base44.asServiceRole.connectors.getConnection('googlecalendar');
    const authHeader = { Authorization: `Bearer ${accessToken}` };

    // Page through events in the window (Israel's calendar, not the connector owner's primary)
    const calendarId = body.calendar_id || 'iryedra@gmail.com';
    const baseUrl = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events?maxResults=100&singleEvents=true&orderBy=startTime&timeMin=${encodeURIComponent(timeMin)}&timeMax=${encodeURIComponent(timeMax)}`;
    const allItems = [];
    let pageToken = null;
    do {
      let url = baseUrl;
      if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`;
      const res = await fetch(url, { headers: authHeader });
      if (!res.ok) {
        const txt = await res.text();
        return Response.json({ error: 'calendar_api_error', status: res.status, detail: txt }, { status: 200 });
      }
      const data = await res.json();
      allItems.push(...(data.items || []));
      pageToken = data.nextPageToken || null;
    } while (pageToken);

    // Existing FeeLines (by event id) + Jobs
    const existingFees = await base44.asServiceRole.entities.FeeLines.list('-created_date', 1000);
    const existingByEventId = new Map();
    for (const f of existingFees) if (f.calendar_event_id) existingByEventId.set(f.calendar_event_id, f);
    const jobsArr = await base44.asServiceRole.entities.Jobs.list('-created_date', 500);

    // First pass: match jobs
    const matched = allItems.map((ev) => {
      const title = ev.summary || '(untitled)';
      const normName = normalizeJobName(title);
      const m = matchJob(normName, jobsArr);
      return { ev, title, normName, m };
    });
    const autoCreateNames = [...new Set(matched.filter((x) => x.m.autoCreate).map((x) => x.normName).filter(Boolean))];
    const newJobs = autoCreateNames.length
      ? await base44.asServiceRole.entities.Jobs.bulkCreate(autoCreateNames.map((n) => ({ canonical_name: n, aliases: [n] })))
      : [];
    const jobByNorm = new Map();
    for (const j of newJobs) jobByNorm.set(j.canonical_name, j);
    for (const j of jobsArr) { const n = normalizeJobName(j.canonical_name); if (n) jobByNorm.set(n, j); }

    const toCreate = [];
    const toUpdate = [];
    let skipped = 0;
    const flagged = [];
    for (const { ev, title, normName, m } of matched) {
      const description = ev.description || '';
      // Explicit labor dollar amount only — never invented
      const calendar_labor_amt = extractLaborAmount(description);
      const startRef = ev.start || {};
      const dateStr = startRef.dateTime ? String(startRef.dateTime).slice(0, 10) : (startRef.date || '');
      let jobId = m.job_id;
      if (m.autoCreate) jobId = jobByNorm.get(normName)?.id || null;
      const row = {
        job_id: jobId,
        job_date: dateStr,
        invoice_month: invoiceMonthFromDate(dateStr),
        job_name_raw: title,
        job_name_norm: normName,
        line_description: description.slice(0, 150),
        calendar_event_id: ev.id,
        calendar_creator: ev.creator?.email || null,
        calendar_organizer: ev.organizer?.email || null,
        calendar_labor_amt,
        note_text: description,
        photo_urls: [],
        fee_pct: 0.1,
        billable: true,
        source: 'calendar',
        written_by: 'calendar',
        match_confidence: m.match_confidence,
        needs_review: !!m.needs_review,
        manually_adjusted: false,
      };
      row.labor_amt = computeLaborAmt(row);
      row.fee_amt = computeFeeAmt(row);
      const ex = existingByEventId.get(ev.id);
      if (ex) {
        if (ex.manually_adjusted || ex.written_by === 'app') { skipped++; continue; }
        const merged = mergeReviewFlags(ex, row);
        toUpdate.push({ id: ex.id, ...row, needs_review: merged.needs_review, match_confidence: merged.match_confidence });
      } else {
        toCreate.push(row);
      }
      if (row.needs_review) flagged.push({ id: ev.id, title, job_date: dateStr });
    }

    if (toCreate.length) await base44.asServiceRole.entities.FeeLines.bulkCreate(toCreate);
    if (toUpdate.length) await base44.asServiceRole.entities.FeeLines.bulkUpdate(toUpdate);

    return Response.json({
      source: 'calendar',
      window: { start_date: startStr, end_date: endStr },
      events_fetched: allItems.length,
      created: toCreate.length,
      updated: toUpdate.length,
      skipped_manually_adjusted: skipped,
      auto_created_jobs: autoCreateNames,
      flagged_for_review: flagged,
    });
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 200 });
  }
}