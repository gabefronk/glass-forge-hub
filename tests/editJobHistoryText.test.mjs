// Unit tests for the owner-only inline text edit (crew field-report message +
// job-note body). No SDK, no I/O — exercises applyHistoryTextEdit directly
// against an in-memory store mock that records the patch handed to update().
import test from "node:test";
import assert from "node:assert/strict";
import { applyHistoryTextEdit, isHistoryEditOwner, HISTORY_EDIT_OWNER_IDS } from "../base44/shared/historyEdit.js";

// Mock owner/nonowner identities. OWNER/OTHER_OWNER are Gabriel's immutable ids
// (twin of src/lib/ownerAccess.js). ADMIN/CREW must be rejected even though ADMIN
// is an admin — the gate is id-based, not role-based.
const OWNER = { id: "6a7f0d834a5f825c724273ea", email: "gabefronk@gmail.com" };
const OTHER_OWNER = { id: "6a8229a9801b2aef9278ff47", email: "gabriel.fronk.wd@gmail.com" };
const ADMIN = { id: "6a000000000000000000000a", email: "admin@x.com", role: "admin" };
const CREW = { id: "6a000000000000000000000b", email: "crew@x.com", role: "user" };

const reportRec = () => ({
  id: "fr1", job_id: "job1", message: "Estra window 471/2x471/2",
  photo_urls: ["p1", "p2", "p3", "p4", "p5"], attachment_count: 5,
  job_date: "2026-10-06", post_id: "post1", project_id: "proj1",
  created_at: "2026-10-06T12:00:00Z", man_hours: null, trip_charges: null,
  original_text: null, edited_at: null, edited_by: null,
});
const noteRec = () => ({
  id: "n1", job_id: "job1", body: "Crew arrived late", author: "crew@x.com",
  note_date: "2026-10-06", interaction_type: "note", attachments: ["a1"],
  edited: false, edited_by: null,
});

// In-memory store mock: records the patch handed to update() so tests can assert
// the exact payload scope (no photos/dates/quantities/extra fields leak through).
function makeDb(rec) {
  const store = { ...rec };
  let updatePatch = null;
  let updateCalled = false;
  return {
    get: async (_type, _id) => ({ ...store }),
    update: async (_type, _id, patch) => { updatePatch = patch; updateCalled = true; Object.assign(store, patch); return { ...store }; },
    patch: () => updatePatch,
    updateCalled: () => updateCalled,
    store: () => ({ ...store }),
  };
}

test("owner report edit: message changed, original_text set once, markers set, photos preserved", async () => {
  const db = makeDb(reportRec());
  const r = await applyHistoryTextEdit({ user: OWNER, type: "report", record_id: "fr1", job_id: "job1", expected_text: "Estra window 471/2x471/2", new_text: "Extra window 47 1/2 x 47 1/2", get: db.get, update: db.update, now: "2026-10-07T10:00:00Z" });
  assert.equal(r.status, 200);
  assert.equal(r.body.ok, true);
  const s = db.store();
  assert.equal(s.message, "Extra window 47 1/2 x 47 1/2");
  assert.equal(s.original_text, "Estra window 471/2x471/2"); // provenance set once
  assert.equal(s.edited_at, "2026-10-07T10:00:00Z");
  assert.equal(s.edited_by, "gabefronk@gmail.com");
  assert.deepEqual(s.photo_urls, ["p1", "p2", "p3", "p4", "p5"]); // photos preserved
  assert.equal(s.job_date, "2026-10-06"); // dates preserved
  assert.equal(s.man_hours, null); // quantities preserved
});

test("report edit: original_text NOT overwritten on second edit", async () => {
  const db = makeDb({ ...reportRec(), message: "Extra window 47 1/2 x 47 1/2", original_text: "Estra window 471/2x471/2", edited_at: "2026-10-07T09:00:00Z", edited_by: "gabefronk@gmail.com" });
  const r = await applyHistoryTextEdit({ user: OWNER, type: "report", record_id: "fr1", job_id: "job1", expected_text: "Extra window 47 1/2 x 47 1/2", new_text: "Extra window 47.5 x 47.5", get: db.get, update: db.update, now: "2026-10-07T11:00:00Z" });
  assert.equal(r.status, 200);
  const s = db.store();
  assert.equal(s.message, "Extra window 47.5 x 47.5");
  assert.equal(s.original_text, "Estra window 471/2x471/2"); // still the original
  assert.equal(s.edited_at, "2026-10-07T11:00:00Z");
});

test("owner note edit: body changed, edited=true, edited_by set, attachments/author/date preserved", async () => {
  const db = makeDb(noteRec());
  const r = await applyHistoryTextEdit({ user: OTHER_OWNER, type: "note", record_id: "n1", job_id: "job1", expected_text: "Crew arrived late", new_text: "Crew arrived on time", get: db.get, update: db.update, now: "2026-10-07T10:00:00Z" });
  assert.equal(r.status, 200);
  const s = db.store();
  assert.equal(s.body, "Crew arrived on time");
  assert.equal(s.edited, true);
  assert.equal(s.edited_by, "gabriel.fronk.wd@gmail.com");
  assert.deepEqual(s.attachments, ["a1"]); // attachments preserved
  assert.equal(s.author, "crew@x.com"); // author preserved
  assert.equal(s.note_date, "2026-10-06"); // date preserved
});

test("nonowner admin: 403, no write", async () => {
  const db = makeDb(reportRec());
  const r = await applyHistoryTextEdit({ user: ADMIN, type: "report", record_id: "fr1", job_id: "job1", expected_text: "Estra window 471/2x471/2", new_text: "x", get: db.get, update: db.update });
  assert.equal(r.status, 403);
  assert.equal(r.body.error, "forbidden");
  assert.equal(db.updateCalled(), false);
});

test("nonowner crew: 403, no write", async () => {
  const db = makeDb(noteRec());
  const r = await applyHistoryTextEdit({ user: CREW, type: "note", record_id: "n1", job_id: "job1", expected_text: "Crew arrived late", new_text: "x", get: db.get, update: db.update });
  assert.equal(r.status, 403);
  assert.equal(db.updateCalled(), false);
});

test("no user: 401", async () => {
  const r = await applyHistoryTextEdit({ user: null, type: "report", record_id: "fr1", job_id: "job1", expected_text: "", new_text: "x", get: async () => null, update: async () => {} });
  assert.equal(r.status, 401);
});

test("missing type: 400", async () => {
  const r = await applyHistoryTextEdit({ user: OWNER, type: "", record_id: "fr1", job_id: "job1", expected_text: "", new_text: "x", get: async () => null, update: async () => {} });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, "missing_type");
});

test("payload scope: extra fields ignored, patch only has allowed keys", async () => {
  const db = makeDb(reportRec());
  const r = await applyHistoryTextEdit({ user: OWNER, type: "report", record_id: "fr1", job_id: "job1", expected_text: "Estra window 471/2x471/2", new_text: "fixed", extra_field: "evil", photo_urls: ["hack"], job_date: "2099-01-01", man_hours: 99, get: db.get, update: db.update });
  assert.equal(r.status, 200);
  const patch = db.patch();
  assert.deepEqual(Object.keys(patch).sort(), ["edited_at", "edited_by", "message", "original_text"].sort());
  const s = db.store();
  assert.deepEqual(s.photo_urls, ["p1", "p2", "p3", "p4", "p5"]); // not overwritten
  assert.equal(s.job_date, "2026-10-06"); // not overwritten
  assert.equal(s.man_hours, null); // not overwritten
});

test("concurrent edit (expected_text mismatch): 409, no write, current returned", async () => {
  const db = makeDb(reportRec());
  const r = await applyHistoryTextEdit({ user: OWNER, type: "report", record_id: "fr1", job_id: "job1", expected_text: "OLD text that is no longer current", new_text: "fixed", get: db.get, update: db.update });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, "conflict");
  assert.equal(db.updateCalled(), false);
  assert.equal(r.body.current, "Estra window 471/2x471/2");
});

test("unknown record (get null): 404", async () => {
  const r = await applyHistoryTextEdit({ user: OWNER, type: "report", record_id: "missing", job_id: "job1", expected_text: "", new_text: "x", get: async () => null, update: async () => {} });
  assert.equal(r.status, 404);
  assert.equal(r.body.error, "not_found");
});

test("job mismatch: 409, no write", async () => {
  const db = makeDb(reportRec());
  const r = await applyHistoryTextEdit({ user: OWNER, type: "report", record_id: "fr1", job_id: "WRONG", expected_text: "Estra window 471/2x471/2", new_text: "x", get: db.get, update: db.update });
  assert.equal(r.status, 409);
  assert.equal(r.body.error, "job_mismatch");
  assert.equal(db.updateCalled(), false);
});

test("empty text: 400", async () => {
  const r = await applyHistoryTextEdit({ user: OWNER, type: "report", record_id: "fr1", job_id: "job1", expected_text: "x", new_text: "   ", get: async () => null, update: async () => {} });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, "empty_text");
});

test("too long: 400", async () => {
  const r = await applyHistoryTextEdit({ user: OWNER, type: "note", record_id: "n1", job_id: "job1", expected_text: "x", new_text: "a".repeat(5001), get: async () => null, update: async () => {} });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, "invalid_text");
});

test("manual sync protection: markers block source-note refresh", async () => {
  const db = makeDb(reportRec());
  await applyHistoryTextEdit({ user: OWNER, type: "report", record_id: "fr1", job_id: "job1", expected_text: "Estra window 471/2x471/2", new_text: "fixed", get: db.get, update: db.update, now: "2026-10-07T10:00:00Z" });
  const s = db.store();
  // sourceNoteFollowthrough.hasManualMarkers checks exactly these three fields.
  const hasManualMarkers = !!(s.edited_at || s.edited_by || s.original_text);
  assert.equal(hasManualMarkers, true);
});

test("note edit: no original_text field on notes (different model)", async () => {
  const db = makeDb(noteRec());
  const r = await applyHistoryTextEdit({ user: OWNER, type: "note", record_id: "n1", job_id: "job1", expected_text: "Crew arrived late", new_text: "fixed", get: db.get, update: db.update });
  assert.equal(r.status, 200);
  const patch = db.patch();
  assert.deepEqual(Object.keys(patch).sort(), ["body", "edited", "edited_by"].sort());
});

test("isHistoryEditOwner + OWNER_IDS: only the two Gabriel ids", () => {
  assert.equal(isHistoryEditOwner(OWNER), true);
  assert.equal(isHistoryEditOwner(OTHER_OWNER), true);
  assert.equal(isHistoryEditOwner(ADMIN), false);
  assert.equal(isHistoryEditOwner(CREW), false);
  assert.equal(isHistoryEditOwner(null), false);
  assert.equal(HISTORY_EDIT_OWNER_IDS.size, 2);
});

test("readback returned in body", async () => {
  const db = makeDb(reportRec());
  const r = await applyHistoryTextEdit({ user: OWNER, type: "report", record_id: "fr1", job_id: "job1", expected_text: "Estra window 471/2x471/2", new_text: "fixed", get: db.get, update: db.update, now: "2026-10-07T10:00:00Z" });
  assert.equal(r.body.readback.message, "fixed");
  assert.equal(r.body.readback.original_text, "Estra window 471/2x471/2");
  assert.equal(r.body.readback.edited_by, "gabefronk@gmail.com");
});