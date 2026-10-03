// Where a window job stands, worked out from what the hub already has: calendar events,
// field reports and the job's status. Display only — nothing here is saved, and it never
// touches Jobs.stage (that field belongs to the parked job-handoff flow).
//
// Each stage is pinned to the day it happened so the Visits list can tag that day.
// The latest stage reached is "current"; the first one after it is "next".
import { visitFields, parseMD } from "./visitFields.js";

export const STAGES = [
  { key: "ordered", label: "Ordered" },
  { key: "received", label: "Received" },
  { key: "delivered", label: "Delivered" },
  { key: "installed", label: "Installed" },
  { key: "sheetrock", label: "Sheetrock windows" },
  { key: "screens", label: "Screen service" },
  { key: "complete", label: "Complete" },
];

const SCREEN_RE = /screen service|screens? (?:install|delivery|requested)|install all screens|window screens/i;
const minDate = (list) => list.filter(Boolean).sort()[0] || "";
const maxDate = (list) => list.filter(Boolean).sort().pop() || "";

export function jobProgress({ events = [], reports = [], status = null, today } = {}) {
  const evs = (events || [])
    .filter((e) => e?.event_date && e.source_status !== "cancelled")
    .map((e) => ({ ev: e, day: String(e.event_date).slice(0, 10), f: visitFields(e) }))
    .sort((a, b) => a.day.localeCompare(b.day));
  const past = evs.filter((x) => x.day <= today);
  const reportDays = (reports || []).map((r) => String(r?.date || "").slice(0, 10)).filter((d) => d && d <= today).sort();
  const hasReport = (x) => x.ev.report_status === "ok" || reportDays.includes(x.day);
  const isScreens = (x) => x.f.tags.some((t) => /screen service/i.test(t)) || SCREEN_RE.test(String(x.ev.scope_notes || ""));
  const isSheetrock = (x) => x.f.tags.includes("Sheetrock windows");
  const isInstall = (x) => x.f.type === "install";

  const at = {};
  const order = past.find((x) => x.f.type === "order");
  if (order) {
    const d = order.f.details.find((v) => v.k === "Ordered")?.v || "";
    at.ordered = /^\d{4}-\d{2}-\d{2}$/.test(d) ? d : order.day;
  }

  const firstInstall = past.find(isInstall);
  if (firstInstall) {
    const direct = firstInstall.f.delivery && /direct|will call/i.test(firstInstall.f.delivery.method);
    const directDay = direct ? parseMD(firstInstall.f.delivery.date, firstInstall.f.year) : "";
    at.delivered = minDate([firstInstall.day, directDay && directDay <= firstInstall.day ? directDay : ""]);
    const received = past.filter((x) => isInstall(x) && x.day <= firstInstall.day)
      .flatMap((x) => x.f.received.map((r) => parseMD(r, x.f.year)))
      .filter((d) => d && d <= at.delivered);
    if (received.length) at.received = maxDate(received);
    else if (direct) at.received = "skipped";
    const installedFromVisits = past.filter((x) => isInstall(x) && x.day >= at.delivered && x.ev.report_status === "ok").map((x) => x.day);
    const installedFromReports = reportDays.filter((d) => d >= at.delivered);
    const installed = minDate([...installedFromVisits, ...installedFromReports]);
    if (installed) at.installed = installed;
  }
  if (at.installed) {
    const sheet = past.find((x) => isSheetrock(x) && x.day >= at.installed && hasReport(x));
    if (sheet) at.sheetrock = sheet.day;
    const screens = past.find((x) => isScreens(x) && x.day >= at.installed && hasReport(x));
    if (screens) at.screens = screens.day;
  }
  if (at.screens && status?.key === "complete") {
    at.complete = maxDate([...past.map((x) => x.day), ...reportDays].filter((d) => d >= at.screens));
  }

  const reached = STAGES.map((s, i) => ({ ...s, n: i + 1 }))
    .filter((s) => at[s.key])
    .map((s) => (at[s.key] === "skipped" ? { ...s, date: "", skipped: true } : { ...s, date: at[s.key] }));
  const dated = reached.filter((s) => !s.skipped);
  const current = dated.length ? dated.reduce((a, b) => (b.n > a.n ? b : a)) : null;

  let next = null;
  if (current && current.key !== "complete") {
    const s = STAGES.slice(current.n).map((x, i) => ({ ...x, n: current.n + i + 1 })).find((x) => !at[x.key]);
    if (s) {
      const future = evs.filter((x) => x.day > today);
      const match = { received: isInstall, delivered: isInstall, installed: isInstall, sheetrock: isSheetrock, screens: isScreens }[s.key];
      next = { key: s.key, label: s.label, n: s.n, booked: !!(match && future.some(match)) };
    }
  }

  const byDate = {};
  for (const s of dated) (byDate[s.date] = byDate[s.date] || []).push({ key: s.key, label: s.label, n: s.n, current: s.key === current?.key });
  return { reached, current: current ? { key: current.key, label: current.label, n: current.n, date: current.date } : null, next, byDate };
}
