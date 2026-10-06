// Mocked (in-memory) tests for the shared combine/undo pipeline. No live data.
import test from "node:test";
import assert from "node:assert/strict";
import {
  mergeSourceIntoTarget, reverseMergeLog, mergeJobFields,
  LINK_ENTITIES, UNSUPPORTED_LINK_ENTITIES,
} from "../base44/shared/jobMerge.js";
import { mergeLogState, movedSummary } from "../src/lib/mergeLogs.js";
import { ticketsByEvent, visitTickets, ticketLabel, attachmentProvenance } from "../src/lib/jobHistory.js";

const NAMES = ["Jobs", "JobMergeLog", ...LINK_ENTITIES.map((e) => e.entity), ...UNSUPPORTED_LINK_ENTITIES];

function makeDb(seed = {}, hooks = {}) {
  const tables = Object.fromEntries(NAMES.map((n) => [n, new Map()]));
  let seq = 0;
  for (const [name, rows] of Object.entries(seed)) for (const r of rows) tables[name].set(r.id, { ...r });
  const match = (rec, q) => Object.entries(q).every(([k, v]) =>
    v && typeof v === "object" && "$in" in v ? v.$in.map(String).includes(String(rec[k])) : rec[k] === v);
  const api = (name) => ({
    async get(id) { const r = tables[name].get(id); return r ? { ...r } : null; },
    async filter(q, opts = {}) {
      await hooks.filter?.(name, q, ctx);
      const rows = [...tables[name].values()].filter((r) => match(r, q));
      const limit = opts.limit || 500;
      return { items: rows.slice(0, limit).map((r) => ({ id: r.id })), has_more: rows.length > limit, next_cursor: null };
    },
    async updateMany(q, upd) {
      await hooks.updateMany?.(name, q, ctx);
      let n = 0;
      for (const r of tables[name].values()) if (match(r, q)) { Object.assign(r, upd.$set); n++; }
      await hooks.afterUpdateMany?.(name, q, ctx);
      return { updated: n };
    },
    async create(d) {
      await hooks.create?.(name, d, ctx);
      const id = `${name}-${++seq}`;
      tables[name].set(id, { ...d, id });
      return { ...d, id };
    },
    async update(id, patch) {
      await hooks.update?.(name, id, patch, ctx);
      const r = tables[name].get(id);
      if (!r) throw new Error("not found");
      Object.assign(r, patch);
      return { ...r };
    },
  });
  const entities = Object.fromEntries(NAMES.map((n) => [n, api(n)]));
  const ctx = {
    tables,
    add(name, rec) { tables[name].set(rec.id, { ...rec }); },
    onJob(name, jobId) { return [...tables[name].values()].filter((r) => r.job_id === jobId).map((r) => r.id).sort(); },
    log() { return [...tables.JobMergeLog.values()][0]; },
  };
  return { base44: { asServiceRole: { entities } }, ...ctx };
}

const jobs = () => [
  { id: "S", canonical_name: "Pulte - 12 Elm" },
  { id: "T", canonical_name: "Pulte Homes - 12 Elm St", po_numbers: ["P1"] },
];
const merge = (db, extra = {}) => mergeSourceIntoTarget(db.base44, { sourceId: "S", targetId: "T", actor: "admin@x", now: "2026-10-06T12:00:00Z", today: "2026-10-06", ...extra });

test("empty stub merge completes, hides the source and logs zero moves", async () => {
  const db = makeDb({ Jobs: jobs() });
  const r = await merge(db);
  assert.equal(r.ok, true);
  assert.equal(r.hidden, true);
  assert.equal(db.tables.Jobs.get("S").merged_into, "T");
  assert.equal(db.log().status, "complete");
  assert.equal(db.log().audit_version, 1);
  assert.deepEqual(Object.values(r.relocated_link_counts).reduce((a, b) => a + b, 0), 0);
});

test("moves exact source ids and never touches the survivor's own records", async () => {
  const db = makeDb({
    Jobs: jobs(),
    FeeLines: [{ id: "f1", job_id: "S" }, { id: "fT", job_id: "T" }],
    CalendarEvents: [{ id: "e1", job_id: "S" }, { id: "e2", job_id: "S" }, { id: "eT", job_id: "T" }],
  });
  const r = await merge(db);
  assert.equal(r.ok, true);
  assert.deepEqual(r.relocated_link_ids.fee_lines, ["f1"]);
  assert.deepEqual(r.relocated_link_ids.calendar_events.sort(), ["e1", "e2"]);
  assert.deepEqual(db.log().relocated_link_ids.calendar_events.sort(), ["e1", "e2"]);
  assert.ok(!db.log().relocated_link_ids.fee_lines.includes("fT"));
  assert.deepEqual(db.onJob("FeeLines", "T"), ["f1", "fT"]);
});

test("race: a record linked to the source mid-combine is logged, moved, then the source is hidden", async () => {
  let injected = false;
  const db = makeDb({ Jobs: jobs(), CalendarEvents: [{ id: "e1", job_id: "S" }] }, {
    afterUpdateMany(name, q, ctx) { if (!injected && name === "CalendarEvents") { injected = true; ctx.add("FeeLines", { id: "late", job_id: "S" }); } },
  });
  const r = await merge(db);
  assert.equal(r.ok, true);
  assert.equal(r.hidden, true);
  assert.deepEqual(r.reconciled_link_ids.fee_lines, ["late"]);
  assert.ok(db.log().planned_link_ids.fee_lines.includes("late"));
  assert.ok(db.log().relocated_link_ids.fee_lines.includes("late"));
  assert.deepEqual(db.onJob("FeeLines", "S"), []);
});

test("race: records that keep appearing leave the source visible with an honest partial result", async () => {
  let n = 0;
  const db = makeDb({ Jobs: jobs(), JobNotes: [{ id: "n0", job_id: "S" }] }, {
    afterUpdateMany(name, q, ctx) { if (name === "JobNotes" && q.job_id === "S") ctx.add("JobNotes", { id: `n${++n}`, job_id: "S" }); },
  });
  const r = await merge(db);
  assert.equal(r.ok, false);
  assert.equal(r.hidden, false);
  assert.equal(r.partial, true);
  assert.equal(db.tables.Jobs.get("S").merged_into, undefined);
  assert.equal(db.log().status, "partial");
  assert.match(r.error, /left visible/);
});

test("unsupported links block the source before anything moves", async () => {
  const db = makeDb({ Jobs: jobs(), ServiceItems: [{ id: "s1", job_id: "S" }], FeeLines: [{ id: "f1", job_id: "S" }] });
  const r = await merge(db);
  assert.equal(r.ok, false);
  assert.equal(r.blocked, true);
  assert.deepEqual(r.unsupported_links.ServiceItems.ids, ["s1"]);
  assert.equal(db.tables.JobMergeLog.size, 0);
  assert.deepEqual(db.onJob("FeeLines", "S"), ["f1"]);
  assert.equal(db.tables.Jobs.get("S").merged_into, undefined);
});

test("an unsupported record added mid-combine keeps the source visible and is recorded", async () => {
  let added = false;
  const db = makeDb({ Jobs: jobs(), FeeLines: [{ id: "f1", job_id: "S" }] }, {
    afterUpdateMany(name, q, ctx) { if (!added) { added = true; ctx.add("TodoTask", { id: "t1", job_id: "S" }); } },
  });
  const r = await merge(db);
  assert.equal(r.ok, false);
  assert.equal(r.hidden, false);
  assert.equal(db.tables.Jobs.get("S").merged_into, undefined);
  assert.deepEqual(db.log().unsupported_links.TodoTask.ids, ["t1"]);
  assert.deepEqual(db.log().relocated_link_ids.fee_lines, ["f1"]);
});

test("audit log create failure aborts with zero moves", async () => {
  const db = makeDb({ Jobs: jobs(), FeeLines: [{ id: "f1", job_id: "S" }] }, {
    create(name) { if (name === "JobMergeLog") throw new Error("db down"); },
  });
  const r = await merge(db);
  assert.equal(r.ok, false);
  assert.match(r.error, /zero moves/);
  assert.deepEqual(db.onJob("FeeLines", "S"), ["f1"]);
});

test("audit log update failure after moving halts the source without claiming success", async () => {
  const db = makeDb({ Jobs: jobs(), FeeLines: [{ id: "f1", job_id: "S" }] }, {
    update(name, id, patch) { if (name === "JobMergeLog" && patch.relocated_link_ids) throw new Error("write refused"); },
  });
  const r = await merge(db);
  assert.equal(r.ok, false);
  assert.equal(r.hidden, false);
  assert.deepEqual(r.relocated_link_ids.fee_lines, ["f1"]);
  assert.match(r.error, /could not update the audit log/);
  assert.equal(db.tables.Jobs.get("S").merged_into, undefined);
});

test("final audit failure after hiding is reported as not ok", async () => {
  const db = makeDb({ Jobs: jobs() }, {
    update(name, id, patch) { if (name === "JobMergeLog" && patch.status === "complete") throw new Error("nope"); },
  });
  const r = await merge(db);
  assert.equal(r.ok, false);
  assert.equal(r.hidden, true);
  assert.match(r.error, /could not be marked complete/);
});

test("a failed move batch leaves the source visible as a partial merge", async () => {
  const db = makeDb({ Jobs: jobs(), FeeLines: [{ id: "f1", job_id: "S" }], FieldReports: [{ id: "r1", job_id: "S" }] }, {
    updateMany(name) { if (name === "FieldReports") throw new Error("timeout"); },
  });
  const r = await merge(db);
  assert.equal(r.ok, false);
  assert.equal(r.partial, true);
  assert.equal(db.tables.Jobs.get("S").merged_into, undefined);
  assert.deepEqual(r.relocated_link_ids.fee_lines, ["f1"]);
  assert.deepEqual(r.relocated_link_ids.field_reports, []);
  assert.equal(db.log().status, "partial");
});

test("undo of a complete merge moves back exactly the logged ids and preserves the survivor", async () => {
  const db = makeDb({ Jobs: jobs(), FeeLines: [{ id: "f1", job_id: "S" }, { id: "fT", job_id: "T" }], CalendarEvents: [{ id: "e1", job_id: "S" }] });
  await merge(db);
  const u = await reverseMergeLog(db.base44, db.log(), { actor: "admin@x" });
  assert.equal(u.ok, true);
  assert.deepEqual(db.onJob("FeeLines", "S"), ["f1"]);
  assert.deepEqual(db.onJob("FeeLines", "T"), ["fT"]);
  assert.deepEqual(db.onJob("CalendarEvents", "S"), ["e1"]);
  assert.equal(db.tables.Jobs.get("S").merged_into, null);
  assert.equal(db.log().reversed, true);
  // The conflict-free merge wrote no note; survivor PO numbers stay.
  assert.deepEqual(db.tables.Jobs.get("T").po_numbers, ["P1"]);
});

test("undo works for a partial (visible) merge log", async () => {
  const db = makeDb({ Jobs: jobs(), FeeLines: [{ id: "f1", job_id: "S" }], FieldReports: [{ id: "r1", job_id: "S" }] }, {
    updateMany(name, q) { if (name === "FieldReports" && q.job_id === "S") throw new Error("timeout"); },
  });
  await merge(db);
  const u = await reverseMergeLog(db.base44, db.log(), { actor: "admin@x" });
  assert.equal(u.ok, true);
  assert.deepEqual(db.onJob("FeeLines", "S"), ["f1"]);
  assert.deepEqual(db.onJob("FieldReports", "S"), ["r1"]);
});

test("undo refuses legacy logs without exact-ID auditing", async () => {
  const db = makeDb({ Jobs: jobs() });
  const u = await reverseMergeLog(db.base44, { id: "L", source_job_id: "S", target_job_id: "T" }, {});
  assert.equal(u.ok, false);
  assert.equal(u.status, 409);
  assert.equal(u.legacy, true);
});

test("a failed undo is resumable: log stays unreversed, rerun finishes", async () => {
  let fail = true;
  const db = makeDb({ Jobs: jobs(), FeeLines: [{ id: "f1", job_id: "S" }] }, {
    updateMany(name, q) { if (fail && q.job_id === "T") throw new Error("flaky"); },
  });
  await merge(db);
  const first = await reverseMergeLog(db.base44, db.log(), { actor: "a" });
  assert.equal(first.ok, false);
  assert.equal(first.resumable, true);
  assert.notEqual(db.log().reversed, true);
  assert.equal(db.log().reverse_status, "partial");
  assert.equal(db.tables.Jobs.get("S").merged_into, null, "source is visible again even though undo did not finish");
  fail = false;
  const second = await reverseMergeLog(db.base44, db.log(), { actor: "a" });
  assert.equal(second.ok, true);
  assert.deepEqual(db.onJob("FeeLines", "S"), ["f1"]);
  assert.equal(db.log().reversed, true);
});

test("undo refuses when the source is now combined into a different job", async () => {
  const db = makeDb({ Jobs: [{ id: "S", merged_into: "X" }, { id: "T" }] });
  const u = await reverseMergeLog(db.base44, { id: "L", audit_version: 1, source_job_id: "S", target_job_id: "T" }, {});
  assert.equal(u.ok, false);
  assert.equal(u.status, 409);
});

test("a different source Drive folder is kept as a visible link, not adopted", () => {
  const { patch, conflict_note } = mergeJobFields(
    { id: "S", canonical_name: "A", drive_job_folder_id: "src123" },
    { id: "T", drive_job_folder_id: "tgt999", drive_job_folder_url: "https://drive.google.com/drive/folders/tgt999" },
  );
  assert.equal(patch.drive_job_folder_id, undefined);
  assert.equal(patch.drive_job_folder_url, undefined);
  assert.match(conflict_note, /files were NOT moved/);
  assert.match(conflict_note, /https:\/\/drive\.google\.com\/drive\/folders\/src123/);
});

test("a source Drive folder fills a survivor that has none", () => {
  const { patch, conflict_note } = mergeJobFields({ id: "S", drive_job_folder_id: "a", drive_job_folder_url: "u" }, { id: "T" });
  assert.equal(patch.drive_job_folder_id, "a");
  assert.equal(patch.drive_job_folder_url, "u");
  assert.equal(conflict_note, "");
});

test("merge log state: undo offered for audited complete/partial/unfinished logs only", () => {
  assert.equal(mergeLogState({ audit_version: 1, status: "complete" }).canUndo, true);
  const partial = mergeLogState({ audit_version: 1, status: "partial", relocated_link_ids: { fee_lines: ["f1"] } });
  assert.equal(partial.canUndo, true);
  assert.equal(partial.label, "Partly combined");
  assert.equal(mergeLogState({ audit_version: 1, status: "failed" }).label, "Combine stopped");
  assert.equal(mergeLogState({ audit_version: 1, status: "complete", reverse_status: "partial" }).undoLabel, "Retry undo");
  assert.equal(mergeLogState({ status: "complete" }).canUndo, false);
  assert.equal(mergeLogState({ audit_version: 1, reversed: true }).canUndo, false);
  assert.equal(movedSummary({ relocated_link_ids: { calendar_events: ["a", "b"], fee_lines: ["f"] } }), "2 visits, 1 invoice line");
});

test("lost response: updateMany throws but the id stays in planned and undo recovers it", async () => {
  const db = makeDb({ Jobs: jobs(), FeeLines: [{ id: "f1", job_id: "S" }] }, {
    updateMany(name) { if (name === "FeeLines") throw new Error("connection lost"); },
  });
  const r = await merge(db);
  assert.equal(r.ok, false);
  assert.equal(r.hidden, false);
  // The attempted id is durable in planned_link_ids even though the move outcome was unknown.
  assert.ok(db.log().planned_link_ids.fee_lines.includes("f1"));
  // Undo still recovers it (job_id guard makes a never-moved id a no-op; a really-moved id moves back).
  const u = await reverseMergeLog(db.base44, db.log(), { actor: "admin@x" });
  assert.equal(u.ok, true);
  assert.deepEqual(db.onJob("FeeLines", "S"), ["f1"]);
});

test("verification failure: verify filter throws over-records the batch so undo covers it", async () => {
  const db = makeDb({ Jobs: jobs(), FeeLines: [{ id: "f1", job_id: "S" }] }, {
    filter(name, q) { if (name === "FeeLines" && q.job_id === "T" && q.id) throw new Error("verify down"); },
  });
  const r = await merge(db);
  assert.equal(r.ok, false);
  // Over-recorded as moved (conservative) so undo attempts it.
  assert.deepEqual(r.relocated_link_ids.fee_lines, ["f1"]);
  assert.ok(db.log().planned_link_ids.fee_lines.includes("f1"));
  const u = await reverseMergeLog(db.base44, db.log(), { actor: "admin@x" });
  assert.equal(u.ok, true);
});

test("post-move audit-failure undo recovery: log update throws, noLog halt, undo still recovers via planned", async () => {
  const db = makeDb({ Jobs: jobs(), FeeLines: [{ id: "f1", job_id: "S" }] }, {
    update(name, id, patch) { if (name === "JobMergeLog" && patch.relocated_link_ids) throw new Error("write refused"); },
  });
  const r = await merge(db);
  assert.equal(r.ok, false);
  assert.match(r.error, /could not update the audit log/);
  assert.equal(db.tables.Jobs.get("S").merged_into, undefined);
  // The log exists with planned_link_ids from the create-before-move step.
  assert.ok(db.log().planned_link_ids.fee_lines.includes("f1"));
  // Undo reads planned_link_ids (union of relocated + planned + reconciled) and recovers.
  const u = await reverseMergeLog(db.base44, db.log(), { actor: "admin@x" });
  assert.equal(u.ok, true);
  assert.deepEqual(db.onJob("FeeLines", "S"), ["f1"]);
});

test("failed unknown relocation cannot disappear from planned/reconciled ids", async () => {
  const db = makeDb({ Jobs: jobs(), FeeLines: [{ id: "f1", job_id: "S" }], FieldReports: [{ id: "r1", job_id: "S" }] }, {
    updateMany(name) { if (name === "FieldReports") throw new Error("timeout"); },
  });
  const r = await merge(db);
  assert.equal(r.ok, false);
  // r1's move failed/unknown, but it remains in planned_link_ids on the log.
  assert.ok(db.log().planned_link_ids.field_reports.includes("r1"));
  // f1 moved cleanly and is in relocated_link_ids.
  assert.deepEqual(r.relocated_link_ids.fee_lines, ["f1"]);
  // Undo unions planned + relocated, so r1 is attempted (no-op if never moved) and f1 returns.
  const u = await reverseMergeLog(db.base44, db.log(), { actor: "admin@x" });
  assert.equal(u.ok, true);
  assert.deepEqual(db.onJob("FeeLines", "S"), ["f1"]);
  assert.deepEqual(db.onJob("FieldReports", "S"), ["r1"]);
});

test("history: invoice-line tickets per visit and attachment provenance", () => {
  const t = ticketsByEvent([
    { calendar_event_id: "g1", ticket_sequence: 2 }, { calendar_event_id: "g1", ticket_sequence: 1 },
    { calendar_event_id: "g1", ticket_sequence: 2 }, { calendar_event_id: "g2", ticket_sequence: null }, { ticket_sequence: 3 },
  ]);
  assert.deepEqual(visitTickets(t, { id: "x", google_event_id: "g1" }), [1, 2]);
  assert.deepEqual(visitTickets(t, { id: "g2" }), []);
  assert.equal(ticketLabel(2), "Ticket 2 · rework");
  assert.equal(ticketLabel(1), "Ticket 1");
  assert.equal(attachmentProvenance({ hub_file_uri: "u" }), "Calendar attachment · Hub copy");
  assert.equal(attachmentProvenance({ drive_url: "d" }), "Calendar attachment · Google Drive");
  assert.equal(attachmentProvenance({ file_url: "f" }), "Calendar attachment · Calendar link");
});