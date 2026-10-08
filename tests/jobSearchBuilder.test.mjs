// Regression for builder/customer-name search on the Jobs list. A query like
// "newco" or "holmes" must return jobs whose true Jobs.builder / Jobs.customer_name
// text field matches, even when canonical_name is something else entirely
// (e.g. "Phil Chadwick - Retro" with builder "Newco"). Pure unit tests — no
// live data, no function invokes, no writes. Mirrors the grounded sample rows
// read from the Jobs entity (builder field).
import test from "node:test";
import assert from "node:assert/strict";
import { jobMatchesSearch, jobSearchTier, NO_MATCH_TIER } from "../src/lib/jobSearch.js";
import { sortJobGroups, buildJobsOverview } from "../src/lib/jobsOverview.js";

function rankGroups(groups, stats, sort, q) {
  const sorted = sortJobGroups(groups, stats, sort);
  if (!q) return sorted;
  const tierOf = (g) => g.members.reduce((best, m) => Math.min(best, jobSearchTier(m, q)), NO_MATCH_TIER);
  return [...sorted].sort((a, b) => tierOf(a) - tierOf(b));
}
const tierOf = (g, q) => g.members.reduce((best, m) => Math.min(best, jobSearchTier(m, q)), NO_MATCH_TIER);
function overview(jobs) {
  return buildJobsOverview({ jobs, feeLines: [], events: null, notes: null, serviceByJob: null, today: "2026-10-07" });
}

test("Newco: a job whose name has no 'newco' but whose builder is 'Newco' matches 'newco' at tier 4", () => {
  // Grounded sample: id 6ac68d24023169bbb1c62451, canonical_name "Phil Chadwick - Retro", builder "Newco".
  const job = { id: "6ac68d24023169bbb1c62451", canonical_name: "Phil Chadwick - Retro", builder: "Newco" };
  assert.equal(jobMatchesSearch(job, "newco"), true, "builder field reveals newco");
  assert.equal(jobSearchTier(job, "newco"), 4, "builder match is tier 4");
  assert.equal(jobSearchTier(job, "Newco"), 4, "case-insensitive");
  assert.equal(jobSearchTier(job, "  newco  "), 4, "outer whitespace trimmed");
});

test("Newco: an unrelated job with no builder/customer/address match is excluded", () => {
  const unrelated = { id: "x", canonical_name: "Daybreak - Lot 5", address: "30 Other Ln", builder: "Holmes" };
  assert.equal(jobMatchesSearch(unrelated, "newco"), false, "Holmes-builder job is not a Newco match");
  assert.equal(jobSearchTier(unrelated, "newco"), NO_MATCH_TIER);
});

test("Newco: a name match on a DIFFERENT job is not stolen by a Newco-builder job — name ranks above builder", () => {
  const jobs = [
    { id: "name-hit", canonical_name: "Newco Summit", address: "1 A St", created_date: "2026-09-01T00:00:00Z" },
    { id: "builder-hit", canonical_name: "Phil Chadwick - Retro", address: "2 B St", builder: "Newco", created_date: "2026-09-20T00:00:00Z" },
  ];
  const { groups, stats } = overview(jobs);
  const ranked = rankGroups(groups, stats, "last", "newco").map((g) => g.job.id);
  // Name starts-with (tier 1) ranks above builder-only (tier 4).
  assert.deepEqual(ranked, ["name-hit", "builder-hit"]);
  assert.equal(jobSearchTier(jobs[0], "newco"), 1);
  assert.equal(jobSearchTier(jobs[1], "newco"), 4);
});

test("Holmes variant: case-insensitive partial builder names all match (Holmes / HOLMES HOMES / holmes)", () => {
  // Grounded samples: builder "Holmes", "Holmes Homes", "HOLMES HOMES".
  const jobs = [
    { id: "h1", canonical_name: "407 oquirrh west", builder: "Holmes" },
    { id: "h2", canonical_name: "326 lakeview", builder: "Holmes Homes" },
    { id: "h3", canonical_name: "109", builder: "HOLMES HOMES", customer_name: "HOLMES HOMES" },
  ];
  for (const q of ["holmes", "Holmes", "HOLMES", "holmes homes", "HOLMES HOMES"]) {
    for (const j of jobs) assert.equal(jobMatchesSearch(j, q), true, `${j.id} matches "${q}"`);
  }
  // "holmes" partial-matches builder "Holmes Homes" (substring) at tier 4.
  assert.equal(jobSearchTier(jobs[1], "holmes"), 4);
  // customer_name also counts as a builder/customer text field.
  assert.equal(jobSearchTier({ id: "c", canonical_name: "Nope", customer_name: "Holmes Homes" }, "holmes"), 4);
});

test("Holmes: a job whose name AND builder both lack 'holmes' is excluded", () => {
  const unrelated = { id: "x", canonical_name: "Canyon House", address: "10 Main St", builder: "Newco", customer_name: "Someone Else" };
  assert.equal(jobMatchesSearch(unrelated, "holmes"), false);
  assert.equal(jobSearchTier(unrelated, "holmes"), NO_MATCH_TIER);
});

test("group-member builder match: a group whose member carries builder 'Newco' matches 'newco' even if the primary job name does not", () => {
  // Mirrors JobsHub: a presentation group's tier is the best tier across members.
  const group = {
    id: "g", job: { id: "g", canonical_name: "Phil Chadwick - Retro", created_date: "2026-09-01T00:00:00Z" },
    members: [
      { id: "m1", canonical_name: "Phil Chadwick - Retro", address: "1 A St", builder: "Newco", created_date: "2026-09-01T00:00:00Z" },
    ],
    memberIds: ["m1"], merged: false, mergeReason: "", review: [],
  };
  assert.equal(tierOf(group, "newco"), 4, "group inherits builder tier from its member");
  assert.equal(jobMatchesSearch(group.members[0], "newco"), true);
});

test("builder tier ranks above address-only (tier 4 < tier 5)", () => {
  const jobs = [
    { id: "addr", canonical_name: "Daybreak - Lot 41", address: "10 Newco Ridge Rd", created_date: "2026-09-25T00:00:00Z" },
    { id: "bld", canonical_name: "Phil Chadwick - Retro", address: "2 B St", builder: "Newco", created_date: "2026-09-01T00:00:00Z" },
  ];
  const { groups, stats } = overview(jobs);
  const ranked = rankGroups(groups, stats, "last", "newco").map((g) => g.job.id);
  // builder-only (tier 4) ranks above address-only (tier 5).
  assert.deepEqual(ranked, ["bld", "addr"]);
  assert.equal(jobSearchTier(jobs[0], "newco"), 5, "address-only newco → tier 5");
  assert.equal(jobSearchTier(jobs[1], "newco"), 4, "builder newco → tier 4");
});

test("null / missing builder & customer_name never crash and never match a builder query", () => {
  const job = { id: "n", canonical_name: "Canyon House", address: "10 Main St" };
  assert.equal(jobSearchTier(job, "newco"), NO_MATCH_TIER);
  // Empty string / null / undefined builder all norm to "" — no false match.
  for (const b of [null, undefined, "", "   "]) {
    assert.equal(jobSearchTier({ id: "z", canonical_name: "X", builder: b }, "newco"), NO_MATCH_TIER);
  }
});

test("empty query is unchanged — no tiering, all included at tier 0", () => {
  const jobs = [
    { id: "a", canonical_name: "Phil Chadwick - Retro", builder: "Newco", created_date: "2026-09-01T00:00:00Z" },
    { id: "b", canonical_name: "Holmes - 407", builder: "Holmes", created_date: "2026-09-20T00:00:00Z" },
  ];
  const { groups, stats } = overview(jobs);
  const noTier = sortJobGroups(groups, stats, "last").map((g) => g.job.id);
  const viaRank = rankGroups(groups, stats, "last", "").map((g) => g.job.id);
  assert.deepEqual(viaRank, noTier, "empty query does not reorder");
  for (const j of jobs) {
    assert.equal(jobMatchesSearch(j, ""), true);
    assert.equal(jobSearchTier(j, ""), 0);
  }
});

test("name-first relevance ranking is unchanged when a builder field also happens to match the name", () => {
  // A job whose name starts-with "holmes" is tier 1 even though its builder also
  // contains "holmes" — the name tier wins (checked first), so ranking is stable.
  const job = { id: "h", canonical_name: "Holmes - 407 Oquirrh West", builder: "Holmes" };
  assert.equal(jobSearchTier(job, "holmes"), 1, "name starts-with wins over builder");
  // Substring name (tier 2) also wins over builder (tier 4).
  assert.equal(jobSearchTier({ id: "x", canonical_name: "The Holmes Project", builder: "Holmes" }, "holmes"), 2);
});

test("JobsHub placeholder mentions builder", () => {
  // Guards the user-facing copy requirement without coupling to live data.
  const src = require("node:fs").readFileSync(new URL("../src/pages/JobsHub.jsx", import.meta.url), "utf8");
  assert.match(src, /placeholder="Search job, builder, address, PO"/);
});