// Shared field-report matching logic used by auditFieldReports and matchDebug.
// Two-stage project-level matching: resolve each calendar event to a Probuild
// project group (alpha-token scoring), then one report satisfies every ticket
// on that project group for that date.

// Convert a UTC date to a Denver date string (YYYY-MM-DD)
export function toDenverDateString(date) {
  if (!date) return null;
  const d = new Date(date);
  if (isNaN(d.getTime())) return null;
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
}

// Yesterday's date in Denver
export function yesterdayDenver() {
  return toDenverDateString(new Date(Date.now() - 86400000));
}

// End of the given day in America/Denver, returned as a UTC ISO string.
export function endOfDayDenver(dateStr) {
  if (!dateStr) return null;
  const [y, m, d] = dateStr.split('-').map(Number);
  const test = new Date(dateStr + 'T12:00:00Z');
  const denverHour = parseInt(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Denver', hour: '2-digit', hour12: false }).format(test), 10);
  const offset = 12 - denverHour; // 6 (MDT) or 7 (MST)
  return new Date(Date.UTC(y, m - 1, d + 1, offset, 0, 0)).toISOString();
}

// Calendar days between event_date and now in Denver (0 if not yet past due)
export function computeDaysLate(eventDateStr) {
  if (!eventDateStr) return 0;
  const nowDenver = toDenverDateString(new Date());
  const diff = Math.floor((new Date(nowDenver + 'T00:00:00Z').getTime() - new Date(eventDateStr + 'T00:00:00Z').getTime()) / 86400000);
  return Math.max(0, diff);
}

// Count attachments from Probuild's RTDB. Attachments can be a keyed object
// (attachment id → record) or an array. Handles both shapes.
export function countAttachments(attachments) {
  if (!attachments) return 0;
  if (Array.isArray(attachments)) return attachments.length;
  if (typeof attachments === 'object') return Object.keys(attachments).length;
  return 0;
}

// Extract street number + street name from text (e.g. "305 Lakeview" → {number:"305", name:"lakeview"})
export function extractStreetInfo(text) {
  if (!text) return null;
  const m = String(text).match(/\b(\d{2,5})\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)?)/);
  if (m) return { number: m[1], name: m[2].toLowerCase() };
  return null;
}

// Normalize a calendar event name for project matching.
// Strips crew prefix (YA - #1, YA - #2, YA -, #3), parenthetical markers,
// lot/building keywords, and punctuation. Returns alpha and numeric tokens
// separately — numeric tokens are lot/building numbers that identify the
// ticket, not the jobsite, and are excluded from scoring.
//
// Example: "YA - #2 DURKIN 33 WILDWOOD" → { alpha_tokens: ["durkin","wildwood"], numeric_tokens: ["33"] }
export function normalizeEventForProjectMatch(name) {
  if (!name) return { alpha_tokens: [], numeric_tokens: [] };
  let s = String(name);
  // Strip crew prefix: "YA - #1", "YA - #2", "YA -", "#3", etc.
  s = s.replace(/^ya\b\s*[-–—]?\s*#?\d*\s*/i, "");
  s = s.replace(/^#\d+\s*/i, "");
  // Strip parenthetical markers: (l.i), (L.I.), (2 - 3 Techs), (3-4 techs)
  s = s.replace(/\([^)]*\)/g, " ");
  // Lowercase
  s = s.toLowerCase();
  // Strip lot/building/unit keywords and their numbers
  s = s.replace(/\b(?:lot|bldg|blding|unit|apt|building)\s*\d*\b/g, " ");
  // Strip punctuation
  s = s.replace(/[.,;:!?\-–—*]+/g, " ");
  // Collapse whitespace
  s = s.replace(/\s+/g, " ").trim();
  // Split into tokens, separate alpha from numeric
  const tokens = s.split(" ").filter(Boolean);
  const alpha_tokens = [];
  const numeric_tokens = [];
  for (const t of tokens) {
    if (/^\d+$/.test(t)) numeric_tokens.push(t);
    else alpha_tokens.push(t);
  }
  return { alpha_tokens, numeric_tokens };
}

// Normalize a Probuild project name into alpha tokens for comparison.
// Uses the same normalization as normalizeEventForProjectMatch so both sides
// are stripped identically.
export function normalizeProjectName(name) {
  return normalizeEventForProjectMatch(name).alpha_tokens;
}

// Jaccard similarity between two token sets (intersection / union).
// Returns 0–1.
function jaccardTokens(eventTokens, projectTokens) {
  if (!eventTokens.length || !projectTokens.length) return 0;
  const eventSet = new Set(eventTokens);
  const projectSet = new Set(projectTokens);
  let intersection = 0;
  for (const t of eventSet) if (projectSet.has(t)) intersection++;
  const union = eventSet.size + projectSet.size - intersection;
  return union > 0 ? intersection / union : 0;
}

// Build project groups from FieldReports. Groups reports by normalized alpha
// tokens of the project name, so "YA - #2 DURKIN 31 WILDWOOD" and
// "YA - #2 DURKIN 33 WILDWOOD" end up in the same group (alpha: "durkin wildwood").
// This is the key structural change: one report on any lot satisfies every
// ticket on that jobsite for that date.
export function buildProjectGroups(reports) {
  const groups = new Map(); // key → { id, name, alpha_tokens, names, posts }
  for (const r of reports) {
    const alpha = normalizeEventForProjectMatch(r.job_name).alpha_tokens;
    const key = alpha.join(" ");
    if (!key) continue;
    if (!groups.has(key)) {
      groups.set(key, { id: key, name: r.job_name, alpha_tokens: alpha, names: [], posts: [] });
    }
    const g = groups.get(key);
    if (!g.names.includes(r.job_name)) g.names.push(r.job_name);
    g.posts.push(r);
  }
  return [...groups.values()];
}

// Score a calendar event against a Probuild project group (0–1).
// Priority: (a) street-address match → 1.0 when both have the same street
// number+name; (b) alpha-token Jaccard similarity otherwise.
export function scoreEventToProject(event, project) {
  // (a) Street-address match (first priority)
  const eventStreet = extractStreetInfo(event.address) || extractStreetInfo(event.job_name);
  const projectStreet = extractStreetInfo(project.name);
  if (eventStreet && projectStreet && eventStreet.number === projectStreet.number && eventStreet.name === projectStreet.name) {
    return 1.0;
  }
  // (b) Alpha-token similarity
  const { alpha_tokens } = normalizeEventForProjectMatch(event.job_name);
  const projectTokens = project.alpha_tokens || normalizeProjectName(project.name);
  return jaccardTokens(alpha_tokens, projectTokens);
}

// Resolve a calendar event to the best-matching Probuild project group.
// Returns { best: { id, name, score } | null, candidates: [{id, name, score}, ...] (top 3), lot_tokens }
export function resolveProject(event, projects) {
  const { alpha_tokens, numeric_tokens } = normalizeEventForProjectMatch(event.job_name);
  const scored = [];
  for (const p of projects) {
    const score = scoreEventToProject(event, p);
    scored.push({ id: p.id, name: p.name, score, project: p });
  }
  scored.sort((a, b) => b.score - a.score);

  // Tiebreaker: if top two score within 0.05, prefer the group whose names
  // contain one of the event's lot tokens (numeric tokens).
  let best = scored[0] || null;
  if (scored.length >= 2 && best && Math.abs(scored[0].score - scored[1].score) <= 0.05 && numeric_tokens.length > 0) {
    for (const cand of scored) {
      const allNames = cand.project.names || [cand.name];
      const projNums = allNames.flatMap((n) => String(n).match(/\b\d{2,5}\b/g) || []);
      if (numeric_tokens.some((nt) => projNums.includes(nt))) {
        best = cand;
        break;
      }
    }
  }

  return {
    best: best && best.score >= 0.80 ? { id: best.id, name: best.name, score: best.score } : null,
    candidates: scored.slice(0, 3).map((s) => ({ id: s.id, name: s.name, score: s.score })),
    lot_tokens: numeric_tokens,
  };
}

// Evaluate a set of posts (for the same project group+date) and return the
// aggregate report status. Uses attachment_count (or photo_urls as fallback).
export function evaluatePosts(posts) {
  if (!posts || posts.length === 0) return { result: "missing_all", post_ids: [] };
  const postIds = posts.map((p) => p.post_id);
  // Aggregate: if ANY post has notes and ANY post has photos, the report is ok.
  const hasNotes = posts.some((p) => (p.message || "").trim().length >= 10);
  const hasPhotos = posts.some((p) => {
    const ac = Number(p.attachment_count) || 0;
    const pc = (p.photo_urls || []).length;
    return ac > 0 || pc > 0;
  });
  let result;
  if (hasNotes && hasPhotos) result = "ok";
  else if (hasPhotos) result = "missing_notes";
  else if (hasNotes) result = "missing_photos";
  else result = "missing_all";
  return { result, post_ids: postIds };
}