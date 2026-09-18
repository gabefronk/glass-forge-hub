import { jobsStatus } from "@/lib/jobsSanitize";
import { groupJobs } from "@/lib/jobDedupe";
import { buildReportEvidence } from "@/lib/jobReports";

// The Jobs hub's list model, pure so it can be tested: duplicate records grouped
// (read-only), one status per visible job, and the pill counts.
// events/notes: pass null when they could not load; statuses then fall back to
// billing lines (still combined across a merged group) and `evidenceAvailable`
// is false so the page can say so.
export function buildJobsOverview({ jobs = [], feeLines = [], events = null, notes = null, today } = {}) {
  const { groups, groupByJobId } = groupJobs(jobs);
  const groupIdOf = (jobId) => groupByJobId.get(jobId)?.id || jobId;
  const evidenceAvailable = Boolean(events || notes);
  const evidence = buildReportEvidence({ events: events || [], notes: notes || [], groupOf: groupIdOf });

  const rowsByGroup = new Map();
  for (const r of feeLines) {
    if (!r.job_id) continue;
    const gid = groupIdOf(r.job_id);
    if (!rowsByGroup.has(gid)) rowsByGroup.set(gid, []);
    rowsByGroup.get(gid).push(r);
  }

  const stats = {};
  const counts = { needs_report: 0, needs_review: 0, active: 0, complete: 0, duplicates: 0, records: jobs.length };
  for (const g of groups) {
    const rows = rowsByGroup.get(g.id) || [];
    const status = jobsStatus(rows, evidence, today);
    const probuildDates = rows.filter((r) => r.source === "probuild" || r.source === "both").map((r) => r.job_date).filter(Boolean).sort();
    stats[g.id] = { status, lastReport: probuildDates.length ? probuildDates[probuildDates.length - 1] : null };
    if (status.key in counts) counts[status.key]++;
    if (g.review.length) counts.duplicates++;
  }
  return { groups, groupByJobId, evidenceAvailable, stats, counts };
}
