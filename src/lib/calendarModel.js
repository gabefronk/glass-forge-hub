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

// A visit on or before `today` still waiting on its field report. Future visits
// default to "pending" in the data, so they are never flagged.
export function reportMissing(e, today) {
  if (today && dayOf(e) > today) return false;
  return e?.report_required !== false && OPEN_REPORT.includes(e?.report_status);
}

// The "Needs report" filter also keeps rescheduled visits, as the old "Unreported only" toggle did.
export function needsReportFilter(e, today) {
  if (today && dayOf(e) > today) return false;
  return e?.report_required !== false && [...OPEN_REPORT, "rescheduled"].includes(e?.report_status);
}

// Small report chip for a visit, or null when there is nothing worth showing
// (future visits, no report needed, unaudited or pre-compliance events).
export function reportBadge(e, today) {
  if (!e?.report_status || e.report_required === false) return null;
  if (today && dayOf(e) > today) return null;
  const late = Number(e.days_late) || 0;
  switch (e.report_status) {
    case "ok": return { label: "Reported", text: "#082F2C", bg: "#E2EEEB", border: "#C7E4D2" };
    case "waived": return { label: "Report waived", text: "#566063", bg: "#F3EFE7", border: "#E2DCD1" };
    case "rescheduled": return { label: "Rescheduled", text: "#566063", bg: "#F3EFE7", border: "#E2DCD1" };
    case "pending":
    case "missing_photos":
    case "missing_notes":
    case "missing_all": {
      const what = { missing_photos: "Needs photos", missing_notes: "Needs notes" }[e.report_status] || "Needs report";
      if (late > 0) return { label: `${what} · ${late}d late`, text: "#A43432", bg: "#FCEDEC", border: "#F0C9C5" };
      return { label: what, text: "#6F4E10", bg: "#FAF0DA", border: "#EFDFB7" };
    }
    default: return null;
  }
}

export function filterEvents(events, filter = "all", today) {
  if (filter === "all") return events;
  if (filter === "needs_report") return events.filter((e) => needsReportFilter(e, today));
  return events.filter((e) => eventKind(e) === filter);
}

export function kindCounts(events, today) {
  const c = { all: events.length, install: 0, service: 0, outlook: 0, needs_report: 0 };
  for (const e of events) {
    c[eventKind(e)]++;
    if (needsReportFilter(e, today)) c.needs_report++;
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
