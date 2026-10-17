import test from "node:test";
import assert from "node:assert/strict";
import {
  OVERDUE_DAYS, addDays, daysBetween, resolveDashboardRange, inDashboardRange,
  billingClockDate, dashboardBuckets, revenueSplit, dashboardMonthGroups, dashboardData,
  lineDashboardStatus, revenueSplitDetailed, manuallyAdjustedCount,
} from "../../src/lib/invoiceDashboard.js";

const TODAY = "2026-10-16";
const noMap = new Map();
const noSup = new Set();

const draft = (over = {}) => ({ id: "d1", job_date: "2020-10-05", invoice_month: "2020-10", billable: true, billed_to_bfs: false, labor_amt: 200, fee_pct: 0.1, fee_amt: 20, source: "app", manually_adjusted: true, ...over });
const billed = (over = {}) => ({ id: "b1", job_date: "2020-10-06", invoice_month: "2020-10", billable: true, billed_to_bfs: true, labor_amt: 300, fee_pct: 0.1, fee_amt: 30, source: "app", manually_adjusted: true, ...over });

test("range presets resolve inclusive bounds", () => {
  assert.deepEqual(resolveDashboardRange("this_month", TODAY), { start: "2026-10-01", end: "2026-10-31", label: "October 2026" });
  assert.deepEqual(resolveDashboardRange("last_month", TODAY), { start: "2026-09-01", end: "2026-09-30", label: "September 2026" });
  assert.deepEqual(resolveDashboardRange("last_30", TODAY), { start: "2026-09-17", end: "2026-10-16", label: "Last 30 days" });
  assert.deepEqual(resolveDashboardRange("this_year", TODAY), { start: "2026-01-01", end: "2026-12-31", label: "2026" });
  assert.deepEqual(resolveDashboardRange("all", TODAY), { start: null, end: null, label: "All time" });
  assert.deepEqual(resolveDashboardRange("custom", TODAY, "2026-10-03", "2026-10-09"), { start: "2026-10-03", end: "2026-10-09", label: "2026-10-03 – 2026-10-09" });
});

test("range checks are inclusive and require a job date", () => {
  const range = { start: "2026-10-01", end: "2026-10-31" };
  assert.equal(inDashboardRange({ job_date: "2026-10-01" }, range), true);
  assert.equal(inDashboardRange({ job_date: "2026-10-31" }, range), true);
  assert.equal(inDashboardRange({ job_date: "2026-09-30" }, range), false);
  assert.equal(inDashboardRange({ job_date: "2026-11-01" }, range), false);
  assert.equal(inDashboardRange({ job_date: "" }, range), false);
  assert.equal(inDashboardRange({}, range), false);
  assert.equal(inDashboardRange({ job_date: "1999-01-01" }, { start: null, end: null }), true);
});

test("day math crosses month and year boundaries", () => {
  assert.equal(addDays("2026-10-01", -1), "2026-09-30");
  assert.equal(addDays("2026-01-01", -1), "2025-12-31");
  assert.equal(daysBetween("2026-10-13", "2026-10-16"), 3);
});

test("overdue clock prefers the last write, falls back to job date", () => {
  assert.equal(billingClockDate({ updated_date: "2026-10-15T04:22:10.873Z", job_date: "2020-01-01" }), "2026-10-15");
  assert.equal(billingClockDate({ job_date: "2020-01-01" }), "2020-01-01");
  assert.equal(billingClockDate({}), null);
});

test("buckets follow the approved mapping with a 3-day overdue clock", () => {
  const rows = [
    draft({ id: "draft1", fee_amt: 20, labor_amt: 200 }),
    billed({ id: "recent", fee_amt: 30, labor_amt: 300, updated_date: "2026-10-15T00:00:00Z" }),
    billed({ id: "edge", fee_amt: 40, labor_amt: 400, updated_date: "2026-10-13T00:00:00Z" }),
    billed({ id: "old", fee_amt: 50, labor_amt: 500, updated_date: "2026-10-12T00:00:00Z" }),
    billed({ id: "paid1", fee_amt: 60, labor_amt: 600, paid_date: "2026-10-10" }),
    draft({ id: "queued", customer_collection_state: "awaiting_request", fee_amt: 70 }),
    draft({ id: "collected", customer_collection_state: "paid", fee_amt: 80 }),
  ];
  const b = dashboardBuckets(rows, noMap, noSup, TODAY);
  assert.deepEqual(b.drafts, { total: 20, count: 1 });
  assert.deepEqual(b.outstanding, { total: 120, count: 3 });
  assert.deepEqual(b.overdue, { total: 50, count: 1 }); // edge row at exactly 3 days is not overdue yet
  assert.deepEqual(b.paid, { total: 140, count: 2 });
  assert.equal(OVERDUE_DAYS, 3);
});

test("superseded and folded rows never reach the cards", () => {
  const rows = [billed({ id: "x", fee_amt: 30 }), billed({ id: "y", fee_amt: 40 }), draft({ id: "z", fee_amt: 10, _companion_folded: true })];
  const b = dashboardBuckets(rows, noMap, new Set(["x"]), TODAY);
  assert.deepEqual(b.outstanding, { total: 40, count: 1 });
  assert.deepEqual(b.drafts, { total: 0, count: 0 });
});

test("revenue split groups by channel from each row's own fee math", () => {
  const rows = [
    draft({ id: "l1", fee_amt: 25, fee_pct: 0.1, labor_amt: 250 }),
    draft({ id: "l2", fee_amt: 35, fee_pct: 0.1, labor_amt: 350 }),
    { id: "s1", job_date: "2020-10-07", billable: true, fee_type: "profit_split", sale_price: 1000, cost: 400, split_pct: 0.5, source: "app", manually_adjusted: true },
  ];
  const s = revenueSplit(rows, noSup);
  assert.equal(s.channels.length, 2);
  const bfs = s.channels.find((c) => c.key === "bfs");
  const ya = s.channels.find((c) => c.key === "ya");
  assert.equal(bfs.terms, "10% of labor");
  assert.equal(bfs.feeTotal, 60);
  assert.equal(ya.terms, "50% profit split");
  assert.equal(ya.feeTotal, 300);
  assert.equal(s.total, 360);
});

test("revenue split reports mixed rates instead of picking one", () => {
  const rows = [
    draft({ id: "m1", fee_pct: 0.1, fee_amt: 10, labor_amt: 100 }),
    draft({ id: "m2", fee_pct: 0.12, fee_amt: 12, labor_amt: 100 }),
  ];
  const s = revenueSplit(rows, noSup);
  assert.equal(s.channels[0].terms, "mixed labor rates");
});

test("month groups sort newest first and keep a no-date bucket", () => {
  const rows = [
    draft({ id: "a", job_date: "2026-10-02" }),
    draft({ id: "b", job_date: "2026-09-14" }),
    draft({ id: "c", job_date: "2026-10-11" }),
    draft({ id: "d", job_date: "" }),
  ];
  const g = dashboardMonthGroups(rows);
  assert.deepEqual(g.map((x) => x.month), ["2026-10", "2026-09", "unknown"]);
  assert.deepEqual(g[0].rows.map((r) => r.id), ["c", "a"]);
  assert.equal(g[0].label, "October 2026");
  assert.equal(g[2].label, "No date");
});

test("dashboardData scopes everything to the range", () => {
  const rows = [
    draft({ id: "in", job_date: "2026-10-05", fee_amt: 20, labor_amt: 200 }),
    draft({ id: "out", job_date: "2026-09-05", fee_amt: 99, labor_amt: 990 }),
  ];
  const d = dashboardData(rows, { range: resolveDashboardRange("this_month", TODAY), reportStatusMap: noMap, supersededSet: noSup, today: TODAY });
  assert.deepEqual(d.buckets.drafts, { total: 20, count: 1 });
  assert.equal(d.split.total, 20);
});

test("line status: paid, overdue, outstanding, draft, then operational states", () => {
  assert.equal(lineDashboardStatus(billed({ paid_date: "2026-10-10" }), noMap, noSup, TODAY), "paid");
  assert.equal(lineDashboardStatus(billed({ updated_date: "2026-10-10T00:00:00Z" }), noMap, noSup, TODAY), "overdue");
  assert.equal(lineDashboardStatus(billed({ updated_date: "2026-10-15T00:00:00Z" }), noMap, noSup, TODAY), "outstanding");
  assert.equal(lineDashboardStatus(draft(), noMap, noSup, TODAY), "draft");
  assert.equal(lineDashboardStatus(draft({ billable: false, needs_review: true }), noMap, noSup, TODAY), "review");
});

test("detailed split shows both sides with ratio terms, drafts excludable", () => {
  const rows = [
    draft({ id: "d", labor_amt: 200, fee_pct: 0.1, fee_amt: 20 }),           // draft, included by default
    billed({ id: "b", labor_amt: 300, fee_pct: 0.1, fee_amt: 30 }),
    { id: "y1", job_date: "2020-10-07", invoice_month: "2020-10", billable: true, billed_to_bfs: true, fee_type: "profit_split", split_pct: 0.5, split_candidate_amt: 100, labor_amt: 0, fee_amt: 50, source: "app", manually_adjusted: true },
  ];
  const all = revenueSplitDetailed(rows, noSup, { reportStatusMap: noMap, today: TODAY });
  const bfs = all.channels.find((c) => c.key === "bfs");
  const ya = all.channels.find((c) => c.key === "ya");
  assert.equal(bfs.terms, "10 / 90");
  assert.equal(bfs.gfFee, 50);
  assert.equal(bfs.other, 450);
  assert.equal(ya.terms, "50 / 50");
  assert.equal(ya.gfFee, 50);
  assert.equal(ya.other, 50);
  assert.equal(all.total, 100);
  const noDrafts = revenueSplitDetailed(rows, noSup, { includeDrafts: false, reportStatusMap: noMap, today: TODAY });
  assert.equal(noDrafts.channels.find((c) => c.key === "bfs").gfFee, 30);
  assert.equal(noDrafts.channels.find((c) => c.key === "ya").gfFee, 50);
});

test("manually adjusted count skips superseded and collection-parked rows", () => {
  const rows = [
    draft({ id: "m1" }),
    draft({ id: "m2", manually_adjusted: false }),
    draft({ id: "m3", customer_collection_state: "awaiting_request" }),
  ];
  assert.equal(manuallyAdjustedCount(rows, noSup), 1);
  assert.equal(manuallyAdjustedCount(rows, new Set(["m1"])), 0);
});
