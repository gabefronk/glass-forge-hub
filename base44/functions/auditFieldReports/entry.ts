import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { toDenverDateString, yesterdayDenver, endOfDayDenver, computeDaysLate, scoreMatch, determineMatchMethod } from '../../shared/reportMatching.ts';
import { fetchAllPages } from '../../shared/pagination.ts';

// Audit field reports for a target date (or trailing N days).
// Idempotent: never overwrites events that are ok+manual or waived.
// Matches CalendarEvents to FieldReports by street/name/builder scoring (>= 0.80).
// Evaluates matched reports for notes+photos, sets report_status, writes ReportAudit rows.
// Also refreshes days_late for all other outstanding events.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));

    const daysBack = body.days_back || 1;
    const targetDate = body.target_date;
    let datesToAudit;
    if (targetDate) {
      datesToAudit = [targetDate];
    } else {
      datesToAudit = [];
      for (let i = 1; i <= daysBack; i++) {
        datesToAudit.push(toDenverDateString(new Date(Date.now() - i * 86400000)));
      }
    }

    const allEvents = await fetchAllPages(base44.asServiceRole.entities.CalendarEvents, '-created_date', 5000);
    const allReports = await fetchAllPages(base44.asServiceRole.entities.FieldReports, '-created_date', 5000);

    const runId = `audit_${datesToAudit.join('_')}_${Date.now()}`;
    const ranAt = new Date().toISOString();
    const toUpdate = [];
    const audits = [];
    const updatedIds = new Set();

    for (const denverDate of datesToAudit) {
      // Events on this date that need a report and aren't waived or manually-ok
      const events = allEvents.filter(e =>
        e.event_date === denverDate &&
        e.report_required !== false &&
        e.report_status !== 'waived' &&
        !(e.report_status === 'ok' && e.match_method === 'manual')
      );
      const reports = allReports.filter(r => r.job_date === denverDate);

      for (const event of events) {
        let bestScore = 0;
        let bestReport = null;
        let candidatesConsidered = 0;

        for (const report of reports) {
          const score = scoreMatch(event, report);
          candidatesConsidered++;
          if (score > bestScore) {
            bestScore = score;
            bestReport = report;
          }
        }

        const matchMethod = bestReport ? determineMatchMethod(event, bestReport, bestScore) : "none";
        const matchedPostIds = bestReport && bestScore >= 0.80 ? [bestReport.post_id] : [];

        // Evaluate the matched report
        let result;
        if (bestReport && bestScore >= 0.80) {
          const hasNotes = (bestReport.message || "").trim().length >= 10;
          const hasPhotos = (bestReport.photo_urls || []).length >= 1;
          if (hasNotes && hasPhotos) result = "ok";
          else if (hasPhotos) result = "missing_notes";
          else if (hasNotes) result = "missing_photos";
          else result = "missing_all";
        } else {
          result = "missing_all";
        }

        const daysLate = result === "ok" ? 0 : computeDaysLate(event.event_date);
        const reportDueAt = event.report_due_at || endOfDayDenver(event.event_date);

        toUpdate.push({
          id: event.id,
          report_status: result,
          report_checked_at: ranAt,
          report_due_at: reportDueAt,
          days_late: daysLate,
          matched_post_ids: matchedPostIds,
          match_method: matchMethod,
          match_confidence: bestScore,
        });
        updatedIds.add(event.id);

        audits.push({
          audit_date: denverDate,
          calendar_event_id: event.id,
          result,
          matched_post_ids: matchedPostIds,
          candidates_considered: candidatesConsidered,
          top_score: bestScore,
          ran_at: ranAt,
          run_id: runId,
        });
      }
    }

    // Refresh days_late for all other outstanding events (not on the audited dates)
    for (const event of allEvents) {
      if (updatedIds.has(event.id)) continue;
      if (event.report_required === false) continue;
      if (event.report_status === 'ok' || event.report_status === 'waived' || event.report_status === 'rescheduled') continue;
      const daysLate = computeDaysLate(event.event_date);
      if (daysLate !== event.days_late) {
        toUpdate.push({
          id: event.id,
          days_late: daysLate,
          report_checked_at: ranAt,
        });
      }
    }

    const chunk = (arr, n) => Array.from({ length: Math.ceil(arr.length / n) }, (_, i) => arr.slice(i * n, i * n + n));
    for (const batch of chunk(toUpdate, 500)) await base44.asServiceRole.entities.CalendarEvents.bulkUpdate(batch);
    for (const batch of chunk(audits, 500)) await base44.asServiceRole.entities.ReportAudit.bulkCreate(batch);

    return Response.json({
      dates_audited: datesToAudit,
      events_evaluated: updatedIds.size,
      updated: toUpdate.length,
      audits_written: audits.length,
      run_id: runId,
    });
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 200 });
  }
}