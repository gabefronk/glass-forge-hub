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

const tagCase = (t) => t.toLowerCase().replace(/(^|[\s/-])([a-z])/g, (m, a, b) => a + b.toUpperCase());
const clean = (t) => String(t || "").replace(/\s+/g, " ").replace(/^[\s\-–—:|,;.#]+|[\s\-–—:|,;#]+$/g, "").trim();
const LINE_REF_RE = /\s*[-–]?\s*\(\s*line\s*#?\s*:?\s*(\d+)\s*\)/i;
const HEAD_RE = /^(.{2,40}?)\s*[-–]\s*per report\s*:?\s*(.*)$/i;
const ITEM_RE = /^(\d{1,3})\s*(?:[-–—x×]|pcs?\b|ea\b)\s*(\S.*)$/i;

// Calendar notes as parts the eye can scan: tags (short all-caps headers),
// quantity line items (split on "|"), plain notes, and reference facts
// (ETA, received, vendor confirmation, AW#, PO, OE). Words are the
// scheduler's own; only capitals of all-caps headers are softened.
// keepMoney/keepContacts keep those lines as notes (the visit history does;
// the crew-facing Scope card does not). refs=false leaves PO/OE out (the job
// card already shows them), but still strips them from the text.
export function parseScopeNotes(text, { keepMoney = false, keepContacts = false, refs = true } = {}) {
  const out = { tags: [], items: [], notes: [], facts: [] };
  const seen = new Set();
  const once = (k) => { const key = k.toLowerCase(); if (seen.has(key)) return false; seen.add(key); return true; };
  const fact = (k, v) => { v = clean(v); if (v && once(`fact:${k}:${v}`)) out.facts.push({ k, v }); };
  const FACTS = [
    [/\bproduct eta\s*[–-]?\s*(wk of\s*:?\s*)?([\d/]+)/gi, (m) => fact("ETA", (m[1] ? "Wk of " : "") + m[2])],
    [/\breceived\s*:?\s*(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/gi, (m) => fact("Received", m[1])],
    [/\bvendor order\s*#?\s*:?\s*(?:confirmation (?:number|#)\s*:?\s*)?([\w-]{4,})/gi, (m) => fact("Vendor conf.", m[1])],
    [/\bconfirmation (?:number|#)\s*:?\s*([\w-]{4,})/gi, (m) => fact("Vendor conf.", m[1])],
    [/\bAW\s*#\s*:?\s*([\w-]{4,})/gi, (m) => fact("AW#", m[1])],
    [/\borig(?:inal)?\.?\s*po\s*#?\s*:?\s*([\w-]{5,})/gi, (m) => refs && fact("Orig. PO", m[1])],
    [/\bpo\s*#?\s*:?\s*(\d{5,}[\w-]*)/gi, (m) => refs && fact("PO", m[1])],
    [/\boe\s*#?\s*:?\s*(\d{5,}[\w-]*)/gi, (m) => refs && fact("OE", m[1])],
  ];
  const segs = scopeText(text).replace(/\*/g, "").split(/\n|•/).flatMap((l) => l.split(/\s*\|+\s*/));
  const queue = [...segs];
  while (queue.length) {
    let seg = queue.shift();
    for (const [re, add] of FACTS) seg = seg.replace(re, (...m) => { add(m); return " "; });
    seg = clean(seg);
    if (seg.length < 2) continue;
    const head = seg.match(HEAD_RE);
    if (head) {
      const tag = /[a-z]/.test(head[1]) ? clean(head[1]) : tagCase(clean(head[1]));
      if (once(`tag:${tag} · per report`)) out.tags.push(`${tag} · per report`);
      if (head[2]) queue.unshift(head[2]);
      continue;
    }
    const money = /\$\s?\d/.test(seg) || /^(labor|price|total)\b/i.test(seg);
    const contact = CONTACT_LABEL_RE.test(seg)
      || (EMAIL_RE.test(seg) && seg.replace(EMAIL_RE, "").replace(/[^A-Za-z]/g, "").length < 6)
      || (PHONE_RE.test(seg) && seg.replace(PHONE_RE, "").replace(/[^A-Za-z]/g, "").length < 14);
    if ((money && !keepMoney) || (contact && !keepContacts)) continue;
    const item = !money && !contact ? seg.match(ITEM_RE) : null;
    if (item && /[A-Za-z]/.test(item[2])) {
      let rest = item[2]; let line = "";
      const ref = rest.match(LINE_REF_RE);
      if (ref) { line = ref[1]; rest = rest.replace(LINE_REF_RE, " "); }
      rest = clean(rest);
      if (once(`item:${item[1]}:${rest}`)) out.items.push({ qty: Number(item[1]), text: rest, line });
      continue;
    }
    if (!/[a-z]/.test(seg) && /[A-Z]{3}/.test(seg) && seg.length <= 40 && !money) {
      const tag = tagCase(seg);
      if (once(`tag:${tag}`)) out.tags.push(tag);
      continue;
    }
    const note = clean(seg.replace(LINE_REF_RE, " ")) + (/[.!?)]$/.test(seg) ? "" : "");
    if (note && once(`note:${note}`)) out.notes.push(note);
  }
  return out;
}

export const scopeIsEmpty = (p) => !p || (!p.tags.length && !p.items.length && !p.notes.length && !p.facts.length);

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

// The one person to call for a job, in order of trust:
// 1. a linked superintendent, 2. a superintendent the directory suggests,
// 3. a super written in calendar notes (newest event first),
// 4. any other linked contact. source tells the UI whether it can be saved.
export function pickSuper({ saved, view, events } = {}) {
  if (saved?.name) return { name: saved.name, phone: saved.phone || "", email: saved.email || "", role: "superintendent", source: "linked", key: saved.key || "" };
  const linked = view?.linked || [];
  const sup = linked.find((c) => c.role === "superintendent");
  if (sup) return { name: sup.name || "", phone: sup.phone || "", email: sup.email || "", role: "superintendent", source: "linked", key: sup.key || "" };
  const sug = (view?.suggestions || []).find((s) => s.role === "superintendent" && s.contact?.key && !s.already_linked && s.confidence !== "low");
  if (sug) return { name: sug.contact.name || "", phone: sug.contact.phone || "", email: sug.contact.email || "", role: "superintendent", source: "suggestion", key: sug.contact.key };
  const newest = [...(events || [])].filter((e) => e?.scope_notes).sort((a, b) => dayOf(b).localeCompare(dayOf(a)));
  for (const e of newest) {
    const found = findSuperInText(e.scope_notes);
    if (found) {
      const known = linked.find((c) => String(c.phone || "").replace(/\D/g, "").endsWith(found.phone.replace(/\D/g, "")));
      if (known) return { name: known.name || found.name, phone: known.phone || found.phone, email: known.email || found.email, role: known.role || "superintendent", source: "linked", key: known.key || "" };
      return { ...found, role: "superintendent", source: "notes", key: "", day: dayOf(e) };
    }
  }
  // The homeowner / customer has its own slot under the super, so it never fills the super's.
  const ROLE_RANK = ["project_manager", "site", "builder"];
  const other = [...linked].filter((c) => (c.phone || c.email) && c.role !== "homeowner" && c.role !== "customer").sort((a, b) => (ROLE_RANK.indexOf(a.role) + 99) % 99 - (ROLE_RANK.indexOf(b.role) + 99) % 99)[0];
  if (other) return { name: other.name || "", phone: other.phone || "", email: other.email || "", role: other.role || "", source: "linked", key: other.key || "" };
  return null;
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

  const workText = workLines(focus?.scope_notes).length ? String(focus?.scope_notes || "") : (lastReport?.message || lastLine?.note_text || lastLine?.probuild_note_text || "");
  // workEventId: the visit whose calendar notes the Scope card shows, so the Visits
  // feed can skip repeating them. primaryPo/Oe: the refs shown once in "The job".
  const workEventId = workLines(focus?.scope_notes).length && !scopeIsEmpty(parseScopeNotes(focus.scope_notes, { refs: false })) ? (focus?.id || null) : null;
  return { next, last: lastEvent, lastDay, kind: kindKey ? KIND[kindKey].label : "", step, facts, refs, work, workFrom, workText, workEventId, primaryPo: pos[0] || "", primaryOe: oes[0] || "" };
}
