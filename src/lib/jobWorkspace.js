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

// Short scope lines for "The work". Money lines stay out of the glance view.
export function workLines(scope, max = 5) {
  return scopeText(scope)
    .split(/\n|•|;\s+/)
    .map((l) => l.replace(/^[\s\-*·]+/, "").replace(/\s+/g, " ").trim())
    .filter((l) => l.length > 2 && !/\$\s?\d/.test(l) && !/^(po|oe)\b[\s#:]/i.test(l) && !/^(labor|price|total)\b/i.test(l))
    .slice(0, max);
}

const uniq = (list) => [...new Set(list.map((v) => String(v || "").trim()).filter(Boolean))];

export function jobSnapshot({ job, events, status, today }) {
  const evs = live(events).sort((a, b) => dayOf(a).localeCompare(dayOf(b)) || String(a.start_time || "").localeCompare(String(b.start_time || "")));
  const next = evs.find((e) => dayOf(e) >= today) || null;
  const past = evs.filter((e) => dayOf(e) < today);
  const last = past.length ? past[past.length - 1] : null;
  const focus = next || last;
  const kindKey = focus ? eventKind(focus) : null;
  const unreported = evs.filter((e) => reportMissing(e, today) && dayOf(e) <= today);
  const late = unreported.length ? unreported[unreported.length - 1] : null;

  let step;
  if (status?.key === "needs_report" && late) {
    const d = Number(late.days_late) || 0;
    step = { tone: d > 0 ? "bad" : "warn", tag: d > 0 ? "Report late" : "Report due", text: `The ${friendlyDay(dayOf(late), today)} visit still has no field report.` };
  } else if (next) {
    const first = workLines(next.scope_notes, 1)[0];
    const when = friendlyDay(dayOf(next), today);
    step = { tone: dayOf(next) === today ? "teal" : "neutral", tag: when, text: `${when === "Today" ? "Today" : "Visit"}, ${visitTime(next)}${first ? `. ${first}` : "."}` };
  } else if (status?.key === "needs_review") {
    step = { tone: "warn", tag: "Review", text: "Billing lines need to be matched to this job." };
  } else {
    step = { tone: "neutral", tag: status?.label || "Job", text: last ? `No visit booked. Last one was ${friendlyDay(dayOf(last), today)}.` : "No visit on the calendar yet." };
  }

  const pos = uniq([...(job?.po_numbers || []), ...evs.map((e) => e.po_number)]);
  const oes = uniq([...(job?.oe_numbers || []), ...evs.map((e) => e.oe_number)]);
  const facts = [
    next ? { k: "Next visit", v: `${friendlyDay(dayOf(next), today)} · ${visitTime(next)}`, tone: "teal" }
      : { k: "Last visit", v: last ? friendlyDay(dayOf(last), today) : "None yet" },
    { k: "Crew", v: crewName(focus?.crew || focus?.created_by) || "—" },
    { k: "PO", v: pos[0] || "—", mono: true },
    { k: "OE", v: oes[0] || "—", mono: true },
  ];
  const refs = [...pos.map((p) => `PO ${p}`), ...oes.map((o) => `OE ${o}`)];

  return {
    next, last, kind: kindKey ? KIND[kindKey].label : "", step, facts, refs,
    work: workLines(focus?.scope_notes),
    workFrom: focus ? friendlyDay(dayOf(focus), today) : "",
  };
}
