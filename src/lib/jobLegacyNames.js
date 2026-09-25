// A legacy name-only record may be shown only when its exact name/alias points
// to this job group and no other Jobs record. Incomplete catalogs fail closed.
export function uniqueLegacyNames(jobs, memberIds) {
  const members = new Set(memberIds);
  const owners = new Map();
  for (const job of jobs || []) {
    if (!job?.id) continue;
    for (const raw of [job.canonical_name, ...(job.aliases || [])]) {
      const name = String(raw || '').trim().toLowerCase();
      if (!name) continue;
      if (!owners.has(name)) owners.set(name, new Set());
      owners.get(name).add(job.id);
    }
  }
  return [...owners].filter(([, ids]) => [...ids].every(id => members.has(id))).map(([name]) => name);
}
