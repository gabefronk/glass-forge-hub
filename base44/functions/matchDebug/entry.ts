import { createClientFromRequest } from 'npm:@base44/sdk@0.8.40';
import { getProbuildIdToken, fetchProbuildProjects, filterProjectsByWindow } from '../../shared/probuildApi.ts';
import { fetchAllPages } from '../../shared/pagination.ts';

// Diagnostic function for the Match Debug admin page.
// Given a date range (defaulting to the last 21 days), returns:
//   - Summary stats from stored audit data (report_status_raw)
//   - Per-event list grouped by date with stored matching data
//   - 30-day posts-per-day histogram (UTC bucket vs Denver bucket)
//   - Project scan stats (total, deleted, skipped, qualifying)
//
// Shows report_status_raw for every event — what the matcher concluded
// regardless of compliance suppression. Pre-compliance events appear here
// so the backlog can be used to tune the matcher.
//
// Params: { start_date: "YYYY-MM-DD", end_date: "YYYY-MM-DD" }
export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const body = await req.json().catch(() => ({}));
    const today = new Date();
    const endDate = body.end_date || today.toISOString().slice(0, 10);
    const startDate = body.start_date || new Date(today.getTime() - 21 * 86400000).toISOString().slice(0, 10);

    const allEvents = await fetchAllPages(base44.asServiceRole.entities.CalendarEvents, '-created_date', 5000);
    const allReports = await fetchAllPages(base44.asServiceRole.entities.FieldReports, '-created_date', 5000);

    // ── 30-day histogram (UTC bucket vs Denver bucket) ──────────────────
    const histogram = [];
    for (let i = 29; i >= 0; i--) {
      const d = new Date(today.getTime() - i * 86400000);
      const dateStr = d.toISOString().slice(0, 10);
      const utcCount = allReports.filter((r) => (r.created_at || '').slice(0, 10) === dateStr).length;
      const denverCount = allReports.filter((r) => r.job_date === dateStr).length;
      histogram.push({ date: dateStr, utc: utcCount, denver: denverCount });
    }

    // ── Project scan stats (Probuild API) ─────────────────────────────────
    let projectScan = null;
    try {
      const idToken = await getProbuildIdToken(base44);
      const projectEntries = await fetchProbuildProjects(idToken);
      const endStr = today.toISOString().slice(0, 10);
      const startStr = new Date(today.getTime() - 21 * 86400000).toISOString().slice(0, 10);
      const windowStartMs = new Date(startStr + 'T00:00:00Z').getTime();
      const windowEndMs = new Date(endStr + 'T23:59:59Z').getTime();
      const { stats } = filterProjectsByWindow(projectEntries, windowStartMs, windowEndMs);
      projectScan = stats;
    } catch (e) {
      projectScan = { error: e.message };
    }

    // ── Events in range with stored audit data ────────────────────────────
    const eventsInRange = allEvents.filter((e) =>
      e.event_date >= startDate && e.event_date <= endDate && e.report_required !== false
    );

    // Summary stats from stored report_status_raw
    const summary = {
      events_evaluated: eventsInRange.length,
      matched_ok: 0,
      matched_missing_notes: 0,
      matched_missing_photos: 0,
      no_match: 0,
      pending: 0,
      pre_compliance: 0,
    };
    const offsetCounts = { '0': 0, '1': 0, '-1': 0, 'null': 0 };

    for (const e of eventsInRange) {
      const raw = e.report_status_raw || e.report_status;
      if (raw === 'ok') summary.matched_ok++;
      else if (raw === 'missing_notes') summary.matched_missing_notes++;
      else if (raw === 'missing_photos') summary.matched_missing_photos++;
      else if (raw === 'missing_all' || raw === 'no_source_data') summary.no_match++;
      else if (raw === 'pending') summary.pending++;
      if (e.report_status === 'pre_compliance') summary.pre_compliance++;

      const off = e.report_date_offset;
      if (off === 0) offsetCounts['0']++;
      else if (off === 1) offsetCounts['1']++;
      else if (off === -1) offsetCounts['-1']++;
      else offsetCounts['null']++;
    }

    // Group by date (descending)
    const byDate = new Map();
    for (const e of eventsInRange) {
      if (!byDate.has(e.event_date)) byDate.set(e.event_date, []);
      byDate.get(e.event_date).push(e);
    }
    const eventsByDate = [...byDate.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, events]) => ({
        date,
        events: events.map((e) => ({
          event_id: e.id,
          job_name: e.job_name,
          address: e.address,
          report_status: e.report_status,
          report_status_raw: e.report_status_raw || e.report_status,
          report_date_offset: e.report_date_offset,
          match_method: e.match_method,
          match_confidence: e.match_confidence,
          matched_post_count: (e.matched_post_ids || []).length,
          days_late: e.days_late || 0,
        })),
      }));

    return Response.json({
      start_date: startDate,
      end_date: endDate,
      summary,
      offset_distribution: offsetCounts,
      events_by_date: eventsByDate,
      histogram,
      project_scan: projectScan,
    });
  } catch (error) {
    return Response.json({ error: error.message, stack: error.stack }, { status: 200 });
  }
}