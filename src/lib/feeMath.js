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

// Invoice Total = sum of fee_amt where billable = true AND (needs_review = false OR manually_adjusted = true)
export function invoiceTotal(rows) {
  return rows
    .filter((r) => r.billable && (!r.needs_review || r.manually_adjusted))
    .reduce((sum, r) => sum + (Number(r.fee_amt) || 0), 0);
}

export function laborTotal(rows) {
  return rows.reduce((sum, r) => sum + (Number(r.labor_amt) || 0), 0);
}

export function currentMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(monthStr) {
  const [y, m] = monthStr.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}