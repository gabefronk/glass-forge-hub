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

// Build groups + stats from a flat job list (no fee lines / events needed for
// ranking tests; buildJobsOverview tolerates null evidence).
function overview(jobs) {
  return buildJobsOverview({ jobs, feeLines: [], events: null, notes: null, serviceByJob: null, today: "2026-10-07" });
}

const sandyJobs = [
  { id: "job-eagle", canonical_name: "SANDY - EAGLE MOUNTAIN", address: "123 Eagle Mountain Dr", created_date: "2026-09-01T00:00:00Z" },
  { id: "job-addr1", canonical_name: "Daybreak - Lot 41", address: "456 Sandy Ridge Rd", created_date: "2026-09-25T00:00:00Z" },
  { id: "job-addr2", canonical_name: "Omar Retro Job", address: "789 Sandy Utah Ln", created_date: "2026-09-20T00:00:00Z" },
  { id: "job-sub", canonical_name: "Sandywood Cove", address: "12 Canyon Dr", created_date: "2026-09-15T00:00:00Z" },
];

test("SANDY: name starts-with ranks above address-only and name substring", () => {
  const { groups, stats } = overview(sandyJobs);
  const ranked = rankGroups(groups, stats, "last", "sandy");
  const names = ranked.map((g) => g.job.canonical_name);
  // Tier 1 (name starts-with SANDY) first, then tier 2 (substring), then tier 4 (address-only).
  assert.equal(names[0], "SANDY - EAGLE MOUNTAIN", "name starts-with SANDY ranks #1");
  // The two address-only Sandy jobs and the Sandywood substring job rank below the starts-with job.
  assert.ok(names.indexOf("SANDY - EAGLE MOUNTAIN") < names.indexOf("Daybreak - Lot 41"));
  assert.ok(names.indexOf("SANDY - EAGLE MOUNTAIN") < names.indexOf("Omar Retro Job"));
  // Sandywood (substring, tier 2) ranks above the address-only matches (tier 4).
  assert.ok(names.indexOf("Sandywood Cove") < names.indexOf("Daybreak - Lot 41"));
  assert.ok(names.indexOf("Sandywood Cove") < names.indexOf("Omar Retro Job"));
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

test("empty query is unchanged — no tiering, selected sort preserved", () => {
  const { groups, stats } = overview(sandyJobs);
  const noTier = sortJobGroups(groups, stats, "last");
  const viaRank = rankGroups(groups, stats, "last", "");
  assert.deepEqual(viaRank.map((g) => g.job.id), noTier.map((g) => g.job.id), "empty query does not reorder");
  // Every job matches an empty query.
  for (const j of sandyJobs) assert.equal(jobMatchesSearch(j, ""), true);
  assert.equal(jobSearchTier(sandyJobs[0], ""), 0);
});

test("selected sort ties: within a tier the Last-visit order survives", () => {
  // Two name starts-with jobs with different last visits: the more recent
  // visit stays first inside tier 1 (Last visit sort).
  const jobs = [
    { id: "old", canonical_name: "SANDY - ALPHA", address: "1 A St", created_date: "2026-09-01T00:00:00Z" },
    { id: "new", canonical_name: "SANDY - BETA", address: "2 B St", created_date: "2026-09-20T00:00:00Z" },
  ];
  // Give each a fee line so they have a "last visit": new has a later visit.
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
  // Static source guard: the page imports both helpers and applies tiering only when q is nonempty.
  const src = readFileSync(new URL("../src/pages/JobsHub.jsx", import.meta.url), "utf8");
  assert.match(src, /import \{ jobMatchesSearch, jobSearchTier, NO_MATCH_TIER \} from "@\/lib\/jobSearch";/);
  assert.match(src, /jobSearchTier\(m, q\)/);
  assert.match(src, /if \(!q\) return sorted;/);
});