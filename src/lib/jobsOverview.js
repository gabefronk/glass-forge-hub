import { jobsStatus } from "@/lib/jobsSanitize";
import { groupJobs } from "@/lib/jobDedupe";
import { buildReportEvidence } from "@/lib/jobReports";
import { denverDate } from "../../base44/shared/billingCore.js";

// The Jobs hub's list model, pure so it can be tested: duplicate records grouped
// (read-only), one status per visible job, visit dates, and the pill counts.
// events/notes: pass null when they could not load; statuses then fall back to
// billing lines (still combined across a merged group) and `evidenceAvailable`
// is false so the page can say so.

const dayOf = (v) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null);

// Adds `days` to a YYYY-MM-DD string without touching UTC.
export function addDays(day, days) {
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

// Visit dates for one job group from calendar events and billing lines.
// Cancelled calendar placeholders never count as visits.
export function visitSummary({ events = [], lines = [], today }) {
  const dates = new Set();
  for (const e of events) {
    if (e?.source_status === "cancelled") continue;
    const d = dayOf(e?.event_date);
    if (d) dates.add(d);
  }
  for (const r of lines) {
    const d = dayOf(r?.job_date);
    if (d) dates.add(d);
  }
  const sorted = [...dates].sort();
  const next = sorted.find((d) => d >= today) || null;
  const past = sorted.filter((d) => d < today);
  return { nextVisit: next, lastVisit: past.length ? past[past.length - 1] : null, visitCount: sorted.length };
}

export function buildJobsOverview({ jobs = [], feeLines = [], events = null, notes = null, today = denverDate() } = {}) {
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
  const eventsByGroup = new Map();
  for (const e of events || []) {
    if (!e?.job_id) continue;
    const gid = groupIdOf(e.job_id);
    if (!eventsByGroup.has(gid)) eventsByGroup.set(gid, []);
    eventsByGroup.get(gid).push(e);
  }

  const weekEnd = addDays(today, 6);
  const stats = {};
  const counts = { needs_report: 0, needs_review: 0, active: 0, complete: 0, duplicates: 0, this_week: 0, records: jobs.length };
  for (const g of groups) {
    const rows = rowsByGroup.get(g.id) || [];
    const status = jobsStatus(rows, evidence, today);
    const probuildDates = rows.filter((r) => r.source === "probuild" || r.source === "both").map((r) => r.job_date).filter(Boolean).sort();
    const visits = visitSummary({ events: eventsByGroup.get(g.id) || [], lines: rows, today });
    const thisWeek = Boolean(visits.nextVisit && visits.nextVisit <= weekEnd);
    stats[g.id] = { status, lastReport: probuildDates.length ? probuildDates[probuildDates.length - 1] : null, ...visits, thisWeek };
    if (status.key in counts) counts[status.key]++;
    if (g.review.length) counts.duplicates++;
    if (thisWeek) counts.this_week++;
  }
  return { groups, groupByJobId, evidenceAvailable, stats, counts };
}

// Sorts for the Jobs hub. Pure; returns a new array.
export const JOB_SORTS = [
  { key: "recent", label: "Newest added" },
  { key: "next", label: "Next visit" },
  { key: "last", label: "Last visit" },
  { key: "name", label: "Name A–Z" },
];

export function sortJobGroups(groups, stats, sort = "recent") {
  const newest = (g) => g.members.reduce((d, m) => ((m.created_date || "") > d ? m.created_date : d), "");
  const name = (g) => String(g.job?.canonical_name || "").toLowerCase();
  const list = [...groups];
  if (sort === "name") return list.sort((a, b) => name(a).localeCompare(name(b)));
  if (sort === "next") {
    // Soonest upcoming visit first; jobs with nothing scheduled go last, newest first.
    return list.sort((a, b) => {
      const na = stats[a.id]?.nextVisit, nb = stats[b.id]?.nextVisit;
      if (na && nb) return na.localeCompare(nb) || name(a).localeCompare(name(b));
      if (na) return -1;
      if (nb) return 1;
      return newest(b).localeCompare(newest(a));
    });
  }
  if (sort === "last") {
    return list.sort((a, b) => {
      const la = stats[a.id]?.lastVisit || "", lb = stats[b.id]?.lastVisit || "";
      return lb.localeCompare(la) || newest(b).localeCompare(newest(a));
    });
  }
  // Newest record in the group first, so a freshly added duplicate stays near the top.
  return list.sort((a, b) => newest(b).localeCompare(newest(a)));
}

// Distinct builders across visible groups, with counts, for the builder filter.
export function builderOptions(groups, clean = (s) => s) {
  const counts = new Map();
  for (const g of groups) {
    const b = clean(String(g.job?.builder || "").trim());
    if (!b) continue;
    counts.set(b, (counts.get(b) || 0) + 1);
  }
  return [...counts.entries()].map(([name, count]) => ({ name, count })).sort((a, b) => a.name.localeCompare(b.name));
}
