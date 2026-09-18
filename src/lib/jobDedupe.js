// Read-only duplicate handling for Jobs records. Nothing here writes, merges or
// deletes a record: it decides how the Jobs pages PRESENT them.
//
// Before ingest matched on customer + address, it auto-created a job whenever a
// name differed and no address/PO match was found, so the same house can exist as
// several records ("Pulte Home - 2154 Jordanelle Ridge" and "Pulte Homes - 2154
// Jordanelle Ridge Dr"). Those records remain. Rules, all deterministic:
//   * MERGE (one visible job): same customer AND same normalized street address
//     (house number, street name, unit/lot), where the only allowed difference is
//     a street type present on one record and missing on the other.
//   * FLAG for review, never merge, when the evidence is weaker or conflicts:
//     - same customer + address but different street types (Dr vs Ct), or
//       different source window quotes;
//     - same customer + house number + first street word, different address;
//     - same customer + same job name but no house-number address to compare.
// The canonical record of a merged group is the oldest (created_date, then id),
// so it stays stable as new duplicates arrive.

// The identity rules (customer, street address with unit/lot, oldest record is
// canonical) live in base44/shared/jobIdentity.js and are shared with ingest, so
// the head of a group here is the record new visits and reports attach to.
import { normalizeCustomer, jobCustomer, parseStreetAddress, jobAddress, describeJobInfo, byAge } from "../../base44/shared/jobIdentity.js";

export { normalizeCustomer, jobCustomer, parseStreetAddress, jobAddress, describeJobInfo };

function suffixLabel(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : "none";
}

// jobs: Jobs records. Returns { groups, groupByJobId } where each group is
// { id, job, members, memberIds, merged, mergeReason, review: [{ reason, jobIds }] }.
export function groupJobs(jobs) {
  const list = (jobs || []).filter((j) => j && j.id);
  const info = new Map(list.map((j) => [j.id, describeJobInfo(j)]));

  // 1. Exact buckets: customer + street (without suffix) + unit.
  const buckets = new Map();
  const singles = [];
  for (const j of list) {
    const { customer, address } = info.get(j.id);
    if (!customer || !address) { singles.push([j]); continue; }
    const key = `${customer}|${address.street}|${address.unit}`;
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push(j);
  }

  const groups = [];
  const flags = new Map(); // group id -> Map(reason -> Set(other group ids))
  // Each pair of groups is flagged once, under the first (most specific) reason.
  const flag = (gid, reason, others) => {
    if (!flags.has(gid)) flags.set(gid, new Map());
    const m = flags.get(gid);
    const seen = new Set([...m.values()].flatMap((s) => [...s]));
    if (!m.has(reason)) m.set(reason, new Set());
    for (const o of others) if (o !== gid && !seen.has(o)) m.get(reason).add(o);
  };

  const makeGroup = (members, mergeReason = "") => {
    const sorted = [...members].sort(byAge);
    const g = { id: sorted[0].id, job: sorted[0], members: sorted, memberIds: sorted.map((m) => m.id), merged: sorted.length > 1, mergeReason, review: [] };
    groups.push(g);
    return g;
  };

  for (const members of buckets.values()) {
    if (members.length === 1) { makeGroup(members); continue; }
    const suffixes = new Set(members.map((m) => info.get(m.id).address.suffix).filter(Boolean));
    const quotes = new Set(members.map((m) => m.source_window_quote_id).filter(Boolean));
    if (suffixes.size > 1 || quotes.size > 1) {
      const reason = suffixes.size > 1
        ? `Same customer and address, but different street types (${[...suffixes].map(suffixLabel).join(" vs ")})`
        : "Same customer and address, but linked to different window quotes";
      const made = members.map((m) => makeGroup([m]));
      for (const g of made) flag(g.id, reason, made.map((x) => x.id));
      continue;
    }
    makeGroup(members, "Same customer and address");
  }
  for (const s of singles) makeGroup(s);

  // 2. Review flags across groups that were NOT merged.
  const near = new Map();
  const names = new Map();
  for (const g of groups) {
    const nearKeys = new Set();
    const nameKeys = new Set();
    for (const m of g.members) {
      const { customer, address, name } = info.get(m.id);
      if (!customer) continue;
      if (address) nearKeys.add(`${customer}|${address.number}|${address.firstWord}`);
      if (name) nameKeys.add(`${customer}|${name}`);
    }
    for (const k of nearKeys) { if (!near.has(k)) near.set(k, new Set()); near.get(k).add(g.id); }
    for (const k of nameKeys) { if (!names.has(k)) names.set(k, new Set()); names.get(k).add(g.id); }
  }
  for (const ids of near.values()) {
    if (ids.size > 1) for (const id of ids) flag(id, "Same customer and house number on a similar street", ids);
  }
  for (const ids of names.values()) {
    if (ids.size > 1) for (const id of ids) flag(id, "Same customer and job name", ids);
  }

  const groupByJobId = new Map();
  for (const g of groups) for (const id of g.memberIds) groupByJobId.set(id, g);
  for (const g of groups) {
    const f = flags.get(g.id);
    if (f) {
      g.review = [...f.entries()]
        .filter(([, ids]) => ids.size > 0)
        .map(([reason, ids]) => {
          const jobIds = [...ids].sort();
          return { reason, jobIds, jobs: jobIds.map((id) => ({ id, name: groupByJobId.get(id)?.job.canonical_name || id })) };
        });
    }
  }
  groups.sort((a, b) => byAge(a.job, b.job));
  return { groups, groupByJobId };
}

// The group for one job id, from a full Jobs list (job page and workspace).
export function groupForJob(jobs, jobId) {
  const { groupByJobId } = groupJobs(jobs);
  return groupByJobId.get(jobId) || null;
}
