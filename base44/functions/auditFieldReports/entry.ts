import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import {
  toDenverDateString, buildProjectGroups, resolveProject, evaluatePosts,
  addDays, reportDueAtWithGrace, computeDaysLateWithGrace, isWithinGrace,
} from '../../shared/reportMatching.ts';
import { fetchAllPages } from '../../shared/pagination.ts';

// Audit field reports using two-stage project-level matching with a
// D-1/D/D+1 date tolerance window and a one-day grace period.
//
// Stage 1 — resolve each calendar event to a Probuild project by alpha-token
//   scoring (street-address match takes priority).
//
// Stage 2 — phased matching with claiming:
//   Phase 1 (offset 0): exact date D. Always preferred.
//   Phase 2 (offset +1): D+1, the "posted next morning" case.
//   Phase 3 (offset -1): D-1, least likely. Accepted but offset stored for review.
//   A post claimed in an earlier phase cannot be claimed in a later phase.
//   A single post satisfies ALL events on the same project + same scheduled date.
//
// Grace period: report_due_at = end of grace day (event_date + 1) in Denver.
//   Within grace → status stays pending (amber, no days-late).
//   After grace with no match → missing_* (red), days_late from grace day.
//
// Source-data verification: if zero FieldReports exist on D-1, D, AND D+1,
//   sets all events on D to no_source_data (flags suppressed).
//
// Params:
//   target_date  — audit a single date (YYYY-MM-DD)
//   days_back    — audit trailing N days from yesterday (default 1)
//   start_date   — audit a date range start (inclusive)
//   end_date     — audit a date range end (inclusive)
//   force        — when true, re-evaluate all events except waived.
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const force = !!body.force;

    // Read compliance start date from AppSettings (editable admin setting)
    let complianceStartDate = null;
    try {
      const settings = await base44.asServiceRole.entities.AppSettings.list('-created_date', 10);
      if (settings && settings.length > 0) complianceStartDate = settings[0].compliance_start_date;
    } catch (e) { /* AppSettings entity may not exist yet */ }

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

    // Expand the report range to include D-1 and D+1 neighbors
    const minAuditDate = datesToAudit.sort()[0];
    const maxAuditDate = datesToAudit[datesToAudit.length - 1];
    const reportRangeStart = addDays(minAuditDate, -1);
    const reportRangeEnd = addDays(maxAuditDate, 1);
    const reportsInRange = allReports.filter((r) => r.job_date >= reportRangeStart && r.job_date <= reportRangeEnd);

    // Build project groups from ALL reports in the expanded range
    const projects = buildProjectGroups(reportsInRange);

    // Reports by date (for no_source_data check)
    const reportsByDate = new Map();
    for (const r of reportsInRange) {
      if (!reportsByDate.has(r.job_date)) reportsByDate.set(r.job_date, []);
      reportsByDate.get(r.job_date).push(r);
    }

    const runId = `audit_${datesToAudit.join('_')}_${Date.now()}`;
    const ranAt = new Date().toISOString();
    const toUpdate = [];
    const audits = [];
    const updatedIds = new Set();
    const dateSummaries = [];
    const offsetCounts = { '0': 0, '1': 0, '-1': 0, 'null': 0 };

    // Step 1: identify no_source_data dates and mark those events
    const noSourceDates = new Set();
    for (const denverDate of datesToAudit) {
      const nearCount =
        (reportsByDate.get(addDays(denverDate, -1)) || []).length +
        (reportsByDate.get(denverDate) || []).length +
        (reportsByDate.get(addDays(denverDate, 1)) || []).length;
      if (nearCount === 0) {
        noSourceDates.add(denverDate);
        const events = allEvents.filter((e) => e.event_date === denverDate && e.report_required !== false && e.report_status !== 'waived');
        for (const event of events) {
          toUpdate.push({
            id: event.id,
            report_status: 'no_source_data',
            report_date_offset: null,
            report_checked_at: ranAt,
            report_due_at: reportDueAtWithGrace(event.event_date),
            days_late: 0,
            matched_post_ids: [],
            match_method: 'none',
            match_confidence: 0,
          });
          updatedIds.add(event.id);
          audits.push({
            audit_date: denverDate, calendar_event_id: event.id, result: 'no_source_data',
            matched_post_ids: [], candidates_considered: 0, top_score: 0, ran_at: ranAt, run_id: runId,
          });
        }
        dateSummaries.push({ date: denverDate, events: events.length, reports_available: 0, result: 'no_source_data' });
      }
    }

    // Step 2: collect all events that need matching (not no_source_data)
    const eventsToMatch = allEvents.filter((e) => {
      if (!datesToAudit.includes(e.event_date)) return false;
      if (noSourceDates.has(e.event_date)) return false;
      if (e.report_required === false) return false;
      if (e.report_status === 'waived') return false;
      if (!force && e.report_status === 'ok' && e.match_method === 'manual') return false;
      return true;
    });

    // Step 3: resolve each event to a project
    const resolutions = new Map();
    for (const event of eventsToMatch) {
      resolutions.set(event.id, resolveProject(event, projects));
    }

    // Step 4: group events by resolved project
    const eventsByProject = new Map();
    const unresolvedEvents = [];
    for (const event of eventsToMatch) {
      const res = resolutions.get(event.id);
      if (res.best) {
        if (!eventsByProject.has(res.best.id)) eventsByProject.set(res.best.id, []);
        eventsByProject.get(res.best.id).push(event);
      } else {
        unresolvedEvents.push(event);
      }
    }

    // Step 5: for each project group, do phased matching with claiming
    for (const [groupKey, groupEvents] of eventsByProject) {
      const group = projects.find((g) => g.id === groupKey);
      const allGroupPosts = group ? group.posts : [];

      // Group events by scheduled date
      const eventsByDate = new Map();
      for (const event of groupEvents) {
        if (!eventsByDate.has(event.event_date)) eventsByDate.set(event.event_date, []);
        eventsByDate.get(event.event_date).push(event);
      }

      // Group posts by date
      const postsByDate = new Map();
      for (const post of allGroupPosts) {
        if (!postsByDate.has(post.job_date)) postsByDate.set(post.job_date, []);
        postsByDate.get(post.job_date).push(post);
      }

      const claimedPostIds = new Set();
      const dateAssignments = new Map(); // date → { posts, offset }

      // Phase 1: exact date (offset 0) — ascending date order
      for (const date of [...eventsByDate.keys()].sort()) {
        const datePosts = (postsByDate.get(date) || []).filter((p) => !claimedPostIds.has(p.post_id));
        if (datePosts.length > 0) {
          dateAssignments.set(date, { posts: datePosts, offset: 0 });
          for (const p of datePosts) claimedPostIds.add(p.post_id);
        }
      }

      // Phase 2: D+1 (offset +1) — ascending date order
      for (const date of [...eventsByDate.keys()].sort()) {
        if (dateAssignments.has(date)) continue;
        const nextDay = addDays(date, 1);
        const datePosts = (postsByDate.get(nextDay) || []).filter((p) => !claimedPostIds.has(p.post_id));
        if (datePosts.length > 0) {
          dateAssignments.set(date, { posts: datePosts, offset: 1 });
          for (const p of datePosts) claimedPostIds.add(p.post_id);
        }
      }

      // Phase 3: D-1 (offset -1) — ascending date order
      for (const date of [...eventsByDate.keys()].sort()) {
        if (dateAssignments.has(date)) continue;
        const prevDay = addDays(date, -1);
        const datePosts = (postsByDate.get(prevDay) || []).filter((p) => !claimedPostIds.has(p.post_id));
        if (datePosts.length > 0) {
          dateAssignments.set(date, { posts: datePosts, offset: -1 });
          for (const p of datePosts) claimedPostIds.add(p.post_id);
        }
      }

      // Evaluate each date assignment
      for (const [date, events] of eventsByDate) {
        const assignment = dateAssignments.get(date);
        if (assignment) {
          const { result, post_ids } = evaluatePosts(assignment.posts);
          for (const event of events) {
            const res = resolutions.get(event.id);
            const daysLate = result === 'ok' ? 0 : computeDaysLateWithGrace(event.event_date);
            toUpdate.push({
              id: event.id,
              report_status: result,
              report_date_offset: assignment.offset,
              report_checked_at: ranAt,
              report_due_at: reportDueAtWithGrace(event.event_date),
              days_late: daysLate,
              matched_post_ids: post_ids,
              match_method: 'project_date',
              match_confidence: res.best.score,
              lot_tokens: res.lot_tokens,
              resolved_project_id: groupKey,
            });
            updatedIds.add(event.id);
            audits.push({
              audit_date: date, calendar_event_id: event.id, result,
              matched_post_ids: post_ids, candidates_considered: res.candidates.length,
              top_score: res.best.score, ran_at: ranAt, run_id: runId,
            });
            offsetCounts[String(assignment.offset)]++;
          }
        } else {
          // No match — check grace period
          for (const event of events) {
            const res = resolutions.get(event.id);
            const dueAt = reportDueAtWithGrace(event.event_date);
            const withinGrace = isWithinGrace(event.event_date);
            if (withinGrace) {
              toUpdate.push({
                id: event.id,
                report_status: 'pending',
                report_date_offset: null,
                report_checked_at: ranAt,
                report_due_at: dueAt,
                days_late: 0,
                matched_post_ids: [],
                match_method: 'none',
                match_confidence: res.best.score,
                lot_tokens: res.lot_tokens,
                resolved_project_id: groupKey,
              });
              offsetCounts['null']++;
            } else {
              const daysLate = computeDaysLateWithGrace(event.event_date);
              toUpdate.push({
                id: event.id,
                report_status: 'missing_all',
                report_date_offset: null,
                report_checked_at: ranAt,
                report_due_at: dueAt,
                days_late: daysLate,
                matched_post_ids: [],
                match_method: 'none',
                match_confidence: res.best.score,
                lot_tokens: res.lot_tokens,
                resolved_project_id: groupKey,
              });
              offsetCounts['null']++;
            }
            updatedIds.add(event.id);
            audits.push({
              audit_date: date, calendar_event_id: event.id,
              result: withinGrace ? 'pending' : 'missing_all',
              matched_post_ids: [], candidates_considered: res.candidates.length,
              top_score: res.best.score, ran_at: ranAt, run_id: runId,
            });
          }
        }
      }
    }

    // Unresolved events: no project matched → check grace period
    for (const event of unresolvedEvents) {
      const res = resolutions.get(event.id);
      const dueAt = reportDueAtWithGrace(event.event_date);
      const withinGrace = isWithinGrace(event.event_date);
      if (withinGrace) {
        toUpdate.push({
          id: event.id,
          report_status: 'pending',
          report_date_offset: null,
          report_checked_at: ranAt,
          report_due_at: dueAt,
          days_late: 0,
          matched_post_ids: [],
          match_method: 'none',
          match_confidence: res.candidates[0]?.score || 0,
          lot_tokens: res.lot_tokens,
          resolved_project_id: null,
        });
      } else {
        const daysLate = computeDaysLateWithGrace(event.event_date);
        toUpdate.push({
          id: event.id,
          report_status: 'missing_all',
          report_date_offset: null,
          report_checked_at: ranAt,
          report_due_at: dueAt,
          days_late: daysLate,
          matched_post_ids: [],
          match_method: 'none',
          match_confidence: res.candidates[0]?.score || 0,
          lot_tokens: res.lot_tokens,
          resolved_project_id: null,
        });
      }
      updatedIds.add(event.id);
      audits.push({
        audit_date: event.event_date, calendar_event_id: event.id,
        result: withinGrace ? 'pending' : 'missing_all',
        matched_post_ids: [], candidates_considered: res.candidates.length,
        top_score: res.candidates[0]?.score || 0, ran_at: ranAt, run_id: runId,
      });
      offsetCounts['null']++;
    }

    // Date summaries for audited dates (not no_source_data)
    for (const denverDate of datesToAudit) {
      if (noSourceDates.has(denverDate)) continue;
      const events = allEvents.filter((e) => e.event_date === denverDate && e.report_required !== false && e.report_status !== 'waived');
      const reports = (reportsByDate.get(denverDate) || []).length;
      dateSummaries.push({ date: denverDate, events: events.length, reports_available: reports, result: 'audited' });
    }

    // Refresh days_late for all other outstanding events (not on audited dates)
    for (const event of allEvents) {
      if (updatedIds.has(event.id)) continue;
      if (event.report_required === false) continue;
      if (['ok', 'waived', 'rescheduled', 'no_source_data', 'pre_compliance'].includes(event.report_status)) continue;

      // Mark events that should be pre_compliance but aren't yet
      if (complianceStartDate && event.event_date && event.event_date < complianceStartDate) {
        toUpdate.push({
          id: event.id,
          report_status_raw: event.report_status,
          report_status: 'pre_compliance',
          days_late: 0,
          report_due_at: reportDueAtWithGrace(event.event_date),
          report_checked_at: ranAt,
        });
        continue;
      }

      const withinGrace = isWithinGrace(event.event_date);
      const daysLate = computeDaysLateWithGrace(event.event_date);
      const dueAt = reportDueAtWithGrace(event.event_date);

      if (event.report_status === 'pending' && !withinGrace) {
        // Grace period expired — transition to missing_all
        toUpdate.push({
          id: event.id,
          report_status: 'missing_all',
          report_date_offset: null,
          days_late: daysLate,
          report_due_at: dueAt,
          report_checked_at: ranAt,
        });
      } else if (daysLate !== event.days_late || (event.report_due_at !== dueAt)) {
        toUpdate.push({
          id: event.id,
          days_late: daysLate,
          report_due_at: dueAt,
          report_checked_at: ranAt,
        });
      }
    }

    // Apply compliance suppression: events before complianceStartDate get pre_compliance.
    // The matcher's computed status is preserved in report_status_raw for tuning.
    const eventDateById = new Map();
    for (const e of allEvents) eventDateById.set(e.id, e.event_date);
    for (const row of toUpdate) {
      const eventDate = eventDateById.get(row.id);
      if (complianceStartDate && eventDate && eventDate < complianceStartDate && row.report_status !== 'waived' && row.report_status !== 'rescheduled') {
        row.report_status_raw = row.report_status;
        row.report_status = 'pre_compliance';
        row.days_late = 0;
      } else {
        row.report_status_raw = row.report_status;
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
      offset_distribution: offsetCounts,
    });
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 200 });
  }
}