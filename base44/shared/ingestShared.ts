import { computeLaborAmt, computeFeeAmt, extractLaborAmount } from "./billingCore.js";
import { createJobIndex, resolveJob, planJobMatches, pendingIdResolver, draftRecord, OWN_COMPANY_PREFIX, isOwnCompany } from "./jobIdentity.js";
export { computeLaborAmt, computeFeeAmt, extractLaborAmount, pendingIdResolver, draftRecord };
// Shared ingest helpers used by both fetchCalendarEvents and fetchProbuildPosts.
// Never copy this logic into a function — import it.

// Normalize a raw job name to a canonical comparison key.
export function normalizeJobName(raw) {
  if (!raw) return "";
  let s = String(raw).toLowerCase().trim();
  s = s.replace(OWN_COMPANY_PREFIX, "");
  s = s.replace(/^#\d+\s*/, "");
  s = s.replace(/\([^)]*\)/g, " ");
  s = s.replace(/\bcash\s+account\b\s*$/, "");
  s = s.replace(/[.,;:!?\-–—]+$/, "");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a) return b.length;
  if (!b) return a.length;
  const m = a.length, n = b.length;
  let prev = Array.from({ length: n + 1 }, (_, j) => j);
  let curr = new Array(n + 1).fill(0);
  for (let i = 1; i <= m; i++) {
    curr[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      curr[j] = Math.min(prev[j] + 1, curr[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, curr] = [curr, prev];
  }
  return prev[n];
}

export function similarity(a, b) {
  if (!a && !b) return 1;
  const max = Math.max(a.length, b.length);
  if (max === 0) return 1;
  return 1 - levenshtein(a, b) / max;
}

// Extract a BFS purchase order number from free text.
const PO_RE_1 = /PO#?\s*:?\s*#?\s*(\d{5,})/gi;
const PO_RE_2 = /PO#\s+[A-Z][^\d]{0,30}[-:]?\s*(\d{5,})/gi;
export function extractPO(text) {
  if (!text) return null;
  PO_RE_1.lastIndex = 0;
  let m = PO_RE_1.exec(text);
  if (m) return m[1];
  PO_RE_2.lastIndex = 0;
  m = PO_RE_2.exec(text);
  return m ? m[1] : null;
}

// Extract an order element number from free text.
const OE_RE_1 = /OE:\s*(\d{6,}-\d{2,})/gi;
const OE_RE_2 = /OE\s+(\d{6,}-\d{2,})/gi;
const OE_RE_3 = /(?:^|\n)\s*(\d{7,8}-\d{2})/g;
export function extractOE(text) {
  if (!text) return null;
  OE_RE_1.lastIndex = 0;
  let m = OE_RE_1.exec(text);
  if (m) return m[1];
  OE_RE_2.lastIndex = 0;
  m = OE_RE_2.exec(text);
  if (m) return m[1];
  OE_RE_3.lastIndex = 0;
  m = OE_RE_3.exec(text);
  return m ? m[1] : null;
}

// Normalize an address for comparison. Both sides are reduced to a canonical
// abbreviated form: street types (Street→st, Loop→lp, Hill→hl, etc.),
// directionals (East→e, North→n), unit/suite markers stripped, punctuation
// removed, and city/state/ZIP/country dropped (everything after the first
// comma). So "677 E Silver Hl Lp, Hideout, UT 84036, USA" and
// "677 East Silver Hill Loop" both become "677 e silver hl lp".
export function normalizeAddress(addr) {
  if (!addr) return "";
  let s = String(addr).toLowerCase().trim();
  // Keep only the street portion — drop city/state/ZIP/country after first comma
  const commaIdx = s.indexOf(",");
  if (commaIdx > -1) s = s.slice(0, commaIdx).trim();
  // Street type abbreviations → canonical short form
  s = s.replace(/\bstreet\b/g, "st").replace(/\bavenue\b/g, "ave")
       .replace(/\bboulevard\b/g, "blvd").replace(/\bdrive\b/g, "dr")
       .replace(/\blane\b/g, "ln").replace(/\broad\b/g, "rd")
       .replace(/\bplace\b/g, "pl").replace(/\bcourt\b/g, "ct")
       .replace(/\bcircle\b/g, "cir").replace(/\bparkway\b/g, "pkwy")
       .replace(/\bloop\b/g, "lp").replace(/\bhill\b/g, "hl")
       .replace(/\bhighway\b/g, "hwy").replace(/\btrail\b/g, "trl")
       .replace(/\bterrace\b/g, "ter");
  // Directionals → single letter
  s = s.replace(/\beast\b/g, "e").replace(/\bsouth\b/g, "s")
       .replace(/\bnorth\b/g, "n").replace(/\bwest\b/g, "w");
  // Strip unit/suite markers
  s = s.replace(/\b(?:unit|suite|ste)\s+#?\d*\b/g, "");
  // Strip punctuation
  s = s.replace(/[,.#]/g, " ");
  // Strip ZIP (fallback when no comma)
  s = s.replace(/\b\d{5}(?:-\d{4})?\b/g, "");
  // Strip state/country (fallback)
  s = s.replace(/\but\b/g, " ").replace(/\busa\b/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

// Virtual meeting locations that are NOT real addresses.
const VIRTUAL_RE = /microsoft teams|zoom|google meet|meet\.google|virtual|teleconference|video call|online meeting/i;

// Pickup / will-call / shop-drop stops are day logistics, not a job site. A bare
// vendor or warehouse venue is NOT rejected on its own - a training or pickup
// visit legitimately happens at the vendor. What makes a location logistics is
// the event's intent (ETA/pickup/will-call/ready/order in the event name) or an
// explicit pickup/shop instruction in the location text. A "deliver/bring to X"
// segment names the day's real destination and wins, unless X is the shop. The
// raw calendar location still lands on the event's source_location, so the day's
// directions stay on the visit where they belong.
const PICKUP_INTENT_RE = /\bwill[- ]?call\b|\bpick[\s-]?up\b/i;
const VENDOR_LOC_RE = /\bamsco\b|\bbuilders firstsource\b/i;
const SHOP_DEST_RE = /\b(?:gabriel'?s|our|the|my|his)\s+shop\b|\bback\s+to\s+(?:the\s+|gabriel'?s\s+)?shop\b/i;
const LOGISTICS_EVENT_RE = /\b(?:eta|pick[\s-]?up|will[- ]?call|ready|arrival|arriving|order)\b/i;
const DELIVER_TO_RE = /\b(?:deliver(?:y|ing)?|drop(?:ping)?\s*off|bring(?:ing)?|take(?:n|ing)?)\b[^.\n]*?\bto\b[:\s]+([^.\n]{3,})/i;

// The day's delivery/drop destination inside a mixed logistics location, else null.
export function deliveryDestination(loc) {
  const m = String(loc || '').match(DELIVER_TO_RE);
  return m ? m[1].trim() : null;
}

// The job-site portion of a calendar location, or null when it is only a
// logistics stop. Mixed "pickup at vendor, deliver to X" yields X (never the
// shop). A bare vendor venue passes unless the event itself is logistics
// (ETA/pickup/ready/order), so training and work venues at a vendor survive.
export function jobSiteFromLocation(loc, summary = '') {
  const s = String(loc || '').trim();
  if (!s || VIRTUAL_RE.test(s)) return null;
  const dest = deliveryDestination(s);
  if (dest) return SHOP_DEST_RE.test(dest) ? null : dest;
  if (PICKUP_INTENT_RE.test(s) || SHOP_DEST_RE.test(s)) return null;
  if (VENDOR_LOC_RE.test(s) && summary && LOGISTICS_EVENT_RE.test(String(summary))) return null;
  return s;
}

export function isLogisticsLocation(loc, summary = '') {
  return jobSiteFromLocation(loc, summary) === null;
}

// Extract a job site address. Priority: Google Calendar location field (its
// job-site portion), then "Address:" label in description. Virtual meetings and
// logistics stops never become a job's address; the job keeps its own stable
// identity and a vendor/shop address would also poison customer + address
// identity matching.
export function extractAddress(location, description, summary = '') {
  const site = jobSiteFromLocation(location, summary);
  if (site) return site;
  if (description) {
    const m = description.match(/address\s*:\s*(.+?)(?:\n|$)/i);
    if (m) {
      const d = jobSiteFromLocation(m[1], summary);
      if (d) return d;
    }
  }
  return null;
}

// Additive-only job patch from a matched calendar event: appends new PO/OE ids,
// fills an EMPTY address with the event's job-site portion and an empty builder.
// Never touches canonical_name or aliases (the job name is stable) and never
// overwrites an owner-edited value - a manager-set address is sync-proof, and a
// manager-CLEARED address (address_manual with no address) stays cleared.
export function accumulateJobPatch(u, ev) {
  if (ev.po_number && !u.po_numbers.includes(ev.po_number)) u.po_numbers.push(ev.po_number);
  if (ev.oe_number && !u.oe_numbers.includes(ev.oe_number)) u.oe_numbers.push(ev.oe_number);
  if (!u.address && !u.address_manual && ev.address) {
    const site = jobSiteFromLocation(ev.address, ev.job_name || '');
    if (site) u.address = site;
  }
  if (!u.builder && ev.builder) u.builder = ev.builder;
  return u;
}

// Extract the builder/GC name from a job name — the part before the first
// dash, after stripping "YA -". e.g. "X3 Homes - 29 Skyridge" → "X3 Homes".
export function extractBuilder(jobName) {
  if (!jobName) return null;
  // Case-insensitive: "YA - Pulte Home - …" must yield "Pulte Home", not "YA".
  let s = String(jobName).replace(OWN_COMPANY_PREFIX, "").trim();
  const m = s.match(/^([A-Z][A-Za-z0-9&\s.'-]+?)\s*[-–—]\s*/);
  if (m && m[1].trim() && !isOwnCompany(m[1])) return m[1].trim();
  return null;
}

// No identity match and no address/PO/OE: a near-identical name to an existing
// job is flagged for review; anything else is a new job.
function nameSimilarityMatch(normName, jobs) {
  let best = 0;
  for (const j of jobs) {
    const candidates = [j.canonical_name, ...(j.aliases || [])].map(normalizeJobName).filter(Boolean);
    for (const c of candidates) {
      const sim = similarity(normName, c);
      if (sim > best) best = sim;
    }
  }
  if (best >= 0.85) {
    return { job_id: null, match_confidence: "unmatched", needs_review: true, autoCreate: false, reason: "similar_name", candidate_job_ids: [] };
  }
  return { job_id: null, match_confidence: "unmatched", needs_review: false, autoCreate: true, reason: "new_name", candidate_job_ids: [] };
}

// jobs: array of Jobs records (id, created_date, canonical_name, aliases, builder,
// po_numbers, oe_numbers, address). Match hierarchy (see jobIdentity.js):
// 1) ProBuild project link / PO / OE, 2) customer + normalized address,
// 3) exact name or alias, 4) new identity or name similarity. A match always
// resolves to the canonical (oldest) record of its customer + address.
// extra: { rawName, builder, linkedJobId }.
// returns { job_id, match_confidence, needs_review, autoCreate, reason, candidate_job_ids }
export function matchJob(normName, jobs, poNumber, oeNumber, address, extra = {}) {
  const index = createJobIndex(jobs, normalizeJobName);
  return resolveJob({ normName, poNumber, oeNumber, address, ...extra }, index) || nameSimilarityMatch(normName, index.list);
}

// One ingestion batch: every item resolved in order against existing jobs plus
// the jobs this batch will create, so repeats of a new customer + address (or
// name / PO) create one job. items: [{ key, normName, rawName, builder, address,
// poNumber, oeNumber, linkedJobId, currentJobId, noCreate }] (see planJobMatches).
// Returns { results: Map(key -> match), drafts: [pending job records] }.
export function planIngestJobs(items, jobs, draftFor) {
  return planJobMatches(items, jobs, {
    normalizeName: normalizeJobName,
    fallback: (item, index) => nameSimilarityMatch(item.normName, index.list),
    draftFor,
  });
}

export const MAN_HOUR_RATE = 100;
export const TRIP_RATE = 75;

// A notes amount is a "pure trip charge" if it's a positive multiple of $75
// but NOT also a multiple of $100. See feeMath.js isTripChargeAmount.
export function isTripChargeAmount(amt) {
  const n = Number(amt);
  return n > 0 && n % TRIP_RATE === 0 && n % MAN_HOUR_RATE !== 0;
}

export function computeProfit(row) {
  if (row.fee_type !== 'profit_split') return 0;
  return (Number(row.sale_price) || 0) - (Number(row.cost) || 0);
}

export function invoiceMonthFromDate(dateStr) {
  if (!dateStr) return "";
  return String(dateStr).slice(0, 7);
}

export function extractTicketSequence(description) {
  if (!description) return null;
  const lines = String(description).split(/\r?\n/);
  let maxSeq = 0;
  for (const line of lines) {
    if (!/labor/i.test(line)) continue;
    const m = line.match(/win(\d*)\b/i);
    if (m) {
      const seq = m[1] ? parseInt(m[1], 10) : 1;
      if (seq > maxSeq) maxSeq = seq;
    }
  }
  return maxSeq > 0 ? maxSeq : null;
}

// Convert HTML to plain text: block-level tags and <br> become newlines,
// remaining tags are stripped, common entities are decoded. Lets downstream
// line-by-line processing (sanitizer, extractors) work on Google Calendar's
// HTML-formatted descriptions.
export function htmlToText(html) {
  if (!html) return '';
  let s = String(html);
  s = s.replace(/<br\s*\/?>/gi, '\n');
  s = s.replace(/<\/p>/gi, '\n');
  s = s.replace(/<\/li>/gi, '\n');
  s = s.replace(/<\/ul>/gi, '\n');
  s = s.replace(/<\/ol>/gi, '\n');
  s = s.replace(/<\/div>/gi, '\n');
  s = s.replace(/<\/h[1-6]>/gi, '\n');
  s = s.replace(/<[^>]+>/g, '');
  s = s.replace(/&amp;/g, '&');
  s = s.replace(/&lt;/g, '<');
  s = s.replace(/&gt;/g, '>');
  s = s.replace(/&quot;/g, '"');
  s = s.replace(/&#39;/g, "'");
  s = s.replace(/&nbsp;/g, ' ');
  s = s.replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

// Detect a profit-split pattern in the event description. A confirmed split
// needs either explicit sale/cost labels, or total/profit/split labels where the
// split matches half of product profit. Ambiguous profit notes stay in review.
export function extractProfitSplit(description) {
  if (!description) return null;
  const lines = String(description).split(/\r?\n/);
  const moneyRe = /\$\s?([\d,]+(?:\.\d{1,2})?)/;
  let salePrice = null;
  let cost = null;
  let profit = null;
  let split = null;
  const roundMoney = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
  const nearlyEqual = (a, b) => Math.abs(roundMoney(a) - roundMoney(b)) <= 0.01;

  for (const line of lines) {
    const label = line.toLowerCase().trim();
    const m = line.match(moneyRe);
    if (!m) continue;
    const amt = Number(m[1].replace(/,/g, ''));
    if (/^(?:project\s+total|sale\s+price|total)\b/.test(label) && salePrice === null) {
      salePrice = amt;
    }
    if (/^(?:package\s+cost|material\s+cost|cost)\b/.test(label) && cost === null) {
      cost = amt;
    }
    if (/^profit\b/.test(label) && profit === null) {
      profit = amt;
    }
    if (/^(?:profit\s+)?split\b/.test(label) && split === null) {
      split = amt;
    }
  }

  if (salePrice !== null && cost !== null && salePrice > cost) {
    return { sale_price: salePrice, cost };
  }
  if (salePrice !== null && profit !== null && split !== null && profit > 0 && nearlyEqual(split, profit * 0.5)) {
    const derivedCost = roundMoney(salePrice - profit);
    if (derivedCost >= 0) return { sale_price: salePrice, cost: derivedCost };
  }
  return null;
}

const CONF_RANK = { unmatched: 0, low: 1, high: 2 };

export function mergeReviewFlags(existing, incoming) {
  // If the incoming row now has a job_id, the match succeeded — clear the
  // flag. Stickiness only applies to rows that are STILL unresolved (no job).
  if (incoming.job_id) {
    return { needs_review: !!incoming.needs_review || incoming.service_review_status === 'review' || !!incoming.pricing_review_reason, match_confidence: 'high' };
  }
  // No job_id — confidence is always "unmatched", never "high".
  const needs_review = !!(existing && existing.needs_review) || !!incoming.needs_review;
  return { needs_review, match_confidence: 'unmatched' };
}

// Additive job fill for an EXISTING billing line that has no job (a line created
// before its job existed, or while its name matched duplicate jobs). Only a confident
// match (match_confidence 'high' to a real job) fills it. A line that already has a
// job, or is superseded, billed or not billable, is never touched (same rule as the
// Unlinked page's planUnlinkedLinks). The job hold clears per mergeReviewFlags: a
// pricing or service review keeps the line held, and a line that was not held is
// never put on hold. Returns the patch, or null.
export function existingLineJobFill(existing, match) {
  if (!existing || existing.job_id || existing.superseded_by || existing.billed_to_bfs || !existing.billable) return null;
  const jobId = match && match.job_id;
  if (!jobId || match.pending || String(jobId).startsWith('pending:') || match.match_confidence !== 'high') return null;
  const flags = mergeReviewFlags(existing, { job_id: jobId, pricing_review_reason: existing.pricing_review_reason, service_review_status: existing.service_review_status });
  return { job_id: jobId, match_confidence: flags.match_confidence, needs_review: !!existing.needs_review && flags.needs_review };
}