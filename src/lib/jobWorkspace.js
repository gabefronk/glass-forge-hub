// What the installer or super needs at a glance for one job: next step,
// four facts, the work, and order numbers. Pure so it can be tested.
import { eventKind, KIND, reportMissing } from "@/lib/calendarModel";
import { crewName, formatShort } from "@/lib/feeUI";
import { addDays } from "@/lib/jobsOverview";

const dayOf = (e) => String(e?.event_date || "").slice(0, 10);
const live = (events) => (events || []).filter((e) => e?.event_date && e.source_status !== "cancelled");

export function friendlyDay(day, today) {
  if (!day) return "";
  if (day === today) return "Today";
  if (day === addDays(today, 1)) return "Tomorrow";
  if (day === addDays(today, -1)) return "Yesterday";
  return formatShort(day);
}

export function visitTime(e) {
  if (!e) return "";
  return e.start_time ? `${e.start_time}${e.end_time ? `–${e.end_time}` : ""}` : "all day";
}

export function scopeText(html) {
  return String(html || "")
    .replace(/<\s*br\s*\/?>/gi, "\n").replace(/<\/(p|div|li)>/gi, "\n").replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;/g, "'").replace(/&quot;/g, "\"");
}

const PHONE_RE = /\(?\b\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4}\b/;
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const CONTACT_LABEL_RE = /^(?:spr|super(?:intendent)?|sup|pm|project manager|site contact|contact|email|e-mail|phone|cell|mobile)\b\s*[:#\-]?/i;

// Short scope lines for "The work". Money lines stay out of the glance view,
// and contact details and order numbers are lifted out (they show elsewhere),
// but the words that remain are the scheduler's own, never reworded.
export function workLines(scope, max = 5) {
  const seen = new Set();
  return scopeText(scope)
    .split(/\n|•|;\s+|\s·\s/)
    .map((l) => l
      .replace(/\*?\s*(?:orig(?:inal)?\.?\s*)?(?:po|oe)\s*#?\s*:?\s*[\w-]{5,}\s*\*?/gi, " ")
      .replace(/^[\s\-*·]+|[\s*]+$/g, "")
      .replace(/\*/g, "")
      .replace(/\s+/g, " ")
      .trim())
    .filter((l) => l.length > 2
      && !/\$\s?\d/.test(l)
      && !/^(po|oe)\b[\s#:]/i.test(l)
      && !/^(labor|price|total)\b/i.test(l)
      && !CONTACT_LABEL_RE.test(l)
      && !(EMAIL_RE.test(l) && l.replace(EMAIL_RE, "").replace(/[^A-Za-z]/g, "").length < 6)
      && !(PHONE_RE.test(l) && l.replace(PHONE_RE, "").replace(/[^A-Za-z]/g, "").length < 14))
    .filter((l) => { const k = l.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; })
    .slice(0, max);
}

// A super named in calendar notes, e.g. "SPR: Mike Shaw 385-230-1483 · Email: mikes@x.com".
// Returns null unless both a name and a phone are written next to the label.
export function findSuperInText(text) {
  const t = scopeText(text).replace(/\s+/g, " ");
  const m = t.match(/\b(?:spr|super(?:intendent)?|sup)\b\s*[:\-]?\s*([A-Z][a-zA-Z'.-]+(?:\s+[A-Z][a-zA-Z'.-]+){0,2})\s*[,:\-–]?\s*(\(?\d{3}\)?[\s.\-]?\d{3}[\s.\-]?\d{4})/i);
  if (!m) return null;
  const name = m[1].trim();
  if (/^(email|phone|cell|call|text|none|tbd)$/i.test(name)) return null;
  const digits = m[2].replace(/\D/g, "");
  const phone = `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  const after = t.slice(m.index, m.index + m[0].length + 140);
  const email = (after.match(EMAIL_RE) || [])[0] || "";
  return { name, phone, email: email.toLowerCase() };
}

const uniq = (list) => [...new Set(list.map((v) => String(v || "").trim()).filter(Boolean))];

// Visits come from the calendar, billing lines and field reports: a job worked
// from a ProBuild report still has a last visit even with no calendar event.
export function jobSnapshot({ job, events, rows = [], fieldReports = [], status, today }) {
  const evs = live(events).sort((a, b) => dayOf(a).localeCompare(dayOf(b)) || String(a.start_time || "").localeCompare(String(b.start_time || "")));
  const next = evs.find((e) => dayOf(e) >= today) || null;
  const past = evs.filter((e) => dayOf(e) < today);
  const lastEvent = past.length ? past[past.length - 1] : null;
  const reports = [...(fieldReports || [])].filter((r) => r?.job_date).sort((a, b) => String(a.job_date).localeCompare(String(b.job_date)));
  const lines = [...(rows || [])].filter((r) => r?.job_date).sort((a, b) => String(a.job_date).localeCompare(String(b.job_date)));
  const pastDays = [
    ...past.map(dayOf),
    ...reports.map((r) => String(r.job_date).slice(0, 10)).filter((d) => d <= today),
    ...lines.map((r) => String(r.job_date).slice(0, 10)).filter((d) => d <= today),
  ].sort();
  const lastDay = pastDays.length ? pastDays[pastDays.length - 1] : "";
  const lastReport = reports.filter((r) => String(r.job_date).slice(0, 10) <= today).pop() || null;
  const lastLine = lines.filter((r) => String(r.job_date).slice(0, 10) <= today).pop() || null;
  const focus = next || lastEvent;
  const kindKey = focus ? eventKind(focus) : null;
  const unreported = evs.filter((e) => reportMissing(e, today) && dayOf(e) <= today);
  const late = unreported.length ? unreported[unreported.length - 1] : null;

  let step;
  if (status?.key === "needs_report" && late) {
    const d = Number(late.days_late) || 0;
    step = { tone: d > 0 ? "bad" : "warn", tag: d > 0 ? "Report late" : "Report due", text: `The ${friendlyDay(dayOf(late), today)} visit still has no field report.` };
  } else if (status?.key === "needs_report") {
    step = { tone: "warn", tag: "Report due", text: lastDay ? `The ${friendlyDay(lastDay, today)} visit still needs its field report.` : "A visit still needs its field report." };
  } else if (next) {
    const first = workLines(next.scope_notes, 1)[0];
    const when = friendlyDay(dayOf(next), today);
    step = { tone: dayOf(next) === today ? "teal" : "neutral", tag: when, text: `${when === "Today" ? "Today" : "Visit"}, ${visitTime(next)}${first ? `. ${first}` : "."}` };
  } else if (status?.key === "needs_review") {
    step = { tone: "warn", tag: "Review", text: "Billing lines need to be matched to this job." };
  } else if (status?.key === "complete") {
    step = { tone: "teal", tag: "Done", text: lastDay ? `Work complete. Last visit was ${friendlyDay(lastDay, today)}.` : "Work complete." };
  } else {
    step = { tone: "neutral", tag: "Not booked", text: lastDay ? `No visit booked. Last visit was ${friendlyDay(lastDay, today)}.` : "No visit on the calendar yet." };
  }

  const pos = uniq([...(job?.po_numbers || []), ...evs.map((e) => e.po_number), ...lines.map((r) => r.po_number)]);
  const oes = uniq([...(job?.oe_numbers || []), ...evs.map((e) => e.oe_number), ...lines.map((r) => r.oe_number)]);
  const crew = crewName(focus?.crew || focus?.created_by || lastLine?.calendar_creator);
  const facts = [
    next ? { k: "Next visit", v: `${friendlyDay(dayOf(next), today)} · ${visitTime(next)}`, tone: "teal" }
      : { k: "Last visit", v: lastDay ? friendlyDay(lastDay, today) : "None yet" },
    { k: "Crew", v: crew || "—" },
    { k: "PO", v: pos[0] || "—", mono: true },
    { k: "OE", v: oes[0] || "—", mono: true },
  ];
  const refs = [...pos.map((p) => `PO ${p}`), ...oes.map((o) => `OE ${o}`)];

  // The work: calendar scope first; otherwise what the last field report said.
  let work = workLines(focus?.scope_notes);
  let workFrom = work.length && focus ? friendlyDay(dayOf(focus), today) : "";
  if (!work.length) {
    const text = lastReport?.message || lastLine?.note_text || lastLine?.probuild_note_text || "";
    work = workLines(text, 4);
    const day = lastReport ? String(lastReport.job_date).slice(0, 10) : lastLine ? String(lastLine.job_date).slice(0, 10) : "";
    workFrom = work.length && day ? `from the ${friendlyDay(day, today)} report` : "";
  }

  return { next, last: lastEvent, lastDay, kind: kindKey ? KIND[kindKey].label : "", step, facts, refs, work, workFrom };
}
