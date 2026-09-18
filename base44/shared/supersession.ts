import { duplicatePostIds, feeCompanions, eventPostIndex } from "./billingCore.js";
// Shared supersession + provenance logic used by both the frontend
// (invoicingFilters.js) and the backend (closeMonthSnapshot). Keeping this
// in one place ensures the snapshot and the UI agree on which rows count.

export const MAN_HOUR_RATE = 100;
export const TRIP_RATE = 75;

// A notes amount is a "pure trip charge" if it's a positive multiple of the
// trip rate ($75) but NOT also a multiple of the man-hour rate ($100).
//   $75 = 1 trip, $150 = 2 trips, $225 = 3 trips  → trip charge
//   $100 = 1 man hour, $200 = 2 man hours          → not a trip charge
//   $300 = ambiguous (3×$100 or 4×$75)             → NOT a trip charge (review)
export function isTripChargeAmount(amt: number | string): boolean {
  const n = Number(amt);
  return n > 0 && n % TRIP_RATE === 0 && n % MAN_HOUR_RATE !== 0;
}

// Conditional supersession — computed at read time, not a static field.
// Within a linked duplicate group (probuild row has superseded_by → calendar row):
//   - Calendar row has calendar_labor_amt (notes amount):
//       Trip-charge case (pure trip charge + probuild man_hours) → probuild
//       is suppressed (its hours were added into the calendar row).
//       Otherwise → do NOT suppress (independent work; needs_review was set
//       at ingest time so the calendar row is held from totals).
//   - Calendar row has no calendar_labor_amt (labor came from the merge):
//       Calendar has labor > 0 → probuild is a duplicate, suppress it.
//       Calendar is $0, probuild has hours → probuild bills, suppress calendar.
//       Both $0 → neither bills.
// Returns the ID that should be excluded from totals, or null if neither.
export function resolveSupersession(
  r: { id: string; superseded_by?: string; labor_amt?: number; man_hours?: number; trip_charges?: number },
  rowById: Map<string, any>
): string | null {
  if (!r.superseded_by) return null;
  const calRow = rowById.get(r.superseded_by);
  if (!calRow) return null;

  const calLabor = Number(calRow.labor_amt) || 0;
  const probuildLabor = Number(r.labor_amt) || 0;
  const probuildHasHours = Number(r.man_hours) > 0 || Number(r.trip_charges) > 0;
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

// events (optional): CalendarEvents, so audit-matched posts pair companion lines by
// identity. $0 ProBuild twins of a calendar labor line are excluded (money-neutral).
export function buildSupersededSet(rows: any[], events?: any[]): Set<string> {
  const rowById = new Map<string, any>();
  for (const r of rows) rowById.set(r.id, r);
  const excluded = duplicatePostIds(rows);
  for (const r of rows) {
    if (!r.superseded_by) continue;
    const ex = resolveSupersession(r, rowById);
    if (ex) excluded.add(ex);
  }
  for (const id of feeCompanions(rows, { eventPosts: eventPostIndex(events) }).folded) excluded.add(id);
  return excluded;
}