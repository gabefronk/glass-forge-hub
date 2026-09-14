const norm = value => String(value ?? "").normalize("NFKC").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
const order = value => String(value ?? "").trim().toUpperCase().replace(/\s+/g, "");
const oeOrder = value => order(value).replace(/^(\d{8})-\d{2}$/, "$1");
const phrase = (text, value) => !!norm(value) && (" " + norm(text) + " ").includes(" " + norm(value) + " ");
const rowKey = row => [row.builder, row.subdivision, row.lot].every(v => norm(v)) ? [row.builder, row.subdivision, row.lot].map(norm).join("|") : ["order", order(row.oe), order(row.po)].join("|");
function titleLots(title, row) {
  let text = String(title ?? "").replace(/^(?:(?:YA|W|Wes|MDS|AP|BB|HP|SP)\s*-\s*)?(?:(?:#[1-9]\s*)|(?:\([^)]*\)\s*)){0,3}/i, "");
  text = norm(text);
  for (const value of [row.builder, row.subdivision]) text = (" " + text + " ").replace(" " + norm(value) + " ", " ").trim();
  const lot = norm(row.lot);
  if (!/^\d+$/.test(lot)) return phrase(text, lot);
  // Expand only explicit short lot ranges; never infer a lot from an order or an address in the notes.
  const raw = String(title ?? "");
  for (const match of raw.matchAll(/\b(\d+)\s*(?:-|through|to)\s*(\d+)\b/gi)) {
    const a = +match[1], b = +match[2];
    if (b >= a && b - a <= 30 && +lot >= a && +lot <= b) return true;
  }
  return text.split(" ").includes(lot);
}
function fullIdentity(event, row) {
  const title = event.job_name || "";
  return [row.builder, row.subdivision, row.lot].every(v => norm(v)) &&
    (event.builder ? norm(event.builder) === norm(row.builder) : phrase(title, row.builder)) &&
    (event.subdivision ? norm(event.subdivision) === norm(row.subdivision) : phrase(title, row.subdivision)) &&
    (event.lot ? norm(event.lot) === norm(row.lot) : titleLots(title, row));
}
export function createOwnershipMatcher(rows) {
  const oeIndex = new Map(), poIndex = new Map();
  for (const row of rows) for (const [key, index] of [["oe", oeIndex], ["po", poIndex]]) {
    const value = key === "oe" ? oeOrder(row[key]) : order(row[key]);
    if (value) index.set(value, [...(index.get(value) || []), row]);
  }
  return event => {
    const oe = oeOrder(event.oe_number), po = order(event.po_number);
    let matches, method;
    if (oe || po) {
      const candidates = [...new Set([...(oeIndex.get(oe) || []), ...(poIndex.get(po) || [])])];
      matches = candidates.filter(row => !(oe && oeOrder(row.oe) && oe !== oeOrder(row.oe)) && !(po && order(row.po) && po !== order(row.po)));
      method = matches.some(row => oe && oe === oeOrder(row.oe)) ? "oe" : "po";
      // A supplied unmatched or conflicting order cannot fall back to a similar name.
    } else {
      matches = rows.filter(row => fullIdentity(event, row));
      method = "builder_subdivision_lot";
    }
    if (!matches.length) return null;
    const precise = matches.filter(row => fullIdentity(event, row));
    if (precise.length) matches = precise;
    return {verified: true, method, job_keys: [...new Set(matches.map(rowKey))].sort()};
  };
}
const notes = event => norm(String(event.scope_notes || "").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " "));
const name = event => norm(String(event.job_name || "").replace(/^(?:(?:YA|W|Wes|MDS|AP|BB|HP|SP)\s*-\s*)?(?:(?:#[1-9]\s*)|(?:\([^)]*\)\s*)){0,3}/i, ""));
const sameOrder = (a,b) => ["oe_number", "po_number"].some(key => order(a[key]) && order(a[key]) === order(b[key]));
function sameVisit(a, b) {
  if (a.event_date !== b.event_date) return false;
  // Unmatched events (no ownership) never merge with other visits; they display as-is.
  if (!a.ownership || !b.ownership) return false;
  if (a.ownership.job_keys.join("\n") !== b.ownership.job_keys.join("\n")) return false;
  if (["oe_number", "po_number"].some(key => order(a[key]) && order(b[key]) && order(a[key]) !== order(b[key]))) return false;
  if (a.source === b.source && ((a.google_event_id && a.google_event_id === b.google_event_id) || (a.source_occurrence_key && a.source_occurrence_key === b.source_occurrence_key) || (a.id && a.id === b.id))) return true;
  if (name(a) !== name(b) || (norm(a.address) && norm(b.address) && norm(a.address) !== norm(b.address))) return false;
  const sameTimes = (a.start_time || "") === (b.start_time || "") && (a.end_time || "") === (b.end_time || "") && (a.end_date || "") === (b.end_date || "");
  const sameNotes = !!notes(a) && notes(a) === notes(b);
  if (sameTimes) return Boolean(sameNotes || (sameOrder(a,b) && (a.source !== b.source || !notes(a) || !notes(b))));
  // An all-day placeholder may duplicate a timed copy only with identical job notes and a shared exact order.
  return Boolean(!a.start_time !== !b.start_time && sameNotes && sameOrder(a,b));
}
export function filterOwnedCalendar(source, rows) {
  const match = createOwnershipMatcher(rows), groups = [], byMonth = {}, rejected = [];
  const totals = {source_events:0, unmatched_events:0, duplicate_events:0, visible_events:0, removed_events:0};
  for (const original of [...source].sort((a,b) => Number(!!b.start_time) - Number(!!a.start_time))) {
    const month = String(original.event_date || "").slice(0,7);
    const counts = byMonth[month] ||= {source_events:0, unmatched_events:0, duplicate_events:0, visible_events:0, removed_events:0};
    totals.source_events++; counts.source_events++;
    const ownership = match(original);
    if (!ownership) {totals.unmatched_events++; counts.unmatched_events++; rejected.push({id:original.id,source:original.source,event_date:original.event_date,job_name:original.job_name,start_time:original.start_time||null,end_time:original.end_time||null,end_date:original.end_date||null,address:original.address||null,created_by:original.created_by||null}); groups.push([{...original, ownership: null}]); continue;}
    const event = {...original, ownership};
    // Timed copies anchor the visit. An untimed placeholder cannot bridge distinct start times.
    const existing = groups.find(group => group.some(member => sameVisit(member,event)) && group.every(member => !member.start_time || !event.start_time || member.start_time === event.start_time));
    if (existing) {existing.push(event);totals.duplicate_events++;counts.duplicate_events++;}
    else {groups.push([event]);totals.visible_events++;counts.visible_events++;}
  }
  for (const counts of [totals,...Object.values(byMonth)]) counts.removed_events = counts.unmatched_events + counts.duplicate_events;
  for (const group of groups) group.sort((a,b) => Number(!!b.start_time)-Number(!!a.start_time) || (a.source === "outlook" ? 1 : 0)-(b.source === "outlook" ? 1 : 0));
  return {groups,counts:totals,by_month:byMonth,rejected};
}