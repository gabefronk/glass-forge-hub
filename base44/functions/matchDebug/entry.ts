import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import {
  toDenverDateString, resolveProject, normalizeEventForProjectMatch,
  evaluatePosts,
} from '../../shared/reportMatching.ts';
import { fetchAllPages } from '../../shared/pagination.ts';

// Diagnostic function for the Match Debug admin page.
// Given a date, returns per-event matching details so an admin can see exactly
// why an event was flagged or cleared.
//
// Params: { date: "YYYY-MM-DD" }
// Returns: { date, events_count, reports_available, events: [{ ... }] }
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const targetDate = body.date || toDenverDateString(new Date(Date.now() - 86400000));

    const allEvents = await fetchAllPages(base44.asServiceRole.entities.CalendarEvents, '-created_date', 5000);
    const allReports = await fetchAllPages(base44.asServiceRole.entities.FieldReports, '-created_date', 5000);

    const events = allEvents.filter((e) => e.event_date === targetDate && e.report_required !== false);
    const reports = allReports.filter((r) => r.job_date === targetDate);

    // Build unique projects from reports
    const projectMap = new Map();
    for (const r of reports) {
      if (!r.project_id) continue;
      if (!projectMap.has(r.project_id)) {
        projectMap.set(r.project_id, { id: r.project_id, name: r.job_name, posts: [] });
      }
      projectMap.get(r.project_id).posts.push(r);
    }
    const projects = [...projectMap.values()];

    const eventDebug = events.map((event) => {
      const { alpha_tokens, numeric_tokens } = normalizeEventForProjectMatch(event.job_name);
      const res = resolveProject(event, projects);
      const resolvedProject = res.best ? { id: res.best.id, name: res.best.name, score: res.best.score } : null;

      // Find posts for the resolved project
      let postInfo = null;
      if (resolvedProject) {
        const project = projectMap.get(resolvedProject.id);
        const posts = project ? project.posts : [];
        const evalResult = evaluatePosts(posts);
        postInfo = {
          found: posts.length > 0,
          post_count: posts.length,
          post_ids: evalResult.post_ids,
          note_length: posts.reduce((s, p) => s + (p.message || "").length, 0),
          attachment_count: posts.reduce((s, p) => s + (Number(p.attachment_count) || (p.photo_urls || []).length), 0),
        };
      }

      // Determine final status and why
      let finalStatus, reason;
      if (reports.length === 0) {
        finalStatus = 'no_source_data';
        reason = 'No FieldReports ingested for this date — Probuild sync likely failed. Flags suppressed.';
      } else if (!resolvedProject) {
        finalStatus = 'missing_all';
        reason = `No project matched above 0.80 threshold (top score: ${(res.candidates[0]?.score || 0).toFixed(3)}).`;
      } else if (postInfo && postInfo.found) {
        const project = projectMap.get(resolvedProject.id);
        const posts = project ? project.posts : [];
        const hasNotes = posts.some((p) => (p.message || "").trim().length >= 10);
        const hasPhotos = posts.some((p) => (Number(p.attachment_count) || (p.photo_urls || []).length) > 0);
        if (hasNotes && hasPhotos) { finalStatus = 'ok'; reason = `Matched project "${resolvedProject.name}" (${resolvedProject.score.toFixed(3)}), post has notes+photos.`; }
        else if (hasPhotos) { finalStatus = 'missing_notes'; reason = `Matched project "${resolvedProject.name}", post has photos but no notes.`; }
        else if (hasNotes) { finalStatus = 'missing_photos'; reason = `Matched project "${resolvedProject.name}", post has notes but no photos.`; }
        else { finalStatus = 'missing_all'; reason = `Matched project "${resolvedProject.name}" but post has no notes or photos.`; }
      } else {
        finalStatus = 'missing_all';
        reason = `Matched project "${resolvedProject.name}" but no posts found for this date.`;
      }

      return {
        event_id: event.id,
        raw_name: event.job_name,
        address: event.address,
        alpha_tokens,
        lot_tokens: numeric_tokens,
        resolved_project: resolvedProject,
        top_candidates: res.candidates.map((c) => ({ id: c.id, name: c.name, score: Number(c.score.toFixed(3)) })),
        post_found: postInfo ? postInfo.found : false,
        post_count: postInfo ? postInfo.post_count : 0,
        note_length: postInfo ? postInfo.note_length : 0,
        attachment_count: postInfo ? postInfo.attachment_count : 0,
        current_status: event.report_status,
        final_status: finalStatus,
        reason,
      };
    });

    return Response.json({
      date: targetDate,
      events_count: events.length,
      reports_available: reports.length,
      projects_available: projects.length,
      events: eventDebug,
    });
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 200 });
  }
}