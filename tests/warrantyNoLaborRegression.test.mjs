// Regression: a warranty service visit with no labor must stay non-billable
// (never "Ready") and its match must keep pointing at the same Job record after
// a combine. The combine only re-links job_id; it must not clear needs_review,
// flip labor_amt, or weaken the billing hold. No live data.
import './support/register-src-alias.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

const { mergeSourceIntoTarget } = await import('../base44/shared/jobMerge.js');
const { statusTag, jobStatus } = await import('../src/lib/feeUI.js');

const NAMES = ["Jobs", "JobMergeLog", "FeeLines", "FieldReports", "CalendarEvents", "JobNotes", "ContactJobLink", "JobBudgets", "ProbuildProjectLink",
  "ServiceItems", "JobSetupSheets", "JobKnowledge", "JobHandoffs", "JobCostInputs", "PurchaseOrders", "VendorOrders", "TodoTask", "MessageConversation", "EmailRelay", "ProbuildReportDraft", "QuoteRequests", "WindowQuoteOnlineRequests", "FieldLibraryProject"];

function makeDb(seed = {}) {
  const tables = Object.fromEntries(NAMES.map((n) => [n, new Map()]));
  for (const [name, rows] of Object.entries(seed)) for (const r of rows) tables[name].set(r.id, { ...r });
  let seq = 0;
  const match = (rec, q) => Object.entries(q).every(([k, v]) =>
    v && typeof v === "object" && "$in" in v ? v.$in.map(String).includes(String(rec[k])) : rec[k] === v);
  const api = (name) => ({
    async get(id) { const r = tables[name].get(id); return r ? { ...r } : null; },
    async filter(q, o = {}) { const rows = [...tables[name].values()].filter((r) => match(r, q)); const lim = o.limit || 500; return { items: rows.slice(0, lim).map((r) => ({ id: r.id })), has_more: rows.length > lim, next_cursor: null }; },
    async updateMany(q, upd) { let n = 0; for (const r of tables[name].values()) if (match(r, q)) { Object.assign(r, upd.$set); n++; } return { updated: n }; },
    async create(d) { const id = `${name}-${++seq}`; tables[name].set(id, { ...d, id }); return { ...d, id }; },
    async update(id, p) { const r = tables[name].get(id); if (!r) throw new Error("nf"); Object.assign(r, p); return { ...r }; },
  });
  const entities = Object.fromEntries(NAMES.map((n) => [n, api(n)]));
  return { base44: { asServiceRole: { entities } }, tables };
}

// A warranty service visit with no labor and an unreadable quantity is flagged
// needs_review by the ingest; the row is $0 so it reads "No charge", never "Ready".
const warrantyRow = (job_id) => ({
  id: "w1", job_id, job_date: "2026-10-01", job_name_raw: "Pulte - 12 Elm (warranty)",
  job_name_norm: "pulte - 12 elm", line_description: "warranty service", note_text: "warranty visit",
  labor_amt: 0, fee_pct: 0.1, fee_amt: 0, fee_type: "labor_pct", source: "calendar",
  written_by: "calendar", match_confidence: "high", needs_review: true, billable: true,
});

test("warranty-no-labor row is non-billable before combine", () => {
  const row = warrantyRow("S");
  assert.equal(statusTag(row).label, "No charge");
  assert.notEqual(statusTag(row).label, "Ready");
  assert.equal(jobStatus([row]).key, "no_charge");
});

test("combine re-links the warranty row to the survivor but keeps it non-billable", async () => {
  const db = makeDb({
    Jobs: [{ id: "S", canonical_name: "Pulte - 12 Elm" }, { id: "T", canonical_name: "Pulte Homes - 12 Elm St" }],
    FeeLines: [warrantyRow("S")],
  });
  const r = await mergeSourceIntoTarget(db.base44, { sourceId: "S", targetId: "T", actor: "admin@x", now: "2026-10-06T12:00:00Z", today: "2026-10-06" });
  assert.equal(r.ok, true);
  // The row now matches the same (surviving) Job.
  const moved = db.tables.FeeLines.get("w1");
  assert.equal(moved.job_id, "T");
  // Billing behavior is not weakened: labor, fee and the review flag are untouched.
  assert.equal(moved.labor_amt, 0);
  assert.equal(moved.fee_amt, 0);
  assert.equal(moved.needs_review, true);
  assert.equal(statusTag(moved).label, "No charge");
  assert.notEqual(statusTag(moved).label, "Ready");
  assert.equal(jobStatus([moved]).key, "no_charge");
});

test("a ready (priced) row on the same job stays ready after combine — billing not weakened the other way", async () => {
  const db = makeDb({
    Jobs: [{ id: "S", canonical_name: "Pulte - 12 Elm" }, { id: "T", canonical_name: "Pulte Homes - 12 Elm St" }],
    FeeLines: [
      { ...warrantyRow("S"), id: "w1" },
      { id: "p1", job_id: "S", job_date: "2026-10-01", job_name_raw: "Pulte - 12 Elm", job_name_norm: "pulte - 12 elm", labor_amt: 500, fee_pct: 0.1, fee_amt: 50, fee_type: "labor_pct", source: "calendar", written_by: "calendar", match_confidence: "high", billable: true },
    ],
  });
  await mergeSourceIntoTarget(db.base44, { sourceId: "S", targetId: "T", actor: "admin@x", now: "2026-10-06T12:00:00Z", today: "2026-10-06" });
  const w = db.tables.FeeLines.get("w1"), p = db.tables.FeeLines.get("p1");
  assert.equal(w.job_id, "T"); assert.equal(p.job_id, "T");
  assert.equal(statusTag(w).label, "No charge");
  assert.equal(statusTag(p).label, "Ready");
  // Job-level: priced row present, no missing report, no review hold on the priced row → not no_charge.
  assert.notEqual(jobStatus([w, p]).key, "no_charge");
});