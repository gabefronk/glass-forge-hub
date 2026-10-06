// Shared job-match guard: normalization + STRONG/MEDIUM/WEAK scoring used by
// the manual "New job" flow (AddJobDialog), the ProBuild auto-create path
// (fetchProbuildPosts) and the job merge tool. Pure, no imports, so it runs in
// both the frontend bundle and backend functions.
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

// "way" is NOT stripped: it is frequently part of a meaningful street name
// (e.g. "Smart Way"), and stripping it conflates distinct streets. The other
// suffixes are safe to remove because they rarely appear inside a street name.
const STREET_SUFFIX_WORDS = new Set([
  "lane", "ln", "drive", "dr", "street", "st", "road", "rd", "court", "ct",
  "avenue", "ave", "circle", "cir", "loop", "blvd", "pkwy", "parkway",
  "trail", "trl", "place", "pl",
]);

const NAME_STOP_WORDS = new Set([
  "glass", "window", "windows", "door", "doors", "pickup", "pick", "up",
  "install", "res", "reorder", "ready", "unit", "bldg", "building", "ya", "li",
]);

const NAME_PREFIXES = /^(ready|done|pickup|delivery):\s*/i;

// normAddress: lowercase, text before first comma, strip punctuation, remove
// street-suffix words, collapse spaces. Empty or <=5 chars counts as "no address".
export function normAddress(a) {
  if (!a) return "";
  let s = String(a).toLowerCase();
  const comma = s.indexOf(",");
  if (comma > -1) s = s.slice(0, comma);
  s = s.replace(/[^a-z0-9\s]/g, " ");
  s = s.split(/\s+/).filter((w) => w && !STREET_SUFFIX_WORDS.has(w)).join(" ");
  // Empty or <=5 chars counts as "no address", but a bare house number ("123")
  // is a valid short address even though it is <=5 chars.
  if (!s) return "";
  return s.length <= 5 && !/^\d+$/.test(s) ? "" : s;
}

// normName: lowercase, strip a leading ready:/done:/pickup:/delivery:, strip
// punctuation, remove stop words, collapse spaces.
export function normName(n) {
  if (!n) return "";
  let s = String(n).toLowerCase().replace(NAME_PREFIXES, "");
  s = s.replace(/[^a-z0-9\s]/g, " ");
  s = s.split(/\s+/).filter((w) => w && !NAME_STOP_WORDS.has(w)).join(" ");
  return s;
}

// Numbers of 2-5 digits found in a string (used to require a shared lot/unit
// number between two similarly-named jobs).
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

// Score one candidate against a target. Both are objects with canonical_name,
// address and po_numbers. Returns "STRONG" | "MEDIUM" | "WEAK" | null.
export function scoreJobMatch(target, candidate) {
  const na = normName(target.canonical_name);
  const nb = normName(candidate.canonical_name);
  const aa = normAddress(target.address);
  const ab = normAddress(candidate.address);

  // Both addresses present and different: never match (overrides everything).
  if (aa && ab && aa !== ab) return null;

  // STRONG
  if (aa && aa === ab && na && na === nb) return "STRONG";
  if (sharedPo(target, candidate)) return "STRONG";

  // MEDIUM — same address, different name
  if (aa && aa === ab && na !== nb) return "MEDIUM";

  // MEDIUM — name subset + shared words + shared number + no address conflict
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

  // WEAK — same name, at least one address blank
  if (na && na === nb && (!aa || !ab)) return "WEAK";

  return null;
}

// findJobMatches: score a target against a list of jobs. The caller is
// responsible for excluding is_sample / merged_into jobs before calling.
// Returns { strong, medium, weak } arrays of the matching job records.
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

// Convenience for callers that already hold a jobs array: filter to jobs that
// are eligible to match against (not a sample, not merged into another job).
export function eligibleJobs(jobs) {
  return (jobs || []).filter((j) => j && !j.is_sample && !j.merged_into);
}