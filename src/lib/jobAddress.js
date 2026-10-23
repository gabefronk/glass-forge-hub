import { base44 } from "@/api/base44Client";

// Manager edit of the canonical job-site address. The address is the job's
// stable identity: whitespace-collapsed, empty means "no site on file yet"
// (null). Every manager save marks address_manual, including an intentional
// clear, so the calendar ingest neither replaces a manager-set address nor
// refills one a manager cleared.
export function cleanJobAddress(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

export async function updateJobAddress(job, next) {
  const address = cleanJobAddress(next) || null;
  if ((job.address || null) === address && job.address_manual) return job;
  await base44.entities.Jobs.update(job.id, { address, address_manual: true });
  return { ...job, address, address_manual: true };
}
