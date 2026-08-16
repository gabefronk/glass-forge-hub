// Shared ingest helpers used by both fetchCalendarEvents and fetchProbuildPosts.
// Never copy this logic into a function — import it.

// Normalize a raw job name to a canonical comparison key.
// Rules: lowercase; strip leading "YA -", the "#N" job number, parenthetical
// tags like "(L.I.)", trailing account tags like "CASH ACCOUNT", and trailing
// punctuation; collapse whitespace.
export function normalizeJobName(raw) {
  if (!raw) return "";
  let s = String(raw).toLowerCase().trim();
  // strip leading "YA -" (dash optional, word-bounded so "yard" is safe)
  s = s.replace(/^ya\b\s*[-–—]?\s*/, "");
  // strip leading "#N" job number
  s = s.replace(/^#\d+\s*/, "");
  // strip parenthetical tags like "(L.I.)"
  s = s.replace(/\([^)]*\)/g, " ");
  // strip trailing account tags like "CASH ACCOUNT"
  s = s.replace(/\bcash\s+account\b\s*$/, "");
  // strip trailing punctuation
  s = s.replace(/[.,;:!?\-–—]+$/, "");
  // collapse whitespace
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
// Matches "PO 7104345", "PO#: 7104345", "PO# 7104345", "Orig. PO#: 7006336".
// Also catches "PO# PELLA WINDOWS- 7006336" via the second pattern.
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
// Matches "OE: 78661292-02" and "OE 79409948-01" (colon optional).
// Also catches bare "79327171-00" at the start of a line (preceded by newline
// + optional whitespace), e.g.:
//     *   4010PW
//
// 79327171-00 | (Cam: 385-315-7903)
// The line-start guard prevents matching random 8-digit-2-digit numbers
// embedded in prose. Labeled patterns are tried first so "OE: 79409948-01"
// is never double-matched.
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

// jobs: array of Jobs records (id, canonical_name, aliases, po_numbers, oe_numbers)
// Match hierarchy: 1) PO number, 2) OE number, 3) name normalization + alias.
// poNumber/oeNumber are optional — pass null/undefined for name-only matching
// (e.g. Probuild posts, non-BFS jobs).
// returns { job_id, match_confidence, needs_review, autoCreate }
export function matchJob(normName, jobs, poNumber, oeNumber) {
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
  // 3. Name normalization + alias matching (unchanged)
  if (!normName) {
    return { job_id: null, match_confidence: "unmatched", needs_review: true, autoCreate: false };
  }
  for (const j of jobs) {
    const candidates = [j.canonical_name, ...(j.aliases || [])].map(normalizeJobName).filter(Boolean);
    if (candidates.includes(normName)) {
      return { job_id: j.id, match_confidence: "high", needs_review: false, autoCreate: false };
    }
  }
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
  return { job_id: null, match_confidence: "high", needs_review: false, autoCreate: true };
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
  const labor = Number(row.labor_amt) || 0;
  const pct = row.fee_pct != null ? Number(row.fee_pct) : 0.1;
  return labor * pct;
}

export function invoiceMonthFromDate(dateStr) {
  if (!dateStr) return "";
  return String(dateStr).slice(0, 7);
}

// Extract the BFS ticket sequence from the "-win" / "-win2" suffix on the
// labor line. "-win" = 1 (original ticket), "-win2" = 2 (first rework), etc.
// Only matches "win" + optional digits + word boundary on a line containing
// "labor" — excludes "window", "WinDor", "awning", etc. Returns null when no
// -win suffix is present on any labor line.
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

// Extract a dollar amount only when it appears on the same line as, or on the
// line immediately following, the word "Labor" (case-insensitive: matches
// "LABOR", "Labor$", "Labor-", "Labor:"). Never falls back to any other dollar
// figure. Returns null when no labor-adjacent amount exists.
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

// Merge review flags on an ingest re-run. needs_review is sticky: once true, a
// re-run can never clear it (only a human UI action can). A re-run may upgrade
// match_confidence but never downgrade it.
export function mergeReviewFlags(existing, incoming) {
  const needs_review = !!(existing && existing.needs_review) || !!incoming.needs_review;
  let mc = incoming.match_confidence || 'unmatched';
  if (existing && existing.match_confidence) {
    const er = CONF_RANK[existing.match_confidence] ?? 0;
    const nr = CONF_RANK[mc] ?? 0;
    if (nr < er) mc = existing.match_confidence;
  }
  return { needs_review, match_confidence: mc };
}