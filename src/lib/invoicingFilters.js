import { duplicatePostIds } from "../../base44/shared/billingCore.js";
import { isFutureRow, isTripChargeAmount } from "@/lib/feeMath";

// Report statuses that are considered "ok" — no report blocking.
// no_source_data is clear for billing: it means the Probuild pull failed that
// morning (system fault), not that the crew failed to upload. Surfaced separately
// in the UI so the user knows data is incomplete without it eating the invoice total.
const OK_REPORT_STATUSES = ["ok", "waived", "pre_compliance", "no_source_data"];

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

// Conditional supersession — computed at read time, not a static field.
// Mirrors base44/shared/supersession.ts (kept in sync so the snapshot backend
// and the UI agree on which rows count).
//
// Calendar row has calendar_labor_amt (notes amount):
//   - Trip-charge case (pure trip charge + probuild man_hours) → probuild
//     suppressed (its hours were added into the calendar row).
//   - Otherwise → do NOT suppress (independent work; needs_review was set
//     at ingest time so the calendar row is held from totals).
// Calendar row has no calendar_labor_amt (labor came from the merge):
//   - Calendar has labor > 0 → probuild is a duplicate, suppress it.
//   - Calendar is $0, probuild has hours → probuild bills, suppress calendar.
//   - Both $0 → neither bills.
export function resolveSupersession(r, rowById) {
  if (!r.superseded_by) return null;
  const calRow = rowById?.get(r.superseded_by);
  if (!calRow) return null;

  const calLabor = Number(calRow.labor_amt) || 0;
  const probuildLabor = Number(r.labor_amt) || 0;
  const probuildHasHours = (Number(r.man_hours) > 0 || Number(r.trip_charges) > 0);
  const calHasNotesLabor = calRow.calendar_labor_amt != null && calRow.calendar_labor_amt !== "";

  if (calHasNotesLabor) {
    const calAmt = Number(calRow.calendar_labor_amt) || 0;
    if (isTripChargeAmount(calAmt) && Number(r.man_hours) > 0) {
      return r.id; // trip charge + labor: probuild hours added into calendar
    }
    return null; // review case: don't suppress (needs_review set at ingest)
  }

  // Merge case: calendar row's labor came from the probuild merge
  if (calLabor > 0 && probuildLabor > 0) return r.id;
  if (calLabor > 0) return r.id;
  if (probuildLabor > 0 || probuildHasHours) return calRow.id;
  return null;
}

// Build a set of row IDs that should be excluded from totals due to supersession.
// Call this once per render with the full month's rows, then pass the set to isReady.
export function buildSupersededSet(rows) {
  const rowById = new Map();
  for (const r of rows) rowById.set(r.id, r);
  const excluded = duplicatePostIds(rows);
  for (const r of rows) {
    if (!r.superseded_by) continue;
    const ex = resolveSupersession(r, rowById);
    if (ex) excluded.add(ex);
  }
  return excluded;
}

// Ready to bill — the single source of truth for "what counts as ready."
// Both the Invoicing header and the sidebar unbilled card use this.
// A row is ready when:
//   - billable, not yet billed to BFS, not a future event
//   - not match-blocked (needs_review && !manually_adjusted)
//   - not report-blocked (missing field report on source CalendarEvent)
//   - not superseded (conditional — see buildSupersededSet)
//   - has labor > 0 OR is a profit-split row (cost $0 is valid for splits)
export const isReady = (r, reportStatusMap, supersededSet) =>
  r.billable &&
  !r.billed_to_bfs &&
  !isFutureRow(r) &&
  !isMatchBlocked(r) &&
  !isReportBlocked(r, reportStatusMap) &&
  !(supersededSet && supersededSet.has(r.id)) &&
  (Number(r.labor_amt) > 0 || r.fee_type === "profit_split");

export const isCustomFee = (r) =>
  r.fee_type !== "profit_split" && Number(r.fee_pct) !== 0.1;