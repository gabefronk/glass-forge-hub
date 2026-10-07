// Regression for the Jobs list search-ranking fix (branch jobs-search-ranking).
// Typing a query like SANDY must rank a job whose name starts with SANDY above
// jobs that only match on address, while preserving the selected sort (Last
// visit by default) WITHIN each tier and leaving the empty-query order
// untouched. Pure unit tests — no live data, no function invokes.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { jobMatchesSearch, jobSearchTier, NO_MATCH_TIER } from "../src/lib/jobSearch.js";
import { sortJobGroups, buildJobsOverview } from "../src/lib/jobsOverview.js";

// Mirror JobsHub: a group's tier is the best tier across its members, and a
// nonempty query re-sorts the already-sorted groups by tier (stable), so the
// selected sort survives inside every tier.
function rankGroups(groups, stats, sort, q) {
  const sorted = sortJobGroups(groups, stats, sort);
  if (!q) return sorted;
  const tierOf = (g) => g.members.reduce((best, m) => Math.min(best, jobSearchTier(m, q)), NO_MATCH_TIER);
  return [...sorted].sort((a, b) => tierOf(a) - tierOf(b));
}
const tierOf = (g, q) => g.members.reduce((best, m) => Math.min(best, jobSearchTier(m, q)), NO_MATCH_TIER);

// Build groups + stats from a flat job list (no fee lines / events needed for
// ranking tests; buildJobsOverview tolerates null evidence).
function overview(jobs, opts = {}) {
  return buildJobsOverview({ jobs, feeLines: opts.feeLines || [], events: opts.events || null, notes: opts.notes || null, serviceByJob: null, today: opts.today || "2026-10-07" });
}

// Fixture note: "Sandywood Cove" STARTS WITH "sandy" so it is tier 1, not a
// substring. To exercise the true substring tier (2) we use "The Sandywood Cove".
const sandyJobs = [
  { id: "job-eagle", canonical_name: "SANDY - EAGLE MOUNTAIN", address: "123 Eagle Mountain Dr", created_date: "2026-09-01T00:00:00Z" },
  { id: "job-addr1", canonical_name: "Daybreak - Lot 41", address: "456 Sandy Ridge Rd", created_date: "2026-09-25T00:00:00Z" },
  { id: "job-addr2", canonical_name: "Omar Retro Job", address: "789 Sandy Utah Ln", created_date: "2026-09-20T00:00:00Z" },
  { id: "job-sub", canonical_name: "The Sandywood Cove", address: "12 Canyon Dr", created_date: "2026-09-15T00:00:00Z" },
];

test("SANDY: tier 1 starts-with, tier 2 substring, tier 4 address-only — in that order", () => {
  const { groups, stats } = overview(sandyJobs);
  // Explicit per-job tiers (product semantics, not test wishful thinking).
  assert.equal(jobSearchTier(sandyJobs[0], "sandy"), 1, "SANDY - EAGLE MOUNTAIN starts-with sandy → tier 1");
  assert.equal(jobSearchTier(sandyJobs[3], "sandy"), 2, "The Sandywood Cove contains sandy (not starts-with) → tier 2");
  assert.equal(jobSearchTier(sandyJobs[1], "sandy"), 4, "Daybreak address-only sandy → tier 4");
  assert.equal(jobSearchTier(sandyJobs[2], "sandy"), 4, "Omar address-only sandy → tier 4");
  // Ranked order: tier 1, then tier 2, then the two tier-4 jobs in their within-tier (Last-visit) order.
  const ranked = rankGroups(groups, stats, "last", "sandy").map((g) => g.job.canonical_name);
  assert.deepEqual(ranked, ["SANDY - EAGLE MOUNTAIN", "The Sandywood Cove", "Daybreak - Lot 41", "Omar Retro Job"]);
});

test("Sandywood Cove (no 'The') is genuinely tier 1 starts-with, and within-tier order is preserved", () => {
  // "Sandywood Cove" starts with "sandy" → tier 1, alongside "SANDY - EAGLE MOUNTAIN".
  // Both are tier 1, so the selected sort decides between them (no tier reordering).
  assert.equal(jobSearchTier({ canonical_name: "Sandywood Cove" }, "sandy"), 1, "starts-with → tier 1");
  assert.equal(jobSearchTier({ canonical_name: "The Sandywood Cove" }, "sandy"), 2, "substring → tier 2");
  const jobs = [
    { id: "eagle", canonical_name: "SANDY - EAGLE MOUNTAIN", address: "1 Eagle Dr", created_date: "2026-09-01T00:00:00Z" },
    { id: "wood", canonical_name: "Sandywood Cove", address: "2 Canyon Dr", created_date: "2026-09-20T00:00:00Z" },
  ];
  const { groups, stats } = overview(jobs);
  // Both tier 1; with "last" sort and no visits, newest created_date wins → wood (09-20) before eagle (09-01).
  const ranked = rankGroups(groups, stats, "last", "sandy").map((g) => g.job.id);
  assert.deepEqual(ranked, ["wood", "eagle"], "within tier 1 the selected (Last-visit) order is preserved");
  // And the plain sortJobGroups order for the same sort is identical (tiering did not disturb it).
  assert.deepEqual(ranked, sortJobGroups(groups, stats, "last").map((g) => g.job.id));
});

test("SANDY: coverage unchanged — all 4 Sandy-matching jobs still present", () => {
  const { groups } = overview(sandyJobs);
  const q = "sandy";
  const matches = (j) => jobMatchesSearch(j, q);
  const matched = groups.filter((g) => g.members.some(matches));
  assert.equal(matched.length, 4, "no Sandy-matching job is dropped by the tier change");
});

test("case and spacing do not change ranking or inclusion", () => {
  const { groups, stats } = overview(sandyJobs);
  const lower = rankGroups(groups, stats, "last", "sandy").map((g) => g.job.id);
  const upper = rankGroups(groups, stats, "last", "SANDY").map((g) => g.job.id);
  const spaced = rankGroups(groups, stats, "last", "  sandy  ").map((g) => g.job.id);
  assert.deepEqual(lower, upper, "case-insensitive");
  assert.deepEqual(lower, spaced, "outer whitespace trimmed");
  // Internal whitespace collapse: "SANDY  -  EAGLE" matches the starts-with tier.
  assert.equal(jobSearchTier({ canonical_name: "Sandy - Eagle Mountain" }, "SANDY  -  EAGLE"), 1);
});

test("aliases rank as tier 3, above address-only, below name substring", () => {
  const jobs = [
    { id: "a", canonical_name: "Daybreak - Lot 41", address: "1 Sandy Rd", created_date: "2026-09-25T00:00:00Z" },
    { id: "b", canonical_name: "Canyon House", aliases: ["Sandy Ridge Residence"], address: "10 Canyon Dr", created_date: "2026-09-01T00:00:00Z" },
  ];
  const { groups, stats } = overview(jobs);
  const ranked = rankGroups(groups, stats, "last", "sandy").map((g) => g.job.id);
  // Alias match (b, tier 3) ranks above address-only (a, tier 4).
  assert.deepEqual(ranked, ["b", "a"]);
  assert.equal(jobSearchTier(jobs[1], "sandy"), 3);
  assert.equal(jobSearchTier(jobs[0], "sandy"), 4);
});

test("group tier is the BEST tier across its members (group-best-member)", () => {
  // A presentation group with two members: one matches only on address (tier 4),
  // the other on name starts-with (tier 1). The group's tier is the min = 1, so
  // the whole group ranks in tier 1, above a tier-2-only group.
  const groupBest = {
    id: "g-best", job: { id: "g-best", canonical_name: "SANDY - EAGLE MOUNTAIN", created_date: "2026-09-01T00:00:00Z" },
    members: [
      { id: "m-addr", canonical_name: "Some Other Name", address: "456 Sandy Ridge Rd", created_date: "2026-09-01T00:00:00Z" },
      { id: "m-name", canonical_name: "SANDY - EAGLE MOUNTAIN", address: "1 Eagle Dr", created_date: "2026-09-01T00:00:00Z" },
    ],
    memberIds: ["m-addr", "m-name"], merged: false, mergeReason: "", review: [],
  };
  const groupSub = {
    id: "g-sub", job: { id: "g-sub", canonical_name: "The Sandywood Cove", created_date: "2026-09-20T00:00:00Z" },
    members: [{ id: "g-sub", canonical_name: "The Sandywood Cove", address: "2 Canyon Dr", created_date: "2026-09-20T00:00:00Z" }],
    memberIds: ["g-sub"], merged: false, mergeReason: "", review: [],
  };
  assert.equal(jobSearchTier(groupBest.members[0], "sandy"), 4, "address-only member is tier 4");
  assert.equal(jobSearchTier(groupBest.members[1], "sandy"), 1, "name starts-with member is tier 1");
  assert.equal(tierOf(groupBest, "sandy"), 1, "group tier is the best (min) of its members");
  assert.equal(tierOf(groupSub, "sandy"), 2, "substring-only group is tier 2");
  const groups = [groupSub, groupBest];
  const stats = {};
  const ranked = rankGroups(groups, stats, "last", "sandy").map((g) => g.id);
  assert.deepEqual(ranked, ["g-best", "g-sub"], "tier-1 group ranks above tier-2 group regardless of member order");
});

test("within-tier order matches sortJobGroups for each chosen sort (name / next / last)", () => {
  // All four jobs are tier 1 (name starts-with "sandy"), so tiering is a no-op
  // and the ranked order must equal sortJobGroups for each sort.
  const jobs = [
    { id: "j1", canonical_name: "SANDY - ALPHA", address: "1 A St", created_date: "2026-09-01T00:00:00Z" },
    { id: "j2", canonical_name: "Sandy - Beta", address: "2 B St", created_date: "2026-09-20T00:00:00Z" },
    { id: "j3", canonical_name: "SANDY GAMMA", address: "3 C St", created_date: "2026-09-10T00:00:00Z" },
    { id: "j4", canonical_name: "Sandy Delta", address: "4 D St", created_date: "2026-09-15T00:00:00Z" },
  ];
  const feeLines = [
    { id: "f1", job_id: "j1", job_date: "2026-09-02", source: "probuild", labor_amt: 100, fee_pct: 0.1, fee_amt: 10, job_name_raw: "SANDY - ALPHA", job_name_norm: "sandy - alpha", match_confidence: "high", written_by: "probuild" },
    { id: "f2", job_id: "j2", job_date: "2026-09-21", source: "probuild", labor_amt: 100, fee_pct: 0.1, fee_amt: 10, job_name_raw: "Sandy - Beta", job_name_norm: "sandy - beta", match_confidence: "high", written_by: "probuild" },
    { id: "f3", job_id: "j3", job_date: "2026-10-05", source: "probuild", labor_amt: 100, fee_pct: 0.1, fee_amt: 10, job_name_raw: "SANDY GAMMA", job_name_norm: "sandy gamma", match_confidence: "high", written_by: "probuild" },
    { id: "f4", job_id: "j4", job_date: "2026-10-12", source: "probuild", labor_amt: 100, fee_pct: 0.1, fee_amt: 10, job_name_raw: "Sandy Delta", job_name_norm: "sandy delta", match_confidence: "high", written_by: "probuild" },
  ];
  const { groups, stats } = overview(jobs, { feeLines, events: [], notes: [], today: "2026-10-07" });
  for (const sort of ["name", "next", "last", "recent"]) {
    const ranked = rankGroups(groups, stats, sort, "sandy").map((g) => g.job.id);
    const plain = sortJobGroups(groups, stats, sort).map((g) => g.job.id);
    assert.deepEqual(ranked, plain, `sort "${sort}" within tier 1 equals sortJobGroups`);
  }
});

test("PO and OE matches are tier 4 (other searchable fields) and stay included", () => {
  const jobs = [
    { id: "po", canonical_name: "Canyon House", address: "10 Main St", po_numbers: ["PO-7788"], created_date: "2026-09-01T00:00:00Z" },
    { id: "oe", canonical_name: "Ridge Estate", address: "20 Hill Dr", oe_numbers: ["OE-9911"], created_date: "2026-09-20T00:00:00Z" },
    { id: "nomatch", canonical_name: "Daybreak - Lot 5", address: "30 Other Ln", created_date: "2026-09-10T00:00:00Z" },
  ];
  assert.equal(jobSearchTier(jobs[0], "po-7788"), 4, "PO substring → tier 4");
  assert.equal(jobSearchTier(jobs[1], "oe-9911"), 4, "OE substring → tier 4");
  assert.equal(jobSearchTier(jobs[2], "po-7788"), NO_MATCH_TIER, "no PO/OE/name/address match → no match");
  const { groups, stats } = overview(jobs);
  // JobsHub filters to matching groups before the tiered sort; mirror that here.
  const q = "po-7788";
  const matched = groups.filter((g) => g.members.some((m) => jobMatchesSearch(m, q)));
  assert.equal(matched.length, 1, "only the PO-matching job is included for a PO query");
  const ranked = rankGroups(matched, stats, "last", q).map((g) => g.job.id);
  assert.deepEqual(ranked, ["po"]);
  assert.equal(jobMatchesSearch(jobs[2], q), false, "non-matching job is excluded");
});

test("empty query is unchanged — no tiering, selected sort preserved", () => {
  const { groups, stats } = overview(sandyJobs);
  const noTier = sortJobGroups(groups, stats, "last");
  const viaRank = rankGroups(groups, stats, "last", "");
  assert.deepEqual(viaRank.map((g) => g.job.id), noTier.map((g) => g.job.id), "empty query does not reorder");
  for (const j of sandyJobs) assert.equal(jobMatchesSearch(j, ""), true);
  assert.equal(jobSearchTier(sandyJobs[0], ""), 0);
});

test("selected sort ties: within a tier the Last-visit order survives", () => {
  const jobs = [
    { id: "old", canonical_name: "SANDY - ALPHA", address: "1 A St", created_date: "2026-09-01T00:00:00Z" },
    { id: "new", canonical_name: "SANDY - BETA", address: "2 B St", created_date: "2026-09-20T00:00:00Z" },
  ];
  const feeLines = [
    { id: "f1", job_id: "old", job_date: "2026-09-05", source: "probuild", labor_amt: 100, fee_pct: 0.1, fee_amt: 10, job_name_raw: "SANDY - ALPHA", job_name_norm: "sandy - alpha", match_confidence: "high", written_by: "probuild" },
    { id: "f2", job_id: "new", job_date: "2026-09-18", source: "probuild", labor_amt: 100, fee_pct: 0.1, fee_amt: 10, job_name_raw: "SANDY - BETA", job_name_norm: "sandy - beta", match_confidence: "high", written_by: "probuild" },
  ];
  const { groups, stats } = buildJobsOverview({ jobs, feeLines, events: [], notes: [], serviceByJob: null, today: "2026-10-07" });
  const ranked = rankGroups(groups, stats, "last", "sandy").map((g) => g.job.id);
  assert.deepEqual(ranked, ["new", "old"], "within tier 1, Last-visit order preserved (newer visit first)");
});

test("record id exact / starts-with is tier 0 (most specific)", () => {
  const job = { id: "job-record-12345", canonical_name: "Canyon House", address: "10 Main St" };
  assert.equal(jobSearchTier(job, "job-record-12345"), 0, "id exact");
  assert.equal(jobSearchTier(job, "job-rec"), 0, "id starts-with");
  assert.equal(jobSearchTier(job, "record-123"), NO_MATCH_TIER, "id is not a substring match (preserved)");
});

test("other example names: 'canyon' name match beats address-only 'canyon'", () => {
  const jobs = [
    { id: "x", canonical_name: "Canyon House", address: "1 Other St", created_date: "2026-09-01T00:00:00Z" },
    { id: "y", canonical_name: "Daybreak - Lot 5", address: "99 Canyon Rim Dr", created_date: "2026-09-25T00:00:00Z" },
  ];
  const { groups, stats } = overview(jobs);
  const ranked = rankGroups(groups, stats, "last", "canyon").map((g) => g.job.id);
  assert.deepEqual(ranked, ["x", "y"], "name substring (tier 2) above address-only (tier 4)");
});

test("JobsHub delegates inclusion to jobMatchesSearch and ranks via jobSearchTier", () => {
  const src = readFileSync(new URL("../src/pages/JobsHub.jsx", import.meta.url), "utf8");
  assert.match(src, /import \{ jobMatchesSearch, jobSearchTier, NO_MATCH_TIER \} from "@\/lib\/jobSearch";/);
  assert.match(src, /jobSearchTier\(m, q\)/);
  assert.match(src, /if \(!q\) return sorted;/);
});