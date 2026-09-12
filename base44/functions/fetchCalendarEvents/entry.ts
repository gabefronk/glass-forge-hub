import { pricingReview, canonicalPostRows } from "../../shared/billingCore.js";
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { normalizeJobName, matchJob, computeLaborAmt, computeFeeAmt, invoiceMonthFromDate, extractLaborAmount, extractTicketSequence, mergeReviewFlags, extractBuilder, htmlToText, extractProfitSplit, isTripChargeAmount } from '../../shared/ingestShared.ts';
import { fetchAllPages } from '../../shared/pagination.ts';

// Derive FeeLines from CalendarEvents (the single Google reader).
// Reads CalendarEvents (source='google') instead of re-reading the Google API.
// Skips app-authored events (source='app') — those are owned by pushCalendarEvent.
// Upserts on calendar_event_id (= CalendarEvents.google_event_id); never
// overwrites a manually_adjusted row or a written_by='app' row.
//
// Reverse merge: when creating a NEW calendar FeeLine, checks for an existing
// Probuild-sourced FeeLine for the same job within ±3 days that has man_hours
// or trip_charges (e.g. a "screen installed trip charge" note posted the day
// after a $0 warranty calendar event). Merges the Probuild labor data into
// the calendar row and supersedes the standalone Probuild row so the charge
// appears on the calendar event's date, not scattered to a separate day.

// Find an existing Probuild-sourced FeeLine for the same job within ±3 days
// that has man_hours or trip_charges and hasn't been merged/superseded yet.
function findProbuildRowToMerge(existingFees, jobId, eventDate, reserved) {
  if (!jobId || !eventDate) return null;
  const eventMs = new Date(eventDate + 'T00:00:00Z').getTime();
  let best = null;
  let minDiff = Infinity;
  for (const f of existingFees) {
    if (f.job_id !== jobId || reserved.has(f.probuild_post_id)) continue;
    if (f.source !== 'probuild') continue;
    if (f.manually_adjusted) continue;
    if (f.superseded_by) continue;
    if (f.calendar_event_id) continue; // already linked to a calendar event
    if (f.man_hours == null && f.trip_charges == null) continue;
    const diff = Math.abs(new Date(f.job_date + 'T00:00:00Z').getTime() - eventMs);
    if (diff <= 3 * 86400000 && diff < minDiff) {
      minDiff = diff;
      best = f;
    }
  }
  return best;
}

// Decide how to handle a Probuild row found during reverse merge, given the
// calendar row's notes amount (calendar_labor_amt).
//   - Trip-charge case: notes amount is a pure trip charge + Probuild man_hours →
//     add them, copy the hours, supersede the probuild row.
//   - Review case: notes amount + independent Probuild hours, ambiguous → don't
//     copy, set needs_review, don't supersede (both rows surface for decision).
//   - Merge case: no notes amount → labor came from the merge, copy and supersede.
function planProbuildMerge(calendar_labor_amt, probuildRow, description) {
  const hasNotesLabor = calendar_labor_amt != null && calendar_labor_amt !== '';
  if (hasNotesLabor) {
    const amt = Number(calendar_labor_amt) || 0;
    if (/trip\s+charge/i.test(description) && isTripChargeAmount(amt) && Number(probuildRow.man_hours) > 0) {
      return { copyHours: true, supersede: true, needsReview: false };
    }
    return { copyHours: false, supersede: false, needsReview: true };
  }
  return { copyHours: true, supersede: true, needsReview: false };
}

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
      cutoff.setUTCDate(1);
      calEvents = calEvents.filter(e => (e.event_date || '') >= cutoff.toISOString().slice(0, 10));
    }
    if (endStr) calEvents = calEvents.filter(e => (e.event_date || '') <= endStr);

    const existingFees = await fetchAllPages(base44.asServiceRole.entities.FeeLines, '-created_date', 1000);
    const reserved = new Set(existingFees.filter(f => f.calendar_event_id && f.probuild_post_id).map(f => f.probuild_post_id));
    const canonical = canonicalPostRows(existingFees);
    const mergeCandidates = existingFees.filter(f => canonical.get(f.probuild_post_id)?.id === f.id);
    const existingByEventId = new Map();
    for (const f of existingFees) if (f.calendar_event_id) existingByEventId.set(f.calendar_event_id, f);

    // Month lock: if a month has ANY sheet-import rows, never write calendar rows into it.
    const lockedMonths = new Set();
    for (const f of existingFees) {
      if (f.source === 'sheet-import' && f.invoice_month) lockedMonths.add(f.invoice_month);
    }
    calEvents = calEvents.filter(e => !lockedMonths.has(invoiceMonthFromDate(e.event_date || '')));
    const snapshots = await fetchAllPages(base44.asServiceRole.entities.MonthCloseSnapshot, '-created_date', 1000);
    for (const snap of snapshots) lockedMonths.add(snap.month);
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
    const probuildRowsToSupersede = [];
    let skipped = 0;
    const flagged = [];
    for (const { ev, title, normName, m } of matched) {
      const description = htmlToText(ev.scope_notes || '');
      const calendar_labor_amt = extractLaborAmount(description);
      const ticket_sequence = extractTicketSequence(description);
      const profitSplit = extractProfitSplit(description);
      const pricing = profitSplit ? null : pricingReview(description);
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
        calendar_note_text: description,
        pricing_review_reason: pricing?.reason || null,
        split_candidate_amt: pricing?.amount ?? null,
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
        needs_review: !!m.needs_review || !!pricing,
        manually_adjusted: false,
      };
      row.labor_amt = computeLaborAmt(row);
      row.fee_amt = computeFeeAmt(row);
      const ex = existingByEventId.get(ev.google_event_id);
      if (ex) {
        if (ex.manually_adjusted || ex.billed_to_bfs || ex.written_by === 'app' || lockedMonths.has(ex.invoice_month)) { skipped++; continue; }
        // Preserve Probuild-merged labor data so labor_amt/fee_amt are
        // recomputed from the full merged state, not just calendar-only fields.
        // Without this, re-running calendar ingest zeroes out labor_amt on
        // rows that had man_hours merged in from Probuild.
        if (ex.man_hours != null) row.man_hours = ex.man_hours;
        if (ex.trip_charges != null) row.trip_charges = ex.trip_charges;
        if (ex.probuild_post_id) row.probuild_post_id = ex.probuild_post_id;
        if (ex.probuild_project_id) row.probuild_project_id = ex.probuild_project_id;
        if (ex.probuild_post_id) {
          row.source = 'both';
          row.note_text = [description, ex.probuild_note_text && "ProBuild:\n" + ex.probuild_note_text].filter(Boolean).join("\n\n");
          for (const key of ['probuild_note_text','probuild_job_date','photo_urls','service_material','service_rate','service_labor_amount','service_trip_amount','service_total','service_calculation_source','service_review_status']) if (ex[key] != null) row[key] = ex[key];
          if (ex.job_date !== dateStr) {
            row.job_date = ex.job_date; row.invoice_month = ex.invoice_month;
            row.pricing_review_reason = 'Calendar was rescheduled after a ProBuild charge was recorded; confirm the billing date.';
            row.needs_review = true;
          }
          if (ex.pricing_review_reason && !row.pricing_review_reason) { row.pricing_review_reason = ex.pricing_review_reason; row.needs_review = true; }
        }
        row.fee_pct = ex.fee_pct ?? row.fee_pct;
        row.billable = ex.billable ?? row.billable;
        // Reverse merge: if this existing calendar row has no Probuild data yet,
        // check for a standalone Probuild row (same job, ±3 days) with man_hours
        // or trip_charges that should be folded in. Fixes the timing gap where
        // Probuild ingest ran before the calendar event was synced.
        let provenanceReview = false;
        if (!ex.probuild_post_id && row.man_hours == null && row.trip_charges == null) {
          const probuildRow = findProbuildRowToMerge(mergeCandidates, jobId, dateStr, reserved);
          if (probuildRow) {
            const plan = planProbuildMerge(row.calendar_labor_amt, probuildRow, description);
            if (plan.copyHours) {
              reserved.add(probuildRow.probuild_post_id);
              for (const key of ['photo_urls','service_material','service_rate','service_labor_amount','service_trip_amount','service_total','service_calculation_source','service_review_status']) if (probuildRow[key] != null) row[key] = probuildRow[key];
              row.probuild_note_text = probuildRow.probuild_note_text || probuildRow.note_text || '';
              row.probuild_job_date = probuildRow.probuild_job_date || probuildRow.job_date;
              row.note_text = [description, 'ProBuild:\n' + row.probuild_note_text].filter(Boolean).join('\n\n');
              if (probuildRow.needs_review) row.needs_review = true;
              if (probuildRow.pricing_review_reason) row.pricing_review_reason = probuildRow.pricing_review_reason;
              if (probuildRow.man_hours != null) row.man_hours = probuildRow.man_hours;
              if (probuildRow.trip_charges != null) row.trip_charges = probuildRow.trip_charges;
              row.probuild_post_id = probuildRow.probuild_post_id;
              row.probuild_project_id = probuildRow.probuild_project_id;
              row.source = 'both';
            }
            if (plan.supersede) probuildRowsToSupersede.push({ id: probuildRow.id, calendar_row_id: ex.id });
            if (plan.needsReview) { provenanceReview = true; row.pricing_review_reason = 'Calendar amount and separate ProBuild service charge need allocation review.'; }
          }
        }
        row.labor_amt = computeLaborAmt(row);
        row.fee_amt = computeFeeAmt(row);
        const merged = mergeReviewFlags(ex, row);
        // Q3: provenance review overrides job-match clearance
        const finalNeedsReview = merged.needs_review || provenanceReview;
        toUpdate.push({ id: ex.id, ...row, needs_review: finalNeedsReview, match_confidence: merged.match_confidence });
      } else {
        // Reverse merge: check for an existing Probuild row (same job, ±3 days)
        // with man_hours or trip_charges that should be folded into this new
        // calendar row. Handles the timing case where Probuild ingest ran
        // before the calendar event was synced.
        const probuildRow = findProbuildRowToMerge(mergeCandidates, jobId, dateStr, reserved);
        if (probuildRow) {
          const plan = planProbuildMerge(row.calendar_labor_amt, probuildRow, description);
          if (plan.copyHours) {
              reserved.add(probuildRow.probuild_post_id);
              for (const key of ['photo_urls','service_material','service_rate','service_labor_amount','service_trip_amount','service_total','service_calculation_source','service_review_status']) if (probuildRow[key] != null) row[key] = probuildRow[key];
              row.probuild_note_text = probuildRow.probuild_note_text || probuildRow.note_text || '';
              row.probuild_job_date = probuildRow.probuild_job_date || probuildRow.job_date;
              row.note_text = [description, 'ProBuild:\n' + row.probuild_note_text].filter(Boolean).join('\n\n');
              if (probuildRow.needs_review) row.needs_review = true;
              if (probuildRow.pricing_review_reason) row.pricing_review_reason = probuildRow.pricing_review_reason;
            if (probuildRow.man_hours != null) row.man_hours = probuildRow.man_hours;
            if (probuildRow.trip_charges != null) row.trip_charges = probuildRow.trip_charges;
            row.probuild_post_id = probuildRow.probuild_post_id;
            row.probuild_project_id = probuildRow.probuild_project_id;
            row.source = 'both';
          }
          if (plan.needsReview) { row.needs_review = true; row.pricing_review_reason = 'Calendar amount and separate ProBuild service charge need allocation review.'; }
          row.labor_amt = computeLaborAmt(row);
          row.fee_amt = computeFeeAmt(row);
          if (plan.supersede) probuildRowsToSupersede.push({ id: probuildRow.id, calendar_row_key: toCreate.length });
        }
        toCreate.push(row);
      }
      if (row.needs_review) flagged.push({ id: ev.google_event_id, title, job_date: dateStr });
    }

    for (const patch of [...toCreate, ...toUpdate]) {
      const event = allCalEvents.find(e => e.google_event_id === patch.calendar_event_id);
      if (event?.source_status === 'cancelled') {
        patch.needs_review = true; patch.pricing_review_reason = 'Source calendar event was cancelled; confirm any completed work.';
        if (!patch.probuild_post_id) patch.billable = false;
      }
    }
    const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
    const createdRows = [];
    for (const batch of chunk(toCreate, 500)) createdRows.push(...await base44.asServiceRole.entities.FeeLines.bulkCreate(batch));
    const createdByEvent = new Map(createdRows.map(r => [r.calendar_event_id, r]));
    for (const batch of chunk(toUpdate, 500)) await base44.asServiceRole.entities.FeeLines.bulkUpdate(batch);

    // Supersede Probuild rows that were reverse-merged into calendar rows.
    // The calendar row now owns the labor data; the Probuild row is suppressed.
    // Deduplicate by Probuild row id — multiple calendar events for the same
    // job can match the same Probuild post; only the first match wins.
    if (probuildRowsToSupersede.length) {
      const seenProbuildIds = new Set();
      const supersedeUpdates = [];
      for (const p of probuildRowsToSupersede) {
        if (seenProbuildIds.has(p.id)) continue;
        seenProbuildIds.add(p.id);
        if (p.calendar_row_id) {
          supersedeUpdates.push({ id: p.id, superseded_by: p.calendar_row_id });
        } else if (p.calendar_row_key != null) {
          const createdRow = createdByEvent.get(toCreate[p.calendar_row_key]?.calendar_event_id);
          if (createdRow && createdRow.id) {
            supersedeUpdates.push({ id: p.id, superseded_by: createdRow.id });
          }
        }
      }
      if (supersedeUpdates.length) await base44.asServiceRole.entities.FeeLines.bulkUpdate(supersedeUpdates);
    }

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
      locked_months: [...lockedMonths],
      calendar_events_scanned: calEvents.length,
      created: toCreate.length,
      updated: toUpdate.length,
      probuild_reverse_merged: probuildRowsToSupersede.length,
      skipped_manually_adjusted: skipped,
      auto_created_jobs: autoCreateNames,
      flagged_for_review: flagged,
    });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
}