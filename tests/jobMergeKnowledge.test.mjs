// Regressions for the JobKnowledge / FieldLibraryProject combine support and the
// paced rate-limit-aware read layer. No live data.
import './support/register-src-alias.mjs';
import test from "node:test";
import assert from "node:assert/strict";
import {
  mergeSourceIntoTarget, reverseMergeLog, makePacedReader,
  LINK_ENTITIES, UNSUPPORTED_LINK_ENTITIES,
} from "../base44/shared/jobMerge.js";
import { movedCounts, movedSummary } from "../src/lib/mergeLogs.js";

const LINK_NAMES = LINK_ENTITIES.map((e) => e.entity);
const NAMES = ["Jobs", "JobMergeLog", ...LINK_NAMES, ...UNSUPPORTED_LINK_ENTITIES];

function makeDb(seed = {}, hooks = {}) {
  const tables = Object.fromEntries(NAMES.map((n) => [n, new Map()]));
  let seq = 0;
  for (const [name, rows] of Object.entries(seed)) for (const r of rows) tables[name].set(r.id, { ...r });
  const match = (rec, q) => Object.entries(q).every(([k, v]) =>
    v && typeof v === "object" && "$in" in v ? v.$in.map(String).includes(String(rec[k])) : rec[k] === v);
  const api = (name) => ({
    async get(id) { const r = tables[name].get(id); return r ? { ...r } : null; },
    async filter(q, o = {}) {
      await hooks.filter?.(name, q, ctx);
      const rows = [...tables[name].values()].filter((r) => match(r, q));
      const lim = o.limit || 500;
      return { items: rows.slice(0, lim).map((r) => ({ id: r.id })), has_more: rows.length > lim, next_cursor: null };
    },
    async updateMany(q, upd) {
      await hooks.updateMany?.(name, q, ctx);
      let n = 0;
      for (const r of tables[name].values()) if (match(r, q)) { Object.assign(r, upd.$set); n++; }
      await hooks.afterUpdateMany?.(name, q, ctx);
      return { updated: n };
    },
    async create(d) { const id = `${name}-${++seq}`; tables[name].set(id, { ...d, id }); return { ...d, id }; },
    async update(id, p) { const r = tables[name].get(id); if (!r) throw new Error("nf"); Object.assign(r, p); return { ...r }; },
  });
  const entities = Object.fromEntries(NAMES.map((n) => [n, api(n)]));
  const ctx = {
    tables,
    onJob(name, jobId) { return [...tables[name].values()].filter((r) => r.job_id === jobId).map((r) => r.id).sort(); },
    log() { return [...tables.JobMergeLog.values()][0]; },
  };
  return { base44: { asServiceRole: { entities } }, ...ctx };
}

const jobs = () => [
  { id: "S", canonical_name: "Beaver - 412" },
  { id: "T", canonical_name: "Summit - 412", po_numbers: ["P1"] },
];
const merge = (db, extra = {}) => mergeSourceIntoTarget(db.base44, {
  sourceId: "S", targetId: "T", actor: "admin@x", now: "2026-10-06T12:00:00Z", today: "2026-10-06", ...extra,
});

// 26 JobKnowledge rows (one per knowledge run) + 1 FieldLibraryProject, each with
// preserved job_name / briefing / context / source_snapshot / external project id.
const knowledgeRows = (jobId) => Array.from({ length: 26 }, (_, i) => ({
  id: `k${i}`, job_id: jobId, run_id: `run-${i}`, job_name: "Beaver - 412",
  status: "complete", briefing: `briefing ${i}`, context: { evidence: [{ lot: "412" }], latest_notes: [{ text: "private" }] },
}));
const libraryProject = (jobId) => ({
  id: "flp1", job_id: jobId, source_key: "probuild:proj-412", source_project_id: "proj-412",
  job_name: "Beaver - 412", name: "Beaver 412 field library", source_snapshot: { posts: 3 },
  report_count: 2, attachment_count: 5,
});

test("26 JobKnowledge + 1 FieldLibraryProject move by exact audited ids; survivor's own records untouched", async () => {
  const db = makeDb({
    Jobs: jobs(),
    JobKnowledge: knowledgeRows("S"),
    FieldLibraryProject: [libraryProject("S"), { id: "flpT", job_id: "T", source_key: "x" }],
    FeeLines: [{ id: "f1", job_id: "S" }, { id: "fT", job_id: "T" }],
  });
  const r = await merge(db);
  assert.equal(r.ok, true);
  assert.equal(r.hidden, true);
  assert.deepEqual(r.relocated_link_ids.job_knowledge.sort(), knowledgeRows("S").map((k) => k.id).sort());
  assert.deepEqual(r.relocated_link_ids.field_library_projects, ["flp1"]);
  assert.equal(r.relocated_link_counts.job_knowledge, 26);
  assert.equal(r.relocated_link_counts.field_library_projects, 1);
  // survivor's own FieldLibraryProject stays put and is never in the moved set
  assert.deepEqual(db.onJob("FieldLibraryProject", "T").sort(), ["flp1", "flpT"]);
  assert.deepEqual(db.onJob("FieldLibraryProject", "S"), []);
  assert.deepEqual(db.onJob("JobKnowledge", "T").sort(), knowledgeRows("S").map((k) => k.id).sort());
  assert.deepEqual(db.onJob("JobKnowledge", "S"), []);
  // audit log records the exact ids
  assert.deepEqual(db.log().relocated_link_ids.job_knowledge.sort(), knowledgeRows("S").map((k) => k.id).sort());
  assert.deepEqual(db.log().relocated_link_ids.field_library_projects, ["flp1"]);
  assert.equal(db.log().status, "complete");
});

test("original job_name, briefing/context, source_snapshot and external project ids are preserved (only job_id moves)", async () => {
  const db = makeDb({ Jobs: jobs(), JobKnowledge: knowledgeRows("S"), FieldLibraryProject: [libraryProject("S")] });
  await merge(db);
  const k0 = db.tables.JobKnowledge.get("k0");
  assert.equal(k0.job_id, "T");
  assert.equal(k0.job_name, "Beaver - 412", "historical job_name preserved");
  assert.equal(k0.briefing, "briefing 0");
  assert.deepEqual(k0.context.evidence, [{ lot: "412" }]);
  assert.equal(k0.run_id, "run-0");
  const flp = db.tables.FieldLibraryProject.get("flp1");
  assert.equal(flp.job_id, "T");
  assert.equal(flp.job_name, "Beaver - 412");
  assert.equal(flp.source_project_id, "proj-412", "external project id preserved");
  assert.equal(flp.source_key, "probuild:proj-412");
  assert.deepEqual(flp.source_snapshot, { posts: 3 });
  assert.equal(flp.report_count, 2, "child-reference counts preserved");
});

test("undo moves the 26 knowledge + 1 library project back to the source; survivor's own stay", async () => {
  const db = makeDb({
    Jobs: jobs(),
    JobKnowledge: knowledgeRows("S"),
    FieldLibraryProject: [libraryProject("S"), { id: "flpT", job_id: "T", source_key: "x" }],
  });
  await merge(db);
  const u = await reverseMergeLog(db.base44, db.log(), { actor: "admin@x" });
  assert.equal(u.ok, true);
  assert.deepEqual(db.onJob("JobKnowledge", "S").sort(), knowledgeRows("S").map((k) => k.id).sort());
  assert.deepEqual(db.onJob("FieldLibraryProject", "S"), ["flp1"]);
  assert.deepEqual(db.onJob("FieldLibraryProject", "T"), ["flpT"]);
  assert.equal(db.tables.Jobs.get("S").merged_into, null);
  assert.equal(db.log().reversed, true);
  // blobs still intact after undo
  assert.equal(db.tables.JobKnowledge.get("k0").context.evidence[0].lot, "412");
  assert.equal(db.tables.FieldLibraryProject.get("flp1").source_project_id, "proj-412");
});

test("transient rate limit recovers: paced reader retries a 429 then succeeds; combine completes", async () => {
  const sleeps = [];
  let throws = 0;
  const db = makeDb({ Jobs: jobs(), JobKnowledge: knowledgeRows("S") }, {
    filter(name) { if (name === "JobKnowledge" && throws++ < 1) { const e = new Error("Too many requests"); e.status = 429; throw e; } },
  });
  const read = makePacedReader(db.base44, { sleep: () => { sleeps.push(1); }, baseBackoffMs: 1, capMs: 2 });
  const r = await merge(db, { read });
  assert.equal(r.ok, true);
  assert.equal(r.relocated_link_counts.job_knowledge, 26);
  assert.equal(sleeps.length, 1, "backed off once then succeeded");
});

test("exhausted rate limit prevents hiding: source stays visible, nothing moved", async () => {
  const sleeps = [];
  const db = makeDb({ Jobs: jobs(), JobKnowledge: knowledgeRows("S") }, {
    filter(name) { if (name === "JobKnowledge") { const e = new Error("Too many requests"); e.status = 429; throw e; } },
  });
  const read = makePacedReader(db.base44, { sleep: () => { sleeps.push(1); }, maxRetries: 2, baseBackoffMs: 1, capMs: 2 });
  const r = await merge(db, { read });
  assert.equal(r.ok, false);
  assert.equal(r.hidden, false);
  assert.equal(db.tables.Jobs.get("S").merged_into, undefined);
  assert.deepEqual(db.onJob("JobKnowledge", "S").sort(), knowledgeRows("S").map((k) => k.id).sort(), "nothing moved");
  assert.equal(sleeps.length, 2, "retried up to maxRetries then failed closed");
  assert.match(r.error, /Could not list this record's links/);
});

test("pagination >500 without a cursor fails closed instead of looping forever", async () => {
  const big = Array.from({ length: 501 }, (_, i) => ({ id: `k${i}`, job_id: "S", run_id: `r${i}`, context: {} }));
  const db = makeDb({ Jobs: jobs(), JobKnowledge: big });
  const r = await merge(db);
  assert.equal(r.ok, false);
  assert.equal(r.hidden, false);
  assert.equal(db.tables.Jobs.get("S").merged_into, undefined);
  assert.match(r.error, /pagination truncated/);
});

test("multi-source pacing: one shared reader serializes all read scans across sources", async () => {
  let inFlight = 0, maxInFlight = 0;
  const db = makeDb({ Jobs: jobs(), JobKnowledge: knowledgeRows("S") }, {
    filter() { inFlight++; maxInFlight = Math.max(maxInFlight, inFlight); },
  });
  // also wrap filter to decrement after settle
  const origFilter = db.base44.asServiceRole.entities.JobKnowledge.filter;
  db.base44.asServiceRole.entities.JobKnowledge.filter = async function (...a) {
    try { return await origFilter.apply(this, a); } finally { inFlight--; }
  };
  const read = makePacedReader(db.base44, { sleep: () => {} });
  // fire many reads concurrently; the reader must serialize them
  await Promise.all(Array.from({ length: 20 }, () => read("JobKnowledge", { job_id: "S" }, { fields: ["id"], limit: 500 })));
  assert.equal(maxInFlight, 1, "reads are serial, never overlapping");
});

test("old logs without the new keys stay compatible in movedCounts / movedSummary", () => {
  const oldLog = {
    audit_version: 1,
    relocated_link_ids: { fee_lines: ["f1"], calendar_events: ["e1"] },
    relocated_link_counts: { fee_lines: 1, calendar_events: 1 },
  };
  const c = movedCounts(oldLog);
  assert.equal(c.fee_lines, 1);
  assert.equal(c.calendar_events, 1);
  assert.equal(c.job_knowledge, 0, "missing new key defaults to 0");
  assert.equal(c.field_library_projects, 0);
  const s = movedSummary(oldLog);
  assert.match(s, /1 visit/);
  assert.match(s, /1 invoice line/);
  assert.doesNotMatch(s, /knowledge/);
  // a new-style log surfaces the new categories
  const newLog = {
    audit_version: 1,
    relocated_link_ids: { job_knowledge: ["k0", "k1"], field_library_projects: ["flp1"] },
  };
  assert.match(movedSummary(newLog), /2 knowledge briefs/);
  assert.match(movedSummary(newLog), /1 field-library project/);
});

test("JobKnowledge and FieldLibraryProject are no longer in UNSUPPORTED_LINK_ENTITIES", () => {
  assert.ok(!UNSUPPORTED_LINK_ENTITIES.includes("JobKnowledge"));
  assert.ok(!UNSUPPORTED_LINK_ENTITIES.includes("FieldLibraryProject"));
  assert.ok(LINK_ENTITIES.some((e) => e.key === "job_knowledge" && e.entity === "JobKnowledge"));
  assert.ok(LINK_ENTITIES.some((e) => e.key === "field_library_projects" && e.entity === "FieldLibraryProject"));
});