import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { normalizeJobName, matchJob, computeLaborAmt, computeFeeAmt, invoiceMonthFromDate, extractLaborAmount, mergeReviewFlags } from '../../shared/ingestShared.ts';

// Derive FeeLines from CalendarEvents (the single Google reader).
// Reads CalendarEvents (source='google') instead of re-reading the Google API.
// Skips app-authored events (source='app') — those are owned by pushCalendarEvent.
// Upserts on calendar_event_id (= CalendarEvents.google_event_id); never
// overwrites a manually_adjusted row or a written_by='app' row.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));

    // Optional date window filter (defaults to all CalendarEvents)
    const startStr = body.start_date || null;
    const endStr = body.end_date || null;

    // Load CalendarEvents — the single source of truth for Google calendar data
    const allCalEvents = await base44.asServiceRole.entities.CalendarEvents.list('-created_date', 2000);
    // Only google-sourced events; skip app-authored (owned by pushCalendarEvent)
    let calEvents = allCalEvents.filter(e => e.source === 'google' && e.google_event_id);
    if (startStr) calEvents = calEvents.filter(e => (e.event_date || '') >= startStr);
    if (endStr) calEvents = calEvents.filter(e => (e.event_date || '') <= endStr);

    // Existing FeeLines (by calendar_event_id) + Jobs
    const existingFees = await base44.asServiceRole.entities.FeeLines.list('-created_date', 1000);
    const existingByEventId = new Map();
    for (const f of existingFees) if (f.calendar_event_id) existingByEventId.set(f.calendar_event_id, f);
    const jobsArr = await base44.asServiceRole.entities.Jobs.list('-created_date', 500);

    // First pass: match jobs
    const matched = calEvents.map((ev) => {
      const title = ev.job_name || '(untitled)';
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
      const description = ev.scope_notes || '';
      // Explicit labor dollar amount from the description — never invented
      const calendar_labor_amt = extractLaborAmount(description);
      const dateStr = ev.event_date || '';
      let jobId = m.job_id;
      if (m.autoCreate) jobId = jobByNorm.get(normName)?.id || null;
      const row = {
        job_id: jobId,
        job_date: dateStr,
        invoice_month: invoiceMonthFromDate(dateStr),
        job_name_raw: title,
        job_name_norm: normName,
        line_description: description.slice(0, 150),
        calendar_event_id: ev.google_event_id,
        calendar_creator: ev.created_by || null,
        calendar_organizer: ev.organizer || null,
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
      const ex = existingByEventId.get(ev.google_event_id);
      if (ex) {
        if (ex.manually_adjusted || ex.written_by === 'app') { skipped++; continue; }
        const merged = mergeReviewFlags(ex, row);
        toUpdate.push({ id: ex.id, ...row, needs_review: merged.needs_review, match_confidence: merged.match_confidence });
      } else {
        toCreate.push(row);
      }
      if (row.needs_review) flagged.push({ id: ev.google_event_id, title, job_date: dateStr });
    }

    if (toCreate.length) await base44.asServiceRole.entities.FeeLines.bulkCreate(toCreate);
    if (toUpdate.length) await base44.asServiceRole.entities.FeeLines.bulkUpdate(toUpdate);

    return Response.json({
      source: 'calendar_events',
      calendar_events_scanned: calEvents.length,
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