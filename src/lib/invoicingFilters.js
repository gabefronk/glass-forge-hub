import { isFutureRow } from "@/lib/feeMath";

// Report statuses that are considered "ok" — no report blocking.
const OK_REPORT_STATUSES = ["ok", "waived", "pre_compliance"];

// Match-confidence block: the row's job match is uncertain.
// This is NOT the same as a missing field report — keep them separate.
export const isMatchBlocked = (r) =>
  r.needs_review && !r.manually_adjusted;

// Field-report block: the crew hasn't uploaded photos/notes for the source
// CalendarEvent. Requires a reportStatusMap: Map<calendar_event_id, report_status>.
// A row with no calendar_event_id (probuild-only or app-authored) is not blocked.
export const isReportBlocked = (r, reportStatusMap) => {
  if (!r.calendar_event_id || !reportStatusMap) return false;
  const status = reportStatusMap.get(r.calendar_event_id);
  if (!status) return false;
  return !OK_REPORT_STATUSES.includes(status);
};

// Ready to bill — the single source of truth for "what counts as ready."
// Both the Invoicing header and the sidebar unbilled card use this.
// A row is ready when:
//   - billable, not yet billed to BFS, not a future event
//   - not match-blocked (needs_review && !manually_adjusted)
//   - not report-blocked (missing field report on source CalendarEvent)
//   - not superseded by another row in a duplicate group
//   - has labor > 0 OR is a profit-split row (cost $0 is valid for splits)
export const isReady = (r, reportStatusMap) =>
  r.billable &&
  !r.billed_to_bfs &&
  !isFutureRow(r) &&
  !isMatchBlocked(r) &&
  !isReportBlocked(r, reportStatusMap) &&
  !r.superseded_by &&
  (Number(r.labor_amt) > 0 || r.fee_type === "profit_split");

export const isCustomFee = (r) =>
  r.fee_type !== "profit_split" && Number(r.fee_pct) !== 0.1;