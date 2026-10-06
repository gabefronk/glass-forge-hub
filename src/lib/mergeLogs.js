// Pure helpers for showing JobMergeLog rows (combine audit) on a job page.

const KEYS = ["calendar_events", "field_reports", "job_notes", "fee_lines", "contact_job_links", "job_budgets", "probuild_project_links", "job_knowledge", "field_library_projects"];

export function isAuditedLog(log) {
  return typeof log?.audit_version === "number" && log.audit_version >= 1;
}

export function movedCounts(log) {
  const ids = log?.relocated_link_ids || {};
  const out = {};
  for (const k of KEYS) out[k] = Array.isArray(ids[k]) ? ids[k].length : (log?.relocated_link_counts?.[k] || 0);
  return out;
}

export function movedSummary(log) {
  const c = movedCounts(log);
  const parts = [
    [c.calendar_events, "visit"], [c.field_reports, "report"], [c.job_notes, "note"], [c.fee_lines, "invoice line"],
    [c.contact_job_links, "contact link"], [c.job_budgets, "budget"], [c.probuild_project_links, "Probuild link"],
    [c.job_knowledge, "knowledge brief"], [c.field_library_projects, "field-library project"],
  ].filter(([n]) => n > 0).map(([n, w]) => `${n} ${w}${n === 1 ? "" : "s"}`);
  return parts.length ? parts.join(", ") : "no linked records";
}

// What the panel says about a log and whether an admin may undo it.
// Undo is offered for every audited, not-yet-reversed log — complete, partial,
// failed or an unfinished undo — because undo only moves recorded ids back.
export function mergeLogState(log) {
  if (log?.reversed) return { key: "reversed", label: "Undone", tone: "muted", canUndo: false };
  if (!isAuditedLog(log)) {
    return { key: "legacy", label: "Combined (older record)", tone: "muted", canUndo: false, note: "Made before exact record tracking, so it can't be undone automatically." };
  }
  if (log.reverse_status === "partial") {
    return { key: "undo_partial", label: "Undo unfinished", tone: "amber", canUndo: true, undoLabel: "Retry undo", note: "Some recorded records are still on the surviving job. Retrying only moves those back." };
  }
  if (log.status === "complete") return { key: "complete", label: "Combined", tone: "green", canUndo: true, undoLabel: "Undo combine" };
  const anyMoved = Object.values(movedCounts(log)).some((n) => n > 0);
  return {
    key: "partial",
    label: anyMoved ? "Partly combined" : "Combine stopped",
    tone: "amber",
    canUndo: true,
    undoLabel: anyMoved ? "Undo moved records" : "Clear this attempt",
    note: anyMoved ? "Some records moved, the rest did not. The record was left visible." : "Nothing was moved. The record was left visible.",
  };
}

export function logErrors(log) {
  return [...(log?.relocate_errors || []), log?.fields_error, log?.mark_error, ...(log?.reverse_errors || [])].filter(Boolean);
}