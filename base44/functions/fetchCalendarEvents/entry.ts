import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { normalizeJobName, matchJob, computeLaborAmt, computeFeeAmt, invoiceMonthFromDate, extractLaborAmount, extractTicketSequence, mergeReviewFlags, extractBuilder, htmlToText, extractProfitSplit } from '../../shared/ingestShared.ts';
import { fetchAllPages } from '../../shared/pagination.ts';

// Derive FeeLines from CalendarEvents (the single Google reader).
// Reads CalendarEvents (source='google') instead of re-reading the Google API.
// Skips app-authored events (source='app') — those are owned by pushCalendarEvent.
// Upserts on calendar_event_id (= CalendarEvents.google_event_id); never
// overwrites a manually_adjusted row or a written_by='app' row.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));

    const startStr = body.start_date || null;
    const endStr = body.end_date || null;

    const allCalEvents = await fetchAllPages(base44.asServiceRole.entities.CalendarEvents, '-created_date', 1000);
    let calEvents = allCalEvents.filter(e => e.source === 'google' && e.google_event_id);
    if (startStr) {
      calEvents = calEvents.filter(e => (e.event_date || '') >= startStr);
    } else {
      // Default to trailing 14-day window (daily ingest scope).
      // Historical months are locked by sheet-import rows — see month lock below.
      const cutoff = new Date();
      cutoff.setDate(cutoff.getDate() - 14);
      calEvents = calEvents.filter(e => (e.event_date || '') >= cutoff.toISOString().slice(0, 10));
    }
    if (endStr) calEvents = calEvents.filter(e => (e.event_date || '') <= endStr);

    const existingFees = await fetchAllPages(base44.asServiceRole.entities.FeeLines, '-created_date', 1000);
    const existingByEventId = new Map();
    for (const f of existingFees) if (f.calendar_event_id) existingByEventId.set(f.calendar_event_id, f);

    // Month lock: if a month has ANY sheet-import rows, never write calendar rows into it.
    const lockedMonths = new Set();
    for (const f of existingFees) {
      if (f.source === 'sheet-import' && f.invoice_month) lockedMonths.add(f.invoice_month);
    }
    calEvents = calEvents.filter(e => !lockedMonths.has(invoiceMonthFromDate(e.event_date || '')));
    const jobsArr = await fetchAllPages(base44.asServiceRole.entities.Jobs, '-created_date', 1000);

    // First pass: match jobs (now with address as a match key)
    const matched = calEvents.map((ev) => {
      const title = ev.job_name || '(untitled)';
      const normName = normalizeJobName(title);
      const m = matchJob(normName, jobsArr, ev.po_number, ev.oe_number, ev.address);
      return { ev, title, normName, m };
    });
    const autoCreateNames = [...new Set(matched.filter((x) => x.m.autoCreate).map((x) => x.normName).filter(Boolean))];
    // Seed PO/OE/address/builder onto auto-created jobs
    const autoPO = {}, autoOE = {}, autoAddr = {}, autoBuilder = {};
    for (const { m, normName, ev } of matched) {
      if (m.autoCreate && normName) {
        if (ev.po_number && !autoPO[normName]) autoPO[normName] = ev.po_number;
        if (ev.oe_number && !autoOE[normName]) autoOE[normName] = ev.oe_number;
        if (ev.address && !autoAddr[normName]) autoAddr[normName] = ev.address;
        if (ev.builder && !autoBuilder[normName]) autoBuilder[normName] = ev.builder;
      }
    }
    const newJobs = autoCreateNames.length
      ? await base44.asServiceRole.entities.Jobs.bulkCreate(autoCreateNames.map((n) => ({
          canonical_name: n, aliases: [n],
          po_numbers: autoPO[n] ? [autoPO[n]] : [],
          oe_numbers: autoOE[n] ? [autoOE[n]] : [],
          address: autoAddr[n] || null,
          builder: autoBuilder[n] || extractBuilder(n) || null,
        })))
      : [];
    const jobByNorm = new Map();
    for (const j of newJobs) jobByNorm.set(j.canonical_name, j);
    for (const j of jobsArr) { const n = normalizeJobName(j.canonical_name); if (n) jobByNorm.set(n, j); }

    const toCreate = [];
    const toUpdate = [];
    let skipped = 0;
    const flagged = [];
    for (const { ev, title, normName, m } of matched) {
      const description = htmlToText(ev.scope_notes || '');
      const calendar_labor_amt = extractLaborAmount(description);
      const ticket_sequence = extractTicketSequence(description);
      const profitSplit = extractProfitSplit(description);
      const dateStr = ev.event_date || '';
      let jobId = m.job_id;
      let matchConf = m.match_confidence;
      if (m.autoCreate) {
        jobId = jobByNorm.get(normName)?.id || null;
        if (jobId) matchConf = 'high'; // job was auto-created and linked
      }
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
        po_number: ev.po_number || null,
        oe_number: ev.oe_number || null,
        calendar_labor_amt,
        ticket_sequence,
        note_text: description,
        photo_urls: [],
        fee_type: profitSplit ? 'profit_split' : 'labor_pct',
        sale_price: profitSplit ? profitSplit.sale_price : null,
        cost: profitSplit ? profitSplit.cost : null,
        split_pct: profitSplit ? 0.5 : null,
        fee_pct: 0.1,
        billable: true,
        source: 'calendar',
        written_by: 'calendar',
        match_confidence: matchConf,
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

    const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
    for (const batch of chunk(toCreate, 500)) await base44.asServiceRole.entities.FeeLines.bulkCreate(batch);
    for (const batch of chunk(toUpdate, 500)) await base44.asServiceRole.entities.FeeLines.bulkUpdate(batch);

    // Add PO/OE/address/builder to matched jobs' arrays (many-to-one).
    const allJobs = [...jobsArr, ...newJobs];
    const jobPatches = new Map();
    for (const { ev, m, normName } of matched) {
      let jobId = m.job_id;
      if (m.autoCreate) jobId = jobByNorm.get(normName)?.id || null;
      if (!jobId) continue;
      const job = allJobs.find(j => j.id === jobId);
      if (!job) continue;
      const existingPOs = new Set(job.po_numbers || []);
      const existingOEs = new Set(job.oe_numbers || []);
      if (!jobPatches.has(jobId)) jobPatches.set(jobId, {
        id: jobId,
        po_numbers: [...(job.po_numbers || [])],
        oe_numbers: [...(job.oe_numbers || [])],
        address: job.address || null,
        builder: job.builder || null,
      });
      const u = jobPatches.get(jobId);
      if (ev.po_number && !existingPOs.has(ev.po_number) && !u.po_numbers.includes(ev.po_number)) u.po_numbers.push(ev.po_number);
      if (ev.oe_number && !existingOEs.has(ev.oe_number) && !u.oe_numbers.includes(ev.oe_number)) u.oe_numbers.push(ev.oe_number);
      if (!u.address && ev.address) u.address = ev.address;
      if (!u.builder && ev.builder) u.builder = ev.builder;
    }
    for (const batch of chunk([...jobPatches.values()], 500)) await base44.asServiceRole.entities.Jobs.bulkUpdate(batch);

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