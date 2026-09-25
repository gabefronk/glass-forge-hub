// Pure helpers for the Calendar page: event kind and colours, report flags,
// kind filters, week math and the month summary. No UTC date math anywhere:
// days are YYYY-MM-DD strings in Denver time.

export const KIND = {
  install: { label: "Install", text: "#082F2C", bg: "#E2EEEB", border: "#C7E4D2", bar: "#0B3F3B" },
  service: { label: "Service", text: "#A43432", bg: "#FCEDEC", border: "#F0C9C5", bar: "#A43432" },
  outlook: { label: "Outlook", text: "#34506A", bg: "#E7EDF2", border: "#C7D8EF", bar: "#34506A" },
};

// App-created events are installs; Google-sourced ones are service calls; Outlook stays separate.
export function eventKind(e) {
  if (e?.source === "outlook") return "outlook";
  return e?.source === "app" ? "install" : "service";
}

const OPEN_REPORT = ["pending", "missing_photos", "missing_notes", "missing_all"];

// A past visit still waiting on its field report (the red flag on the grid).
export function reportMissing(e) {
  return e?.report_required !== false && OPEN_REPORT.includes(e?.report_status);
}

// The "Needs report" filter also keeps rescheduled visits, as the old "Unreported only" toggle did.
export function needsReportFilter(e) {
  return e?.report_required !== false && [...OPEN_REPORT, "rescheduled"].includes(e?.report_status);
}

export const REPORT_LABEL = {
  ok: "Report complete",
  complete: "Report complete",
  pending: "Report due",
  missing_photos: "Missing photos",
  missing_notes: "Missing notes",
  missing_all: "Report missing",
  rescheduled: "Rescheduled",
  waived: "Report waived",
  not_required: "No report needed",
};

export function reportBadge(e) {
  if (!e?.report_status || e.report_required === false) return null;
  const label = REPORT_LABEL[e.report_status];
  if (!label) return null;
  if (reportMissing(e)) return { label, text: "#6F4E10", bg: "#FAF0DA", border: "#EFDFB7" };
  if (e.report_status === "rescheduled") return { label, text: "#566063", bg: "#F3EFE7", border: "#E2DCD1" };
  return { label, text: "#082F2C", bg: "#E2EEEB", border: "#C7E4D2" };
}

export function filterEvents(events, filter = "all") {
  if (filter === "all") return events;
  if (filter === "needs_report") return events.filter(needsReportFilter);
  return events.filter((e) => eventKind(e) === filter);
}

export function kindCounts(events) {
  const c = { all: events.length, install: 0, service: 0, outlook: 0, needs_report: 0 };
  for (const e of events) {
    c[eventKind(e)]++;
    if (needsReportFilter(e)) c.needs_report++;
  }
  return c;
}

export function addDays(day, days) {
  const [y, m, d] = day.split("-").map(Number);
  const dt = new Date(y, m - 1, d + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, "0")}-${String(dt.getDate()).padStart(2, "0")}`;
}

// The Sunday-to-Saturday week containing `day`, matching the month grid.
export function weekDays(day) {
  const [y, m, d] = day.split("-").map(Number);
  const start = addDays(day, -new Date(y, m - 1, d).getDay());
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}

export const dayOf = (e) => (e?.event_date || "").slice(0, 10);
export const byTime = (a, b) => (a.start_time || "99").localeCompare(b.start_time || "99") || String(a.job_name || "").localeCompare(String(b.job_name || ""));

// Events grouped by day, days ascending, events by start time.
export function groupByDay(events) {
  const map = new Map();
  for (const e of events) {
    const d = dayOf(e);
    if (!d) continue;
    if (!map.has(d)) map.set(d, []);
    map.get(d).push(e);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([day, list]) => ({ day, events: list.sort(byTime) }));
}

export function dayHeading(day, today) {
  const [y, m, d] = day.split("-").map(Number);
  const label = new Date(y, m - 1, d).toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  if (day === today) return `Today · ${label}`;
  if (day === addDays(today, 1)) return `Tomorrow · ${label}`;
  return label;
}

export function weekLabel(days) {
  const fmt = (day, opts) => { const [y, m, d] = day.split("-").map(Number); return new Date(y, m - 1, d).toLocaleDateString("en-US", opts); };
  const a = days[0], b = days[6];
  const sameMonth = a.slice(0, 7) === b.slice(0, 7);
  return `${fmt(a, { month: "short", day: "numeric" })} – ${fmt(b, sameMonth ? { day: "numeric", year: "numeric" } : { month: "short", day: "numeric", year: "numeric" })}`;
}
