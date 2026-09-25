// Conservative cross-linking helpers. A label is automatically linked only when
// its normalized full value identifies exactly one permanent Jobs record.
export function normalizeJobLabel(value) {
  return String(value || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

export function exactJobCandidates({ job_name = "", builder = "", quote_id = "" } = {}, jobs = []) {
  const name = normalizeJobLabel(job_name);
  const builderKey = normalizeJobLabel(builder);
  const quote = String(quote_id || "").trim();
  const candidates = (jobs || []).filter((job) => {
    if (quote && String(job.source_window_quote_id || "") === quote) return true;
    if (!name) return false;
    const names = [job.canonical_name, ...(job.aliases || [])].map(normalizeJobLabel).filter(Boolean);
    if (!names.includes(name)) return false;
    return !builderKey || !job.builder || normalizeJobLabel(job.builder) === builderKey;
  });
  const evidence = [quote && `quote ${quote}`, name && `name “${job_name}”`, builderKey && `builder “${builder}”`].filter(Boolean);
  return { candidates, evidence };
}

export function matchExactJob(input, jobs) {
  const { candidates, evidence } = exactJobCandidates(input, jobs);
  if (candidates.length === 1) return { status: "matched", job_id: candidates[0].id, candidate_job_ids: [candidates[0].id], evidence };
  return {
    status: "needs_review",
    reason: candidates.length ? "multiple exact jobs share this identity" : "no exact Hub job identity found",
    candidate_job_ids: candidates.map((job) => job.id),
    evidence,
  };
}

export function ownerConfirmedJobPatch(record, job, confirmedAt) {
  if (!job?.id) throw new Error("A permanent job id is required.");
  return {
    job_id: job.id,
    job_match: { ...(record?.job_match || {}), status: "owner_confirmed", job_id: job.id, owner_confirmed_at: confirmedAt },
    status: record?.status === "needs_review" ? "draft" : record?.status,
    ...(job.canonical_name ? { job_name: job.canonical_name } : {}),
  };
}
