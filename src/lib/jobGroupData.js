import { base44 } from "@/api/base44Client";
import { fetchAllPages } from "@/lib/pagination";
import { groupForJob } from "@/lib/jobDedupe";
import { buildReportEvidence } from "@/lib/jobReports";

// Read-only loaders shared by the job page and the Jobs workspace panel. A job
// that has duplicate records (see jobDedupe.js) is shown as one: activity from
// every member record is read and combined. No record is written or merged.

// The presentation group for jobId, or a single-member group when the Jobs list
// cannot be read (the page still works, just without duplicate merging).
export async function loadJobGroup(jobId) {
  try {
    const all = await fetchAllPages(base44.entities.Jobs, "-created_date", 1000);
    const group = groupForJob(all, jobId);
    if (group) return group;
  } catch {
    // fall through to the single record
  }
  return { id: jobId, job: null, members: [], memberIds: [jobId], merged: false, mergeReason: "", review: [] };
}

export async function loadJobActivity(memberIds) {
  const ids = [...new Set(memberIds)];
  const [rowLists, noteLists] = await Promise.all([
    Promise.all(ids.map((id) => base44.entities.FeeLines.filter({ job_id: id }, "-job_date", 5000))),
    Promise.all(ids.map((id) => base44.entities.JobNotes.filter({ job_id: id }, "-note_date", 500))),
  ]);
  const byDateDesc = (field) => (a, b) => String(b[field] || "").localeCompare(String(a[field] || ""));
  return { rows: rowLists.flat().sort(byDateDesc("job_date")), notes: noteLists.flat().sort(byDateDesc("note_date")) };
}

// Calendar events shown on the job, plus report evidence for its status. The
// evidence also covers events linked from this job's lines that are filed under
// another job id, so a linked event's "Report complete" is never missed.
export function jobEventsAndEvidence(allEvents, memberIds, rows, notes) {
  const members = new Set(memberIds);
  const linkIds = new Set(rows.filter((r) => r.calendar_event_id).map((r) => r.calendar_event_id));
  const shown = [];
  const relevant = [];
  for (const e of allEvents || []) {
    const linked = Boolean(e.google_event_id) && linkIds.has(e.google_event_id);
    if (e.job_id ? members.has(e.job_id) : linked) shown.push(e);
    if (linked || (e.job_id && members.has(e.job_id))) relevant.push(e);
  }
  const canonical = memberIds[0];
  const evidence = buildReportEvidence({ events: relevant, notes, groupOf: (id) => (members.has(id) ? canonical : id) });
  return { events: shown, evidence };
}
