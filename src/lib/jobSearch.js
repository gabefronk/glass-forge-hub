export function jobMatchesSearch(job, query) {
  const q = String(query || "").trim().toLowerCase();
  if (!q) return true;
  const id = String(job?.id || "").toLowerCase();
  if (id === q || id.startsWith(q)) return true;
  const fields = [job?.canonical_name, ...(job?.aliases || []), job?.address, ...(job?.po_numbers || []), ...(job?.oe_numbers || [])];
  return fields.some(value => String(value || "").toLowerCase().includes(q));
}
