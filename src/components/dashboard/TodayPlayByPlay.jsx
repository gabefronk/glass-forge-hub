import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CalendarClock, Hammer, Info, MapPin, Navigation, RefreshCw, Sun } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { dayPlan, daySummary, denverDate, denverMinutes, directionsUrl, nextUp } from "@/lib/todayPlayByPlay";

// My Day, on the Today tab: the user's own day first. Personal and timed
// appointments are the chronological timeline at the top, with the one running
// now (or next to start) carrying the lead treatment and its full address ready
// to open for directions. All-day job work sits in its own lower section, and
// the tasks already on the day sit below that, so installs never flood the top.
// Same records, same model: read-only — this panel never writes an event, a task
// or any mail, and it never states a travel time, because no record holds one.
const CALENDAR_ROLES = ["admin", "manager"];
// The one read-only Outlook import the Calendar page trusts. Shown only while a
// complete capture actually covers today (see outlookState).
const OUTLOOK_CALENDAR = "UT Window Install";
const REFRESH_MS = 120000;

const MUTED = { text: "#566063", bg: "#F3EFE7", border: "#E2DCD1" };
const STATUS_TONES = {
  confirmed: { text: "#082F2C", bg: "#E2EEEB", border: "#C7E4D2" },
  scheduled: MUTED,
  provisional: { text: "#6F4E10", bg: "#FAF0DA", border: "#EFDFB7" },
  rescheduled: MUTED,
  overdue: { text: "#A43432", bg: "#FCEDEC", border: "#F0C9C5" },
  due: { text: "#6F4E10", bg: "#FAF0DA", border: "#EFDFB7" },
  follow_up: { text: "#6F4E10", bg: "#FAF0DA", border: "#EFDFB7" },
  in_progress: { text: "#34506A", bg: "#E7EDF2", border: "#C7D8EF" },
  planned: MUTED,
  listed: MUTED,
};

function Chip({ tone = MUTED, children }) {
  return (
    <span className="inline-flex items-center whitespace-nowrap rounded-[6px] px-1.5 py-0.5 text-[11px] font-medium" style={{ color: tone.text, backgroundColor: tone.bg, border: `1px solid ${tone.border}` }}>
      {children}
    </span>
  );
}

function Note({ tone = "amber", children }) {
  const colors = tone === "amber"
    ? { color: "#6F4E10", backgroundColor: "#FAF0DA", borderColor: "#EFDFB7" }
    : { color: "#566063", backgroundColor: "#F7F5F0", borderColor: "#E2DCD1" };
  return <p className="m-0 rounded-xl border px-3 py-2 text-[12.5px] leading-relaxed" style={colors}>{children}</p>;
}

// Which metadata earns a chip. Google-normalized CalendarEvents are the
// scheduling source of truth, so labelling every row "Google Calendar" says
// nothing; a Hub-only or read-only Outlook row does. Same for status: every row
// here is scheduled or confirmed, so only a provisional ETA or a reschedule is
// worth the ink, and a field-report badge only while it still asks for
// something. Everything else stays in Day details.
const sourceChip = (item) => (item.source.key === "google" ? null : item.source);
const statusChip = (item) => (["scheduled", "confirmed", "listed"].includes(item.status.key) ? null : item.status);
const reportChip = (item) => (item.report && item.report.label.startsWith("Needs") ? item.report : null);

// The full address, always spelled out, with the directions link beside it. The
// link is an ordinary Google Maps search built from the address on the record;
// nothing is sent anywhere until the user taps it.
function Address({ location, label }) {
  if (!location) return null;
  return (
    <p className="m-0 mt-1 flex flex-wrap items-start gap-x-2.5 gap-y-0.5 text-[13px] leading-snug text-[#34403F]">
      <MapPin className="mt-[3px] h-3.5 w-3.5 shrink-0 text-[#616A6D]" aria-hidden="true" />
      <span className="min-w-0 break-words">{location}</span>
      <a
        href={directionsUrl(location)}
        target="_blank"
        rel="noopener noreferrer"
        aria-label={`Directions to ${location}${label ? ` for ${label}` : ""}`}
        className="inline-flex min-h-9 items-center gap-1 whitespace-nowrap font-medium text-[#0B3F3B] hover:underline"
      >
        <Navigation className="h-3.5 w-3.5" aria-hidden="true" />Directions
      </a>
    </p>
  );
}

function Meta({ item }) {
  const source = sourceChip(item), status = statusChip(item), report = reportChip(item);
  const merged = item.mergedSourceIds.length;
  if (!source && !status && !report && !merged && !item.jobId) return null;
  return (
    <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1">
      {status ? <Chip tone={STATUS_TONES[status.key] || MUTED}>{status.label}</Chip> : null}
      {report ? <Chip tone={report}>{report.label}</Chip> : null}
      {source ? <Chip tone={source.tone}>{source.label}</Chip> : null}
      {merged ? <Chip>{merged === 1 ? "1 copy merged" : `${merged} copies merged`}</Chip> : null}
      {item.jobId ? (
        <Link to={`/jobs/${encodeURIComponent(item.jobId)}`} className="inline-flex min-h-9 items-center text-[12.5px] font-medium text-[#0B3F3B] hover:underline">
          {item.jobName && item.jobName !== item.title ? item.jobName : "Open job"} →
        </Link>
      ) : null}
    </span>
  );
}

// An overlap is stated on both rows that clash, in the warning tone and on one
// line, so it reads as a flag on the appointment rather than an alarm card.
function Overlap({ conflicts }) {
  if (!conflicts.length) return null;
  return (
    <p className="m-0 mt-1 flex items-start gap-1.5 text-[12.5px] font-medium leading-snug" style={{ color: "#6F4E10" }}>
      <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="break-words">Overlaps {conflicts.join(", ")}</span>
    </p>
  );
}

// One line of the personal timeline: a strong time gutter, then the event and
// its address. `lead` is the "Happening now" / "Next up" marker for the one
// appointment to act on; it is the only row given extra weight.
function TimelineRow({ item, lead = "" }) {
  const [start, end] = item.timeLabel.split("–");
  const conflict = item.conflicts.length > 0;
  const tone = lead
    ? { borderColor: "#BFD8D3", backgroundColor: "#EEF5F3" }
    : { borderColor: conflict ? "#EFDFB7" : "#EEE9E0", backgroundColor: "#FFFFFF" };
  return (
    <li className="relative overflow-hidden rounded-xl border px-3 py-3" style={tone}>
      {lead ? <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[3px]" style={{ backgroundColor: "#0B3F3B" }} /> : null}
      <div className="flex gap-3">
        <span className="w-[54px] shrink-0 sm:w-[62px]">
          <span className={"block tabular-nums font-semibold leading-none " + (lead ? "text-[17px]" : "text-[15px]")} style={{ color: lead ? "#0B3F3B" : "#34403F" }}>{start}</span>
          {end ? <span className="mt-1.5 block text-[12px] leading-none tabular-nums text-[#616A6D]">{end}</span> : null}
        </span>
        <div className="min-w-0 flex-1">
          {lead ? <p className="m-0 mb-0.5 text-[11px] font-semibold uppercase tracking-[.08em]" style={{ color: "#0B3F3B" }}>{lead}</p> : null}
          <p className={"m-0 break-words font-semibold leading-snug text-[#101617] " + (lead ? "text-[16.5px]" : "text-[15px]")}>{item.title}</p>
          {item.span ? <p className="m-0 mt-0.5 text-[12.5px] text-[#616A6D]">Runs {item.span}</p> : null}
          <Address location={item.location} label={item.title} />
          <Meta item={item} />
          <Overlap conflicts={item.conflicts} />
        </div>
      </div>
    </li>
  );
}

// All-day job work and loose tasks: compact rules instead of cards, so the
// secondary sections scan fast and never compete with the timeline. The job
// link and the full address are kept on every install row.
function CompactRow({ item, bold = true }) {
  return (
    <li className="py-2.5 first:pt-0 last:pb-0">
      <p className={"m-0 break-words text-[14.5px] leading-snug text-[#101617] " + (bold ? "font-semibold" : "")}>{item.title}</p>
      {item.span ? <p className="m-0 mt-0.5 text-[12px] text-[#616A6D]">Runs {item.span}</p> : null}
      <Address location={item.location} label={item.title} />
      <Meta item={item} />
    </li>
  );
}

function Section({ label, count, Icon, hint = "", badge = null, sunken = false, children }) {
  return (
    <section className={sunken ? "rounded-xl p-3 sm:p-3.5" : ""} style={sunken ? { backgroundColor: "#FAF8F3" } : undefined}>
      <h3 className="m-0 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[12px] font-semibold uppercase tracking-[.08em] text-[#566063]">
        <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />{label}
        <span className="tabular-nums font-normal text-[#616A6D]">{count}</span>
        {badge}
      </h3>
      {hint ? <p className="m-0 mt-0.5 text-[12px] leading-snug text-[#616A6D]">{hint}</p> : null}
      <div className="mt-2">{children}</div>
    </section>
  );
}

export default function TodayPlayByPlay({ today = denverDate(), tasks = [], jobs = [], tasksLoading = false, tasksError = "" }) {
  const { user } = useAuth();
  const canReadCalendar = CALENDAR_ROLES.includes(String(user?.role || ""));
  const [state, setState] = useState({ loading: canReadCalendar, error: "", events: [], outlook: null, checkedAt: "" });
  const sequence = useRef(0);

  const load = useCallback(async () => {
    const run = ++sequence.current;
    if (!canReadCalendar) {
      setState({ loading: false, error: "", events: [], outlook: null, checkedAt: "" });
      return;
    }
    setState((prev) => ({ ...prev, loading: true, error: "" }));
    try {
      // Today only: the day itself, plus an all-day row that started earlier and
      // still runs today (Google's end_date is exclusive).
      const [events, snapshots] = await Promise.all([
        base44.entities.CalendarEvents.filter({ $or: [{ event_date: today }, { event_date: { $lt: today }, end_date: { $gt: today } }] }, "start_time", 200),
        base44.entities.OutlookCalendarSnapshot.filter({ calendar_name: OUTLOOK_CALENDAR, complete: true }, "-captured_at", 1).catch(() => []),
      ]);
      if (run !== sequence.current) return;
      setState({ loading: false, error: "", events: events || [], outlook: (snapshots || [])[0] || null, checkedAt: new Date().toISOString() });
    } catch (error) {
      if (run !== sequence.current) return;
      setState({ loading: false, error: error?.response?.data?.error || error?.message || "Today's schedule could not be loaded.", events: [], outlook: null, checkedAt: "" });
    }
  }, [canReadCalendar, today]);

  useEffect(() => {
    load();
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    const timer = setInterval(() => { if (!document.hidden) load(); }, REFRESH_MS);
    return () => { sequence.current++; clearInterval(timer); window.removeEventListener("focus", onFocus); };
  }, [load]);

  // One memo for both, so the "Happening now" marker is re-read off the Denver
  // clock on every poll without a timer of its own.
  const { plan, lead } = useMemo(() => {
    const next = dayPlan({ events: state.events, tasks, jobs, today, outlook: state.outlook });
    return { plan: next, lead: nextUp(next.timed, denverMinutes()) };
  }, [state.events, state.outlook, tasks, jobs, today]);
  const leadLabel = lead.state === "now" ? "Happening now" : lead.state === "next" ? "Next up" : "";
  const firstLoad = state.loading && !state.checkedAt && !state.error;
  const checked = state.checkedAt ? new Date(state.checkedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";
  const dateLabel = new Date(`${today}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "UTC" });

  return (
    <section aria-label="My day" className="rounded-2xl border border-[#d3cabb] bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <div className="flex min-w-0 flex-wrap items-baseline gap-x-2.5 gap-y-0.5">
          <h2 className="m-0 text-lg font-semibold text-[#0B3F3B]">My day</h2>
          <span className="text-[13px] font-medium tabular-nums text-[#616A6D]">{dateLabel}</span>
        </div>
        <div className="-mt-1.5 flex shrink-0 items-center gap-1">
          <Link to="/calendar" className="min-h-10 px-1 py-2 text-sm font-medium text-[#0B3F3B] hover:underline">Calendar →</Link>
          <button type="button" onClick={load} disabled={state.loading} aria-label="Refresh today's schedule" title="Refresh" className="inline-flex h-10 w-10 items-center justify-center rounded-full text-[#34403f] hover:bg-black/5 disabled:opacity-50">
            <RefreshCw className={"h-[18px] w-[18px] " + (state.loading ? "animate-spin" : "")} />
          </button>
        </div>
      </div>
      {!firstLoad && !state.error ? (
        <p role="status" className="m-0 mt-0.5 text-[14px] leading-snug text-[#34403F]">{daySummary(plan)}</p>
      ) : null}

      <div className="mt-3 flex flex-col gap-3" aria-busy={firstLoad || tasksLoading ? "true" : "false"}>
        {firstLoad ? <p role="status" className="m-0 py-2 text-sm text-[#566063]">Loading today&apos;s schedule…</p> : null}

        {state.error ? (
          <p role="alert" className="m-0 flex flex-wrap items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-900">
            {state.error}
            <button type="button" onClick={load} className="min-h-9 font-medium underline">Try again</button>
          </p>
        ) : null}

        {!canReadCalendar ? (
          <Note tone="plain">This account does not have calendar access, so only your tasks are listed. Ask an admin for the manager role to see the schedule here.</Note>
        ) : null}

        {tasksError ? <Note tone="plain">Your tasks could not be loaded, so the list below may be missing them.</Note> : null}

        {!firstLoad && !state.error && plan.empty ? (
          <div className="flex flex-col items-center gap-1 rounded-xl px-5 py-6 text-center" style={{ backgroundColor: "#FAF8F3" }}>
            <Sun className="h-6 w-6 text-[#b8955a]" aria-hidden="true" />
            <p className="m-0 text-[15px] font-semibold text-[#101617]">Nothing scheduled today</p>
            <p className="m-0 max-w-[340px] text-[13px] text-[#566063]">No calendar event covers today and no task is on your day yet.</p>
          </div>
        ) : null}

        {!firstLoad && !state.error && !plan.empty ? (
          <Section
            label="Your timeline"
            count={plan.timed.length}
            Icon={CalendarClock}
            hint={lead.state === "done" && plan.timed.length ? "Every timed appointment today has already started." : ""}
            badge={plan.conflicts ? <Chip tone={STATUS_TONES.provisional}>{plan.conflicts === 1 ? "1 overlap" : `${plan.conflicts} items overlap`}</Chip> : null}
          >
            {plan.timed.length ? (
              <ul className="m-0 flex list-none flex-col gap-2 p-0" aria-label="Your timeline">
                {plan.timed.map((item) => <TimelineRow key={item.key} item={item} lead={item.key === lead.key ? leadLabel : ""} />)}
              </ul>
            ) : (
              <p className="m-0 rounded-xl border border-dashed px-3 py-2.5 text-[13px] text-[#616A6D]" style={{ borderColor: "#E2DCD1" }}>
                No appointment has an exact start time today.
              </p>
            )}
          </Section>
        ) : null}

        {!firstLoad && !state.error && plan.allDay.length ? (
          <Section label="Today’s installs" count={plan.allDay.length} Icon={Hammer} hint="All-day job work, with no start time in the source calendar." sunken>
            <ul className="m-0 flex list-none flex-col divide-y divide-[#E4DCCC] p-0" aria-label="Today’s installs">
              {plan.allDay.map((item) => <CompactRow key={item.key} item={item} />)}
            </ul>
          </Section>
        ) : null}

        {plan.unscheduled.length ? (
          <Section label="Tasks with no set time" count={plan.unscheduled.length} Icon={Sun} hint="On your day, with no time of their own." sunken>
            <ul className="m-0 flex list-none flex-col divide-y divide-[#E4DCCC] p-0" aria-label="Tasks with no set time">
              {plan.unscheduled.map((item) => <CompactRow key={item.key} item={item} bold={false} />)}
            </ul>
          </Section>
        ) : null}

        {!firstLoad && !state.error ? (
          <div className="flex flex-col gap-1.5 border-t pt-3" style={{ borderColor: "#EEE9E0" }}>
            {canReadCalendar && !plan.outlook.available ? (
              <p className="m-0 flex items-start gap-1.5 text-[12px] leading-snug text-[#616A6D]">
                <Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span className="break-words">{plan.outlook.note}</span>
              </p>
            ) : null}
            <details>
              <summary className="inline-flex min-h-8 cursor-pointer items-center text-[12.5px] font-medium text-[#34403F]">Day details</summary>
              <ul className="m-0 mt-1.5 flex list-none flex-col gap-1 rounded-xl bg-[#F7F5F0] p-3 text-[12.5px] leading-relaxed text-[#34403F]" aria-label="Day briefing">
                {plan.briefing.map((line) => <li key={line}>{line}</li>)}
              </ul>
              <p className="m-0 mt-2 text-[12px] leading-snug text-[#616A6D]">
                Google Calendar events normalized into the Hub, plus the tasks already on your day. Read-only — nothing here changes a calendar.
                {checked ? ` Checked ${checked}.` : ""}
              </p>
            </details>
          </div>
        ) : null}
      </div>
    </section>
  );
}
