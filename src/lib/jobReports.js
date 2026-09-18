// Field-report evidence for the Jobs "Needs report" status. Pure and read-only.
//
// A past calendar visit (FeeLines row with source calendar/both) needs a report
// until one of these pieces of evidence, each tied to THAT visit, clears it:
//   1. its linked CalendarEvent (row.calendar_event_id = event.google_event_id)
//      is Report complete, Waived, Rescheduled or not required: the same states
//      the visit card on the job page shows as not needing a report;
//   2. a ProBuild line for the same job on the same date (the original rule);
//   3. a ProBuild line that supersedes this exact row (superseded_by = row.id);
//   4. only when the row has no linked event record: an event for the same job
//      and date that is cleared, or a field-report note (photos or a
//      complete/incomplete answer) for the same job and date.
// A report on another date, or on another job, never clears a visit. A linked
// event that is still pending or late keeps its visit flagged even when some
// other report exists (rule 2 aside, which predates this module).

export const REPORT_CLEARED_STATUSES = new Set(["ok", "waived", "rescheduled"]);

export function eventReportCleared(ev) {
  if (!ev) return false;
  return ev.report_required === false || REPORT_CLEARED_STATUSES.has(ev.report_status);
}

export function isFieldReportNote(note) {
  return Boolean(note) && ((Array.isArray(note.attachments) && note.attachments.length > 0) || Boolean(note.completion));
}

const dayOf = (v) => String(v || "").slice(0, 10);
const identity = (id) => id;

// events/notes: any superset of the relevant records. groupOf maps a job id to
// the id its presentation group uses, so evidence on a merged duplicate record
// counts for the group (see jobDedupe.js); by default each job stands alone.
export function buildReportEvidence({ events = [], notes = [], groupOf = identity } = {}) {
  const eventsByLink = new Map();
  const clearedJobDates = new Set();
  const noteJobDates = new Set();
  for (const ev of events || []) {
    if (!ev) continue;
    if (ev.google_event_id) eventsByLink.set(ev.google_event_id, ev);
    if (ev.job_id && ev.event_date && eventReportCleared(ev)) {
      clearedJobDates.add(`${groupOf(ev.job_id)}|${dayOf(ev.event_date)}`);
    }
  }
  for (const n of notes || []) {
    if (n?.job_id && n.note_date && isFieldReportNote(n)) noteJobDates.add(`${groupOf(n.job_id)}|${dayOf(n.note_date)}`);
  }
  return { eventsByLink, clearedJobDates, noteJobDates, groupOf };
}

const isCalendarRow = (r) => r.source === "calendar" || r.source === "both";
const isProbuildRow = (r) => r.source === "probuild" || r.source === "both";

// Returns the visits (calendar rows) on or before `today` that still need a report.
export function visitsMissingReport(rows, evidence, today) {
  const ev = evidence || null;
  const groupOf = ev?.groupOf || identity;
  const probuild = rows.filter(isProbuildRow);
  const probuildDates = new Set(probuild.map((p) => `${groupOf(p.job_id)}|${dayOf(p.job_date)}`));
  const supersededBy = new Set(probuild.map((p) => p.superseded_by).filter(Boolean));
  const missing = [];
  for (const r of rows) {
    if (!isCalendarRow(r)) continue;
    const linked = r.calendar_event_id ? ev?.eventsByLink.get(r.calendar_event_id) : null;
    // A visit moved to a later date is not due yet.
    const date = dayOf(linked?.event_date || r.job_date);
    if (date > today) continue;
    const key = `${groupOf(r.job_id)}|${dayOf(r.job_date)}`;
    if (probuildDates.has(key) || (r.id && supersededBy.has(r.id))) continue;
    if (linked) {
      if (eventReportCleared(linked)) continue;
    } else if (ev && (ev.clearedJobDates.has(key) || ev.noteJobDates.has(key))) {
      continue;
    }
    missing.push(r);
  }
  return missing;
}

// Future visits (by the linked event's current date when known).
export function hasUpcomingVisit(rows, evidence, today) {
  return rows.some((r) => {
    if (!isCalendarRow(r)) return false;
    const linked = r.calendar_event_id ? evidence?.eventsByLink.get(r.calendar_event_id) : null;
    return dayOf(linked?.event_date || r.job_date) > today;
  });
}
