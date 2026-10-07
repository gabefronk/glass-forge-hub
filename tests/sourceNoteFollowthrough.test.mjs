// Unit tests for the pure source-note follow-through decision helper.
// No SDK, no I/O — exercises planReportWrite / freshRecheck / buildNewReportRow /
// planReportWrites directly against in-memory records.
import test from "node:test";
import assert from "node:assert/strict";
import {
  planReportWrite, freshRecheck, buildNewReportRow, planReportWrites,
} from "../base44/shared/sourceNoteFollowthrough.js";

const NOW = "2026-10-07T10:00:00.000Z";

test("buildNewReportRow seeds message + baseline = source verbatim", () => {
  const row = buildNewReportRow({ jobDate: "2026-10-07", jobName: "P", message: "hello world", postId: "p1", projectId: "x", nowIso: NOW, photoUrls: [], attachmentCount: 0, createdAt: null, manHours: null, tripCharges: null, jobFields: null });
  assert.equal(row.message, "hello world");
  assert.equal(row.source_message_baseline, "hello world");
  assert.equal(row.source_baseline_at, NOW);
  assert.equal(row.post_id, "p1");
});

test("buildNewReportRow seeds empty-string baseline when source empty", () => {
  const row = buildNewReportRow({ jobDate: "2026-10-07", jobName: "P", message: "", postId: "p1", projectId: "x", nowIso: NOW });
  assert.equal(row.message, "");
  assert.equal(row.source_message_baseline, "");
  assert.equal(row.source_baseline_at, NOW);
});

test("planReportWrite: empty fill — Hub empty, source nonempty", () => {
  const r = planReportWrite({ existing: { message: "" }, sourceMessage: "new note", nowIso: NOW });
  assert.equal(r.action, "write");
  assert.equal(r.plannedAction, "empty_fill");
  assert.deepEqual(r.patch, { message: "new note", source_message_baseline: "new note", source_baseline_at: NOW });
});

test("planReportWrite: baseline_seed — legacy Hub==source, no baseline", () => {
  const r = planReportWrite({ existing: { message: "same text" }, sourceMessage: "same text", nowIso: NOW });
  assert.equal(r.action, "write");
  assert.equal(r.plannedAction, "baseline_seed");
  assert.deepEqual(r.patch, { source_message_baseline: "same text", source_baseline_at: NOW });
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

test("planReportWrite: malformed (whitespace) baseline fails closed for update", () => {
  const r = planReportWrite({ existing: { message: "hub", source_message_baseline: "   " }, sourceMessage: "new", nowIso: NOW });
  assert.equal(r.action, "none");
  assert.equal(r.reason, "legacy_divergent_no_baseline");
});

test("planReportWrite: malformed baseline, Hub===source -> baseline_seed", () => {
  const r = planReportWrite({ existing: { message: "same", source_message_baseline: "  " }, sourceMessage: "same", nowIso: NOW });
  assert.equal(r.action, "write");
  assert.equal(r.plannedAction, "baseline_seed");
});

test("planReportWrite: non-string baseline fails closed", () => {
  const r = planReportWrite({ existing: { message: "hub", source_message_baseline: 42 }, sourceMessage: "new", nowIso: NOW });
  assert.equal(r.action, "none");
  assert.equal(r.reason, "legacy_divergent_no_baseline");
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

test("planReportWrite: authorizedCorrection bypasses manual markers + gate", () => {
  const r = planReportWrite({ existing: { message: "manual edit", source_message_baseline: "old", edited_at: NOW }, sourceMessage: "corrected", nowIso: NOW, authorizedCorrection: true });
  assert.equal(r.action, "write");
  assert.equal(r.plannedAction, "authorized_correction");
  assert.deepEqual(r.patch, { message: "corrected", source_message_baseline: "corrected", source_baseline_at: NOW });
});

test("planReportWrite: authorizedCorrection still refuses empty source", () => {
  const r = planReportWrite({ existing: { message: "keep", source_message_baseline: "keep", edited_at: NOW }, sourceMessage: "", nowIso: NOW, authorizedCorrection: true });
  assert.equal(r.action, "none");
  assert.equal(r.reason, "empty_source");
});

test("freshRecheck: safe when predicate still holds", () => {
  const fresh = { post_id: "p1", message: "", source_message_baseline: "" };
  const r = freshRecheck({ fresh, expectedPostId: "p1", sourceMessage: "new", nowIso: NOW, expectedAction: "empty_fill" });
  assert.equal(r.safe, true);
  assert.deepEqual(r.patch, { message: "new", source_message_baseline: "new", source_baseline_at: NOW });
});

test("freshRecheck: fresh missing", () => {
  const r = freshRecheck({ fresh: null, expectedPostId: "p1", sourceMessage: "new", nowIso: NOW });
  assert.equal(r.safe, false);
  assert.match(r.reason, /fresh_missing/);
});

test("freshRecheck: post_id mismatch (project/post identity guard)", () => {
  const r = freshRecheck({ fresh: { post_id: "other", message: "" }, expectedPostId: "p1", sourceMessage: "new", nowIso: NOW });
  assert.equal(r.safe, false);
  assert.equal(r.reason, "post_id_mismatch");
});

test("freshRecheck: manual markers appeared", () => {
  const r = freshRecheck({ fresh: { post_id: "p1", message: "", edited_at: NOW }, expectedPostId: "p1", sourceMessage: "new", nowIso: NOW, expectedAction: "empty_fill" });
  assert.equal(r.safe, false);
  assert.match(r.reason, /manual_markers/);
});

test("freshRecheck: currentHub changed since plan -> action changed", () => {
  const r = freshRecheck({ fresh: { post_id: "p1", message: "filled already", source_message_baseline: "filled already" }, expectedPostId: "p1", sourceMessage: "new", nowIso: NOW, expectedAction: "empty_fill" });
  assert.equal(r.safe, false);
  assert.match(r.reason, /action_changed/);
});

test("planReportWrites: duplicate post_id fail closed", () => {
  const r = planReportWrites([
    { existing: { id: "r1", message: "" }, sourceMessage: "new", postId: "p1", duplicatePostId: true },
    { existing: { id: "r2", message: "" }, sourceMessage: "new2", postId: "p2", duplicatePostId: false },
  ], NOW);
  assert.equal(r.writes.length, 1);
  assert.equal(r.writes[0].id, "r2");
  assert.equal(r.skipped.length, 1);
  assert.equal(r.skipped[0].reason, "duplicate_post_id");
});

test("planReportWrites: never passes authorizedCorrection (manual-marker row skipped)", () => {
  const r = planReportWrites([
    { existing: { id: "r1", message: "old", source_message_baseline: "old", edited_at: NOW }, sourceMessage: "new", postId: "p1", duplicatePostId: false },
  ], NOW);
  assert.equal(r.writes.length, 0);
  assert.equal(r.skipped[0].reason, "manual_markers");
});