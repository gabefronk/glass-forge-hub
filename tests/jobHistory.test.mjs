import test from "node:test";
import assert from "node:assert/strict";
import {
  buildJobHistory, historyCounts, groupHistoryByDay, splitFolderFiles,
  recentSitePhotos, touchesJob, interactionLabel,
} from "../src/lib/jobHistory.js";

const events = [
  { id: "e1", event_date: "2026-09-20", start_time: "08:00", job_name: "Rainey" },
  { id: "e2", event_date: "2026-09-25", job_name: "Rainey", reschedule_count: 1, original_scheduled_date: "2026-09-23" },
];
const fieldReports = [
  { post_id: "p1", job_date: "2026-09-20", message: "Glass in", photo_urls: ["a.jpg", "b.jpg"] },
  { post_id: "p2", job_date: "2026-09-21", message: "Touch-up", photo_urls: ["c.jpg"] },
];
const notes = [
  { id: "n1", job_id: "j1", note_date: "2026-09-22", body: "Called super", interaction_type: "call", created_date: "2026-09-22T15:00:00Z" },
  { id: "n2", job_id: "j1", note_date: "2026-09-22", body: "Photos", attachments: ["d.jpg"], completion: "complete", created_date: "2026-09-22T09:00:00Z" },
];
const files = [
  { id: "f1", name: "Plans.pdf", mime_type: "application/pdf", modified_at: "2026-09-19T10:00:00Z" },
  { id: "f2", name: "IMG_1.JPG", mime_type: "image/jpeg", modified_at: "2026-09-24T10:00:00Z" },
  { id: "f3", name: "takeoff.xlsx", mime_type: "application/vnd.ms-excel", modified_at: "" },
];

test("history merges every kind of interaction by date", () => {
  const h = buildJobHistory({ events, rows: [], notes, fieldReports, files });
  const kinds = h.map((e) => e.kind).sort();
  assert.deepEqual(kinds, ["change", "file", "file", "note", "note", "report", "visit", "visit"]);
  const visit = h.find((e) => e.kind === "visit" && e.date === "2026-09-20");
  assert.equal(visit.reports.length, 1, "same-day report folds into the visit");
  assert.deepEqual(visit.groups, ["visits", "reports"]);
});

test("counts and filters by interaction", () => {
  const h = buildJobHistory({ events, rows: [], notes, fieldReports, files });
  assert.deepEqual(historyCounts(h), { all: 8, visits: 3, reports: 3, notes: 1, files: 2 });
  const notesOnly = groupHistoryByDay(h, "notes");
  assert.equal(notesOnly.length, 1);
  assert.equal(notesOnly[0].items[0].note.id, "n1");
});

test("days are newest first and each day reads in order", () => {
  const days = groupHistoryByDay(buildJobHistory({ events, rows: [], notes, fieldReports, files }));
  assert.equal(days[0].date, "2026-09-25");
  const sep22 = days.find((d) => d.date === "2026-09-22");
  assert.deepEqual(sep22.items.map((i) => i.note.id), ["n2", "n1"]);
});

test("folder files split into plans and photos", () => {
  const { plans, photos, other } = splitFolderFiles(files);
  assert.deepEqual(plans.map((f) => f.id), ["f1"]);
  assert.deepEqual(photos.map((f) => f.id), ["f2"]);
  assert.deepEqual(other.map((f) => f.id), ["f3"]);
});

test("recent site photos are newest first and deduped", () => {
  const h = buildJobHistory({ events, rows: [], notes, fieldReports, files });
  assert.deepEqual(recentSitePhotos(h).map((p) => p.url), ["d.jpg", "c.jpg", "a.jpg", "b.jpg"]);
});

test("live updates only reload for this job", () => {
  assert.equal(touchesJob({ type: "create", data: { job_id: "j1" } }, ["j1", "j2"]), true);
  assert.equal(touchesJob({ type: "create", data: { job_id: "zz" } }, ["j1"]), false);
  assert.equal(touchesJob({ type: "delete", id: "n1", data: {} }, ["j1"], ["n1"]), true);
  assert.equal(interactionLabel("call"), "Phone call");
  assert.equal(interactionLabel(undefined), "Note");
});
