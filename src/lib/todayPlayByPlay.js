// Pure model for the Today tab's play-by-play. Google-normalized CalendarEvents
// are the scheduling source of truth; the Hub only links them to jobs and shows
// them beside the tasks the personal views already put on the day. Read-only:
// nothing here fetches, writes or reads the clock unless `now` is handed in, so
// the same records always produce the same timeline and the same briefing.
//
// Deliberately absent: travel time, drive time and route duration. None of that
// exists in the records, so the briefing never states it. An item without an
// exact start time is called all-day or unscheduled, never guessed into a slot.

import { addDays, reportBadge } from "@/lib/calendarModel";

const text = (value) => String(value ?? "").trim();
const dayText = (value) => (/^\d{4}-\d{2}-\d{2}/.test(text(value)) ? text(value).slice(0, 10) : "");

// Inlined twin of denverDate (base44/shared/billingCore.js) — platform guard
// blocks new src files from importing base44/shared. America/Denver today.
export const denverDate = (value = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));

// Inlined twin of isIgnoredWorkItem: the owner's "Renta" reminder is not work.
export const isIgnoredWorkItem = (row) =>
  text(row?.job_name || row?.summary || row?.title).normalize("NFKC").toLowerCase().replace(/[.,;:!?]+$/, "").trim() === "renta";

export const titleOf = (event) => text(event?.job_name) || text(event?.summary) || text(event?.title) || "(untitled)";
export const locationOf = (event) => text(event?.address) || text(event?.source_location);

// An ordinary Google Maps search for the address already on the record. Built
// here, opened only when the user taps it: no address leaves the page by itself.
export const directionsUrl = (location) =>
  (text(location) ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(text(location))}` : "");

// HH:MM 24h only. Anything else (null, "", "all day", "8am") has no exact time.
export function minutesOf(time) {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(text(time));
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

// America/Denver wall clock as minutes past midnight, so the view can lead with
// the appointment running now. The only clock read in this file; dayPlan itself
// stays clock-free, and an unparseable hour simply yields null.
export const denverMinutes = (value = new Date()) =>
  minutesOf(new Intl.DateTimeFormat("en-GB", { timeZone: "America/Denver", hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value)));

export function timeLabel(event) {
  const start = minutesOf(event?.start_time);
  if (start === null) return "All day";
  const end = minutesOf(event?.end_time);
  return end === null ? text(event.start_time) : `${text(event.start_time)}–${text(event.end_time)}`;
}

// Google's all-day end_date is exclusive, so a row ending the next day is a
// single day. Only a longer span is worth saying out loud.
export function spanLabel(event) {
  const start = dayText(event?.event_date);
  const end = dayText(event?.end_date);
  if (minutesOf(event?.start_time) !== null || !start || !end) return "";
  const last = addDays(end, -1);
  return last > start ? `${start} through ${last}` : "";
}

// An all-day row can run past its own event_date; end_date is exclusive.
export function coversDay(event, day) {
  const start = dayText(event?.event_date);
  if (!start || !dayText(day)) return false;
  if (start === day) return true;
  const end = dayText(event?.end_date);
  return Boolean(end && start < day && day < end);
}

export const isCancelled = (event) =>
  ["cancelled", "canceled"].includes(text(event?.source_status).toLowerCase()) ||
  ["cancelled", "canceled"].includes(text(event?.status).toLowerCase());

// The Hub's etaCalendar function titles supplier ETAs "ETA - <builder> - <job>",
// and Google's own "tentative" status is provisional as well. Neither is a
// confirmed schedule, so both are labelled instead of read as a commitment.
const ETA_TITLE_RE = /^eta\s*-/i;
export const isProvisional = (event) =>
  ETA_TITLE_RE.test(titleOf(event)) ||
  text(event?.builder).toLowerCase() === "eta" ||
  text(event?.source_status).toLowerCase() === "tentative";

export const SOURCE_BADGES = {
  google: { key: "google", label: "Google Calendar", tone: { text: "#34506A", bg: "#E7EDF2", border: "#C7D8EF" } },
  app: { key: "app", label: "Hub event", tone: { text: "#082F2C", bg: "#E2EEEB", border: "#C7E4D2" } },
  outlook: { key: "outlook", label: "Outlook · read-only", tone: { text: "#4B3470", bg: "#EDE8F5", border: "#D6CBEA" } },
  task: { key: "task", label: "Hub task", tone: { text: "#6F4E10", bg: "#FAF0DA", border: "#EFDFB7" } },
  unknown: { key: "unknown", label: "Unlabelled source", tone: { text: "#566063", bg: "#F3EFE7", border: "#E2DCD1" } },
};
export const sourceBadge = (event) => SOURCE_BADGES[text(event?.source).toLowerCase()] || SOURCE_BADGES.unknown;

export function scheduleStatus(event) {
  if (isProvisional(event)) return { key: "provisional", label: "Provisional ETA" };
  if (text(event?.report_status).toLowerCase() === "rescheduled") return { key: "rescheduled", label: "Rescheduled" };
  if (text(event?.source_status).toLowerCase() === "confirmed") return { key: "confirmed", label: "Confirmed" };
  return { key: "scheduled", label: "Scheduled" };
}

// Stable identifiers a mirrored copy shares with its original. The Hub keeps the
// sanitized installer event's id on the row it was pushed from, so a pulled
// installer copy carries an id the source row already names.
export const sourceIds = (event) =>
  [text(event?.google_event_id), text(event?.installer_event_id), text(event?.source_occurrence_key)].filter(Boolean);

// Richest copy wins: the row that mirrors out (installer id), then the one
// carrying job notes, then the timed one. Ties fall to the lower record id so
// the result never depends on load order.
const rank = (event) => (text(event?.installer_event_id) ? 4 : 0) + (text(event?.scope_notes) ? 2 : 0) + (minutesOf(event?.start_time) !== null ? 1 : 0);
const outranks = (candidate, held) => (rank(candidate) !== rank(held) ? rank(candidate) > rank(held) : text(candidate?.id) < text(held?.id));

export function dedupeEvents(events) {
  const bySourceId = new Map();
  const slots = [];
  for (const event of events || []) {
    if (!event) continue;
    const ids = sourceIds(event);
    let slot = null;
    for (const id of ids) if (bySourceId.has(id)) { slot = bySourceId.get(id); break; }
    if (!slot) {
      slot = { event, merged: [], jobId: text(event.job_id) };
      slots.push(slot);
    } else {
      const replace = outranks(event, slot.event);
      const dropped = replace ? slot.event : event;
      if (replace) slot.event = event;
      slot.merged.push(text(dropped.id) || sourceIds(dropped)[0] || "");
      slot.jobId = slot.jobId || text(event.job_id);
    }
    for (const id of ids) if (!bySourceId.has(id)) bySourceId.set(id, slot);
  }
  // A mirrored copy is dropped, never its job link: the kept row inherits a job
  // id only when it has none of its own.
  return slots.map(({ event, merged, jobId }) => {
    if (!merged.length) return event;
    const kept = { ...event, merged_source_ids: merged.filter(Boolean) };
    return !text(kept.job_id) && jobId ? { ...kept, job_id: jobId, job_link_inherited: true } : kept;
  });
}

// Outlook is read-only and only trusted while a complete import actually covers
// the day. Same 26-hour window the Calendar page's source bar uses.
export const OUTLOOK_MAX_AGE_HOURS = 26;
export function outlookState(snapshot, day, now = Date.now()) {
  if (!snapshot) return { available: false, reason: "none", note: "No Outlook import is loaded, so no Outlook items are shown." };
  const start = dayText(snapshot.range_start), end = dayText(snapshot.range_end);
  const label = `${start || "?"}–${end || "?"}`;
  if (snapshot.complete === false) return { available: false, reason: "incomplete", note: `The Outlook import (${label}) is incomplete, so no Outlook items are shown.` };
  if (!start || !end || day < start || day > end) return { available: false, reason: "out_of_range", note: `The Outlook import covers ${label}, not ${day}, so no Outlook items are shown.` };
  const captured = Date.parse(text(snapshot.captured_at));
  const ageHours = Number.isFinite(captured) ? (Number(now) - captured) / 3600000 : null;
  if (ageHours === null) return { available: false, reason: "undated", note: `The Outlook import (${label}) has no capture time, so no Outlook items are shown.` };
  if (ageHours > OUTLOOK_MAX_AGE_HOURS) return { available: false, reason: "stale", note: `The Outlook import is ${Math.round(ageHours)}h old (over ${OUTLOOK_MAX_AGE_HOURS}h), so no Outlook items are shown.`, ageHours };
  return { available: true, reason: "current", note: `Outlook import ${label} is ${Math.round(ageHours)}h old and covers today.`, ageHours };
}

const jobLabel = (jobs, id) => (id ? text((jobs || []).find((job) => job && job.id === id)?.canonical_name) : "");

export function eventItem(event, { jobs = [], today = "" } = {}) {
  const start = minutesOf(event.start_time);
  const status = scheduleStatus(event);
  // The field-report chip is dropped when it would only repeat the status.
  const report = reportBadge(event, today);
  return {
    key: `event:${text(event.id) || sourceIds(event)[0] || titleOf(event)}`,
    kind: "event",
    title: titleOf(event),
    start,
    end: minutesOf(event.end_time),
    timeLabel: timeLabel(event),
    allDay: start === null,
    span: spanLabel(event),
    location: locationOf(event),
    jobId: text(event.job_id),
    jobName: jobLabel(jobs, text(event.job_id)) || (text(event.job_id) ? titleOf(event) : ""),
    source: sourceBadge(event),
    status,
    report: report && report.label !== status.label ? report : null,
    mergedSourceIds: event.merged_source_ids || [],
    conflicts: [],
  };
}

// Why a task is on today, straight from its own dates. A focus date is a plan,
// never a deadline, so it is worded that way.
export function taskReason(task, today) {
  const due = dayText(task?.due_date), focus = dayText(task?.focus_date), follow = dayText(task?.follow_up_date);
  const waiting = text(task?.waiting_on);
  if (due && due < today) return { key: "overdue", label: `Overdue · was due ${due}` };
  if (due === today) return { key: "due", label: "Due today" };
  if (waiting && follow && follow <= today) return { key: "follow_up", label: `Follow up on ${waiting}` };
  if (text(task?.status) === "in_progress") return { key: "in_progress", label: "In progress" };
  if (focus && focus < today) return { key: "planned", label: `Planned for ${focus}` };
  if (focus === today) return { key: "planned", label: "Planned for today" };
  return { key: "listed", label: "On your list" };
}

export function taskItem(task, { jobs = [], today = "" } = {}) {
  return {
    key: `task:${text(task.id)}`,
    kind: "task",
    title: text(task.title) || "(untitled task)",
    start: null,
    end: null,
    timeLabel: "No set time",
    allDay: false,
    span: "",
    location: "",
    jobId: text(task.job_id),
    jobName: jobLabel(jobs, text(task.job_id)),
    source: SOURCE_BADGES.task,
    status: taskReason(task, today),
    report: null,
    mergedSourceIds: [],
    conflicts: [],
  };
}

// Two timed items clash when their minutes overlap, or when they start at the
// same minute (a shared start with no end is still two places at once).
export function overlapping(a, b) {
  if (a.start === null || b.start === null) return false;
  if (a.start === b.start) return true;
  const endA = a.end !== null && a.end > a.start ? a.end : a.start;
  const endB = b.end !== null && b.end > b.start ? b.end : b.start;
  return a.start < endB && b.start < endA;
}

// Each overlapping item names the others it clashes with, so the row can say so.
export function markOverlaps(items) {
  const marked = items.map((item) => ({ ...item, conflicts: [] }));
  for (let i = 0; i < marked.length; i += 1) {
    for (let j = i + 1; j < marked.length; j += 1) {
      if (!overlapping(marked[i], marked[j])) continue;
      marked[i].conflicts.push(marked[j].title);
      marked[j].conflicts.push(marked[i].title);
    }
  }
  return marked;
}

const count = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Facts only, in a fixed order, each one read off an item already in the day.
export function briefingLines(plan) {
  const { timed, allDay, unscheduled } = plan;
  const lines = [];
  if (!timed.length && !allDay.length && !unscheduled.length) return ["Nothing on the calendar and no tasks on your list for today."];
  lines.push(`${count(timed.length, "timed event", "timed events")}, ${count(allDay.length, "all-day item", "all-day items")}, ${count(unscheduled.length, "task", "tasks")}.`);
  if (timed.length) {
    const first = timed[0];
    lines.push(`First timed: ${first.timeLabel} · ${first.title}${first.location ? ` · ${first.location}` : ""}.`);
    const lastEnd = timed.filter((item) => item.end !== null).sort((a, b) => a.end - b.end).pop();
    if (lastEnd) lines.push(`Last timed item ends ${lastEnd.timeLabel.split("–")[1]}.`);
  } else if (allDay.length) {
    lines.push("No exact times today: every calendar item is all-day.");
  }
  const clashing = timed.filter((item) => item.conflicts.length);
  if (clashing.length) lines.push(`${count(clashing.length, "timed item overlaps", "timed items overlap")} another: ${clashing.map((item) => item.title).join("; ")}.`);
  const provisional = [...timed, ...allDay].filter((item) => item.status.key === "provisional");
  if (provisional.length) lines.push(`${count(provisional.length, "item is a provisional ETA", "items are provisional ETAs")}, not a confirmed schedule.`);
  const rescheduled = [...timed, ...allDay].filter((item) => item.status.key === "rescheduled");
  if (rescheduled.length) lines.push(`${count(rescheduled.length, "item is marked rescheduled", "items are marked rescheduled")}.`);
  return lines;
}

// One plain sentence for the top of My Day, read off the same items as the
// briefing: counts and the first start time, nothing from the clock and nothing
// the records do not already say. The briefing itself is kept, in full, below.
export function daySummary(plan) {
  const { timed = [], allDay = [], unscheduled = [] } = plan || {};
  if (!timed.length && !allDay.length && !unscheduled.length) return "Nothing on your calendar and no tasks on your list today.";
  const parts = [];
  if (timed.length) parts.push(`${count(timed.length, "timed appointment", "timed appointments")}, starting ${timed[0].timeLabel.split("–")[0]}`);
  else parts.push("No timed appointment");
  if (allDay.length) parts.push(`${count(allDay.length, "all-day job", "all-day jobs")} running`);
  if (unscheduled.length) parts.push(`${count(unscheduled.length, "task", "tasks")} with no set time`);
  return `${parts.join(" · ")}.`;
}

// The appointment to lead with: the one running now, else the next one to start,
// else none left today. Pure — the wall clock is handed in, and without one the
// first appointment of the day leads.
export function nextUp(timed = [], nowMinutes = null) {
  if (!timed.length) return { key: "", state: "none" };
  if (nowMinutes === null || nowMinutes === undefined) return { key: timed[0].key, state: "next" };
  // An item with no end is "now" for its own minute only; it claims no span.
  const running = timed.find((item) => nowMinutes >= item.start && nowMinutes < (item.end !== null && item.end > item.start ? item.end : item.start + 1));
  if (running) return { key: running.key, state: "now" };
  const upcoming = timed.find((item) => item.start > nowMinutes);
  return upcoming ? { key: upcoming.key, state: "next" } : { key: "", state: "done" };
}

// The whole day in one object: timed items in order, all-day items and tasks
// kept apart, overlaps marked, and a briefing read off the items themselves.
export function dayPlan({ events = [], tasks = [], jobs = [], today, outlook = null, now = Date.now() }) {
  const day = dayText(today);
  const source = outlookState(outlook, day, now);
  const usable = dedupeEvents((events || []).filter((event) => event && coversDay(event, day) && !isCancelled(event) && !isIgnoredWorkItem(event) && (text(event.source).toLowerCase() !== "outlook" || source.available)));
  const items = usable.map((event) => eventItem(event, { jobs, today: day }));
  const timed = markOverlaps(items.filter((item) => !item.allDay).sort((a, b) => a.start - b.start || a.title.localeCompare(b.title)));
  const allDay = items.filter((item) => item.allDay).sort((a, b) => a.title.localeCompare(b.title));
  const unscheduled = (tasks || [])
    .filter((task) => task && !isIgnoredWorkItem({ job_name: task.title }))
    .map((task) => taskItem(task, { jobs, today: day }));
  const plan = { today: day, timed, allDay, unscheduled, outlook: source, conflicts: timed.filter((item) => item.conflicts.length).length };
  return { ...plan, briefing: briefingLines(plan), empty: !timed.length && !allDay.length && !unscheduled.length };
}
