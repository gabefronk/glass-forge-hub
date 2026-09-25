const ACRONYMS = new Set(["BFS", "OE", "PO", "YA", "UT", "ID"]);
const SMALL_WORDS = new Set(["a", "an", "and", "at", "by", "for", "in", "of", "on", "the", "to"]);
const clean = (value) => String(value ?? "").replace(/[\u2010-\u2015]/g, "-").replace(/\s+/g, " ").trim();

function formatWord(word, index) {
  if (!word) return word;
  const upper = word.toUpperCase();
  if (ACRONYMS.has(upper)) return upper;
  // Keep intentional internal capitalization in proper names (McDonald, iQ).
  if (/[a-z][A-Z]|[A-Z].*[A-Z].*[a-z]/.test(word)) return word;
  if (/^(?:#?\d+[A-Za-z]?|[A-Za-z]+\d+[A-Za-z0-9-]*)$/.test(word)) return word.toUpperCase();
  const lower = word.toLowerCase();
  if (index > 0 && SMALL_WORDS.has(lower)) return lower;
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

function formatPart(part) {
  return part.split(" ").map((token, index) => token.split("/").map((word) => formatWord(word, index)).join("/")).join(" ");
}

// A presentation-safe proposal only. Missing customer/site/scope data is never invented.
export function formatJobDisplayName(value) {
  const input = clean(value);
  if (!input || !/[A-Za-z0-9]/.test(input)) return "";
  return input.replace(/\s*-+\s*/g, " - ").replace(/\s*([,:])\s*/g, "$1 ")
    .split(" - ").map(formatPart).join(" - ").replace(/\s+/g, " ").trim();
}

export function normalizedJobName(value) {
  return clean(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

export function buildNameReviewRows(jobs = []) {
  const existing = new Map();
  for (const job of jobs) {
    const key = normalizedJobName(job?.canonical_name);
    if (key) existing.set(key, (existing.get(key) || []).concat(job.id));
  }
  return jobs.map((job) => {
    const original = clean(job?.canonical_name);
    const proposed = formatJobDisplayName(original);
    const collisionIds = proposed ? (existing.get(normalizedJobName(proposed)) || []).filter((id) => id !== job.id) : [];
    return { job, original, proposed, changed: Boolean(proposed && proposed !== original), ambiguous: !original || !proposed || collisionIds.length > 0, collisionIds };
  });
}

export function jobMatchesSearch(job, query) {
  const q = clean(query).toLowerCase();
  if (!q) return true;
  return [job?.canonical_name, ...(job?.aliases || []), job?.id, job?.address,
    ...(job?.po_numbers || []), ...(job?.bfs_po_numbers || []), ...(job?.oe_numbers || []), ...(job?.ya_po_numbers || [])]
    .some((value) => String(value || "").toLowerCase().includes(q));
}

const ids = (values) => (values || []).map(String).filter(Boolean);

function duplicateEvidence(a, b) {
  const evidence = [];
  if (normalizedJobName(a.canonical_name) && normalizedJobName(a.canonical_name) === normalizedJobName(b.canonical_name)) evidence.push("normalized name");
  if (normalizedJobName(a.address) && normalizedJobName(a.address) === normalizedJobName(b.address)) evidence.push("address");
  if (normalizedJobName(a.customer_name || a.builder) && normalizedJobName(a.customer_name || a.builder) === normalizedJobName(b.customer_name || b.builder)) evidence.push("customer");
  if (ids(a.po_numbers).some((x) => ids(b.po_numbers).includes(x))) evidence.push("BFS PO");
  if (ids(a.oe_numbers).some((x) => ids(b.oe_numbers).includes(x))) evidence.push("OE");
  return evidence;
}

export function buildDuplicateReviewPairs(jobs = []) {
  const pairs = [];
  for (let i = 0; i < jobs.length; i++) for (let j = i + 1; j < jobs.length; j++) {
    const evidence = duplicateEvidence(jobs[i], jobs[j]);
    const excluded = ids(jobs[i].duplicate_exclusions).includes(String(jobs[j].id));
    if (evidence.length >= 2 && !excluded) pairs.push({ a: jobs[i], b: jobs[j], evidence });
  }
  return pairs;
}
