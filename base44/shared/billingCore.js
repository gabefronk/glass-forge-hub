// Pure billing rules shared by browser and backend. No credentials or I/O.
export const MAN_HOUR_RATE = 100;
export const TRIP_RATE = 75;
export const MATERIAL_RATES = { vinyl: 100, composite: 125, aluminum: 150, wood: 150 };
export const roundMoney = n => Math.round((Number(n) + Number.EPSILON * Math.max(1, Math.abs(Number(n)))) * 100) / 100;
export function denverDate(value = new Date()) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
}
export function isTripChargeAmount(amt) {
  const n = Number(amt);
  return n > 0 && n % TRIP_RATE === 0 && n % MAN_HOUR_RATE !== 0;
}
export function laborRate(row) {
  return MATERIAL_RATES[row.service_material] || Number(row.service_rate) || MAN_HOUR_RATE;
}
export function computeLaborAmt(row) {
  if (row.manually_adjusted) return Number(row.labor_amt) || 0;
  if (row.calendar_labor_amt != null && row.calendar_labor_amt !== "") {
    const amount = Number(row.calendar_labor_amt) || 0;
    // Combine only when source text explicitly identifies a trip charge.
    const trip = /\btrip\s+charge/i.test(row.calendar_note_text || row.note_text || "");
    return roundMoney(amount + (trip && isTripChargeAmount(amount) ? (Number(row.man_hours) || 0) * laborRate(row) : 0));
  }
  return roundMoney((Number(row.man_hours) || 0) * laborRate(row) + (Number(row.trip_charges) || 0) * TRIP_RATE);
}
export function computeFeeAmt(row) {
  if (row.manually_adjusted && row.fee_amt != null) return Number(row.fee_amt) || 0;
  if (row.fee_type === "profit_split") return roundMoney(((Number(row.sale_price) || 0) - (Number(row.cost) || 0)) * (row.split_pct == null ? .5 : Number(row.split_pct)));
  return roundMoney(computeLaborAmt(row) * (row.fee_pct == null ? .1 : Number(row.fee_pct)));
}
export function extractLaborAmount(description) {
  const lines = String(description || "").split(/\r?\n/);
  const label = /\b(?:sub\s*pay|sub\s*labor|labor)\b\s*(?:amount|pay|cost)?\s*[:=]?\s*/i;
  for (let i = 0; i < lines.length; i++) {
    const hit = label.exec(lines[i]);
    if (!hit) continue;
    let tail = lines[i].slice(hit.index + hit[0].length).trim();
    if (!tail && /^\s*\$/.test(lines[i + 1] || "")) tail = lines[i + 1].trim();
    if (tail.includes("$")) tail = tail.slice(tail.indexOf("$"));
    // A leading minus is ambiguous in imported notes; surface it for review.
    const amount = tail.match(/^\$?\s*(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)(?=\s|$|[-–—,;]|\.(?!\d)|\/win\b)/i);
    if (!amount || /\b(?:man\s*)?(?:hours?|hrs?)\b/i.test(tail.slice(amount[0].length, amount[0].length + 20))) continue;
    return Number(amount[1].replace(/,/g, ""));
  }
  return null;
}
export function extractExplicitService(note) {
  const text = String(note || "").toLowerCase();
  const quantities = [...text.matchAll(/(?:^|[^\w.-])(\d+(?:\.\d+)?)\s*(?:(?:vinyl|composite|alumini?um|wood)\s+)?(?:man[\s-]*(?:hours?|hrs?)|(?<=vinyl\s|composite\s|aluminum\s|aluminium\s|wood\s)(?:hours?|hrs?))\b/g)];
  const hours = quantities.length === 1 ? Number(quantities[0][1]) : null;
  const tripMatches = [...text.matchAll(/\b(?:(\d+(?:\.\d+)?)\s+)?trip\s+charges?\b/g)];
  let trips = tripMatches.length === 1 ? Number(tripMatches[0][1] || 1) : null;
  if (trips == null && /\+\s*(?:a\s+)?trip\b/.test(text)) trips = 1;
  const statedTrips = text.match(/\b(\d+)\s+trips?\b/);
  const uncertainTrips = trips == null && statedTrips;
  if (uncertainTrips) trips = Number(statedTrips[1]);
  let reason = quantities.length > 1 || tripMatches.length > 1 ? "Multiple quantities: confirm the total." : null;
  if (uncertainTrips) reason ||= "Trip count stated without charge wording; confirm billable trips.";
  if (/\bno\s*charge|not\s+billable/i.test(text) && (hours > 0 || trips > 0)) reason = "Hours or trips stated with no-charge instructions.";
  if (hours == null && /\bman[\s-]*(?:hours?|hrs?)\b/.test(text)) reason ||= "Man-hour quantity is not explicit.";
  if (trips != null && /\bextra\s+trip\b/.test(text)) reason ||= "Confirm whether the extra trip is included in the trip-charge count.";
  return { man_hours: hours, trip_charges: trips, needs_review: !!reason, reason };
}
export function parseServiceBilling(note, manHours, tripCharges) {
  const text = String(note || "").toLowerCase();
  const materials = [...new Set([...text.matchAll(/(?:^|[^a-z])(vinyl|composite|aluminum|aluminium|wood)\b/g)].map(m => m[1] === "aluminium" ? "aluminum" : m[1]))];
  const hours = manHours == null || manHours === "" ? null : Number(manHours);
  const trips = tripCharges == null || tripCharges === "" ? 0 : Number(tripCharges);
  if ((hours != null && (!Number.isFinite(hours) || hours < 0)) || !Number.isFinite(trips) || trips < 0) return { review: true, reason: "Invalid service quantity." };
  if (hours == null) {
    const ambiguous = /\bman[\s-]*(?:hours?|hrs?)\b|\b(?:vinyl|composite|aluminum|wood)\s+hours?\b/.test(text);
    return { review: ambiguous, reason: ambiguous ? "No explicit service-hour quantity." : null, labor: 0, trip: trips * TRIP_RATE, total: trips * TRIP_RATE, source: trips ? "Explicit trip charge" : "No service charge stated" };
  }
  const material = materials.length === 1 ? materials[0] : null;
  const rate = MATERIAL_RATES[material] || MAN_HOUR_RATE;
  const review = hours > 0 && materials.length !== 1;
  const labor = roundMoney(hours * rate), trip = roundMoney(trips * TRIP_RATE);
  return { review, reason: review ? (materials.length ? "Multiple materials stated: confirm the rate." : "Material missing: $100/hour is provisional.") : null, material, rate, labor, trip, total: roundMoney(labor + trip), source: review ? "Provisional service rate" : "Explicit service hours and configured material rate" };
}
export function pricingReview(description) {
  const text = String(description || "");
  if (/\b(?:sub\s*pay|sub\s*labor|labor)\b[^\n]*\$\s*[-–—]\s*\d/i.test(text)) return { reason: "Labor amount contains a minus or separator; confirm the amount." };
  const explicit = text.match(/\b(?:profit\s+)?split\s*[:=]?\s*\$?\s*([\d,]+\.\d{2})\b/i);
  const profit = text.match(/\bprofit\s*[:=]?\s*\$?\s*([\d,]+\.\d{2})\b/i);
  if (explicit || /\bsale\s+price\b|\bprofit\b.*\d/i.test(text)) return {
    reason: "Profit split: confirm the job allocation and prior payments before billing.",
    amount: explicit ? Number(explicit[1].replace(/,/g, "")) : profit ? roundMoney(Number(profit[1].replace(/,/g, "")) * .5) : null
  };
  return null;
}
// Only explicit web URLs are used. Never synthesize a storage URL from an ID.
export function extractPhotoUrls(post) {
  const urls = new Set();
  function walk(value, depth = 0) {
    if (!value || depth > 7) return;
    if (typeof value === "string") { if (/^https?:\/\//i.test(value)) urls.add(value); return; }
    if (Array.isArray(value)) { value.forEach(v => walk(v, depth + 1)); return; }
    if (typeof value === "object") for (const [key, val] of Object.entries(value)) {
      if (typeof val === "object" || /url|uri|src|link|original|thumbnail/i.test(key)) walk(val, depth + 1);
    }
  }
  for (const key of ["attachments", "photos", "media", "images", "files"]) walk(post?.[key]);
  return [...urls];
}
export function canonicalPostRows(rows) {
  const groups = new Map();
  for (const row of rows) if (row.probuild_post_id) {
    if (!groups.has(row.probuild_post_id)) groups.set(row.probuild_post_id, []);
    groups.get(row.probuild_post_id).push(row);
  }
  const result = new Map();
  for (const [post, group] of groups) {
    const sorted = [...group].sort((a, b) =>
      Number(!!b.manually_adjusted || !!b.billed_to_bfs) - Number(!!a.manually_adjusted || !!a.billed_to_bfs) ||
      Number(!!a.superseded_by) - Number(!!b.superseded_by) ||
      Number(!!b.calendar_event_id) - Number(!!a.calendar_event_id) ||
      String(a.id).localeCompare(String(b.id)));
    result.set(post, sorted[0]);
  }
  return result;
}
export function duplicatePostIds(rows) {
  const canonical = canonicalPostRows(rows);
  const ids = new Set();
  for (const row of rows) {
    const owner = canonical.get(row.probuild_post_id);
    // Do not discard independent calendar-note charges or manual adjustments.
    if (owner && owner.id !== row.id && !row.manually_adjusted && !row.billed_to_bfs &&
        (row.calendar_labor_amt == null || row.calendar_labor_amt === "") &&
        (Number(row.man_hours) > 0 || Number(row.trip_charges) > 0)) ids.add(row.id);
  }
  return ids;
}

export function denverMidnight(date) {
  const target = Date.parse(date + "T00:00:00Z");
  let ms = target;
  for (let i = 0; i < 3; i++) {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/Denver", timeZoneName: "longOffset" }).formatToParts(new Date(ms));
    const offset = parts.find(p => p.type === "timeZoneName").value.match(/GMT([+-])(\d{2}):(\d{2})/);
    ms = target - (offset ? (offset[1] === "-" ? -1 : 1) * (+offset[2] * 60 + +offset[3]) * 60000 : 0);
  }
  return new Date(ms).toISOString();
}
