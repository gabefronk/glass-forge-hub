// Unit tests for the pure source-note follow-through decision helper (defect-corrected).
// No SDK, no I/O — exercises planReportWrite / freshRecheck / buildNewReportRow /
// planReportWrites / captureSnapshot directly against in-memory records.
import test from "node:test";
import assert from "node:assert/strict";
import {
  planReportWrite, freshRecheck, buildNewReportRow, planReportWrites, captureSnapshot,
} from "../base44/shared/sourceNoteFollowthrough.js";

const NOW = "2026-10-07T10:00:00.000Z";

test("buildNewReportRow seeds message + baseline = source verbatim", () => {
  const row = buildNewReportRow({ jobDate: "2026-10-07", jobName: "P", message: "hello world", postId: "p1", projectId: "pr1", nowIso: NOW, photoUrls: [], attachmentCount: 0, createdAt: null, manHours: null, tripCharges: null, jobFields: null });
  assert.equal(row.message, "hello world");
  assert.equal(row.source_message_baseline, "hello world");
  assert.equal(row.source_baseline_at, NOW);
  assert.equal(row.post_id, "p1");
  assert.equal(row.project_id, "pr1");
});

test("buildNewReportRow seeds empty-string baseline when source empty", () => {
  const row = buildNewReportRow({ jobDate: "2026-10-07", jobName: "P", message: "", postId: "p1", projectId: "pr1", nowIso: NOW });
  assert.equal(row.message, "");
  assert.equal(row.source_message_baseline, "");
  assert.equal(row.source_baseline_at, NOW);
});

test("planReportWrite: empty fill — Hub empty, source nonempty", () => {
  const r = planReportWrite({ existing: { message: "" }, sourceMessage: "new note", nowIso: NOW });
  assert.equal(r.action, "write");
  assert.equal(r.plannedAction, "empty_fill");
  assert.deepEqual(r.patch, { message: "new note", source_message_baseline: "new note", source_baseline_at: NOW });
  assert.ok(r.snapshot, "write result carries a snapshot");
});

test("planReportWrite: empty fill — null Hub treated as empty", () => {
  const r = planReportWrite({ existing: { message: null }, sourceMessage: "new note", nowIso: NOW });
  assert.equal(r.action, "write");
  assert.equal(r.plannedAction, "empty_fill");
});

test("planReportWrite: baseline_seed — legacy Hub==source, baseline absent", () => {
  const r = planReportWrite({ existing: { message: "same text" }, sourceMessage: "same text", nowIso: NOW });
  assert.equal(r.action, "write");
  assert.equal(r.plannedAction, "baseline_seed");
  assert.deepEqual(r.patch, { source_message_baseline: "same text", source_baseline_at: NOW });
  assert.ok(!("message" in r.patch), "baseline_seed patch must not include message");
});

test("planReportWrite: update — Hub===baseline, source differs", () => {
  const r = planReportWrite({ existing: { message: "old", source_message_baseline: "old" }, sourceMessage: "new", nowIso: NOW });
  assert.equal(r.action, "write");
  assert.equal(r.plannedAction, "update");
  assert.deepEqual(r.patch, { message: "new", source_message_baseline: "new", source_baseline_at: NOW });
});

test("planReportWrite: already in sync — Hub===baseline===source", () => {
  const r = planReportWrite({ existing: { message: "x", source_message_baseline: "x" }, sourceMessage: "x", nowIso: NOW });
  assert.equal(r.action, "none");
  assert.equal(r.reason, "already_in_sync");
});

test("planReportWrite: manual markers block (edited_at)", () => {
  const r = planReportWrite({ existing: { message: "", edited_at: NOW }, sourceMessage: "new", nowIso: NOW });
  assert.equal(r.action, "none");
  assert.equal(r.reason, "manual_markers");
});

test("planReportWrite: manual markers block (edited_by)", () => {
  const r = planReportWrite({ existing: { message: "old", source_message_baseline: "old", edited_by: "gabe@x" }, sourceMessage: "new", nowIso: NOW });
  assert.equal(r.action, "none");
  assert.equal(r.reason, "manual_markers");
});

test("planReportWrite: manual markers block (original_text)", () => {
  const r = planReportWrite({ existing: { message: "old", source_message_baseline: "old", original_text: "old" }, sourceMessage: "new", nowIso: NOW });
  assert.equal(r.action, "none");
  assert.equal(r.reason, "manual_markers");
});

test("planReportWrite: empty source does not clear Hub", () => {
  const r = planReportWrite({ existing: { message: "keep me", source_message_baseline: "keep me" }, sourceMessage: "", nowIso: NOW });
  assert.equal(r.action, "none");
  assert.equal(r.reason, "empty_source");
});

test("planReportWrite: whitespace source does not clear Hub", () => {
  const r = planReportWrite({ existing: { message: "keep me", source_message_baseline: "keep me" }, sourceMessage: "   ", nowIso: NOW });
  assert.equal(r.action, "none");
  assert.equal(r.reason, "empty_source");
});

// DEFECT 4: malformed baseline (whitespace / numeric / empty string) never seeds a nonempty Hub.
test("planReportWrite: whitespace baseline fails closed (no seed) for nonempty Hub", () => {
  const r = planReportWrite({ existing: { message: "hub", source_message_baseline: "   " }, sourceMessage: "new", nowIso: NOW });
  assert.equal(r.action, "none");
  assert.equal(r.reason, "malformed_baseline");
});

test("planReportWrite: whitespace baseline, Hub===source still fails closed (no seed)", () => {
  const r = planReportWrite({ existing: { message: "same", source_message_baseline: "  " }, sourceMessage: "same", nowIso: NOW });
  assert.equal(r.action, "none");
  assert.equal(r.reason, "malformed_baseline");
});

test("planReportWrite: numeric baseline fails closed", () => {
  const r = planReportWrite({ existing: { message: "hub", source_message_baseline: 42 }, sourceMessage: "new", nowIso: NOW });
  assert.equal(r.action, "none");
  assert.equal(r.reason, "malformed_baseline");
});

test("planReportWrite: empty-string baseline fails closed for nonempty Hub (only null/absent seeds)", () => {
  const r = planReportWrite({ existing: { message: "hub", source_message_baseline: "" }, sourceMessage: "hub", nowIso: NOW });
  assert.equal(r.action, "none");
  assert.equal(r.reason, "malformed_baseline");
});

test("planReportWrite: null baseline + Hub===source -> baseline_seed (true legacy)", () => {
  const r = planReportWrite({ existing: { message: "same", source_message_baseline: null }, sourceMessage: "same", nowIso: NOW });
  assert.equal(r.action, "write");
  assert.equal(r.plannedAction, "baseline_seed");
});

test("planReportWrite: legacy divergent nonempty no baseline preserved", () => {
  const r = planReportWrite({ existing: { message: "hub text" }, sourceMessage: "different", nowIso: NOW });
  assert.equal(r.action, "none");
  assert.equal(r.reason, "legacy_divergent_no_baseline");
});

test("planReportWrite: hub changed since baseline (Hub !== baseline) preserved", () => {
  const r = planReportWrite({ existing: { message: "changed", source_message_baseline: "original" }, sourceMessage: "new", nowIso: NOW });
  assert.equal(r.action, "none");
  assert.equal(r.reason, "hub_changed_since_baseline");
});

test("planReportWrite: null markers alone do NOT authorize update", () => {
  const r = planReportWrite({ existing: { message: "hub", source_message_baseline: null }, sourceMessage: "src", nowIso: NOW });
  assert.equal(r.action, "none");
  assert.equal(r.reason, "legacy_divergent_no_baseline");
});

// DEFECT 4: malformed Hub (number/object/boolean) fails closed — never coerced to '' and overwritten.
test("planReportWrite: malformed Hub (number) fails closed", () => {
  const r = planReportWrite({ existing: { message: 42 }, sourceMessage: "new", nowIso: NOW });
  assert.equal(r.action, "none");
  assert.equal(r.reason, "malformed_hub");
});

test("planReportWrite: malformed Hub (object) fails closed", () => {
  const r = planReportWrite({ existing: { message: { x: 1 } }, sourceMessage: "new", nowIso: NOW });
  assert.equal(r.action, "none");
  assert.equal(r.reason, "malformed_hub");
});

test("planReportWrite: malformed Hub (boolean) fails closed", () => {
  const r = planReportWrite({ existing: { message: true }, sourceMessage: "new", nowIso: NOW });
  assert.equal(r.action, "none");
  assert.equal(r.reason, "malformed_hub");
});

// DEFECT 3: no authorizedCorrection lever — manual markers ALWAYS block.
test("planReportWrite: no authorizedCorrection lever — manual markers block unconditionally", () => {
  // Even if a caller tried to pass authorizedCorrection, the helper ignores it (no param).
  const r = planReportWrite({ existing: { message: "old", source_message_baseline: "old", edited_at: NOW }, sourceMessage: "new", nowIso: NOW });
  assert.equal(r.action, "none");
  assert.equal(r.reason, "manual_markers");
});

// DEFECT 1: exact project+post identity at initial plan.
test("planReportWrite: project_id mismatch fails closed (initial)", () => {
  const r = planReportWrite({ existing: { post_id: "p1", project_id: "OTHER", message: "old", source_message_baseline: "old" }, sourceMessage: "new", nowIso: NOW, expectedPostId: "p1", expectedProjectId: "pr1" });
  assert.equal(r.action, "none");
  assert.equal(r.reason, "identity_mismatch:project_id");
});

test("planReportWrite: post_id mismatch fails closed (initial)", () => {
  const r = planReportWrite({ existing: { post_id: "OTHER", project_id: "pr1", message: "old", source_message_baseline: "old" }, sourceMessage: "new", nowIso: NOW, expectedPostId: "p1", expectedProjectId: "pr1" });
  assert.equal(r.action, "none");
  assert.equal(r.reason, "identity_mismatch:post_id");
});

test("planReportWrite: matching project+post ids allow the plan", () => {
  const r = planReportWrite({ existing: { post_id: "p1", project_id: "pr1", message: "old", source_message_baseline: "old" }, sourceMessage: "new", nowIso: NOW, expectedPostId: "p1", expectedProjectId: "pr1" });
  assert.equal(r.action, "write");
  assert.equal(r.plannedAction, "update");
});

test("freshRecheck: safe when predicate + snapshot hold", () => {
  const fresh = { post_id: "p1", project_id: "pr1", message: "", source_message_baseline: "" };
  const snap = captureSnapshot({ post_id: "p1", project_id: "pr1", message: "", source_message_baseline: "" });
  const r = freshRecheck({ fresh, expectedPostId: "p1", expectedProjectId: "pr1", snapshot: snap, sourceMessage: "new", nowIso: NOW, expectedAction: "empty_fill" });
  assert.equal(r.safe, true);
  assert.deepEqual(r.patch, { message: "new", source_message_baseline: "new", source_baseline_at: NOW });
});

test("freshRecheck: fresh missing", () => {
  const r = freshRecheck({ fresh: null, expectedPostId: "p1", sourceMessage: "new", nowIso: NOW });
  assert.equal(r.safe, false);
  assert.match(r.reason, /fresh_missing/);
});

test("freshRecheck: post_id mismatch", () => {
  const r = freshRecheck({ fresh: { post_id: "other", project_id: "pr1", message: "" }, expectedPostId: "p1", expectedProjectId: "pr1", sourceMessage: "new", nowIso: NOW });
  assert.equal(r.safe, false);
  assert.equal(r.reason, "post_id_mismatch");
});

// DEFECT 1: fresh project_id mismatch.
test("freshRecheck: project_id mismatch (wrong project report)", () => {
  const r = freshRecheck({ fresh: { post_id: "p1", project_id: "OTHER", message: "" }, expectedPostId: "p1", expectedProjectId: "pr1", sourceMessage: "new", nowIso: NOW });
  assert.equal(r.safe, false);
  assert.equal(r.reason, "project_id_mismatch");
});

test("freshRecheck: manual markers appeared (snapshot markers changed)", () => {
  const snap = captureSnapshot({ post_id: "p1", project_id: "pr1", message: "", source_message_baseline: "" });
  const r = freshRecheck({ fresh: { post_id: "p1", project_id: "pr1", message: "", source_message_baseline: "", edited_at: NOW }, expectedPostId: "p1", expectedProjectId: "pr1", snapshot: snap, sourceMessage: "new", nowIso: NOW, expectedAction: "empty_fill" });
  assert.equal(r.safe, false);
  assert.match(r.reason, /state_changed_since_plan:edited_at/);
});

// DEFECT 2: snapshot equality — currentHub changed since plan -> fail (narrower than action equality).
test("freshRecheck: currentHub changed since plan -> snapshot mismatch", () => {
  const snap = captureSnapshot({ post_id: "p1", project_id: "pr1", message: "old", source_message_baseline: "old" });
  const r = freshRecheck({ fresh: { post_id: "p1", project_id: "pr1", message: "owner typed", source_message_baseline: "old" }, expectedPostId: "p1", expectedProjectId: "pr1", snapshot: snap, sourceMessage: "new", nowIso: NOW, expectedAction: "update" });
  assert.equal(r.safe, false);
  assert.match(r.reason, /state_changed_since_plan:message/);
});

// DEFECT 2: concurrent Hub+baseline advance, same action -> snapshot catches it.
test("freshRecheck: concurrent Hub+baseline advance (same action) -> snapshot mismatch", () => {
  // Plan: Hub="old", baseline="old", source="new" -> update. A newer sync advanced both to "newer".
  const snap = captureSnapshot({ post_id: "p1", project_id: "pr1", message: "old", source_message_baseline: "old" });
  const fresh = { post_id: "p1", project_id: "pr1", message: "newer", source_message_baseline: "newer" };
  const r = freshRecheck({ fresh, expectedPostId: "p1", expectedProjectId: "pr1", snapshot: snap, sourceMessage: "new", nowIso: NOW, expectedAction: "update" });
  assert.equal(r.safe, false);
  assert.match(r.reason, /state_changed_since_plan:message/);
});

test("freshRecheck: baseline changed since plan -> snapshot mismatch", () => {
  const snap = captureSnapshot({ post_id: "p1", project_id: "pr1", message: "old", source_message_baseline: "old" });
  const r = freshRecheck({ fresh: { post_id: "p1", project_id: "pr1", message: "old", source_message_baseline: "changed" }, expectedPostId: "p1", expectedProjectId: "pr1", snapshot: snap, sourceMessage: "new", nowIso: NOW, expectedAction: "update" });
  assert.equal(r.safe, false);
  assert.match(r.reason, /state_changed_since_plan:baseline/);
});

test("planReportWrites: duplicate post_id fail closed", () => {
  const r = planReportWrites([
    { existing: { id: "r1", post_id: "p1", project_id: "pr1", message: "" }, sourceMessage: "new", postId: "p1", projectId: "pr1", duplicatePostId: true },
    { existing: { id: "r2", post_id: "p2", project_id: "pr2", message: "" }, sourceMessage: "new2", postId: "p2", projectId: "pr2", duplicatePostId: false },
  ], NOW);
  assert.equal(r.writes.length, 1);
  assert.equal(r.writes[0].id, "r2");
  assert.equal(r.skipped.length, 1);
  assert.equal(r.skipped[0].reason, "duplicate_post_id");
});

test("planReportWrites: manual-marker row skipped (no authorizedCorrection lever)", () => {
  const r = planReportWrites([
    { existing: { id: "r1", post_id: "p1", project_id: "pr1", message: "old", source_message_baseline: "old", edited_at: NOW }, sourceMessage: "new", postId: "p1", projectId: "pr1", duplicatePostId: false },
  ], NOW);
  assert.equal(r.writes.length, 0);
  assert.equal(r.skipped[0].reason, "manual_markers");
});

test("planReportWrites: wrong project id fails closed", () => {
  const r = planReportWrites([
    { existing: { id: "r1", post_id: "p1", project_id: "OTHER", message: "old", source_message_baseline: "old" }, sourceMessage: "new", postId: "p1", projectId: "pr1", duplicatePostId: false },
  ], NOW);
  assert.equal(r.writes.length, 0);
  assert.equal(r.skipped[0].reason, "identity_mismatch:project_id");
});