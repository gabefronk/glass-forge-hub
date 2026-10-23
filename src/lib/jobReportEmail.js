// Compose a customer-safe email report from a job's history. Three-dot "Email
// report" on a section or the whole job feeds this; the owner reviews and ticks
// optional items before anything becomes a draft. Sending is never this module's
// business.
//
// Three classes of history entry:
//   safe    - visits, field reports, photos: the report's default content
//   opt-in  - ordinary logged notes: offered in review, excluded until ticked
//   private - never offered: internal text-derived summaries (Instinct customer/
//             internal texts), email notes, and account/payment-hold operational
//             notes. These stay in the Hub.
export const REPORT_SAFE = "safe";
export const REPORT_OPT_IN = "opt-in";
export const REPORT_PRIVATE = "private";

const INTERNAL_NOTE = /^\s*instinct\s*\(/i;
const PAYMENT_HOLD = /\b(?:payment|account|billing)[^.\n]{0,30}\bhold\b|\bhold\b[^.\n]{0,30}\b(?:payment|account|billing)\b/i;

export function classifyReportEntry(entry) {
  if (!entry) return REPORT_PRIVATE;
  if (entry.kind === "visit" || entry.kind === "change" || entry.kind === "report") return REPORT_SAFE;
  if (entry.kind === "file") return REPORT_SAFE;
  if (entry.kind === "stage") return REPORT_SAFE;
  if (entry.kind === "note") {
    const body = String(entry.note?.body || "");
    if (INTERNAL_NOTE.test(body)) return REPORT_PRIVATE;               // Instinct text/internal summaries
    if ((entry.note?.interaction_type || "") === "email") return REPORT_PRIVATE;
    if (PAYMENT_HOLD.test(body)) return REPORT_PRIVATE;                // account/payment-hold ops notes
    return REPORT_OPT_IN;                                              // ordinary note: owner may include
  }
  return REPORT_PRIVATE;                                               // service items, unknown kinds
}

const md = (date) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date || "");
  return m ? `${Number(m[2])}/${Number(m[3])}/${m[1]}` : date;
};

function entryLines(entry, noteTexts) {
  if (entry.kind === "visit") {
    const ev = entry.ev || {};
    const head = `Visit${ev.crew ? ` - ${ev.crew}` : ""}`;
    const reports = (entry.reports || []).map((r) => r.text).filter(Boolean);
    return [head, ...reports];
  }
  if (entry.kind === "change") return ["Visit rescheduled"];
  if (entry.kind === "report") return entry.report?.text ? [entry.report.text] : ["Field report"];
  if (entry.kind === "file") return [];
  if (entry.kind === "stage") return [];
  if (entry.kind === "note" && noteTexts.has(entry.note?.id)) {
    const t = String(entry.note?.body || "").trim();
    return t ? [t] : [];
  }
  return [];
}

function entryPhotos(entry, noteTexts) {
  if (entry.kind === "visit") return (entry.reports || []).flatMap((r) => r.photos || []);
  if (entry.kind === "report") return entry.report?.photos || [];
  if (entry.kind === "note" && noteTexts.has(entry.note?.id)) return entry.note?.attachments || [];
  return [];
}

// scope: { kind: "job" } for the whole timeline, { kind: "day", date } for one day.
export function composeJobReport({ job, entries, scope = { kind: "job" }, selectedNoteIds = [], photoCap = 20 } = {}) {
  const noteTexts = new Set(selectedNoteIds);
  const inScope = (entries || []).filter((e) => (scope.kind === "day" ? e.date === scope.date : true));
  const days = new Map();
  const excluded = { private: 0, optIn: 0 };
  const photos = [];
  const seenPhoto = new Set();

  for (const e of [...inScope].sort((a, b) => a.when.localeCompare(b.when))) {
    const cls = classifyReportEntry(e);
    if (cls === REPORT_PRIVATE) { excluded.private += e.kind === "note" ? 1 : 0; continue; }
    if (cls === REPORT_OPT_IN) {
      if (!noteTexts.has(e.note?.id)) { excluded.optIn += 1; continue; }
    }
    const lines = entryLines(e, noteTexts);
    const pics = entryPhotos(e, noteTexts);
    if (!lines.length && !pics.length) continue;
    const list = days.get(e.date) || [];
    list.push(...lines);
    days.set(e.date, list);
    for (const url of pics) {
      if (!url || seenPhoto.has(url)) continue;
      seenPhoto.add(url);
      photos.push({ url, date: e.date });
    }
  }

  const name = job?.canonical_name || "Job";
  const scopeText = scope.kind === "day" ? `visits on ${md(scope.date)}` : "whole job timeline";
  const body = [];
  body.push(`Job report - ${name}`);
  if (job?.address) body.push(job.address);
  body.push(`Scope: ${scopeText}`);
  body.push("");
  for (const [date, lines] of [...days.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    body.push(md(date));
    for (const line of lines) body.push(`  ${line}`);
    body.push("");
  }
  const capped = photos.slice(0, photoCap);
  const warnings = [];
  if (photos.length > photoCap) warnings.push(`${photos.length - photoCap} photos left out (cap ${photoCap}).`);
  if (!days.size) warnings.push("Nothing report-safe in this scope yet - tick notes in review or pick another section.");
  if (excluded.private) body.push(`(${excluded.private} internal note${excluded.private === 1 ? "" : "s"} kept private)`);
  body.push(capped.length ? `Photos: ${capped.length} attached` : "Photos: none");
  const subject = `${name} - ${scope.kind === "day" ? `job report ${md(scope.date)}` : "job report"}`;
  return {
    subject,
    text: body.join("\n").replace(/\n{3,}/g, "\n\n").trim(),
    photos: capped,
    counts: { days: days.size, photos: capped.length, excludedPrivate: excluded.private, notesAvailable: excluded.optIn },
    warnings,
  };
}
