import { base44 } from "@/api/base44Client";
import { renamePatch } from "@/lib/jobNames";

export { renamePatch, planMatchesJob } from "@/lib/jobNames";

export async function renameJob(job, nextName) {
  const patch = renamePatch(job, nextName);
  if (patch.canonical_name === job.canonical_name) return job;
  await base44.entities.Jobs.update(job.id, patch);
  return { ...job, ...patch };
}
