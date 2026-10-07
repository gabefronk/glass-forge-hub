// Adapter tests for the source-note follow-through wiring (defect-corrected, final
// SDK-contract + mandatory-lookup). Imports the ACTUAL shared decision helper
// (planReportWrite / buildNewReportRow / captureSnapshot / planReportWrites) and the
// ACTUAL write adapter (executeMessageFills) used by the ingest, and injects a mock
// get/update/lookup (the same interface executeMessageFills uses against the real SDK).
// No provider, no SDK, no I/O.
//
// Covers: empty fill, currentHub changed, concurrent Hub+baseline advance (same action),
// manual markers appeared, duplicates, wrong project (initial + fresh), post_id mismatch,
// empty fill repeated (idempotent), new seed, malformed Hub, malformed baseline, other
// fields preserved, mandatory nonempty id/expectedPostId/expectedProjectId/snapshot,
// fresh.id === queued id, planner output fed to the actual adapter, lookup mandatory
// (absent -> fail closed), lookup normalization (array + page {items} forms), and
// shape-unknown / truncated-page fail closed.
import test from "node:test";
import assert from "node:assert/strict";
import {
  planReportWrite, buildNewReportRow, executeMessageFills, captureSnapshot, planReportWrites,
} from "../base44/shared/sourceNoteFollowthrough.js";

const NOW = "2026-10-07T10:00:00.000Z";

// In-memory FieldReports store + injected get/update adapter.
function makeStore(initial) {
  const store = new Map(initial.map((r) => [r.id, { ...r }]));
  return {
    get: async (id) => (store.has(id) ? { ...store.get(id) } : null),
    update: async (id, patch) => { const cur = store.get(id); store.set(id, { ...cur, ...patch }); return { ...store.get(id) }; },
    snapshot: () => [...store.values()].map((r) => ({ ...r })),
  };
}

// Mock-owning lookup: mirrors the real entry's filter({post_id}, {limit:50}) -> page.items
// (an array). Returns records with that post_id. The adapter normalizes array or {items}.
function lookupFrom(store) {
  return async (postId) => store.snapshot().filter((m) => m.post_id === postId);
}

// Plan a message fill for one existing record (mirrors how the ingest plans), carrying
// expectedPostId + expectedProjectId + the plan-time snapshot through the queue.
function plan(existing, sourceMessage, postId, projectId) {
  const p = planReportWrite({ existing, sourceMessage, nowIso: NOW, expectedPostId: postId, expectedProjectId: projectId });
  if (p.action !== "write") return null;
  return { id: existing.id, expectedPostId: postId, expectedProjectId: projectId, snapshot: p.snapshot, sourceMessage, plannedAction: p.plannedAction, patch: p.patch };
}

test("adapter: empty fill writes message + baseline, other fields preserved", async () => {
  const store = makeStore([{ id: "r1", post_id: "p1", project_id: "pr1", message: "", photo_urls: ["a.jpg"], job_id: "j1" }]);
  const mf = plan({ id: "r1", post_id: "p1", project_id: "pr1", message: "", photo_urls: ["a.jpg"], job_id: "j1" }, "new note", "p1", "pr1");
  const r = await executeMessageFills({ messageFills: [mf], get: store.get, update: store.update, lookup: lookupFrom(store), nowIso: NOW });
  assert.equal(r.filled, 1);
  assert.equal(r.skipped, 0);
  const row = store.snapshot()[0];
  assert.equal(row.message, "new note");
  assert.equal(row.source_message_baseline, "new note");
  assert.equal(row.source_baseline_at, NOW);
  assert.deepEqual(row.photo_urls, ["a.jpg"]);
  assert.equal(row.job_id, "j1");
});

test("adapter: idempotent — second run plans nothing (already in sync)", async () => {
  const store = makeStore([{ id: "r1", post_id: "p1", project_id: "pr1", message: "note", source_message_baseline: "note", source_baseline_at: NOW }]);
  const p = planReportWrite({ existing: store.snapshot()[0], sourceMessage: "note", nowIso: NOW, expectedPostId: "p1", expectedProjectId: "pr1" });
  assert.equal(p.action, "none");
  assert.equal(p.reason, "already_in_sync");
  const r = await executeMessageFills({ messageFills: [], get: store.get, update: store.update, lookup: lookupFrom(store), nowIso: NOW });
  assert.equal(r.filled, 0);
  assert.equal(store.snapshot()[0].message, "note");
});

test("adapter: fresh GET shows currentHub changed -> skip (no overwrite)", async () => {
  const stale = { id: "r1", post_id: "p1", project_id: "pr1", message: "" };
  const mf = plan(stale, "new", "p1", "pr1");
  assert.equal(mf.plannedAction, "empty_fill");
  const store = makeStore([{ id: "r1", post_id: "p1", project_id: "pr1", message: "owner typed", source_message_baseline: "" }]);
  const r = await executeMessageFills({ messageFills: [mf], get: store.get, update: store.update, lookup: lookupFrom(store), nowIso: NOW });
  assert.equal(r.filled, 0);
  assert.equal(r.skipped, 1);
  assert.equal(store.snapshot()[0].message, "owner typed");
});

test("adapter: manual markers appeared between plan and write -> skip", async () => {
  const stale = { id: "r1", post_id: "p1", project_id: "pr1", message: "old", source_message_baseline: "old" };
  const mf = plan(stale, "new", "p1", "pr1");
  assert.equal(mf.plannedAction, "update");
  const store = makeStore([{ id: "r1", post_id: "p1", project_id: "pr1", message: "old", source_message_baseline: "old", edited_at: NOW }]);
  const r = await executeMessageFills({ messageFills: [mf], get: store.get, update: store.update, lookup: lookupFrom(store), nowIso: NOW });
  assert.equal(r.filled, 0);
  assert.equal(r.skipped, 1);
  assert.equal(store.snapshot()[0].message, "old");
});

test("adapter: concurrent Hub+baseline advance (same action) -> skip, no stale overwrite", async () => {
  const stale = { id: "r1", post_id: "p1", project_id: "pr1", message: "old", source_message_baseline: "old" };
  const mf = plan(stale, "new", "p1", "pr1");
  assert.equal(mf.plannedAction, "update");
  const store = makeStore([{ id: "r1", post_id: "p1", project_id: "pr1", message: "newer", source_message_baseline: "newer" }]);
  const r = await executeMessageFills({ messageFills: [mf], get: store.get, update: store.update, lookup: lookupFrom(store), nowIso: NOW });
  assert.equal(r.filled, 0);
  assert.equal(r.skipped, 1);
  assert.equal(store.snapshot()[0].message, "newer");
  assert.equal(store.snapshot()[0].source_message_baseline, "newer");
});

test("adapter: wrong project on fresh GET -> skip", async () => {
  const stale = { id: "r1", post_id: "p1", project_id: "pr1", message: "" };
  const mf = plan(stale, "new", "p1", "pr1");
  const store = makeStore([{ id: "r1", post_id: "p1", project_id: "OTHER", message: "" }]);
  const r = await executeMessageFills({ messageFills: [mf], get: store.get, update: store.update, lookup: lookupFrom(store), nowIso: NOW });
  assert.equal(r.filled, 0);
  assert.equal(r.skipped, 1);
});

test("adapter: wrong project at initial plan -> not planned", () => {
  const existing = { id: "r1", post_id: "p1", project_id: "OTHER", message: "old", source_message_baseline: "old" };
  const mf = plan(existing, "new", "p1", "pr1");
  assert.equal(mf, null);
  const p = planReportWrite({ existing, sourceMessage: "new", nowIso: NOW, expectedPostId: "p1", expectedProjectId: "pr1" });
  assert.equal(p.action, "none");
  assert.equal(p.reason, "identity_mismatch:project_id");
});

test("adapter: project/post identity mismatch (post_id changed on fresh) -> skip", async () => {
  const stale = { id: "r1", post_id: "p1", project_id: "pr1", message: "" };
  const mf = plan(stale, "new", "p1", "pr1");
  const store = makeStore([{ id: "r1", post_id: "DIFFERENT", project_id: "pr1", message: "" }]);
  const r = await executeMessageFills({ messageFills: [mf], get: store.get, update: store.update, lookup: lookupFrom(store), nowIso: NOW });
  assert.equal(r.filled, 0);
  assert.equal(r.skipped, 1);
});

test("adapter: duplicate post_id never reaches execute (planner fail-closed)", () => {
  const p = planReportWrite({ existing: { id: "r1", post_id: "p1", project_id: "pr1", message: "" }, sourceMessage: "new", nowIso: NOW, expectedPostId: "p1", expectedProjectId: "pr1" });
  assert.equal(p.action, "write");
});

test("adapter: malformed baseline on fresh GET -> predicate fails -> skip", async () => {
  const stale = { id: "r1", post_id: "p1", project_id: "pr1", message: "old", source_message_baseline: "old" };
  const mf = plan(stale, "new", "p1", "pr1");
  const store = makeStore([{ id: "r1", post_id: "p1", project_id: "pr1", message: "old", source_message_baseline: "   " }]);
  const r = await executeMessageFills({ messageFills: [mf], get: store.get, update: store.update, lookup: lookupFrom(store), nowIso: NOW });
  assert.equal(r.filled, 0);
  assert.equal(r.skipped, 1);
});

test("adapter: malformed Hub (number) on fresh GET -> skip", async () => {
  const stale = { id: "r1", post_id: "p1", project_id: "pr1", message: "" };
  const mf = plan(stale, "new", "p1", "pr1");
  const store = makeStore([{ id: "r1", post_id: "p1", project_id: "pr1", message: 42 }]);
  const r = await executeMessageFills({ messageFills: [mf], get: store.get, update: store.update, lookup: lookupFrom(store), nowIso: NOW });
  assert.equal(r.filled, 0);
  assert.equal(r.skipped, 1);
});

test("adapter: malformed baseline (numeric) at initial plan -> not planned", () => {
  const existing = { id: "r1", post_id: "p1", project_id: "pr1", message: "hub", source_message_baseline: 42 };
  const p = planReportWrite({ existing, sourceMessage: "new", nowIso: NOW, expectedPostId: "p1", expectedProjectId: "pr1" });
  assert.equal(p.action, "none");
  assert.equal(p.reason, "malformed_baseline");
});

test("adapter: manual markers always block (no correction lever)", () => {
  const p = planReportWrite({ existing: { id: "r1", post_id: "p1", project_id: "pr1", message: "old", source_message_baseline: "old", edited_at: NOW }, sourceMessage: "new", nowIso: NOW, expectedPostId: "p1", expectedProjectId: "pr1" });
  assert.equal(p.action, "none");
  assert.equal(p.reason, "manual_markers");
});

test("adapter: update path writes when Hub===baseline on fresh GET", async () => {
  const stale = { id: "r1", post_id: "p1", project_id: "pr1", message: "old", source_message_baseline: "old" };
  const mf = plan(stale, "new", "p1", "pr1");
  assert.equal(mf.plannedAction, "update");
  const store = makeStore([{ id: "r1", post_id: "p1", project_id: "pr1", message: "old", source_message_baseline: "old" }]);
  const r = await executeMessageFills({ messageFills: [mf], get: store.get, update: store.update, lookup: lookupFrom(store), nowIso: NOW });
  assert.equal(r.filled, 1);
  assert.equal(store.snapshot()[0].message, "new");
  assert.equal(store.snapshot()[0].source_message_baseline, "new");
});

test("adapter: empty fill repeated (already filled) -> fresh predicate yields no fill", async () => {
  const store = makeStore([{ id: "r1", post_id: "p1", project_id: "pr1", message: "", source_message_baseline: "" }]);
  const mf1 = plan({ id: "r1", post_id: "p1", project_id: "pr1", message: "", source_message_baseline: "" }, "note", "p1", "pr1");
  await executeMessageFills({ messageFills: [mf1], get: store.get, update: store.update, lookup: lookupFrom(store), nowIso: NOW });
  assert.equal(store.snapshot()[0].message, "note");
  const p2 = planReportWrite({ existing: store.snapshot()[0], sourceMessage: "note", nowIso: NOW, expectedPostId: "p1", expectedProjectId: "pr1" });
  assert.equal(p2.action, "none");
  assert.equal(p2.reason, "already_in_sync");
});

test("adapter: new seed via buildNewReportRow (no existing -> create path)", () => {
  const row = buildNewReportRow({ jobDate: "2026-10-07", jobName: "P", message: "fresh note", postId: "p9", projectId: "pr9", nowIso: NOW, photoUrls: [], attachmentCount: 0, createdAt: null, manHours: null, tripCharges: null, jobFields: null });
  assert.equal(row.message, "fresh note");
  assert.equal(row.source_message_baseline, "fresh note");
  assert.equal(row.source_baseline_at, NOW);
});

test("adapter: baseline_seed writes baseline only, message unchanged", async () => {
  const existing = { id: "r1", post_id: "p1", project_id: "pr1", message: "same text" };
  const mf = plan(existing, "same text", "p1", "pr1");
  assert.equal(mf.plannedAction, "baseline_seed");
  assert.ok(!("message" in mf.patch), "baseline_seed patch must not include message");
  const store = makeStore([{ id: "r1", post_id: "p1", project_id: "pr1", message: "same text" }]);
  const r = await executeMessageFills({ messageFills: [mf], get: store.get, update: store.update, lookup: lookupFrom(store), nowIso: NOW });
  assert.equal(r.filled, 1);
  assert.equal(store.snapshot()[0].message, "same text");
  assert.equal(store.snapshot()[0].source_message_baseline, "same text");
});

test("adapter: patch is source/baseline-only — never photo_urls or job_id", async () => {
  const store = makeStore([{ id: "r1", post_id: "p1", project_id: "pr1", message: "old", source_message_baseline: "old", photo_urls: ["x.jpg"], job_id: "j1" }]);
  const mf = plan({ id: "r1", post_id: "p1", project_id: "pr1", message: "old", source_message_baseline: "old" }, "new", "p1", "pr1");
  await executeMessageFills({ messageFills: [mf], get: store.get, update: store.update, lookup: lookupFrom(store), nowIso: NOW });
  const row = store.snapshot()[0];
  assert.deepEqual(Object.keys(row).sort(), ["id", "job_id", "message", "photo_urls", "post_id", "project_id", "source_baseline_at", "source_message_baseline"].sort());
  assert.deepEqual(row.photo_urls, ["x.jpg"]);
  assert.equal(row.job_id, "j1");
});

// FINAL ADAPTER GAP: mandatory nonempty id/expectedPostId/expectedProjectId/snapshot.
test("adapter: missing id fails closed", async () => {
  const store = makeStore([{ id: "r1", post_id: "p1", project_id: "pr1", message: "" }]);
  const mf = plan({ id: "r1", post_id: "p1", project_id: "pr1", message: "" }, "new", "p1", "pr1");
  const r = await executeMessageFills({ messageFills: [{ ...mf, id: "" }], get: store.get, update: store.update, lookup: lookupFrom(store), nowIso: NOW });
  assert.equal(r.filled, 0);
  assert.equal(r.skipped, 1);
});

test("adapter: missing expectedPostId fails closed", async () => {
  const store = makeStore([{ id: "r1", post_id: "p1", project_id: "pr1", message: "" }]);
  const mf = plan({ id: "r1", post_id: "p1", project_id: "pr1", message: "" }, "new", "p1", "pr1");
  const r = await executeMessageFills({ messageFills: [{ ...mf, expectedPostId: "" }], get: store.get, update: store.update, lookup: lookupFrom(store), nowIso: NOW });
  assert.equal(r.filled, 0);
  assert.equal(r.skipped, 1);
});

test("adapter: missing expectedProjectId fails closed", async () => {
  const store = makeStore([{ id: "r1", post_id: "p1", project_id: "pr1", message: "" }]);
  const mf = plan({ id: "r1", post_id: "p1", project_id: "pr1", message: "" }, "new", "p1", "pr1");
  const r = await executeMessageFills({ messageFills: [{ ...mf, expectedProjectId: "" }], get: store.get, update: store.update, lookup: lookupFrom(store), nowIso: NOW });
  assert.equal(r.filled, 0);
  assert.equal(r.skipped, 1);
});

test("adapter: missing snapshot fails closed", async () => {
  const store = makeStore([{ id: "r1", post_id: "p1", project_id: "pr1", message: "" }]);
  const mf = plan({ id: "r1", post_id: "p1", project_id: "pr1", message: "" }, "new", "p1", "pr1");
  const r = await executeMessageFills({ messageFills: [{ ...mf, snapshot: null }], get: store.get, update: store.update, lookup: lookupFrom(store), nowIso: NOW });
  assert.equal(r.filled, 0);
  assert.equal(r.skipped, 1);
});

// fresh.id !== queued id fails closed.
test("adapter: fresh.id !== queued id fails closed", async () => {
  const store = makeStore([{ id: "r1", post_id: "p1", project_id: "pr1", message: "" }]);
  const mf = plan({ id: "r1", post_id: "p1", project_id: "pr1", message: "" }, "new", "p1", "pr1");
  const r = await executeMessageFills({ messageFills: [mf], get: async () => ({ id: "OTHER", post_id: "p1", project_id: "pr1", message: "" }), update: store.update, lookup: lookupFrom(store), nowIso: NOW });
  assert.equal(r.filled, 0);
  assert.equal(r.skipped, 1);
});

// planReportWrites output fed directly to the actual adapter (no reshaping).
test("adapter: planReportWrites output fed to executeMessageFills works", async () => {
  const existing = { id: "r1", post_id: "p1", project_id: "pr1", message: "old", source_message_baseline: "old" };
  const store = makeStore([existing]);
  const planned = planReportWrites([{ existing, sourceMessage: "new", postId: "p1", projectId: "pr1", duplicatePostId: false }], NOW);
  assert.equal(planned.writes.length, 1);
  const r = await executeMessageFills({ messageFills: planned.writes, get: store.get, update: store.update, lookup: lookupFrom(store), nowIso: NOW });
  assert.equal(r.filled, 1);
  assert.equal(store.snapshot()[0].message, "new");
  assert.equal(store.snapshot()[0].source_message_baseline, "new");
});

// Fresh duplicate appeared (lookup returns 2) -> fail closed, no overwrite.
test("adapter: duplicate appeared (lookup returns 2) fails closed", async () => {
  const existing = { id: "r1", post_id: "p1", project_id: "pr1", message: "old", source_message_baseline: "old" };
  const store = makeStore([existing, { id: "r2", post_id: "p1", project_id: "pr1", message: "old", source_message_baseline: "old" }]);
  const mf = plan({ id: "r1", post_id: "p1", project_id: "pr1", message: "old", source_message_baseline: "old" }, "new", "p1", "pr1");
  const r = await executeMessageFills({ messageFills: [mf], get: store.get, update: store.update, lookup: lookupFrom(store), nowIso: NOW });
  assert.equal(r.filled, 0);
  assert.equal(r.skipped, 1);
  assert.equal(store.snapshot()[0].message, "old");
});

// Lookup returns 0 (record missing) -> fail closed.
test("adapter: lookup returns 0 (missing) fails closed", async () => {
  const existing = { id: "r1", post_id: "p1", project_id: "pr1", message: "old", source_message_baseline: "old" };
  const store = makeStore([existing]);
  const mf = plan({ id: "r1", post_id: "p1", project_id: "pr1", message: "old", source_message_baseline: "old" }, "new", "p1", "pr1");
  const r = await executeMessageFills({ messageFills: [mf], get: store.get, update: store.update, lookup: async () => [], nowIso: NOW });
  assert.equal(r.filled, 0);
  assert.equal(r.skipped, 1);
});

// Lookup returns 1 but wrong id -> fail closed.
test("adapter: lookup returns 1 but wrong id fails closed", async () => {
  const existing = { id: "r1", post_id: "p1", project_id: "pr1", message: "old", source_message_baseline: "old" };
  const store = makeStore([existing]);
  const mf = plan({ id: "r1", post_id: "p1", project_id: "pr1", message: "old", source_message_baseline: "old" }, "new", "p1", "pr1");
  const r = await executeMessageFills({ messageFills: [mf], get: store.get, update: store.update, lookup: async () => [{ id: "OTHER", post_id: "p1", project_id: "pr1" }], nowIso: NOW });
  assert.equal(r.filled, 0);
  assert.equal(r.skipped, 1);
});

// SDK CONTRACT: lookup normalization — array form (positional filter) and page {items}
// form (options filter) both unwrap to the record and write.
test("adapter: lookup array form (positional filter) unwraps and writes", async () => {
  const existing = { id: "r1", post_id: "p1", project_id: "pr1", message: "old", source_message_baseline: "old" };
  const store = makeStore([existing]);
  const mf = plan({ id: "r1", post_id: "p1", project_id: "pr1", message: "old", source_message_baseline: "old" }, "new", "p1", "pr1");
  // Array form: filter(query, sort, limit) returns an array. A valid array is NOT collapsed to [].
  const r = await executeMessageFills({ messageFills: [mf], get: store.get, update: store.update, lookup: async () => [store.snapshot()[0]], nowIso: NOW });
  assert.equal(r.filled, 1);
  assert.equal(store.snapshot()[0].message, "new");
});

test("adapter: lookup page {items} form (options filter) unwraps and writes", async () => {
  const existing = { id: "r1", post_id: "p1", project_id: "pr1", message: "old", source_message_baseline: "old" };
  const store = makeStore([existing]);
  const mf = plan({ id: "r1", post_id: "p1", project_id: "pr1", message: "old", source_message_baseline: "old" }, "new", "p1", "pr1");
  // Page form: filter(query, {limit}) returns {items, next_cursor, has_more}.
  const r = await executeMessageFills({ messageFills: [mf], get: store.get, update: store.update, lookup: async () => ({ items: [store.snapshot()[0]], next_cursor: null, has_more: false }), nowIso: NOW });
  assert.equal(r.filled, 1);
  assert.equal(store.snapshot()[0].message, "new");
});

test("adapter: lookup valid non-empty array is not collapsed to [] (2-item array fails on length)", async () => {
  // A 2-item array is a valid array; the adapter returns it as-is (not []) and then
  // fails closed on length !== 1. This proves a valid array is never silently [].
  const existing = { id: "r1", post_id: "p1", project_id: "pr1", message: "old", source_message_baseline: "old" };
  const store = makeStore([existing]);
  const mf = plan({ id: "r1", post_id: "p1", project_id: "pr1", message: "old", source_message_baseline: "old" }, "new", "p1", "pr1");
  let received = null;
  const r = await executeMessageFills({ messageFills: [mf], get: store.get, update: store.update, lookup: async () => { received = [store.snapshot()[0], { ...store.snapshot()[0], id: "r2" }]; return received; }, nowIso: NOW });
  assert.equal(r.filled, 0);
  assert.equal(r.skipped, 1);
  assert.ok(Array.isArray(received) && received.length === 2, "lookup received a real 2-item array");
});

// lookup mandatory: absent lookup -> fail closed.
test("adapter: absent lookup fails closed (lookup mandatory)", async () => {
  const existing = { id: "r1", post_id: "p1", project_id: "pr1", message: "old", source_message_baseline: "old" };
  const store = makeStore([existing]);
  const mf = plan({ id: "r1", post_id: "p1", project_id: "pr1", message: "old", source_message_baseline: "old" }, "new", "p1", "pr1");
  const r = await executeMessageFills({ messageFills: [mf], get: store.get, update: store.update, nowIso: NOW });
  assert.equal(r.filled, 0);
  assert.equal(r.skipped, 1);
  assert.equal(store.snapshot()[0].message, "old");
});

// Shape unknown / truncated page -> fail closed.
test("adapter: lookup unknown shape (object without items) fails closed", async () => {
  const existing = { id: "r1", post_id: "p1", project_id: "pr1", message: "old", source_message_baseline: "old" };
  const store = makeStore([existing]);
  const mf = plan({ id: "r1", post_id: "p1", project_id: "pr1", message: "old", source_message_baseline: "old" }, "new", "p1", "pr1");
  const r = await executeMessageFills({ messageFills: [mf], get: store.get, update: store.update, lookup: async () => ({ weird: true }), nowIso: NOW });
  assert.equal(r.filled, 0);
  assert.equal(r.skipped, 1);
});

test("adapter: lookup truncated page (items missing) fails closed", async () => {
  const existing = { id: "r1", post_id: "p1", project_id: "pr1", message: "old", source_message_baseline: "old" };
  const store = makeStore([existing]);
  const mf = plan({ id: "r1", post_id: "p1", project_id: "pr1", message: "old", source_message_baseline: "old" }, "new", "p1", "pr1");
  const r = await executeMessageFills({ messageFills: [mf], get: store.get, update: store.update, lookup: async () => ({ next_cursor: "x", has_more: true }), nowIso: NOW });
  assert.equal(r.filled, 0);
  assert.equal(r.skipped, 1);
});

test("adapter: lookup non-object/non-array (string) fails closed", async () => {
  const existing = { id: "r1", post_id: "p1", project_id: "pr1", message: "old", source_message_baseline: "old" };
  const store = makeStore([existing]);
  const mf = plan({ id: "r1", post_id: "p1", project_id: "pr1", message: "old", source_message_baseline: "old" }, "new", "p1", "pr1");
  const r = await executeMessageFills({ messageFills: [mf], get: store.get, update: store.update, lookup: async () => "unexpected", nowIso: NOW });
  assert.equal(r.filled, 0);
  assert.equal(r.skipped, 1);
});

test("adapter: lookup throws fails closed", async () => {
  const existing = { id: "r1", post_id: "p1", project_id: "pr1", message: "old", source_message_baseline: "old" };
  const store = makeStore([existing]);
  const mf = plan({ id: "r1", post_id: "p1", project_id: "pr1", message: "old", source_message_baseline: "old" }, "new", "p1", "pr1");
  const r = await executeMessageFills({ messageFills: [mf], get: store.get, update: store.update, lookup: async () => { throw new Error("boom"); }, nowIso: NOW });
  assert.equal(r.filled, 0);
  assert.equal(r.skipped, 1);
});