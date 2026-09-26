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
//   * MERGE: same customer AND same normalized job name, when the records have
//     at most one street address in their address fields (name-only records
//     beside the one with the real address) and at most one window quote.
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

  // 1b. Same customer + same job name, where the records agree on at most one
  // street address from the address FIELD and at most one window quote. This is
  // the common ProBuild / calendar case: a name-only record ("Pulte Homes - 338
  // Sunset Flats", no builder or address) beside the record with the real street
  // address. Groups already flagged for conflicting street types or quotes stay out.
  {
    const conflicted = new Set(flags.keys());
    const parent = new Map(groups.map((g) => [g.id, g.id]));
    const find = (id) => { while (parent.get(id) !== id) { parent.set(id, parent.get(parent.get(id))); id = parent.get(id); } return id; };
    const facts = new Map(); // root id -> { addrs:Set, quotes:Set }
    for (const g of groups) {
      const addrs = new Set();
      const quotes = new Set();
      for (const m of g.members) {
        const a = info.get(m.id).address;
        if (a && a.source === "address") addrs.add(`${a.street}|${a.unit}`);
        if (m.source_window_quote_id) quotes.add(m.source_window_quote_id);
      }
      facts.set(g.id, { addrs, quotes });
    }
    const byName = new Map();
    for (const g of groups) {
      if (conflicted.has(g.id)) continue;
      const keys = new Set();
      for (const m of g.members) {
        const { customer, name } = info.get(m.id);
        if (customer && name) keys.add(`${customer}|${name}`);
      }
      for (const k of keys) { if (!byName.has(k)) byName.set(k, []); byName.get(k).push(g.id); }
    }
    for (const ids of byName.values()) {
      for (let i = 1; i < ids.length; i++) {
        const a = find(ids[0]);
        const b = find(ids[i]);
        if (a === b) continue;
        const fa = facts.get(a);
        const fb = facts.get(b);
        const addrs = new Set([...fa.addrs, ...fb.addrs]);
        const quotes = new Set([...fa.quotes, ...fb.quotes]);
        if (addrs.size > 1 || quotes.size > 1) continue; // real conflict: leave for review
        parent.set(b, a);
        facts.set(a, { addrs, quotes });
      }
    }
    const byRoot = new Map();
    for (const g of groups) { const r = find(g.id); if (!byRoot.has(r)) byRoot.set(r, []); byRoot.get(r).push(g); }
    if ([...byRoot.values()].some((list) => list.length > 1)) {
      const kept = [];
      for (const list of byRoot.values()) {
        if (list.length === 1) { kept.push(list[0]); continue; }
        const members = [...list.flatMap((g) => g.members)].sort(byAge);
        kept.push({ id: members[0].id, job: members[0], members, memberIds: members.map((m) => m.id), merged: true, mergeReason: "Same customer and job name; the records don't disagree on address", review: [] });
      }
      groups.length = 0;
      groups.push(...kept);
    }
  }

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
