// Calculation rules for FeeLines.
// labor_amt: if calendar_labor_amt present use it; else (man_hours × 100) + (trip_charges × 75)
// fee_amt = labor_amt × fee_pct
// Rows where manually_adjusted = true preserve their labor_amt (never recomputed from man_hours/trip_charges);
// fee_amt is always derived from labor_amt × fee_pct.

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
  if (row.fee_type === 'profit_split') {
    const sale = Number(row.sale_price) || 0;
    const cost = Number(row.cost) || 0;
    const split = row.split_pct != null ? Number(row.split_pct) : 0.5;
    return Math.round((sale - cost) * split * 100) / 100;
  }
  const labor = computeLaborAmt(row);
  return Math.round(labor * (Number(row.fee_pct) || 0) * 100) / 100;
}

// Profit = sale_price − cost (display only, never stored).
export function computeProfit(row) {
  if (row.fee_type !== 'profit_split') return 0;
  return (Number(row.sale_price) || 0) - (Number(row.cost) || 0);
}

// Human-readable fee math, e.g. "2 man hours × $100 + 1 trip × $75 = $275 × 10% = $27.50"
export function feeMathString(row) {
  if (row.fee_type === 'profit_split') {
    const sale = Number(row.sale_price) || 0;
    const cost = Number(row.cost) || 0;
    const profit = sale - cost;
    const split = row.split_pct != null ? Number(row.split_pct) : 0.5;
    return `$${formatMoney(sale)} − $${formatMoney(cost)} = $${formatMoney(profit)} × ${Math.round(split * 100)}% = $${formatMoney(row.fee_amt)}`;
  }
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
  return r.billable && !r._suppressed && (!r.needs_review || r.manually_adjusted) && !isFutureRow(r);
}

export function isBillableFuture(r) {
  return r.billable && !r._suppressed && (!r.needs_review || r.manually_adjusted) && isFutureRow(r);
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

// Double-count guard: labor_pct rows on a job that also has a profit_split
// row are suppressed — their labor is already paid inside the profit split.
// Returns a Set of suppressed row IDs.
export function suppressedLaborRows(rows) {
  const byJob = new Map();
  for (const r of rows) {
    const key = r.job_id || `__unmatched__${r.job_name_norm}`;
    if (!byJob.has(key)) byJob.set(key, []);
    byJob.get(key).push(r);
  }
  const suppressed = new Set();
  for (const jobRows of byJob.values()) {
    if (jobRows.some(r => r.fee_type === 'profit_split')) {
      for (const r of jobRows) {
        if (r.fee_type !== 'profit_split') suppressed.add(r.id);
      }
    }
  }
  return suppressed;
}

// Per-type subtotals for billable rows.
export function invoiceTotalByType(rows) {
  const billable = rows.filter(isBillableNow);
  const laborPct = billable
    .filter(r => r.fee_type !== 'profit_split')
    .reduce((sum, r) => sum + (Number(r.fee_amt) || 0), 0);
  const profitSplit = billable
    .filter(r => r.fee_type === 'profit_split')
    .reduce((sum, r) => sum + (Number(r.fee_amt) || 0), 0);
  return { laborPct, profitSplit, total: laborPct + profitSplit };
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

// Payment tracking — the chain is: BFS bills → YA gets paid → I invoice YA.
// invoiced_to_ya requires paid_to_ya (enforced in UI and on save).
export function paymentStats(rows) {
  const billable = rows.filter(isBillableNow);
  const invoiced = billable.filter(r => r.invoiced_to_ya);
  const awaiting = billable.filter(r => r.paid_to_ya && !r.invoiced_to_ya);
  const notBilled = billable.filter(r => !r.billed_to_bfs);
  const sum = (arr) => arr.reduce((s, r) => s + (Number(r.fee_amt) || 0), 0);
  return {
    invoicedToYA: { total: sum(invoiced), count: invoiced.length },
    awaitingPayment: { total: sum(awaiting), count: awaiting.length },
    notBilled: { total: sum(notBilled), count: notBilled.length },
  };
}

export function filterRows(rows, filter) {
  if (!filter || filter === 'all') return rows;
  if (filter === 'unpaid') return rows.filter(r => isBillableNow(r) && !r.paid_to_ya);
  if (filter === 'uninvoiced') return rows.filter(r => isBillableNow(r) && !r.invoiced_to_ya);
  return rows;
}

export function currentMonthStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(monthStr) {
  const [y, m] = monthStr.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}