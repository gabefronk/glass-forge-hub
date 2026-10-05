// Lot + community aware matching for Daybreak and similar communities where
// lot numbers are reused across communities. A lot match counts only when the
// community also matches; different communities are never cross-linked.
//
// Used by resolveJob (jobIdentity.js) and resolveJobLink (jobLinkResolver.js)
// to veto hard-ID matches whose title lots/communities disagree, and as a
// tiebreaker among same-street / same-builder candidates. Pure, no imports —
// runs in both the frontend bundle and backend functions.

// Known Daybreak / community tokens. A lot match counts only when the community
// also matches; different communities are never cross-linked.
const COMMUNITY_TOKENS = [
  "move up", "village", "watermark", "towns", "watercourse", "highlands",
  "parks", "ridge", "crossing", "meadow", "creek", "hollow", "canyon",
  "trail", "walk", "row", "manor", "court", "square", "terrace", "flats",
  "lofts", "estates", "grove", "landing", "overlook", "place",
];

// Extract lot numbers from text, expanding ranges:
//   "388-390"   → {388, 389, 390}
//   "177 & 180" → {177, 180}  (& joins discrete lots, not a range)
//   "Lot 12"    → {12}
//   "Move Up 177" → {177}  (number after a community token is the lot)
// Returns a Set of integers.
export function extractLots(text) {
  const lots = new Set();
  if (!text) return lots;
  const s = String(text).toLowerCase();
  let m;
  // Ranges: 388-390, 388–390, 388 to 390 (NOT & — & connects discrete lots).
  const rangeRe = /(\d{1,5})\s*(?:[-–—]|to)\s*(\d{1,5})/g;
  while ((m = rangeRe.exec(s))) {
    const lo = parseInt(m[1], 10);
    const hi = parseInt(m[2], 10);
    if (lo && hi && hi >= lo && hi - lo < 50) {
      for (let i = lo; i <= hi; i++) lots.add(i);
    }
  }
  // Discrete lots joined by &: "177 & 180"
  const ampRe = /(\d{1,5})\s*&\s*(\d{1,5})/g;
  while ((m = ampRe.exec(s))) {
    lots.add(parseInt(m[1], 10));
    lots.add(parseInt(m[2], 10));
  }
  // Explicit lot/unit/building labels: "Lot 12", "Unit 5", "#12"
  const labelRe = /(?:lot|lt|unit|bldg|building|#)\s*(\d{1,5})\b/g;
  while ((m = labelRe.exec(s))) {
    const n = parseInt(m[1], 10);
    if (n) lots.add(n);
  }
  // Numbers after a community token: "Move Up 177", "Villages 12". In Daybreak
  // the lot follows the community name, so the number right after a community
  // token is the lot, not a street number.
  for (const token of COMMUNITY_TOKENS) {
    const afterCommunity = new RegExp(token + "\\s+(\\d{1,5})\\b", "g");
    while ((m = afterCommunity.exec(s))) {
      const n = parseInt(m[1], 10);
      if (n) lots.add(n);
    }
  }
  return lots;
}

// Extract the first community token from text, lowercased, or "".
export function extractCommunity(text) {
  if (!text) return "";
  const s = String(text).toLowerCase();
  for (const token of COMMUNITY_TOKENS) {
    if (s.includes(token)) return token;
  }
  return "";
}

// Lot + community check between an event title and a candidate job.
// Returns { veto: boolean, reason: string }.
//   veto = true  → do NOT auto-link; mark for review.
//   veto = false → no lot/community evidence against linking.
export function lotCommunityCheck(eventText, job) {
  if (!eventText || !job) return { veto: false, reason: "" };
  const eventLots = extractLots(eventText);
  const eventCommunity = extractCommunity(eventText);
  const jobText = [job.canonical_name, ...(job.aliases || [])].filter(Boolean).join(" ");
  const jobLots = extractLots(jobText);
  const jobCommunity = extractCommunity(jobText);

  // No lots on one side: no lot-based veto (not enough evidence).
  if (!eventLots.size || !jobLots.size) return { veto: false, reason: "" };

  // Lots on both sides: they must overlap.
  const overlap = [...eventLots].some((l) => jobLots.has(l));
  if (!overlap) return { veto: true, reason: "lot_mismatch" };

  // Communities on both sides: they must match.
  if (eventCommunity && jobCommunity && eventCommunity !== jobCommunity) {
    return { veto: true, reason: "community_mismatch" };
  }

  return { veto: false, reason: "" };
}

// Tiebreaker score: how well a candidate job's lots/community match the event
// text. Higher is better. Used when several same-street/same-builder jobs are
// candidates. Returns 0 when there is no lot or community evidence.
export function lotCommunityScore(eventText, job) {
  if (!eventText || !job) return 0;
  const eventLots = extractLots(eventText);
  const jobText = [job.canonical_name, ...(job.aliases || [])].filter(Boolean).join(" ");
  const jobLots = extractLots(jobText);
  const eventCommunity = extractCommunity(eventText);
  const jobCommunity = extractCommunity(jobText);
  let score = 0;
  if (eventLots.size && jobLots.size) {
    score += [...eventLots].filter((l) => jobLots.has(l)).length * 10;
  }
  if (eventCommunity && jobCommunity && eventCommunity === jobCommunity) score += 5;
  return score;
}