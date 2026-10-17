// Test-app-style invoicing dashboard, computed entirely from existing FeeLines rows.
// No new entities, no migration, no writes: the same billing lines the month views
// use, bucketed over a date range. Money semantics approved by Gabriel 2026-10-16:
//   Drafts      = ready to bill, not yet billed, not already paid (existing isReady truth)
//   Outstanding = billed to BFS, no payment-received date
//   Overdue     = outstanding for more than OVERDUE_DAYS days (clock below)
//   Paid        = payment received (BFS paid_date, or customer collection marked paid)
// The overdue clock starts at the line's billing date. FeeLines does not store a
// billed-at timestamp, so the clock uses the row's last update (updated_date) as the
// billing-date proxy: an edit after billing only moves the clock forward, so a line
// can surface overdue LATE but never early.
import { computeFeeAmt, monthLabel, shiftMonthStr } from "./feeMath.js";
import { isReady, isMatchBlocked, isReportBlocked } from "./invoicingFilters.js";

export const OVERDUE_DAYS = 3;

export const DASHBOARD_PRESETS = [
  { key: "this_month", label: "This month" },
  { key: "last_month", label: "Last month" },
  { key: "last_30", label: "Last 30 days" },
  { key: "this_year", label: "This year" },
  { key: "all", label: "All" },
];

export function addDays(dateStr, delta) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d) + delta * 86400000).toISOString().slice(0, 10);
}

export function daysBetween(fromStr, toStr) {
  const parse = (s) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d); };
  return Math.round((parse(toStr) - parse(fromStr)) / 86400000);
}

export function resolveDashboardRange(preset, today, customStart = "", customEnd = "") {
  const month = today.slice(0, 7);
  const year = today.slice(0, 4);
  if (preset === "last_month") {
    const prev = shiftMonthStr(month, -1);
    return { start: prev + "-01", end: addDays(month + "-01", -1), label: monthLabel(prev) };
  }
  if (preset === "last_30") return { start: addDays(today, -29), end: today, label: "Last 30 days" };
  if (preset === "this_year") return { start: year + "-01-01", end: year + "-12-31", label: year };
  if (preset === "all") return { start: null, end: null, label: "All time" };
  if (preset === "custom") {
    return {
      start: customStart || null,
      end: customEnd || null,
      label: customStart || customEnd ? `${customStart || "start"} – ${customEnd || "today"}` : "Custom range",
    };
  }
  return { start: month + "-01", end: addDays(shiftMonthStr(month, 1) + "-01", -1), label: monthLabel(month) };
}

export function inDashboardRange(row, range) {
  const d = row?.job_date;
  if (!d) return false;
  if (range.start && d < range.start) return false;
  if (range.end && d > range.end) return false;
  return true;
}

// Billing-date proxy for the overdue clock. updated_date is when the row was last
// written — for a billed line that is usually the moment it was marked billed; a
// later edit only makes the line look newer, never older.
export function billingClockDate(row) {
  const u = row?.updated_date;
  if (u) return String(u).slice(0, 10);
  return row?.job_date || null;
}

// Rows the dashboard counts: drops superseded/folded twins and lines parked in the
// customer-collections queue (those live in Purchasing until paid).
function dashboardActive(rows, supersededSet) {
  return (Array.isArray(rows) ? rows : []).filter((r) =>
    !(r.customer_collection_state && r.customer_collection_state !== "paid") &&
    !(supersededSet && supersededSet.has(r.id)) &&
    !r._companion_folded
  );
}

export function dashboardBuckets(rows, reportStatusMap, supersededSet, today) {
  const active = dashboardActive(rows, supersededSet);
  const sum = (arr) => Math.round(arr.reduce((n, r) => n + computeFeeAmt(r), 0) * 100) / 100;
  const drafts = active.filter((r) => isReady(r, reportStatusMap, supersededSet) && !r.paid_date && r.customer_collection_state !== "paid");
  const outstanding = active.filter((r) => r.billed_to_bfs && !r.paid_date);
  const overdue = outstanding.filter((r) => {
    const clock = billingClockDate(r);
    return clock && daysBetween(clock, today) > OVERDUE_DAYS;
  });
  const paid = active.filter((r) => !!r.paid_date || r.customer_collection_state === "paid");
  const pack = (arr) => ({ total: sum(arr), count: arr.length });
  return { drafts: pack(drafts), outstanding: pack(outstanding), overdue: pack(overdue), paid: pack(paid) };
}

// Glass Forge fee by billing channel, from each row's own fee math — no constants.
export function revenueSplit(rows, supersededSet) {
  const active = dashboardActive(rows, supersededSet);
  const channels = new Map();
  for (const r of active) {
    const isSplit = r.fee_type === "profit_split";
    const key = isSplit ? "ya" : "bfs";
    if (!channels.has(key)) channels.set(key, { key, label: isSplit ? "YA / outside jobs" : "BFS", pcts: new Set(), feeTotal: 0, lineCount: 0 });
    const c = channels.get(key);
    c.pcts.add(isSplit ? (r.split_pct ?? 0.5) : (r.fee_pct ?? 0.1));
    c.feeTotal += computeFeeAmt(r);
    c.lineCount += 1;
  }
  const list = [...channels.values()].map((c) => {
    const pcts = [...c.pcts];
    const terms = c.key === "ya"
      ? (pcts.length === 1 ? `${Math.round(pcts[0] * 100)}% profit split` : "mixed profit splits")
      : (pcts.length === 1 ? `${Math.round(pcts[0] * 100)}% of labor` : "mixed labor rates");
    return { key: c.key, label: c.label, terms, feeTotal: Math.round(c.feeTotal * 100) / 100, lineCount: c.lineCount };
  }).sort((a, b) => b.feeTotal - a.feeTotal);
  return { channels: list, total: Math.round(list.reduce((n, c) => n + c.feeTotal, 0) * 100) / 100 };
}

export function dashboardMonthGroups(rows) {
  const groups = new Map();
  for (const r of Array.isArray(rows) ? rows : []) {
    const m = (r.job_date || "").slice(0, 7) || "unknown";
    if (!groups.has(m)) groups.set(m, []);
    groups.get(m).push(r);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === "unknown" ? 1 : b === "unknown" ? -1 : b.localeCompare(a)))
    .map(([month, rs]) => ({
      month,
      label: month === "unknown" ? "No date" : monthLabel(month),
      rows: rs.sort((a, b) => String(b.job_date).localeCompare(String(a.job_date)) || String(a.id).localeCompare(String(b.id))),
    }));
}

// Display status for one list row. The four card buckets win first; lines that are
// not billable yet keep their existing operational states.
export function lineDashboardStatus(row, reportStatusMap, supersededSet, today) {
  if (row.paid_date || row.customer_collection_state === "paid") return "paid";
  if (row.billed_to_bfs) {
    const clock = billingClockDate(row);
    return clock && daysBetween(clock, today) > OVERDUE_DAYS ? "overdue" : "outstanding";
  }
  if (isReady(row, reportStatusMap, supersededSet)) return "draft";
  if (isReportBlocked(row, reportStatusMap)) return "needs_report";
  if (isMatchBlocked(row)) return "check_billing";
  return "review";
}

// Richer split for the dashboard panel: Glass Forge fee plus the channel's own
// share of the same basis, with split-ratio terms ("10 / 90", "50 / 50").
export function revenueSplitDetailed(rows, supersededSet, { includeDrafts = true, reportStatusMap, today } = {}) {
  let active = dashboardActive(rows, supersededSet);
  if (!includeDrafts) {
    active = active.filter((r) => !(isReady(r, reportStatusMap, supersededSet) && !r.paid_date && !r.billed_to_bfs && r.customer_collection_state !== "paid"));
  }
  const channels = new Map();
  for (const r of active) {
    const isSplit = r.fee_type === "profit_split";
    const key = isSplit ? "ya" : "bfs";
    if (!channels.has(key)) channels.set(key, { key, label: isSplit ? "YA" : "BFS", pcts: new Set(), gfFee: 0, basis: 0, lineCount: 0 });
    const c = channels.get(key);
    c.pcts.add(isSplit ? (r.split_pct ?? 0.5) : (r.fee_pct ?? 0.1));
    const fee = computeFeeAmt(r);
    c.gfFee += fee;
    c.basis += isSplit ? Number(r.split_candidate_amt) || 0 : Number(r.labor_amt) || 0;
    c.lineCount += 1;
  }
  const list = [...channels.values()].map((c) => {
    const pcts = [...c.pcts];
    const gfFee = Math.round(c.gfFee * 100) / 100;
    let other;
    if (c.basis > 0) other = Math.round((c.basis - c.gfFee) * 100) / 100;
    else {
      const p = pcts[0] || 0;
      other = p > 0 && p < 1 ? Math.round(gfFee * (1 - p) / p * 100) / 100 : 0;
    }
    if (other < 0) other = 0;
    const terms = pcts.length === 1
      ? `${Math.round(pcts[0] * 100)} / ${100 - Math.round(pcts[0] * 100)}`
      : "mixed";
    return { key: c.key, label: c.label, terms, gfFee, other, lineCount: c.lineCount, mixed: pcts.length > 1 };
  }).sort((a, b) => (a.key === "ya" ? -1 : 1) - (b.key === "ya" ? -1 : 1));
  return { channels: list, total: Math.round(list.reduce((n, c) => n + c.gfFee, 0) * 100) / 100 };
}

export function manuallyAdjustedCount(rows, supersededSet) {
  return dashboardActive(rows, supersededSet).filter((r) => r.manually_adjusted).length;
}

export function dashboardData(rows, { range, reportStatusMap, supersededSet, today, includeDrafts = true }) {
  const scoped = (Array.isArray(rows) ? rows : []).filter((r) => inDashboardRange(r, range));
  return {
    buckets: dashboardBuckets(scoped, reportStatusMap, supersededSet, today),
    split: revenueSplitDetailed(scoped, supersededSet, { includeDrafts, reportStatusMap, today }),
    manuallyAdjusted: manuallyAdjustedCount(scoped, supersededSet),
  };
}

export { isMatchBlocked };
