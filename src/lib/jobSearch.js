// Shared job-search matching + tiered ranking for the Jobs list. Pure: no
// entity reads, no writes. JobsHub uses jobMatchesSearch for inclusion and
// jobSearchTier for ranking, so "which jobs match" and "how they rank" share
// one normalization rule and can never disagree.
//
// Tiers (only while the query is nonempty; empty query matches all at tier 0):
//   0  record id exact or starts-with  (most specific; preserved from the
//      original matcher so typing a job id still ranks that record first)
//   1  canonical/display job name starts-with the query
//   2  canonical/display job name contains the query (substring)
//   3  an alias contains the query      (aliases are already part of search)
//   4  builder / customer_name contains the query (true builder/customer TEXT
//      fields on the Jobs record — never inferred from contacts/messages, no
//      link creation, no mutation). A builder query like "newco" finds a job
//      whose canonical_name is "Phil Chadwick - Retro" but whose builder is
//      "Newco". Ranks below name/aliases, above address-only.
//   5  address / PO / OE contains the query (other searchable fields)
// A job whose best tier is NO_MATCH_TIER is not a match. The Jobs list keeps
// its selected sort (Last visit by default) WITHIN each tier; the tier only
// reorders groups so a name match ranks above an address-only match.

export const NO_MATCH_TIER = Infinity;

// Normalize for matching: lowercase, collapse internal whitespace runs to a
// single space, trim. Applied to both the query and every field value so
// "SANDY  -  Eagle" and "Sandy - Eagle" compare equal.
function norm(value) {
  return String(value == null ? "" : value).toLowerCase().replace(/\s+/g, " ").trim();
}

export function jobSearchTier(job, query) {
  const q = norm(query);
  if (!q) return 0;
  // Record ids carry no whitespace, so a plain lowercase compare is exact.
  const id = String(job?.id || "").toLowerCase();
  if (id === q || id.startsWith(q)) return 0;
  const name = norm(job?.canonical_name);
  if (name.startsWith(q)) return 1;
  if (name.includes(q)) return 2;
  const aliases = Array.isArray(job?.aliases) ? job.aliases : [];
  for (const a of aliases) {
    if (norm(a).includes(q)) return 3;
  }
  // True builder/customer text fields on the Jobs record. Null/missing fields
  // norm to "" and never match. No contact/message inference, no link creation.
  for (const b of [job?.builder, job?.customer_name]) {
    if (norm(b).includes(q)) return 4;
  }
  const others = [job?.address, ...(job?.po_numbers || []), ...(job?.oe_numbers || [])];
  for (const o of others) {
    if (norm(o).includes(q)) return 5;
  }
  return NO_MATCH_TIER;
}

export function jobMatchesSearch(job, query) {
  return jobSearchTier(job, query) !== NO_MATCH_TIER;
}