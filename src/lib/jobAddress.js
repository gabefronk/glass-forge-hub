import { base44 } from "@/api/base44Client";

// Manager edit of the canonical job-site address (owner direction 2026-10-23).
// The address is the job's stable identity: whitespace-collapsed, empty means
// "no site on file yet" (null). The calendar ingest only fills an EMPTY address
// and never overwrites a saved one, so a manager-set address is sync-proof.
export function cleanJobAddress(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export async function updateJobAddress(job, next) {
  const address = cleanJobAddress(next) || null;
  if ((job.address || null) === address) return job;
  await base44.entities.Jobs.update(job.id, { address });
  return { ...job, address };
}
