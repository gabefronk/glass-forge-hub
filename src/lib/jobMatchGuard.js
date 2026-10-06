// Frontend twin of base44/shared/jobMatchGuard.js. The platform forbids new
// frontend imports from base44/shared, so this pure copy lives under src/lib
// for the manual "New job" flow. Keep it byte-for-byte in sync with the shared
// backend copy (used by fetchProbuildPosts and the merge tool).
//
// Rules (see the three-prompt spec):
//   normAddress(a): lowercase, text before first comma, strip punctuation,
//     remove street-suffix words, collapse spaces. Empty or <=5 chars = "".
//   normName(n): lowercase, strip a leading ready:/done:/pickup:/delivery:,
//     strip punctuation, remove stop words, collapse spaces.
//   STRONG: same normAddress (non-empty) AND same normName; or a shared
//     po_numbers value (case-insensitive).
//   MEDIUM: same normAddress but different normName; or one normName's words
//     are a subset of the other's, they share >=2 words, they share a number
//     (2-5 digits) from canonical_name, and the addresses do not conflict.
//   WEAK: same normName and at least one address blank.
//   If both addresses are present and different, never match.

const STREET_SUFFIX_WORDS = new Set([
  "lane", "ln", "drive", "dr", "street", "st", "road", "rd", "court", "ct",
  "way", "avenue", "ave", "circle", "cir", "loop", "blvd", "pkwy", "parkway",
  "trail", "trl", "place", "pl",
]);

const NAME_STOP_WORDS = new Set([
  "glass", "window", "windows", "door", "doors", "pickup", "pick", "up",
  "install", "res", "reorder", "ready", "unit", "bldg", "building", "ya", "li",
]);

const NAME_PREFIXES = /^(ready|done|pickup|delivery):\s*/i;

export function normAddress(a) {
  if (!a) return "";
  let s = String(a).toLowerCase();
  const comma = s.indexOf(",");
  if (comma > -1) s = s.slice(0, comma);
  s = s.replace(/[^a-z0-9\s]/g, " ");
  s = s.split(/\s+/).filter((w) => w && !STREET_SUFFIX_WORDS.has(w)).join(" ");
  return s.length <= 5 ? "" : s;
}

export function normName(n) {
  if (!n) return "";
  let s = String(n).toLowerCase().replace(NAME_PREFIXES, "");
  s = s.replace(/[^a-z0-9\s]/g, " ");
  s = s.split(/\s+/).filter((w) => w && !NAME_STOP_WORDS.has(w)).join(" ");
  return s;
}

function numbersIn(s) {
  const set = new Set();
  if (!s) return set;
  const re = /\d{2,5}/g;
  let m;
  while ((m = re.exec(String(s)))) set.add(m[0]);
  return set;
}

function sharedPo(a, b) {
  const pa = (a.po_numbers || []).map((p) => String(p).toLowerCase().trim()).filter(Boolean);
  const pb = (b.po_numbers || []).map((p) => String(p).toLowerCase().trim()).filter(Boolean);
  if (!pa.length || !pb.length) return false;
  const set = new Set(pb);
  return pa.some((p) => set.has(p));
}

export function scoreJobMatch(target, candidate) {
  const na = normName(target.canonical_name);
  const nb = normName(candidate.canonical_name);
  const aa = normAddress(target.address);
  const ab = normAddress(candidate.address);

  if (aa && ab && aa !== ab) return null;

  if (aa && aa === ab && na && na === nb) return "STRONG";
  if (sharedPo(target, candidate)) return "STRONG";

  if (aa && aa === ab && na !== nb) return "MEDIUM";

  if (na && nb) {
    const wa = new Set(na.split(" "));
    const wb = new Set(nb.split(" "));
    const inter = [...wa].filter((w) => wb.has(w));
    const subset = inter.length === wa.size || inter.length === wb.size;
    if (subset && inter.length >= 2) {
      const numsA = numbersIn(target.canonical_name);
      const numsB = numbersIn(candidate.canonical_name);
      if ([...numsA].some((x) => numsB.has(x))) return "MEDIUM";
    }
  }

  if (na && na === nb && (!aa || !ab)) return "WEAK";

  return null;
}

export function findJobMatches(target, jobs) {
  const strong = [], medium = [], weak = [];
  for (const job of jobs || []) {
    const tier = scoreJobMatch(target, job);
    if (tier === "STRONG") strong.push(job);
    else if (tier === "MEDIUM") medium.push(job);
    else if (tier === "WEAK") weak.push(job);
  }
  return { strong, medium, weak };
}

export function eligibleJobs(jobs) {
  return (jobs || []).filter((j) => j && !j.is_sample && !j.merged_into);
}