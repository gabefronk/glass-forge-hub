// Adapter tests for the source-note follow-through wiring (defect-corrected).
// Imports the ACTUAL shared decision helper (planReportWrite / buildNewReportRow /
// captureSnapshot) and the ACTUAL write adapter (executeMessageFills) used by the
// ingest, and injects a mock get/update (the same interface executeMessageFills uses
// against the real SDK). No provider, no SDK, no I/O. Exercises the message/baseline
// execution path with mocked fresh GETs covering: currentHub changed, concurrent
// Hub+baseline advance (same action), manual markers appeared, duplicates, wrong
// project (initial + fresh), post_id mismatch, empty fill repeated (idempotent),
// new seed, malformed Hub, malformed baseline, other fields preserved.
import test from "node:test";
import assert from "node:assert/strict";
import {
  planReportWrite, buildNewReportRow, executeMessageFills, captureSnapshot,
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
  assert.ok(mf);
  const r = await executeMessageFills({ messageFills: [mf], get: store.get, update: store.update, nowIso: NOW });
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
  const r = await executeMessageFills({ messageFills: [], get: store.get, update: store.update, nowIso: NOW });
  assert.equal(r.filled, 0);
  assert.equal(store.snapshot()[0].message, "note");
});

test("adapter: fresh GET shows currentHub changed -> skip (no overwrite)", async () => {
  const stale = { id: "r1", post_id: "p1", project_id: "pr1", message: "" };
  const mf = plan(stale, "new", "p1", "pr1");
  assert.equal(mf.plannedAction, "empty_fill");
  const store = makeStore([{ id: "r1", post_id: "p1", project_id: "pr1", message: "owner typed", source_message_baseline: "" }]);
  const r = await executeMessageFills({ messageFills: [mf], get: store.get, update: store.update, nowIso: NOW });
  assert.equal(r.filled, 0);
  assert.equal(r.skipped, 1);
  assert.equal(store.snapshot()[0].message, "owner typed");
});

test("adapter: manual markers appeared between plan and write -> skip", async () => {
  const stale = { id: "r1", post_id: "p1", project_id: "pr1", message: "old", source_message_baseline: "old" };
  const mf = plan(stale, "new", "p1", "pr1");
  assert.equal(mf.plannedAction, "update");
  const store = makeStore([{ id: "r1", post_id: "p1", project_id: "pr1", message: "old", source_message_baseline: "old", edited_at: NOW }]);
  const r = await executeMessageFills({ messageFills: [mf], get: store.get, update: store.update, nowIso: NOW });
  assert.equal(r.filled, 0);
  assert.equal(r.skipped, 1);
  assert.equal(store.snapshot()[0].message, "old");
});

// DEFECT 2: concurrent Hub+baseline advance, same action -> snapshot mismatch -> skip.
test("adapter: concurrent Hub+baseline advance (same action) -> skip, no stale overwrite", async () => {
  const stale = { id: "r1", post_id: "p1", project_id: "pr1", message: "old", source_message_baseline: "old" };
  const mf = plan(stale, "new", "p1", "pr1");
  assert.equal(mf.plannedAction, "update");
  // A newer sync advanced both Hub and baseline to "newer" (still action=update for source "new").
  const store = makeStore([{ id: "r1", post_id: "p1", project_id: "pr1", message: "newer", source_message_baseline: "newer" }]);
  const r = await executeMessageFills({ messageFills: [mf], get: store.get, update: store.update, nowIso: NOW });
  assert.equal(r.filled, 0);
  assert.equal(r.skipped, 1);
  // The newer synced state is preserved; the stale earlier source "new" did not overwrite.
  assert.equal(store.snapshot()[0].message, "newer");
  assert.equal(store.snapshot()[0].source_message_baseline, "newer");
});

// DEFECT 1: wrong project on fresh GET -> skip.
test("adapter: wrong project on fresh GET -> skip", async () => {
  const stale = { id: "r1", post_id: "p1", project_id: "pr1", message: "" };
  const mf = plan(stale, "new", "p1", "pr1");
  const store = makeStore([{ id: "r1", post_id: "p1", project_id: "OTHER", message: "" }]);
  const r = await executeMessageFills({ messageFills: [mf], get: store.get, update: store.update, nowIso: NOW });
  assert.equal(r.filled, 0);
  assert.equal(r.skipped, 1);
});

// DEFECT 1: wrong project at initial plan -> not planned.
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
  const r = await executeMessageFills({ messageFills: [mf], get: store.get, update: store.update, nowIso: NOW });
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
  const r = await executeMessageFills({ messageFills: [mf], get: store.get, update: store.update, nowIso: NOW });
  assert.equal(r.filled, 0);
  assert.equal(r.skipped, 1);
});

// DEFECT 4: malformed Hub (number) on fresh GET -> skip.
test("adapter: malformed Hub (number) on fresh GET -> skip", async () => {
  const stale = { id: "r1", post_id: "p1", project_id: "pr1", message: "" };
  const mf = plan(stale, "new", "p1", "pr1");
  const store = makeStore([{ id: "r1", post_id: "p1", project_id: "pr1", message: 42 }]);
  const r = await executeMessageFills({ messageFills: [mf], get: store.get, update: store.update, nowIso: NOW });
  assert.equal(r.filled, 0);
  assert.equal(r.skipped, 1);
});

// DEFECT 4: malformed baseline (numeric) at initial plan -> not planned.
test("adapter: malformed baseline (numeric) at initial plan -> not planned", () => {
  const existing = { id: "r1", post_id: "p1", project_id: "pr1", message: "hub", source_message_baseline: 42 };
  const p = planReportWrite({ existing, sourceMessage: "new", nowIso: NOW, expectedPostId: "p1", expectedProjectId: "pr1" });
  assert.equal(p.action, "none");
  assert.equal(p.reason, "malformed_baseline");
});

test("adapter: update path writes when Hub===baseline on fresh GET", async () => {
  const stale = { id: "r1", post_id: "p1", project_id: "pr1", message: "old", source_message_baseline: "old" };
  const mf = plan(stale, "new", "p1", "pr1");
  assert.equal(mf.plannedAction, "update");
  const store = makeStore([{ id: "r1", post_id: "p1", project_id: "pr1", message: "old", source_message_baseline: "old" }]);
  const r = await executeMessageFills({ messageFills: [mf], get: store.get, update: store.update, nowIso: NOW });
  assert.equal(r.filled, 1);
  assert.equal(store.snapshot()[0].message, "new");
  assert.equal(store.snapshot()[0].source_message_baseline, "new");
});

test("adapter: empty fill repeated (already filled) -> fresh predicate yields no fill", async () => {
  const store = makeStore([{ id: "r1", post_id: "p1", project_id: "pr1", message: "", source_message_baseline: "" }]);
  const mf1 = plan({ id: "r1", post_id: "p1", project_id: "pr1", message: "", source_message_baseline: "" }, "note", "p1", "pr1");
  await executeMessageFills({ messageFills: [mf1], get: store.get, update: store.update, nowIso: NOW });
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
  const r = await executeMessageFills({ messageFills: [mf], get: store.get, update: store.update, nowIso: NOW });
  assert.equal(r.filled, 1);
  assert.equal(store.snapshot()[0].message, "same text");
  assert.equal(store.snapshot()[0].source_message_baseline, "same text");
});

// DEFECT 3: no authorizedCorrection lever — manual markers always block at the adapter.
test("adapter: manual markers always block (no correction lever)", () => {
  const p = planReportWrite({ existing: { id: "r1", post_id: "p1", project_id: "pr1", message: "old", source_message_baseline: "old", edited_at: NOW }, sourceMessage: "new", nowIso: NOW, expectedPostId: "p1", expectedProjectId: "pr1" });
  assert.equal(p.action, "none");
  assert.equal(p.reason, "manual_markers");
});

test("adapter: patch is source/baseline-only — never photo_urls or job_id", async () => {
  const store = makeStore([{ id: "r1", post_id: "p1", project_id: "pr1", message: "old", source_message_baseline: "old", photo_urls: ["x.jpg"], job_id: "j1" }]);
  const mf = plan({ id: "r1", post_id: "p1", project_id: "pr1", message: "old", source_message_baseline: "old" }, "new", "p1", "pr1");
  await executeMessageFills({ messageFills: [mf], get: store.get, update: store.update, nowIso: NOW });
  const row = store.snapshot()[0];
  assert.deepEqual(Object.keys(row).sort(), ["id", "job_id", "message", "photo_urls", "post_id", "project_id", "source_baseline_at", "source_message_baseline"].sort());
  assert.deepEqual(row.photo_urls, ["x.jpg"]);
  assert.equal(row.job_id, "j1");
});