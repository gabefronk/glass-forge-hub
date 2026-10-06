// Rename a job for display and search. The old name is kept as an alias so
// calendar events, field reports and plans that carry it still match this job.
export function renamePatch(job, nextName) {
  const name = String(nextName || "").replace(/\s+/g, " ").trim();
  if (!name) throw new Error("Give the job a name.");
  if (name.length > 150) throw new Error("Keep the name under 150 characters.");
  const old = String(job?.canonical_name || "").trim();
  const seen = new Set([name.toLowerCase()]);
  const aliases = [];
  for (const a of [old, ...(job?.aliases || [])]) {
    const t = String(a || "").trim();
    if (!t || seen.has(t.toLowerCase())) continue;
    seen.add(t.toLowerCase());
    aliases.push(t);
  }
  return { canonical_name: name, aliases };
}

// A plan set belongs to the job when its recorded job name is the job's
// current name or any earlier one.
export function planMatchesJob(plan, job) {
  if (!plan || !job) return false;
  if (job.source_window_quote_id && plan.quote_id === job.source_window_quote_id) return true;
  const n = String(plan.job_name || "").trim().toLowerCase();
  return !!n && [job.canonical_name, ...(job.aliases || [])].some((a) => String(a || "").trim().toLowerCase() === n);
}
