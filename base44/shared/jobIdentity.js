// Job identity: which existing Jobs record a new event, visit, appointment or field
// report belongs to. Shared by ingest (fetchCalendarEvents, fetchProbuildPosts),
// resolveFieldReport and the Jobs pages (src/lib/jobDedupe.js), so the record the
// hub shows as a group's head is the record new work attaches to.
//
// Identity = normalized customer (builder) + normalized street address, where the
// unit / lot / building is part of the address. Rules, all deterministic:
//   * Hard IDs first: an owner-confirmed ProBuild project link, then PO, then OE.
//     A hard ID that points at a clearly different customer or address, or PO and
//     OE that point at different jobs, is flagged for review.
//   * Same customer + same street + same unit (a street type may be missing on
//     one side) attaches to the canonical record: the OLDEST matching record
//     (created_date, then id), so it stays stable as duplicates arrive.
//   * Then an exact normalized name / alias, unless the addresses clearly differ.
//   * Weak or conflicting evidence (Dr vs Ct, unit on one side only, a similar
//     street, "Pulte" vs "Pulte Home", several customers at one address, an
//     address match whose customer is unknown, an address with no house number
//     shared with another job, existing duplicates linked to different window
//     quotes) is flagged for review: nothing is attached and nothing is created.
//   * Two different units / lots, or another customer, are different jobs.
// Nothing here writes; callers create at most one job per identity per batch.

const CORP_WORDS = new Set(["inc", "llc", "ltd", "co", "corp", "corporation", "company", "the", "and"]);
const CUSTOMER_SINGULAR = { homes: "home", builders: "builder", companies: "company", communities: "community" };

// Street-type words, abbreviated. A trailing one is split off as the "suffix".
const STREET_TYPES = {
  street: "st", st: "st", avenue: "ave", ave: "ave", av: "ave", boulevard: "blvd", blvd: "blvd",
  drive: "dr", dr: "dr", lane: "ln", ln: "ln", road: "rd", rd: "rd", place: "pl", pl: "pl",
  court: "ct", ct: "ct", circle: "cir", cir: "cir", parkway: "pkwy", pkwy: "pkwy", loop: "lp", lp: "lp",
  highway: "hwy", hwy: "hwy", trail: "trl", trl: "trl", terrace: "ter", ter: "ter", way: "way",
  cove: "cv", cv: "cv",
};
const STREET_SUFFIXES = new Set(Object.values(STREET_TYPES));
// Words that are usually part of the street NAME; abbreviated but never split off.
const NAME_WORDS = {
  north: "n", south: "s", east: "e", west: "w", hill: "hl", ridge: "rdg", point: "pt",
  heights: "hts", crossing: "xing", canyon: "cyn", hollow: "holw", mountain: "mtn",
};
const DIRECTIONALS = new Set(["n", "s", "e", "w"]);
const UNIT_WORDS = { unit: "unit", apt: "unit", ste: "unit", suite: "unit", lot: "lot", bldg: "bldg", building: "bldg" };

const DASH_SPLIT = /\s+[-–—]+\s+|\s*[–—]\s*/;

function words(s) {
  return String(s || "").toLowerCase().replace(/\([^)]*\)/g, " ").split(/[^a-z0-9#]+/).filter(Boolean);
}

export function normalizeCustomer(raw) {
  return words(raw)
    .map((w) => w.replace(/#/g, ""))
    .filter((w) => w && !CORP_WORDS.has(w))
    .map((w) => CUSTOMER_SINGULAR[w] || w)
    .join(" ");
}

function cleanName(name) {
  return String(name || "").trim().replace(/^ya\b\s*[-–—]?\s*/i, "").replace(/^#\d+\s*/, "");
}

// Customer (builder) and the rest of the job name after the customer.
export function jobCustomer(job) {
  const name = cleanName(job?.canonical_name);
  // Older calendar syncs stored the "YA" title prefix as the builder; it names no customer.
  const explicit = [job?.builder, job?.customer_name].find((v) => v && normalizeCustomer(v) && normalizeCustomer(v) !== "ya") || "";
  const parts = name.split(DASH_SPLIT);
  if (explicit) {
    const b = String(explicit).trim().toLowerCase();
    const after = name.toLowerCase().startsWith(b) ? name.slice(b.length) : null;
    // "Pulte Home" must not strip the front of "Pulte Homes - …".
    const rest = after !== null && /^(?:$|[\s:–—-])/.test(after)
      ? after.replace(/^[\s:–—-]+/, "")
      : parts.length > 1 ? parts.slice(1).join(" - ") : name;
    return { customer: normalizeCustomer(explicit), rest };
  }
  if (parts.length > 1 && !/^\d/.test(parts[0].trim())) {
    return { customer: normalizeCustomer(parts[0]), rest: parts.slice(1).join(" - ") };
  }
  return { customer: "", rest: name };
}

// Parses "2154 Jordanelle Ridge Dr, Heber City, UT 84032" into comparable parts.
// Returns null unless the text starts with a house number.
export function parseStreetAddress(raw) {
  if (!raw) return null;
  let s = String(raw).toLowerCase().split(",")[0];
  s = s.replace(/\s\d{5}(?:-\d{4})?\s*$/, "").replace(/\s(?:ut|utah|usa)\s*$/, "");
  s = s.replace(/#\s*(\w+)/g, " unit $1");
  const tokens = s.split(/[^a-z0-9]+/).filter(Boolean);
  if (!tokens.length || !/^\d+[a-z]?$/.test(tokens[0])) return null;
  const street = [];
  const unit = [];
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (i > 0 && UNIT_WORDS[t] && tokens[i + 1]) {
      unit.push(`${UNIT_WORDS[t]} ${tokens[i + 1]}`);
      i++;
      continue;
    }
    street.push(i === 0 ? t : (STREET_TYPES[t] || NAME_WORDS[t] || t));
  }
  let suffix = "";
  if (street.length >= 3 && STREET_SUFFIXES.has(street[street.length - 1])) suffix = street.pop();
  if (street.length < 2) return null;
  // First street word, past a leading directional ("100 N Main" → "main").
  const firstWord = street.slice(1).find((w) => !DIRECTIONALS.has(w)) || street[1];
  return { number: street[0], firstWord, street: street.join(" "), suffix, unit: unit.join(" ") };
}

// The address to compare: the address field when it has a house number,
// otherwise the first dash-separated part of the job name that starts with one.
export function jobAddress(job, rest) {
  const fromField = parseStreetAddress(job?.address);
  if (fromField) return { ...fromField, source: "address" };
  for (const part of String(rest || "").split(DASH_SPLIT)) {
    const parsed = parseStreetAddress(part);
    if (parsed) return { ...parsed, source: "name" };
  }
  return null;
}

export function jobNameKey(rest) {
  return words(rest).map((w) => w.replace(/#/g, "")).filter(Boolean).map((w) => STREET_TYPES[w] || NAME_WORDS[w] || w).join(" ");
}

export const byAge = (a, b) =>
  String(a.created_date || "").localeCompare(String(b.created_date || "")) || String(a.id).localeCompare(String(b.id));

export function describeJobInfo(job) {
  const { customer, rest } = jobCustomer(job);
  return { customer, address: jobAddress(job, rest), name: jobNameKey(rest) };
}

// An address field with no house number ("Daybreak Towns, South Jordan") still
// identifies a site. Compared only field-to-field, never against a job name.
function looseAddressKey(raw) {
  if (!raw || parseStreetAddress(raw)) return "";
  const s = String(raw).toLowerCase().split(",")[0].replace(/[^a-z0-9#]+/g, " ").replace(/\s+/g, " ").trim();
  return s.length >= 4 ? s : "";
}

// ── Comparisons ─────────────────────────────────────────────────────────────

// Words too generic to tie two builder names together ("Ivory Home" vs "Holmes Home").
const GENERIC_CUSTOMER_WORDS = new Set(["home", "builder", "construction", "community", "custom", "development", "group", "design", "contractor", "general", "property", "properties", "residential", "build"]);

// Both customers known and sharing no distinctive word ("Pulte" vs "Pulte Home"
// do not conflict; "Ivory Home" vs "Holmes Home" do).
export function customersConflict(a, b) {
  if (!a || !b || a === b) return false;
  const wa = new Set(a.split(" ").filter((w) => !GENERIC_CUSTOMER_WORDS.has(w)));
  return !b.split(" ").some((w) => wa.has(w));
}

// Same street and unit; a street type may be missing on one side.
export function sameAddress(a, b) {
  return !!(a && b) && a.street === b.street && a.unit === b.unit && (!a.suffix || !b.suffix || a.suffix === b.suffix);
}

// Two explicit, different units / lots / buildings: different jobs.
function distinctUnits(a, b) {
  return !!(a.unit && b.unit && a.unit !== b.unit);
}

// Clearly a different place: another house number or street, or another unit.
function addressesClash(a, b) {
  if (!a || !b) return false;
  return a.number !== b.number || a.firstWord !== b.firstWord || distinctUnits(a, b);
}

// ── Index ───────────────────────────────────────────────────────────────────

const push = (map, key, value) => { if (!key) return; if (!map.has(key)) map.set(key, []); map.get(key).push(value); };

// normalizeName: the ingest name normalizer (normalizeJobName), used for exact
// name/alias matches. Jobs can be added later (pending creates in one batch).
export function createJobIndex(jobs, normalizeName = (s) => String(s || "").toLowerCase().trim()) {
  const index = {
    normalizeName, byId: new Map(), info: new Map(), byPO: new Map(), byOE: new Map(),
    byName: new Map(), byNear: new Map(), byLoose: new Map(), list: [],
  };
  index.add = (job) => {
    if (!job || !job.id || index.byId.has(job.id)) return;
    const info = describeJobInfo(job);
    index.byId.set(job.id, job);
    index.info.set(job.id, info);
    index.list.push(job);
    for (const po of job.po_numbers || []) push(index.byPO, String(po), job);
    for (const oe of job.oe_numbers || []) push(index.byOE, String(oe), job);
    const names = new Set([job.canonical_name, ...(job.aliases || [])].map(normalizeName).filter(Boolean));
    for (const n of names) push(index.byName, n, job);
    if (info.address) push(index.byNear, `${info.address.number}|${info.address.firstWord}`, job);
    push(index.byLoose, looseAddressKey(job.address), job);
  };
  for (const j of jobs || []) index.add(j);
  return index;
}

// The canonical record for a job: the oldest record with the same customer and
// address. Returns the job itself when it has no full identity, or when its
// identity group is itself ambiguous (conflicting street types, different
// window quotes) — never redirect on doubtful evidence.
export function canonicalJob(job, index) {
  if (!job) return null;
  const info = index.info.get(job.id) || describeJobInfo(job);
  if (!info.customer || !info.address) return job;
  const group = (index.byNear.get(`${info.address.number}|${info.address.firstWord}`) || []).filter((j) => {
    const other = index.info.get(j.id);
    return other.customer === info.customer && other.address.street === info.address.street && other.address.unit === info.address.unit;
  });
  if (group.length <= 1) return job;
  const suffixes = new Set(group.map((j) => index.info.get(j.id).address.suffix).filter(Boolean));
  const quotes = new Set(group.map((j) => j.source_window_quote_id).filter(Boolean));
  if (suffixes.size > 1 || quotes.size > 1) return job;
  return [...group].sort(byAge)[0];
}

// Distinct canonical records for a list of jobs, oldest first.
function canonicalSet(jobs, index) {
  const seen = new Map();
  for (const j of jobs) { const c = canonicalJob(j, index); seen.set(c.id, c); }
  return [...seen.values()].sort(byAge);
}

// Whether several canonical records could all be the same job (so the oldest
// can be chosen): no customer conflict, no address difference, one window quote.
function compatibleRecords(jobs, index) {
  const quotes = new Set(jobs.map((j) => j.source_window_quote_id).filter(Boolean));
  if (quotes.size > 1) return false;
  for (let i = 0; i < jobs.length; i++) {
    for (let k = i + 1; k < jobs.length; k++) {
      const a = index.info.get(jobs[i].id);
      const b = index.info.get(jobs[k].id);
      if (customersConflict(a.customer, b.customer)) return false;
      if (a.address && b.address && !sameAddress(a.address, b.address)) return false;
    }
  }
  return true;
}

const ids = (jobs) => [...new Set(jobs.map((j) => j.id))].sort();

// ── Resolution ──────────────────────────────────────────────────────────────

// input: { normName, rawName, builder, address, poNumber, oeNumber, linkedJobId }
// Returns { job_id, match_confidence, needs_review, autoCreate, reason, candidate_job_ids }.
export function resolveJob(input, index) {
  const { normName = "", rawName = "", builder = "", address = "", poNumber = "", oeNumber = "", linkedJobId = "" } = input || {};
  const me = describeJobInfo({ canonical_name: rawName || normName, builder, address });
  const attach = (job, reason) => ({ job_id: job.id, match_confidence: "high", needs_review: false, autoCreate: false, reason, candidate_job_ids: [job.id] });
  const review = (reason, candidates = []) => ({ job_id: null, match_confidence: "unmatched", needs_review: true, autoCreate: false, reason, candidate_job_ids: ids(candidates) });
  const create = (reason) => ({ job_id: null, match_confidence: "unmatched", needs_review: false, autoCreate: true, reason, candidate_job_ids: [] });
  const conflictsWithMe = (job) => {
    const info = index.info.get(job.id);
    return customersConflict(me.customer, info.customer) || addressesClash(me.address, info.address);
  };

  // 1. Hard identifiers.
  const linked = linkedJobId ? index.byId.get(linkedJobId) : null;
  if (linked) return attach(canonicalJob(linked, index), "probuild_project_link");
  const poJobs = poNumber ? canonicalSet(index.byPO.get(String(poNumber)) || [], index) : [];
  const oeJobs = oeNumber ? canonicalSet(index.byOE.get(String(oeNumber)) || [], index) : [];
  if (poJobs.length || oeJobs.length) {
    let hard = poJobs.length ? poJobs : oeJobs;
    if (poJobs.length && oeJobs.length) {
      const oeIds = new Set(oeJobs.map((j) => j.id));
      hard = poJobs.filter((j) => oeIds.has(j.id));
      if (!hard.length) return review("po_oe_point_to_different_jobs", [...poJobs, ...oeJobs]);
    }
    const fitting = hard.filter((j) => !conflictsWithMe(j));
    if (!fitting.length) return review("hard_id_conflicts_with_customer_or_address", hard);
    if (fitting.length === 1 || compatibleRecords(fitting, index)) return attach(fitting[0], poJobs.length ? "po_number" : "oe_number");
    return review("hard_id_on_several_jobs", fitting);
  }

  // 2. Customer + normalized house-number address.
  const atAddress = me.address ? index.byNear.get(`${me.address.number}|${me.address.firstWord}`) || [] : [];
  const exact = [];
  const unclear = []; // Dr vs Ct, unit on one side only, a similar street
  const partial = []; // "Pulte" vs "Pulte Home": maybe the same customer
  for (const j of atAddress) {
    const info = index.info.get(j.id);
    if (distinctUnits(me.address, info.address)) continue; // another unit / lot / building
    if (me.customer && info.customer && info.customer !== me.customer) {
      if (!customersConflict(me.customer, info.customer)) partial.push(j);
      continue; // otherwise another customer
    }
    if (sameAddress(me.address, info.address)) exact.push(j);
    else unclear.push(j);
  }
  if (me.customer) {
    const same = exact.filter((j) => index.info.get(j.id).customer === me.customer);
    if (same.length) {
      const canon = canonicalSet(same, index);
      if (canon.length === 1) return attach(canon[0], "customer_and_address");
      return review("existing_duplicates_disagree", canon);
    }
    if (exact.length) return review("address_match_customer_unknown", exact);
  } else if (exact.length) {
    const customers = new Set(exact.map((j) => index.info.get(j.id).customer));
    const canon = canonicalSet(exact, index);
    if (customers.size === 1 && canon.length === 1) return attach(canon[0], "address");
    return review(customers.size > 1 ? "address_shared_by_customers" : "existing_duplicates_disagree", canon);
  }
  if (unclear.length) return review("similar_address", unclear);
  if (partial.length) return review("customer_name_differs", partial);

  // 3. Exact normalized name or alias.
  if (!normName) return review("no_job_name");
  const named = index.byName.get(normName) || [];
  if (named.length) {
    const fitting = canonicalSet(named.filter((j) => !conflictsWithMe(j)), index);
    if (!fitting.length) return review("name_matches_different_address", named);
    if (fitting.length === 1 || compatibleRecords(fitting, index)) return attach(fitting[0], "name");
    return review("name_on_several_jobs", fitting);
  }

  // An address with no house number (a subdivision, or only a city) is too weak
  // to attach on, and too weak to create beside another job that shares it.
  const loose = me.address ? "" : looseAddressKey(address);
  const looseShared = loose ? (index.byLoose.get(loose) || []).filter((j) => !customersConflict(me.customer, index.info.get(j.id).customer)) : [];
  if (looseShared.length) return review("address_without_house_number", looseShared);

  // 4. An unmatched hard identifier, address field or house-number address is a
  //    new job. Name similarity to a different lot/unit must not block it.
  if (poNumber || oeNumber || address || me.address) return create("new_identity");
  return null; // caller decides by name similarity
}

// Plans one ingestion batch. items: [{ key, normName, rawName, builder, address,
// poNumber, oeNumber, linkedJobId, currentJobId, noCreate }] in a deterministic
// order. A job that is to be created is added to the index as a pending record,
// so later items in the same batch attach to it (or are flagged) instead of
// creating a second copy. draftFor(item) returns the new Jobs record.
//   currentJobId: the item's existing billing line already points at this job;
//                 it is kept as-is (existing links are never re-pointed).
//   noCreate:     the item will not be written, so it must not create a job.
export function planJobMatches(items, jobs, { normalizeName, fallback, draftFor } = {}) {
  const index = createJobIndex(jobs, normalizeName);
  const drafts = [];
  const results = new Map();
  for (const item of items) {
    if (item.currentJobId && index.byId.has(item.currentJobId)) {
      results.set(item.key, { job_id: item.currentJobId, match_confidence: "high", needs_review: false, autoCreate: false, reason: "existing_link", candidate_job_ids: [item.currentJobId] });
      continue;
    }
    let m = resolveJob(item, index);
    if (!m) m = fallback ? fallback(item, index) : { job_id: null, match_confidence: "unmatched", needs_review: false, autoCreate: true, reason: "new_name", candidate_job_ids: [] };
    if (m.autoCreate) {
      if (item.noCreate) {
        m = { ...m, autoCreate: false };
      } else {
        const seq = String(drafts.length + 1).padStart(6, "0");
        const draft = { ...(draftFor ? draftFor(item) : { canonical_name: item.normName, aliases: [item.normName] }), id: `pending:${seq}`, created_date: `￿pending:${seq}` };
        drafts.push(draft);
        index.add(draft);
        m = { ...m, job_id: draft.id, match_confidence: "high", autoCreate: false, pending: true, reason: "created" };
      }
    }
    results.set(item.key, m);
  }
  return { results, drafts, index };
}

// Maps pending ids to the records returned by bulkCreate (same order; falls back
// to the canonical name). An unmapped pending id resolves to null (review).
export function pendingIdResolver(drafts, created) {
  const map = new Map();
  const used = new Set();
  drafts.forEach((d, i) => {
    let real = created?.[i];
    if (!real || real.canonical_name !== d.canonical_name || used.has(real.id)) {
      real = (created || []).find((c) => c && c.canonical_name === d.canonical_name && !used.has(c.id));
    }
    if (real?.id) { map.set(d.id, real); used.add(real.id); }
  });
  return (id) => (id && String(id).startsWith("pending:") ? map.get(id)?.id || null : id);
}

// Strips planner-only fields before bulkCreate.
export function draftRecord(draft) {
  const { id: _id, created_date: _created, ...rest } = draft;
  return rest;
}
