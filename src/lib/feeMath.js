// Calculation rules for FeeLines.
// labor_amt: if calendar_labor_amt present use it; else (man_hours × 100) + (trip_charges × 75)
// fee_amt = labor_amt × fee_pct
// Rows where manually_adjusted = true are passed through exactly as stored (never recomputed).

export const MAN_HOUR_RATE = 100;
export const TRIP_RATE = 75;

export function computeLaborAmt(row) {
  if (row.manually_adjusted) return row.labor_amt;
  if (row.calendar_labor_amt != null && row.calendar_labor_amt !== "") return Number(row.calendar_labor_amt) || 0;
  const mh = Number(row.man_hours) || 0;
  const tc = Number(row.trip_charges) || 0;
  return mh * MAN_HOUR_RATE + tc * TRIP_RATE;
}

export function computeFeeAmt(row) {
  if (row.manually_adjusted) return row.fee_amt;
  const labor = computeLaborAmt(row);
  return Math.round(labor * (Number(row.fee_pct) || 0) * 100) / 100;
}

// Human-readable fee math, e.g. "2 man hours × $100 + 1 trip × $75 = $275 × 10% = $27.50"
export function feeMathString(row) {
  if (row.manually_adjusted) {
    return `$${formatMoney(row.labor_amt)} × ${Math.round((row.fee_pct || 0) * 100)}% = $${formatMoney(row.fee_amt)} (manually adjusted)`;
  }
  if (row.calendar_labor_amt != null && row.calendar_labor_amt !== "") {
    const labor = Number(row.calendar_labor_amt) || 0;
    const fee = Math.round(labor * (Number(row.fee_pct) || 0) * 100) / 100;
    return `calendar labor $${formatMoney(labor)} × ${Math.round((row.fee_pct || 0) * 100)}% = $${formatMoney(fee)}`;
  }
  const mh = Number(row.man_hours) || 0;
  const tc = Number(row.trip_charges) || 0;
  const labor = mh * MAN_HOUR_RATE + tc * TRIP_RATE;
  const fee = Math.round(labor * (Number(row.fee_pct) || 0) * 100) / 100;
  const parts = [];
  if (mh) parts.push(`${mh} man hour${mh === 1 ? "" : "s"} × $${MAN_HOUR_RATE}`);
  if (tc) parts.push(`${tc} trip${tc === 1 ? "" : "s"} × $${TRIP_RATE}`);
  const lhs = parts.join(" + ") || "$0";
  return `${lhs} = $${formatMoney(labor)} × ${Math.round((row.fee_pct || 0) * 100)}% = $${formatMoney(fee)}`;
}

export function formatMoney(n) {
  const v = Number(n) || 0;
  return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// Today's date (YYYY-MM-DD) for future-event exclusion
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// A row is "future" if its job_date is after today — scheduled but not yet billable.
export function isFutureRow(r) {
  const d = r.job_date;
  if (!d) return false;
  return d > todayStr();
}

// Billable-gated predicate — the ONLY filter for any total pair, so labor and
// fee always iterate the identical row set. If a row's fee is excluded, its
// labor is excluded too. Excluded rows are surfaced in their own sections with
// visible subtotals so nothing is hidden.
export function isBillableNow(r) {
  return r.billable && (!r.needs_review || r.manually_adjusted) && !isFutureRow(r);
}

export function isBillableFuture(r) {
  return r.billable && (!r.needs_review || r.manually_adjusted) && isFutureRow(r);
}

// Held-out rows — visible in Needs Review / Scheduled sections, never in totals.
export function isReviewHeld(r) {
  return !(r.billable && (!r.needs_review || r.manually_adjusted));
}

// Invoice Total / Labor Total — identical row set (billable now).
export function invoiceTotal(rows) {
  return rows
    .filter(isBillableNow)
    .reduce((sum, r) => sum + (Number(r.fee_amt) || 0), 0);
}

export function laborTotal(rows) {
  return rows
    .filter(isBillableNow)
    .reduce((sum, r) => sum + (Number(r.labor_amt) || 0), 0);
}

// Scheduled subtotals — identical row set (billable future).
export function futureLaborTotal(rows) {
  return rows
    .filter(isBillableFuture)
    .reduce((sum, r) => sum + (Number(r.labor_amt) || 0), 0);
}

export function futureFeeTotal(rows) {
  return rows
    .filter(isBillableFuture)
    .reduce((sum, r) => sum + (Number(r.fee_amt) || 0), 0);
}

// Held-out subtotals (Needs Review) — rows excluded from any total.
export function heldLaborTotal(rows) {
  return rows
    .filter((r) => !isFutureRow(r) && isReviewHeld(r))
    .reduce((sum, r) => sum + (Number(r.labor_amt) || 0), 0);
}

export function heldFeeTotal(rows) {
  return rows
    .filter((r) => !isFutureRow(r) && isReviewHeld(r))
    .reduce((sum, r) => sum + (Number(r.fee_amt) || 0), 0);
}

export function heldFutureLaborTotal(rows) {
  return rows
    .filter((r) => isFutureRow(r) && isReviewHeld(r))
    .reduce((sum, r) => sum + (Number(r.labor_amt) || 0), 0);
}

export function heldFutureFeeTotal(rows) {
  return rows
    .filter((r) => isFutureRow(r) && isReviewHeld(r))
    .reduce((sum, r) => sum + (Number(r.fee_amt) || 0), 0);
}

export function currentMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(monthStr) {
  const [y, m] = monthStr.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}