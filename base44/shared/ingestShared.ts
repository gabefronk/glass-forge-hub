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

// jobs: array of Jobs records (id, canonical_name, aliases)
// returns { job_id, match_confidence, needs_review, autoCreate }
export function matchJob(normName, jobs) {
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