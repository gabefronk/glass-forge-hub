import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import {
  toDenverDateString, buildProjectGroups, resolveProject, normalizeEventForProjectMatch,
  evaluatePosts, addDays,
} from '../../shared/reportMatching.ts';
import { getProbuildIdToken, fetchProbuildProjects, filterProjectsByWindow } from '../../shared/probuildApi.ts';
import { fetchAllPages } from '../../shared/pagination.ts';

// Diagnostic function for the Match Debug admin page.
// Given a date, returns:
//   - Per-event matching details with D-1/D/D+1 tolerance search
//   - 30-day posts-per-day histogram (UTC bucket vs Denver bucket)
//   - Project scan stats (total, deleted, skipped by lastModifiedAt, qualifying)
//   - Offset distribution (how many events resolved at 0, +1, -1)
//
// Params: { date: "YYYY-MM-DD" }
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const targetDate = body.date || toDenverDateString(new Date(Date.now() - 86400000));

    const allEvents = await fetchAllPages(base44.asServiceRole.entities.CalendarEvents, '-created_date', 5000);
    const allReports = await fetchAllPages(base44.asServiceRole.entities.FieldReports, '-created_date', 5000);

    // ── 30-day histogram (UTC bucket vs Denver bucket) ──────────────────
    const today = new Date();
    const histogram = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today.getTime() - i * 86400000);
      const dateStr = d.toISOString().slice(0, 10);
      // UTC bucket: raw createdAt date (first 10 chars of the ISO string)
      const utcCount = allReports.filter((r) => (r.created_at || '').slice(0, 10) === dateStr).length;
      // Denver bucket: the job_date field (already Denver-converted during ingest)
      const denverCount = allReports.filter((r) => r.job_date === dateStr).length;
      histogram.push({ date: dateStr, utc: utcCount, denver: denverCount });
    }

    // ── Project scan stats (Probuild API) ─────────────────────────────────
    let projectScan = null;
    try {
      const idToken = await getProbuildIdToken(base44);
      const projectEntries = await fetchProbuildProjects(idToken);
      const endStr = today.toISOString().slice(0, 10);
      const startStr = new Date(today.getTime() - 21 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const windowStartMs = new Date(startStr + 'T00:00:00Z').getTime();
      const windowEndMs = new Date(endStr + 'T23:59:59Z').getTime();
      const { stats } = filterProjectsByWindow(projectEntries, windowStartMs, windowEndMs);
      projectScan = stats;
    } catch (e) {
      projectScan = { error: e.message };
    }

    // ── Offset distribution (across all events) ──────────────────────────
    const offsetDistribution = { '0': 0, '1': 0, '-1': 0, 'null': 0 };
    for (const e of allEvents) {
      if (e.report_required === false) continue;
      if (['ok', 'waived', 'no_source_data'].includes(e.report_status)) continue;
      const off = e.report_date_offset;
      if (off === 0) offsetDistribution['0']++;
      else if (off === 1) offsetDistribution['1']++;
      else if (off === -1) offsetDistribution['-1']++;
      else offsetDistribution['null']++;
    }

    // ── Per-event debug for target date ──────────────────────────────────
    const events = allEvents.filter((e) => e.event_date === targetDate && e.report_required !== false);
    // Expand reports to D-1/D/D+1 for the tolerance search
    const reportsForDate = allReports.filter((r) => {
      const d = r.job_date;
      return d === targetDate || d === addDays(targetDate, -1) || d === addDays(targetDate, 1);
    });
    const projects = buildProjectGroups(reportsForDate);

    // Reports by date for the target date's neighborhood
    const reportsByDate = new Map();
    for (const r of reportsForDate) {
      if (!reportsByDate.has(r.job_date)) reportsByDate.set(r.job_date, []);
      reportsByDate.get(r.job_date).push(r);
    }
    const nearCount =
      (reportsByDate.get(addDays(targetDate, -1)) || []).length +
      (reportsByDate.get(targetDate) || []).length +
      (reportsByDate.get(addDays(targetDate, 1)) || []).length;

    const eventDebug = events.map((event) => {
      const { alpha_tokens, numeric_tokens } = normalizeEventForProjectMatch(event.job_name);
      const res = resolveProject(event, projects);
      const resolvedProject = res.best ? { id: res.best.id, name: res.best.name, score: res.best.score } : null;

      // Search D-1, D, D+1 for posts on the resolved project
      const dateSearch = { '-1': { count: 0, posts: [] }, '0': { count: 0, posts: [] }, '1': { count: 0, posts: [] } };
      let group = null;
      if (resolvedProject) {
        group = projects.find((g) => g.id === resolvedProject.id);
        if (group) {
          for (const offset of [-1, 0, 1]) {
            const searchDate = addDays(targetDate, offset);
            const datePosts = group.posts.filter((p) => p.job_date === searchDate);
            dateSearch[String(offset)] = {
              count: datePosts.length,
              posts: datePosts.map((p) => ({
                post_id: p.post_id,
                job_date: p.job_date,
                note_length: (p.message || '').length,
                attachment_count: Number(p.attachment_count) || (p.photo_urls || []).length,
              })),
            };
          }
        }
      }

      // Determine final status and reason
      let finalStatus, reason, matchedOffset = null;
      if (nearCount === 0) {
        finalStatus = 'no_source_data';
        reason = 'No FieldReports ingested for D-1/D/D+1 — Probuild sync likely failed. Flags suppressed.';
      } else if (!resolvedProject) {
        finalStatus = 'missing_all';
        reason = `No project matched above 0.80 threshold (top score: ${(res.candidates[0]?.score || 0).toFixed(3)}).`;
      } else if (!group) {
        finalStatus = 'missing_all';
        reason = `Project resolved but group not found in buildProjectGroups.`;
      } else {
        // Check phases: exact (0), then +1, then -1
        if (dateSearch['0'].count > 0) {
          matchedOffset = 0;
          const posts = dateSearch['0'].posts;
          const evalResult = evaluatePosts(group.posts.filter((p) => p.job_date === targetDate));
          finalStatus = evalResult.result;
          reason = `Matched project "${resolvedProject.name}" on exact date (offset 0). ${posts.length} post(s).`;
        } else if (dateSearch['1'].count > 0) {
          matchedOffset = 1;
          const posts = dateSearch['1'].posts;
          const evalResult = evaluatePosts(group.posts.filter((p) => p.job_date === addDays(targetDate, 1)));
          finalStatus = evalResult.result;
          reason = `Matched project "${resolvedProject.name}" on D+1 (offset +1, posted next day). ${posts.length} post(s).`;
        } else if (dateSearch['-1'].count > 0) {
          matchedOffset = -1;
          const posts = dateSearch['-1'].posts;
          const evalResult = evaluatePosts(group.posts.filter((p) => p.job_date === addDays(targetDate, -1)));
          finalStatus = evalResult.result;
          reason = `Matched project "${resolvedProject.name}" on D-1 (offset -1, posted day before — review). ${posts.length} post(s).`;
        } else {
          finalStatus = 'missing_all';
          reason = `Matched project "${resolvedProject.name}" but no posts found on D-1/D/D+1.`;
        }
      }

      return {
        event_id: event.id,
        raw_name: event.job_name,
        address: event.address,
        alpha_tokens,
        lot_tokens: numeric_tokens,
        resolved_project: resolvedProject,
        top_candidates: res.candidates.map((c) => ({ id: c.id, name: c.name, score: Number(c.score.toFixed(3)) })),
        date_search: dateSearch,
        matched_offset: matchedOffset,
        current_status: event.report_status,
        current_offset: event.report_date_offset,
        final_status: finalStatus,
        reason,
      };
    });

    return Response.json({
      date: targetDate,
      events_count: events.length,
      reports_available: (reportsByDate.get(targetDate) || []).length,
      reports_nearby: nearCount,
      projects_available: projects.length,
      histogram,
      project_scan: projectScan,
      offset_distribution: offsetDistribution,
      events: eventDebug,
    });
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 200 });
  }
}