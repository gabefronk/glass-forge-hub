import { computeLaborAmt, computeFeeAmt, extractLaborAmount } from "./billingCore.js";
export { computeLaborAmt, computeFeeAmt, extractLaborAmount };
// Shared ingest helpers used by both fetchCalendarEvents and fetchProbuildPosts.
// Never copy this logic into a function — import it.

// Normalize a raw job name to a canonical comparison key.
export function normalizeJobName(raw) {
  if (!raw) return "";
  let s = String(raw).toLowerCase().trim();
  s = s.replace(/^ya\b\s*[-–—]?\s*/, "");
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

// Extract a job site address. Priority: Google Calendar location field
// (filtered for virtual meetings), then "Address:" label in description.
export function extractAddress(location, description) {
  if (location && location.trim() && !VIRTUAL_RE.test(location)) return location.trim();
  if (description) {
    const m = description.match(/address\s*:\s*(.+?)(?:\n|$)/i);
    if (m && m[1].trim() && !VIRTUAL_RE.test(m[1])) return m[1].trim();
  }
  return null;
}

// Extract the builder/GC name from a job name — the part before the first
// dash, after stripping "YA -". e.g. "X3 Homes - 29 Skyridge" → "X3 Homes".
export function extractBuilder(jobName) {
  if (!jobName) return null;
  let s = String(jobName).replace(/^ya\b\s*[-–—]?\s*/, "").trim();
  const m = s.match(/^([A-Z][A-Za-z0-9&\s.'-]+?)\s*[-–—]\s*/);
  if (m && m[1].trim()) return m[1].trim();
  return null;
}

// jobs: array of Jobs records (id, canonical_name, aliases, po_numbers, oe_numbers, address)
// Match hierarchy: 1) PO number, 2) OE number, 3) Address, 4) Name normalization + alias.
// poNumber/oeNumber/address are optional — pass null/undefined for name-only matching.
// returns { job_id, match_confidence, needs_review, autoCreate }
export function matchJob(normName, jobs, poNumber, oeNumber, address) {
  // 1. PO number match — hard identifier, highest confidence
  if (poNumber) {
    for (const j of jobs) {
      if ((j.po_numbers || []).includes(poNumber)) {
        return { job_id: j.id, match_confidence: "high", needs_review: false, autoCreate: false };
      }
    }
  }
  // 2. OE number match — hard identifier
  if (oeNumber) {
    for (const j of jobs) {
      if ((j.oe_numbers || []).includes(oeNumber)) {
        return { job_id: j.id, match_confidence: "high", needs_review: false, autoCreate: false };
      }
    }
  }
  // 3. Address match — a job's address doesn't change even when its name
  //    is written five different ways. Normalized comparison.
  if (address) {
    const normAddr = normalizeAddress(address);
    if (normAddr) {
      for (const j of jobs) {
        if (j.address && normalizeAddress(j.address) === normAddr) {
          return { job_id: j.id, match_confidence: "high", needs_review: false, autoCreate: false };
        }
      }
    }
  }
  // 4. Name normalization + alias matching
  if (!normName) {
    return { job_id: null, match_confidence: "unmatched", needs_review: true, autoCreate: false };
  }
  for (const j of jobs) {
    const candidates = [j.canonical_name, ...(j.aliases || [])].map(normalizeJobName).filter(Boolean);
    if (candidates.includes(normName)) {
      return { job_id: j.id, match_confidence: "high", needs_review: false, autoCreate: false };
    }
  }
  // If we have a hard identifier (PO/OE/address) that didn't match any job,
  // it's a new job — auto-create. Don't let name similarity to a *different*
  // lot/unit in the same neighborhood block creation.
  if (poNumber || oeNumber || address) {
    return { job_id: null, match_confidence: "unmatched", needs_review: false, autoCreate: true };
  }
  // No hard identifier — use name similarity to decide
  let best = 0;
  for (const j of jobs) {
    const candidates = [j.canonical_name, ...(j.aliases || [])].map(normalizeJobName).filter(Boolean);
    for (const c of candidates) {
      const sim = similarity(normName, c);
      if (sim > best) best = sim;
    }
  }
  if (best >= 0.85) {
    return { job_id: null, match_confidence: "unmatched", needs_review: true, autoCreate: false };
  }
  return { job_id: null, match_confidence: "unmatched", needs_review: false, autoCreate: true };
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

// Detect a profit-split pattern in the event description: a "Project Total"
// line (sale price) and a "Package Cost" / "Material Cost" line (cost).
// Returns { sale_price, cost } when both are found and sale_price > cost,
// indicating a side job where profit is split 50/50 with YA.
export function extractProfitSplit(description) {
  if (!description) return null;
  const lines = String(description).split(/\r?\n/);
  const moneyRe = /\$\s?([\d,]+(?:\.\d{1,2})?)/;
  let salePrice = null;
  let cost = null;
  for (const line of lines) {
    const lower = line.toLowerCase();
    const m = line.match(moneyRe);
    if (!m) continue;
    const amt = Number(m[1].replace(/,/g, ''));
    if (lower.includes('project total') && salePrice === null) {
      salePrice = amt;
    }
    if ((lower.includes('package cost') || lower.includes('material cost')) && cost === null) {
      cost = amt;
    }
  }
  if (salePrice !== null && cost !== null && salePrice > cost) {
    return { sale_price: salePrice, cost };
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