export function normalizeJobText(value) {
  return String(value || "").trim().replace(/\s+/g, " ");
}

export function normalizeMatchValue(value) {
  return normalizeJobText(value).toLocaleLowerCase();
}

export function newJobPayload(values = {}) {
  const canonical_name = normalizeJobText(values.canonical_name);
  const builder = normalizeJobText(values.builder);
  const address = normalizeJobText(values.address);
  const po = normalizeJobText(values.po_number);
  const oe = normalizeJobText(values.oe_number);
  return {
    canonical_name,
    ...(builder ? { builder } : {}),
    ...(address ? { address } : {}),
    ...(po ? { po_numbers: [po] } : {}),
    ...(oe ? { oe_numbers: [oe] } : {}),
  };
}

export function findDuplicateJobs(jobs = [], values = {}) {
  const address = normalizeMatchValue(values.address);
  const po = normalizeMatchValue(values.po_number);
  const oe = normalizeMatchValue(values.oe_number);
  if (!address && !po && !oe) return [];

  return jobs.filter((job) => {
    if (address && normalizeMatchValue(job.address) === address) return true;
    if (po && (job.po_numbers || []).some((number) => normalizeMatchValue(number) === po)) return true;
    return Boolean(oe && (job.oe_numbers || []).some((number) => normalizeMatchValue(number) === oe));
  });
}
