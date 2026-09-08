const norm = (v) => String(v ?? "").trim().replace(/\s+/g, " ").toLowerCase();
export function confirmedOverlap(outlook, israel) {
  if (outlook.event_date !== israel.event_date) return false;
  // Shared order numbers can cover multiple lots: require precise job identity too.
  const titleSame = norm(outlook.job_name) && norm(outlook.job_name) === norm(israel.job_name);
  const lotSame = norm(outlook.lot) && norm(outlook.lot) === norm(israel.lot);
  const communitySame = norm(outlook.subdivision) && norm(outlook.subdivision) === norm(israel.subdivision);
  const builderSame = norm(outlook.builder) && norm(outlook.builder) === norm(israel.builder);
  const orderSame = ["oe_number", "po_number"].some(k => norm(outlook[k]) && norm(outlook[k]) === norm(israel[k]));
  if (["oe_number", "po_number"].some(k => norm(outlook[k]) && norm(israel[k]) && norm(outlook[k]) !== norm(israel[k]))) return false;
  return Boolean((orderSame && titleSame) || (lotSame && communitySame && builderSame && orderSame));
}
export function combineCalendarSources(existing, imported, showIsrael = true, showOutlook = true) {
  const retained = imported.filter(e => !existing.some(i => confirmedOverlap(e, i)));
  return { events: [...(showIsrael ? existing : []), ...(showOutlook ? retained : [])], hidden: imported.length - retained.length };
}
export function snapshotEvents(snapshot) {
  return (snapshot?.events || []).map((e,i) => ({ ...e, id: "outlook-" + snapshot.id + "-" + i, source: "outlook", report_required: false, calendar_name: snapshot.calendar_name, captured_at: snapshot.captured_at }));
}
