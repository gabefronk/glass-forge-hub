import { similarity } from './ingestShared.ts';

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
// For "2026-08-24" this returns "2026-08-25T06:00:00.000Z" (MDT) or
// "2026-08-25T07:00:00.000Z" (MST) — midnight Denver = the report deadline.
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

// Extract street number + street name from text (e.g. "305 Lakeview" → {number:"305", name:"lakeview"})
export function extractStreetInfo(text) {
  if (!text) return null;
  const m = String(text).match(/\b(\d{2,5})\s+([A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)?)/);
  if (m) return { number: m[1], name: m[2].toLowerCase() };
  return null;
}

// Normalize a job name for matching: strip builder prefix, lot/building numbers, punctuation, case
export function normalizeForMatching(name) {
  if (!name) return "";
  let s = String(name).toLowerCase().trim();
  s = s.replace(/^ya\b\s*[-–—]?\s*/, "");
  s = s.replace(/^[^-]+-\s*/, "");
  s = s.replace(/\b(?:lot|bldg|blding|unit|apt|building)\s*\d+\b/g, " ");
  s = s.replace(/\b\d+\s+/g, "");
  s = s.replace(/[.,;:!?\-–—*]+/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

// Extract builder name from job name (part before first dash, lowercased)
export function extractBuilderForMatch(name) {
  if (!name) return null;
  let s = String(name).replace(/^ya\b\s*[-–—]?\s*/, "").trim();
  const m = s.match(/^([A-Z][A-Za-z0-9&\s.'-]+?)\s*[-–—]\s*/);
  return m && m[1].trim() ? m[1].trim().toLowerCase() : null;
}

// Extract lot/building number from job name (first 2-5 digit number after the builder prefix)
export function extractLotNumber(name) {
  if (!name) return null;
  const s = String(name).replace(/^ya\b\s*[-–—]?\s*/, "").replace(/^[^-]+-\s*/, "");
  const m = s.match(/\b(\d{2,5})\b/);
  return m ? m[1] : null;
}

// Score the match between a CalendarEvent and a FieldReport (0–1).
// Components: (a) street number+name 0.40, (b) normalized name similarity 0.40, (c) builder+lot 0.20
export function scoreMatch(event, report) {
  // (a) Street match
  const eventStreet = extractStreetInfo(event.job_name) || extractStreetInfo(event.address);
  const reportStreet = extractStreetInfo(report.job_name);
  let streetScore = 0;
  if (eventStreet && reportStreet) {
    if (eventStreet.number === reportStreet.number && eventStreet.name === reportStreet.name) streetScore = 0.40;
    else if (eventStreet.number === reportStreet.number) streetScore = 0.20;
  }

  // (b) Normalized name similarity
  const eventNorm = normalizeForMatching(event.job_name);
  const reportNorm = normalizeForMatching(report.job_name);
  let nameScore = 0;
  if (eventNorm && reportNorm) nameScore = similarity(eventNorm, reportNorm) * 0.40;

  // (c) Builder + lot
  let builderScore = 0;
  const eventBuilder = (event.builder || extractBuilderForMatch(event.job_name) || "").toLowerCase();
  const reportBuilder = extractBuilderForMatch(report.job_name) || "";
  if (eventBuilder && reportBuilder && eventBuilder === reportBuilder) {
    builderScore += 0.10;
    const eventLot = extractLotNumber(event.job_name);
    const reportLot = extractLotNumber(report.job_name);
    if (eventLot && reportLot && eventLot === reportLot) builderScore += 0.10;
  }

  return Math.min(1, streetScore + nameScore + builderScore);
}

// Determine which match method was used based on the top-scoring component
export function determineMatchMethod(event, report, score) {
  if (score < 0.80) return "none";
  const eventStreet = extractStreetInfo(event.job_name) || extractStreetInfo(event.address);
  const reportStreet = extractStreetInfo(report.job_name);
  if (eventStreet && reportStreet && eventStreet.number === reportStreet.number) return "address";
  return "name_date";
}