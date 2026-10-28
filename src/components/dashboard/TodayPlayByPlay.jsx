import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CalendarClock, MapPin, RefreshCw, Sun } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { dayPlan, denverDate, SOURCE_BADGES } from "@/lib/todayPlayByPlay";

// Today's play-by-play, on the Today tab: today's normalized CalendarEvents —
// the scheduling source of truth — in one chronological list, with all-day
// items and the tasks the personal views already put on the day kept apart.
// Read-only: this panel never writes an event, a task or any mail, and it never
// states a travel time, because no record holds one.
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

// One line of the day. Time first, so the column reads as a schedule; overlaps
// are marked on both rows that clash.
function PlanRow({ item }) {
  const conflict = item.conflicts.length > 0;
  return (
    <li className="flex gap-3 rounded-xl border px-3 py-2.5" style={conflict ? { borderColor: "#F0C9C5", backgroundColor: "#FCEDEC" } : { borderColor: "#EEE9E0", backgroundColor: "#FFFFFF" }}>
      <span className="w-[58px] shrink-0 pt-px text-[12.5px] font-semibold tabular-nums" style={{ color: "#34403F" }}>{item.timeLabel}</span>
      <div className="min-w-0 flex-1">
        <p className="m-0 break-words text-[15px] font-semibold leading-snug text-[#101617]">{item.title}</p>
        {item.span ? <p className="m-0 mt-0.5 text-[12.5px] text-[#566063]">Runs {item.span}</p> : null}
        {item.location ? (
          <p className="m-0 mt-0.5 flex items-start gap-1.5 text-[12.5px] text-[#566063]">
            <MapPin className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span className="break-words">{item.location}</span>
          </p>
        ) : null}
        <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <Chip tone={item.source.tone}>{item.source.label}</Chip>
          <Chip tone={STATUS_TONES[item.status.key] || MUTED}>{item.status.label}</Chip>
          {item.report ? <Chip tone={item.report}>{item.report.label}</Chip> : null}
          {item.mergedSourceIds.length ? <Chip>{item.mergedSourceIds.length === 1 ? "1 mirrored copy merged" : `${item.mergedSourceIds.length} mirrored copies merged`}</Chip> : null}
          {item.jobId ? (
            <Link to={`/jobs/${encodeURIComponent(item.jobId)}`} className="inline-flex min-h-9 items-center text-[12.5px] font-medium text-[#0B3F3B] hover:underline">
              {item.jobName || "Open job"} →
            </Link>
          ) : null}
        </span>
        {conflict ? (
          <p className="m-0 mt-1 flex items-start gap-1.5 text-[12.5px] font-semibold" style={{ color: "#A43432" }}>
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
            <span className="break-words">Overlaps {item.conflicts.join(", ")}</span>
          </p>
        ) : null}
      </div>
    </li>
  );
}

function Group({ label, hint, items, Icon }) {
  if (!items.length) return null;
  return (
    <div>
      <h3 className="m-0 mb-1.5 flex items-center gap-1.5 text-[12px] font-semibold uppercase tracking-[.08em] text-[#566063]">
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />{label}<span className="tabular-nums font-normal">{items.length}</span>
      </h3>
      {hint ? <p className="m-0 mb-1.5 text-[12px] text-[#616a6d]">{hint}</p> : null}
      <ul className="m-0 flex list-none flex-col gap-1.5 p-0" aria-label={label}>
        {items.map((item) => <PlanRow key={item.key} item={item} />)}
      </ul>
    </div>
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

  const plan = useMemo(() => dayPlan({ events: state.events, tasks, jobs, today, outlook: state.outlook }), [state.events, state.outlook, tasks, jobs, today]);
  const firstLoad = state.loading && !state.checkedAt && !state.error;
  const checked = state.checkedAt ? new Date(state.checkedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";

  return (
    <section aria-label="Today's play-by-play" className="rounded-2xl border border-[#d3cabb] bg-white p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="m-0 text-lg font-semibold text-[#0B3F3B]">Today&apos;s play-by-play</h2>
        <div className="flex items-center gap-1">
          <Link to="/calendar" className="min-h-10 px-1 py-2 text-sm font-medium text-[#0B3F3B] hover:underline">Calendar →</Link>
          <button type="button" onClick={load} disabled={state.loading} aria-label="Refresh today's schedule" title="Refresh" className="inline-flex h-10 w-10 items-center justify-center rounded-full text-[#34403f] hover:bg-black/5 disabled:opacity-50">
            <RefreshCw className={"h-[18px] w-[18px] " + (state.loading ? "animate-spin" : "")} />
          </button>
        </div>
      </div>
      <p className="m-0 mb-3 text-xs text-slate-500">
        Google Calendar events normalized into the Hub, plus the tasks already on your day. Read-only — nothing here changes a calendar.
        {checked ? ` Checked ${checked}.` : ""}
      </p>

      <div className="flex flex-col gap-3" aria-busy={firstLoad || tasksLoading ? "true" : "false"}>
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

        {canReadCalendar && !state.error && !plan.outlook.available ? <Note>{plan.outlook.note}</Note> : null}

        {tasksError ? <Note tone="plain">Your tasks could not be loaded, so the list below may be missing them.</Note> : null}

        {!firstLoad && !state.error ? (
          <ul className="m-0 flex list-none flex-col gap-1 rounded-xl bg-[#F7F5F0] p-3 text-[13.5px] leading-relaxed text-[#101617]" role="status" aria-label="Day briefing">
            {plan.briefing.map((line) => <li key={line}>{line}</li>)}
          </ul>
        ) : null}

        {!firstLoad && !state.error && plan.empty ? (
          <div className="flex flex-col items-center gap-1.5 rounded-xl bg-white/60 px-6 py-8 text-center">
            <Sun className="h-7 w-7 text-[#b8955a]" aria-hidden="true" />
            <p className="m-0 text-[15px] font-semibold text-[#101617]">Nothing scheduled today</p>
            <p className="m-0 max-w-[340px] text-sm text-[#566063]">No calendar event covers today and no task is on your day yet.</p>
          </div>
        ) : null}

        <Group label="Timeline" items={plan.timed} Icon={CalendarClock} />
        {!firstLoad && !state.error && !plan.timed.length && (plan.allDay.length || plan.unscheduled.length) ? (
          <p className="m-0 text-[12.5px] text-[#616a6d]">No item has an exact start time today.</p>
        ) : null}
        <Group label="All day" items={plan.allDay} Icon={CalendarClock} hint="No start time in the source calendar." />
        <Group label="Unscheduled tasks" items={plan.unscheduled} Icon={Sun} hint="On your day, with no time of their own." />
      </div>
    </section>
  );
}
