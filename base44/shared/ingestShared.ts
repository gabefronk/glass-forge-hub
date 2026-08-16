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

// Normalize an address for comparison: lowercase, standardize street
// suffixes, strip punctuation/zip/state so "50 W 250 N, MIDWAY, UT, 84049"
// and "50 W 250 N Midway" both become "50 w 250 n midway".
export function normalizeAddress(addr) {
  if (!addr) return "";
  let s = String(addr).toLowerCase().trim();
  s = s.replace(/\bstreet\b/g, "st").replace(/\bavenue\b/g, "ave")
       .replace(/\bboulevard\b/g, "blvd").replace(/\bdrive\b/g, "dr")
       .replace(/\blane\b/g, "ln").replace(/\broad\b/g, "rd")
       .replace(/\bplace\b/g, "pl").replace(/\bcourt\b/g, "ct")
       .replace(/\bcircle\b/g, "cir");
  s = s.replace(/[,.#]/g, " ");
  s = s.replace(/\b\d{5}(?:-\d{4})?\b/g, ""); // zip
  s = s.replace(/,\s*ut\b/g, " "); // Utah state after comma
  s = s.replace(/\but\b/g, " "); // bare UT
  s = s.replace(/\busa\b/g, " ");
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

export function computeLaborAmt(row) {
  if (row.manually_adjusted) return row.labor_amt;
  if (row.calendar_labor_amt != null) return Number(row.calendar_labor_amt) || 0;
  const mh = Number(row.man_hours) || 0;
  const tc = Number(row.trip_charges) || 0;
  return mh * 100 + tc * 75;
}

export function computeFeeAmt(row) {
  if (row.manually_adjusted) return row.fee_amt;
  if (row.fee_type === 'profit_split') {
    const sale = Number(row.sale_price) || 0;
    const cost = Number(row.cost) || 0;
    const split = row.split_pct != null ? Number(row.split_pct) : 0.5;
    return (sale - cost) * split;
  }
  const labor = Number(row.labor_amt) || 0;
  const pct = row.fee_pct != null ? Number(row.fee_pct) : 0.1;
  return labor * pct;
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

export function extractLaborAmount(description) {
  if (!description) return null;
  const lines = String(description).split(/\r?\n/);
  const moneyRe = /\$\s?([\d,]+(?:\.\d{1,2})?)/;
  for (let i = 0; i < lines.length; i++) {
    if (!/labor/i.test(lines[i])) continue;
    const m = lines[i].match(moneyRe);
    if (m) return Number(m[1].replace(/,/g, ''));
    if (i + 1 < lines.length) {
      const m2 = lines[i + 1].match(moneyRe);
      if (m2) return Number(m2[1].replace(/,/g, ''));
    }
  }
  return null;
}

const CONF_RANK = { unmatched: 0, low: 1, high: 2 };

export function mergeReviewFlags(existing, incoming) {
  // If the incoming row now has a job_id, the match succeeded — clear the
  // flag. Stickiness only applies to rows that are STILL unresolved (no job).
  if (incoming.job_id) {
    return { needs_review: false, match_confidence: 'high' };
  }
  // No job_id — confidence is always "unmatched", never "high".
  const needs_review = !!(existing && existing.needs_review) || !!incoming.needs_review;
  return { needs_review, match_confidence: 'unmatched' };
}