import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import {
  toDenverDateString, yesterdayDenver, endOfDayDenver, computeDaysLate,
  resolveProject, evaluatePosts,
} from '../../shared/reportMatching.ts';
import { fetchAllPages } from '../../shared/pagination.ts';

// Audit field reports using two-stage project-level matching.
//
// Stage 1 — resolve each calendar event to a Probuild project by alpha-token
//   scoring (street-address match takes priority). Numeric tokens (lot/building
//   numbers) are stored as lot_tokens and used as a tiebreaker only.
//
// Stage 2 — one report satisfies every ticket on that project for that date.
//   Events resolved to the same project+date share a single status derived from
//   the aggregate of all posts on that project for that date.
//
// Source-data verification: if zero FieldReports exist for a date, sets all
// events for that date to no_source_data (flags suppressed, not marked missing).
//
// Params:
//   target_date  — audit a single date (YYYY-MM-DD)
//   days_back    — audit trailing N days from yesterday (default 1)
//   start_date   — audit a date range start (inclusive)
//   end_date     — audit a date range end (inclusive)
//   force        — when true, re-evaluate all events except waived (ignores
//                  ok+manual protection). Use for bulk re-runs after logic changes.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const force = !!body.force;

    // Build the list of dates to audit
    let datesToAudit;
    if (body.target_date) {
      datesToAudit = [body.target_date];
    } else if (body.start_date && body.end_date) {
      datesToAudit = [];
      const start = new Date(body.start_date + 'T00:00:00Z');
      const end = new Date(body.end_date + 'T00:00:00Z');
      for (let d = new Date(start); d <= end; d = new Date(d.getTime() + 86400000)) {
        datesToAudit.push(d.toISOString().slice(0, 10));
      }
    } else {
      const daysBack = body.days_back || 1;
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
    const dateSummaries = [];

    for (const denverDate of datesToAudit) {
      // Events on this date that need a report
      const events = allEvents.filter((e) => {
        if (e.event_date !== denverDate) return false;
        if (e.report_required === false) return false;
        if (e.report_status === 'waived') return false;
        if (!force && e.report_status === 'ok' && e.match_method === 'manual') return false;
        return true;
      });

      const reports = allReports.filter((r) => r.job_date === denverDate);
      const reportsAvailable = reports.length;

      // Source-data verification: zero reports means the pull failed, not that
      // crews skipped paperwork. Suppress flags — set no_source_data, not missing.
      if (reportsAvailable === 0) {
        for (const event of events) {
          toUpdate.push({
            id: event.id,
            report_status: 'no_source_data',
            report_checked_at: ranAt,
            report_due_at: event.report_due_at || endOfDayDenver(event.event_date),
            days_late: 0,
            matched_post_ids: [],
            match_method: 'none',
            match_confidence: 0,
          });
          updatedIds.add(event.id);
          audits.push({
            audit_date: denverDate,
            calendar_event_id: event.id,
            result: 'no_source_data',
            matched_post_ids: [],
            candidates_considered: 0,
            top_score: 0,
            ran_at: ranAt,
            run_id: runId,
          });
        }
        dateSummaries.push({ date: denverDate, events: events.length, reports_available: 0, result: 'no_source_data' });
        continue;
      }

      // Build unique projects from reports (project_id → { id, name, posts })
      const projectMap = new Map();
      for (const r of reports) {
        if (!r.project_id) continue;
        if (!projectMap.has(r.project_id)) {
          projectMap.set(r.project_id, { id: r.project_id, name: r.job_name, posts: [] });
        }
        projectMap.get(r.project_id).posts.push(r);
      }
      const projects = [...projectMap.values()];

      // Stage 1: resolve each event to a project
      const resolutions = new Map(); // event.id → { best, candidates, lot_tokens }
      for (const event of events) {
        const res = resolveProject(event, projects);
        resolutions.set(event.id, res);
      }

      // Stage 2: group events by resolved project, evaluate posts for that project+date
      const eventsByProject = new Map(); // project_id → [event]
      const unresolvedEvents = [];
      for (const event of events) {
        const res = resolutions.get(event.id);
        if (res.best) {
          if (!eventsByProject.has(res.best.id)) eventsByProject.set(res.best.id, []);
          eventsByProject.get(res.best.id).push(event);
        } else {
          unresolvedEvents.push(event);
        }
      }

      // Evaluate each project group
      for (const [projectId, groupEvents] of eventsByProject) {
        const project = projectMap.get(projectId);
        const posts = project ? project.posts : [];
        const { result, post_ids } = evaluatePosts(posts);

        for (const event of groupEvents) {
          const res = resolutions.get(event.id);
          const daysLate = result === 'ok' ? 0 : computeDaysLate(event.event_date);
          toUpdate.push({
            id: event.id,
            report_status: result,
            report_checked_at: ranAt,
            report_due_at: event.report_due_at || endOfDayDenver(event.event_date),
            days_late: daysLate,
            matched_post_ids: post_ids,
            match_method: 'project_date',
            match_confidence: res.best.score,
            lot_tokens: res.lot_tokens,
            resolved_project_id: projectId,
          });
          updatedIds.add(event.id);
          audits.push({
            audit_date: denverDate,
            calendar_event_id: event.id,
            result,
            matched_post_ids: post_ids,
            candidates_considered: res.candidates.length,
            top_score: res.best.score,
            ran_at: ranAt,
            run_id: runId,
          });
        }
      }

      // Unresolved events: no project matched → missing_all
      for (const event of unresolvedEvents) {
        const res = resolutions.get(event.id);
        const daysLate = computeDaysLate(event.event_date);
        toUpdate.push({
          id: event.id,
          report_status: 'missing_all',
          report_checked_at: ranAt,
          report_due_at: event.report_due_at || endOfDayDenver(event.event_date),
          days_late: daysLate,
          matched_post_ids: [],
          match_method: 'none',
          match_confidence: res.candidates[0]?.score || 0,
          lot_tokens: res.lot_tokens,
          resolved_project_id: null,
        });
        updatedIds.add(event.id);
        audits.push({
          audit_date: denverDate,
          calendar_event_id: event.id,
          result: 'missing_all',
          matched_post_ids: [],
          candidates_considered: res.candidates.length,
          top_score: res.candidates[0]?.score || 0,
          ran_at: ranAt,
          run_id: runId,
        });
      }

      dateSummaries.push({ date: denverDate, events: events.length, reports_available, result: 'audited' });
    }

    // Refresh days_late for all other outstanding events (not on audited dates)
    for (const event of allEvents) {
      if (updatedIds.has(event.id)) continue;
      if (event.report_required === false) continue;
      if (['ok', 'waived', 'rescheduled', 'no_source_data'].includes(event.report_status)) continue;
      const daysLate = computeDaysLate(event.event_date);
      if (daysLate !== event.days_late) {
        toUpdate.push({ id: event.id, days_late: daysLate, report_checked_at: ranAt });
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
      date_summaries: dateSummaries,
    });
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 200 });
  }
}