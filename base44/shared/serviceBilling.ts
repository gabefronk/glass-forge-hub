const RATES = { vinyl: 100, composite: 125, aluminum: 150, wood: 150 };
export function parseServiceBilling(note, manHours, tripCharges) {
  const text = String(note || "").toLowerCase();
  const materials = [...new Set([...text.matchAll(/\b(vinyl|composite|aluminum|aluminium|wood)\b/g)].map(m => m[1] === "aluminium" ? "aluminum" : m[1]))];
  const hours = Number(manHours);
  const trips = Number(tripCharges) || 0;
  if (!Number.isFinite(hours) || hours < 0) return { review: true, reason: "No explicit man-hour quantity." };
  if (materials.length !== 1) return { review: true, reason: materials.length ? "Multiple materials stated." : "No labor material stated." };
  const material = materials[0], rate = RATES[material];
  const labor = hours * rate, trip = trips * 75;
  return { review: false, material, rate, labor, trip, total: labor + trip, source: "ProBuild note: explicit man-hours, material, and trip-charge count" };
}