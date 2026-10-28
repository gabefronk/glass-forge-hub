import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ArrowRight, ChevronRight, Hammer, Info, MapPin, Navigation, RefreshCw, Sun, User } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { dayPlan, daySummary, denverDate, denverMinutes, directionsUrl, nextUp } from "@/lib/todayPlayByPlay";

// My Day, on the Today tab: the user's own day first, split by ownership rather
// than by shape. "My calendar & to-dos" is the primary card — the user's own
// appointments in time order, then the to-dos that hold no time, each with its
// full address and a Directions button. "Install calendar" is the quieter card
// below it and holds every job-linked row: timed jobs as full rows, all-day jobs
// as one compact line each. A clash between the two is a small amber tag on both
// rows, and the count chips at the top say where the day's overlap is.
// Same records, same model: read-only — this panel never writes an event, a task
// or any mail, and it never states a travel time, because no record holds one.
const CALENDAR_ROLES = ["admin", "manager"];
// The one read-only Outlook import the Calendar page trusts. Shown only while a
// complete capture actually covers today (see outlookState).
const OUTLOOK_CALENDAR = "UT Window Install";
const REFRESH_MS = 120000;

const MUTED = { text: "#566063", bg: "#F3EFE7", border: "#E2DCD1" };
const AMBER = { text: "#6F4E10", bg: "#FAF0DA", border: "#EFDFB7" };
const NOW = { text: "#082F2C", bg: "#E2EEEB", border: "#C7E4D2" };
const STATUS_TONES = {
  confirmed: NOW,
  scheduled: MUTED,
  provisional: AMBER,
  rescheduled: MUTED,
  overdue: { text: "#A43432", bg: "#FCEDEC", border: "#F0C9C5" },
  due: AMBER,
  follow_up: AMBER,
  in_progress: { text: "#34506A", bg: "#E7EDF2", border: "#C7D8EF" },
  planned: { text: "#34506A", bg: "#E7EDF2", border: "#C7D8EF" },
  listed: MUTED,
};

function Chip({ tone = MUTED, wrap = false, children }) {
  return (
    <span
      className={"inline-flex min-h-[22px] items-center gap-1.5 rounded-[4.5px] px-[7px] py-px text-[12px] font-medium leading-tight " + (wrap ? "break-words" : "whitespace-nowrap")}
      style={{ color: tone.text, backgroundColor: tone.bg, border: `1px solid ${tone.border}` }}
    >
      {children}
    </span>
  );
}

function Note({ tone = "amber", children }) {
  const colors = tone === "amber"
    ? { color: AMBER.text, backgroundColor: AMBER.bg, borderColor: AMBER.border }
    : { color: "#566063", backgroundColor: "#FAF8F3", borderColor: "#E2DCD1" };
  return <p className="m-0 rounded-[8px] border px-3 py-2 text-[12.5px] leading-relaxed" style={colors}>{children}</p>;
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

// "Happening now" gets the live dot; "Next up" is the same chip, cooler.
function LeadChip({ lead }) {
  if (!lead) return null;
  const now = lead === "Happening now";
  return (
    <Chip tone={now ? NOW : STATUS_TONES.in_progress}>
      {now ? <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[#3B8A5A]" /> : null}
      {lead}
    </Chip>
  );
}

// An overlap is stated on both rows that clash, as one amber tag, so it reads as
// a flag on the appointment rather than an alarm card. When the other side of
// the clash sits in the other card, the tag says so, so splitting the day never
// costs the user the conflict.
function OverlapChip({ item, across = "" }) {
  if (!item.conflicts.length) return null;
  return (
    <Chip tone={AMBER} wrap>
      <AlertTriangle className="h-3 w-3 shrink-0 text-[#C08B2E]" aria-hidden="true" />
      <span>Overlaps {item.conflicts.join(", ")}{across && item.conflictsAcross.length ? ` · ${across}` : ""}</span>
    </Chip>
  );
}

function Tags({ item, across = "", className = "" }) {
  const source = sourceChip(item), status = statusChip(item), report = reportChip(item);
  const merged = item.mergedSourceIds.length;
  if (!source && !status && !report && !merged && !item.conflicts.length) return null;
  return (
    <span className={"flex flex-wrap items-center gap-2 " + className}>
      {status ? <Chip tone={STATUS_TONES[status.key] || MUTED}>{status.label}</Chip> : null}
      {report ? <Chip tone={report}>{report.label}</Chip> : null}
      {source ? <Chip tone={source.tone}>{source.label}</Chip> : null}
      {merged ? <Chip>{merged === 1 ? "1 copy merged" : `${merged} copies merged`}</Chip> : null}
      <OverlapChip item={item} across={across} />
    </span>
  );
}

// The full address, always spelled out. The Directions button beside the row is
// an ordinary Google Maps search built from the same address; nothing is sent
// anywhere until the user taps it.
function Address({ location }) {
  if (!location) return null;
  return (
    <p className="m-0 mt-1.5 flex items-start gap-1.5 text-[14px] leading-5 text-[#566063]">
      <MapPin className="mt-[3px] h-3.5 w-3.5 shrink-0" aria-hidden="true" />
      <span className="min-w-0 break-words">{location}</span>
    </p>
  );
}

// A to-do's own note, kept readable but set apart from the title and address.
// The record's own wording and line breaks, nothing added.
function Detail({ note }) {
  if (!note) return null;
  return <p className="m-0 mt-2 whitespace-pre-line rounded-[8px] bg-[#FAF8F3] px-3 py-2.5 text-[14px] leading-5 text-[#34403F]">{note}</p>;
}

function Actions({ item }) {
  if (!item.location && !item.jobId) return null;
  return (
    <div className="flex shrink-0 flex-wrap items-start gap-2">
      {item.location ? (
        <a
          href={directionsUrl(item.location)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Directions to ${item.location} for ${item.title}`}
          className="inline-flex min-h-11 items-center gap-2 rounded-[7px] border border-[#E2DCD1] bg-white px-3 text-[14px] font-medium text-[#0B3F3B] shadow-[0_1px_2px_rgba(21,24,26,.04)] hover:bg-[#F6F3EC] sm:min-h-9"
        >
          <Navigation className="h-3.5 w-3.5" aria-hidden="true" />Directions
        </a>
      ) : null}
      {item.jobId ? (
        <Link
          to={`/jobs/${encodeURIComponent(item.jobId)}`}
          aria-label={`Open job ${item.jobName || item.title}`}
          className="inline-flex min-h-11 items-center gap-2 rounded-[7px] bg-[#0B3F3B] px-3 text-[14px] font-medium text-white hover:bg-[#093431] sm:min-h-9"
        >
          Open job<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
        </Link>
      ) : null}
    </div>
  );
}

// The time gutter: start in bold, end beneath it. An item with no exact time says
// so in the same place ("Anytime" for a to-do), so it reads as part of the day.
function Gutter({ item, strong = false }) {
  if (item.start === null) {
    return <span className="block pt-[3px] text-[12px] font-semibold leading-[18px] tracking-[.02em] text-[#566063]">{item.timeLabel === "No set time" ? "Anytime" : item.timeLabel}</span>;
  }
  const [start, end] = item.timeLabel.split("–");
  return (
    <>
      <span className={"block font-bold tabular-nums tracking-[-.02em] text-[#101617] " + (strong ? "text-[18px] leading-6" : "text-[15px] leading-[22px]")}>{start}</span>
      {end ? <span className="block text-[12px] leading-4 tabular-nums text-[#566063]">to {end}</span> : null}
    </>
  );
}

// One full row: time gutter, then the item, its address, note and tags, then its
// buttons. `lead` marks the one appointment of the day to act on.
function Row({ item, lead = "", across = "", strong = false }) {
  return (
    <li className="flex flex-wrap gap-x-5 gap-y-2 px-4 py-4 sm:px-6">
      <div className="w-16 shrink-0"><Gutter item={item} strong={strong} /></div>
      <div className="min-w-0 flex-[1_1_200px]">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h4 className="m-0 break-words text-[16px] font-semibold leading-[22px] tracking-[-.02em] text-[#101617]">{item.title}</h4>
          <LeadChip lead={lead} />
        </div>
        {item.span ? <p className="m-0 mt-0.5 text-[12.5px] text-[#566063]">Runs {item.span}</p> : null}
        {item.jobId && item.jobName && item.jobName !== item.title ? <p className="m-0 mt-0.5 text-[12.5px] text-[#566063]">Job · {item.jobName}</p> : null}
        <Address location={item.location} />
        <Detail note={item.note} />
        <Tags item={item} across={across} className="mt-2" />
      </div>
      <Actions item={item} />
    </li>
  );
}

// All-day install jobs: one compact line each, the whole line opening the job,
// with a small Directions button at the end.
function AllDayRow({ item }) {
  const content = (
    <>
      <span className="min-w-0 flex-[1_1_220px] break-words text-[15px] font-medium leading-snug text-[#101617]">
        {item.title}
        {item.span ? <span className="ml-2 text-[12.5px] font-normal text-[#566063]">Runs {item.span}</span> : null}
      </span>
      {item.location ? <span className="min-w-0 break-words text-[13px] leading-snug text-[#566063]">{item.location}</span> : null}
      <Tags item={item} across="your calendar" className="basis-full" />
    </>
  );
  return (
    <li className="flex items-center gap-1 border-t border-[#EEE9E0] first:border-t-0">
      {item.jobId ? (
        <Link to={`/jobs/${encodeURIComponent(item.jobId)}`} className="flex min-h-12 min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1 rounded-[7px] px-3 py-2 text-[#101617] hover:bg-[#F6F3EC]">
          {content}
          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[#616A6D]" aria-hidden="true" />
        </Link>
      ) : (
        <div className="flex min-h-12 min-w-0 flex-1 flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2">{content}</div>
      )}
      {item.location ? (
        <a
          href={directionsUrl(item.location)}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`Directions to ${item.location} for ${item.title}`}
          title="Directions"
          className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-[7px] text-[#0B3F3B] hover:bg-[#F6F3EC]"
        >
          <Navigation className="h-4 w-4" aria-hidden="true" />
        </a>
      ) : null}
    </li>
  );
}

function Card({ id, title, count, hint = "", Icon, tile, band = false, action = null, children }) {
  return (
    <section aria-labelledby={id} className={"overflow-hidden rounded-[8px] border border-[#E2DCD1] " + (band ? "bg-[#FAF8F3]" : "bg-white shadow-[0_1px_2px_rgba(21,24,26,.04)]")}>
      <div className="flex items-center gap-3 border-b border-[#E2DCD1] px-4 py-3.5 sm:px-6">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[8px]" style={{ backgroundColor: tile.bg, color: tile.ink }}>
          <Icon className="h-4 w-4" aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 id={id} className="m-0 text-[18px] font-bold leading-6 tracking-[-.03em] text-[#101617]">
            {title} <span className="font-medium tabular-nums text-[#616A6D]">{count}</span>
          </h3>
          {hint ? <p className="m-0 text-[12.5px] leading-[18px] text-[#566063]">{hint}</p> : null}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

// Count chips for the top of My Day, read off the same plan as the briefing.
function SummaryChips({ plan }) {
  const { timed = [], allDay = [], unscheduled = [] } = plan;
  const clashing = timed.filter((item) => item.conflicts.length);
  const chips = [];
  if (timed.length) chips.push(`${timed.length} timed`);
  if (unscheduled.length) chips.push(`${unscheduled.length} anytime ${unscheduled.length === 1 ? "task" : "tasks"}`);
  if (allDay.length) chips.push(`${allDay.length} all-day`);
  return (
    <div role="status" aria-label={daySummary(plan)} className="flex flex-wrap items-center gap-2">
      {chips.map((label) => (
        <span key={label} className="inline-flex h-7 items-center rounded-[4.5px] border border-[#E2DCD1] bg-white px-2.5 text-[12.5px] font-medium text-[#34403F]">{label}</span>
      ))}
      {clashing.length ? (
        <span className="inline-flex h-7 items-center gap-1.5 rounded-[4.5px] border px-2.5 text-[12.5px] font-medium" style={{ color: AMBER.text, backgroundColor: AMBER.bg, borderColor: AMBER.border }}>
          <AlertTriangle className="h-3 w-3 text-[#C08B2E]" aria-hidden="true" />
          {clashing.length > 2 ? `${clashing.length} items overlap` : `Overlap at ${clashing[0].timeLabel.split("–")[0]}`}
        </span>
      ) : null}
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

  // One memo for both, so the "Happening now" marker is re-read off the Denver
  // clock on every poll without a timer of its own.
  const { plan, lead } = useMemo(() => {
    const next = dayPlan({ events: state.events, tasks, jobs, today, outlook: state.outlook });
    return { plan: next, lead: nextUp(next.timed, denverMinutes()) };
  }, [state.events, state.outlook, tasks, jobs, today]);
  const leadLabel = lead.state === "now" ? "Happening now" : lead.state === "next" ? "Next up" : "";
  const leadFor = (item) => (item.key === lead.key ? leadLabel : "");
  // Two cards, read straight off the plan's ownership split: the user's own day
  // in time order with its untimed items after it, then install work, timed
  // before all-day. The lead marker is still the one appointment of the whole
  // day to act on, shown wherever that item actually lives.
  const personal = [...plan.personal.timed, ...plan.personal.untimed];
  const installTimed = plan.install.timed;
  const installAllDay = plan.install.allDay;
  const installCount = installTimed.length + installAllDay.length;
  const firstLoad = state.loading && !state.checkedAt && !state.error;
  const ready = !firstLoad && !state.error;
  const checked = state.checkedAt ? new Date(state.checkedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : "";

  return (
    <div role="region" aria-label="My day" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
        {ready && !plan.empty ? <SummaryChips plan={plan} /> : <span />}
        <div className="flex shrink-0 items-center gap-1">
          <Link to="/calendar" className="inline-flex min-h-10 items-center gap-1.5 px-1 text-[14px] font-medium text-[#0B3F3B] hover:underline">
            Calendar<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
          </Link>
          <button type="button" onClick={load} disabled={state.loading} aria-label="Refresh today's schedule" title="Refresh" className="inline-flex h-10 w-10 items-center justify-center rounded-[7px] text-[#34403F] hover:bg-black/5 disabled:opacity-50">
            <RefreshCw className={"h-4 w-4 " + (state.loading ? "animate-spin" : "")} aria-hidden="true" />
          </button>
        </div>
      </div>

      <div className="flex flex-col gap-4" aria-busy={firstLoad || tasksLoading ? "true" : "false"}>
        {firstLoad ? <p role="status" className="m-0 py-2 text-sm text-[#566063]">Loading today&apos;s schedule…</p> : null}

        {state.error ? (
          <p role="alert" className="m-0 flex flex-wrap items-center gap-2 rounded-[8px] border px-3 py-2.5 text-sm" style={{ color: "#A43432", backgroundColor: "#FCEDEC", borderColor: "#F0C9C5" }}>
            {state.error}
            <button type="button" onClick={load} className="min-h-9 font-medium underline">Try again</button>
          </p>
        ) : null}

        {!canReadCalendar ? (
          <Note tone="plain">This account does not have calendar access, so only your tasks are listed. Ask an admin for the manager role to see the schedule here.</Note>
        ) : null}

        {tasksError ? <Note tone="plain">Your tasks could not be loaded, so the list below may be missing them.</Note> : null}

        {ready && plan.empty ? (
          <div className="flex flex-col items-center gap-1 rounded-[8px] border border-[#E2DCD1] bg-white px-5 py-8 text-center">
            <Sun className="h-6 w-6 text-[#b8955a]" aria-hidden="true" />
            <p className="m-0 text-[15px] font-semibold text-[#101617]">Nothing scheduled today</p>
            <p className="m-0 max-w-[340px] text-[13px] text-[#566063]">No calendar event covers today and no task is on your day yet.</p>
          </div>
        ) : null}

        {ready && !plan.empty ? (
          <Card
            id="myday-mine"
            title="My calendar & to-dos"
            count={personal.length}
            Icon={User}
            tile={{ bg: "#E2EEEB", ink: "#082F2C" }}
            hint={lead.state === "done" && plan.personal.timed.length ? "Your own appointments and to-dos. Every timed one has already started." : "Your own appointments and to-dos, in time order"}
          >
            {personal.length ? (
              <ul className="m-0 list-none divide-y divide-[#EEE9E0] p-0" aria-label="My calendar and to-dos">
                {personal.map((item) => <Row key={item.key} item={item} lead={leadFor(item)} across="install calendar" strong />)}
              </ul>
            ) : (
              <p className="m-0 px-4 py-4 text-[13px] text-[#616A6D] sm:px-6">
                Nothing of your own on today — everything scheduled is job work, on the install calendar below.
              </p>
            )}
          </Card>
        ) : null}

        {ready && installCount ? (
          <Card
            id="myday-install"
            title="Install calendar"
            count={installCount}
            Icon={Hammer}
            tile={{ bg: "#F1E8D6", ink: "#6F4E10" }}
            hint="Crew work today: timed jobs first, then all-day"
            band
            action={(
              <Link to="/jobs" className="inline-flex min-h-10 shrink-0 items-center gap-1.5 text-[14px] font-medium text-[#0B3F3B] hover:underline">
                Jobs<ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
              </Link>
            )}
          >
            {installTimed.length ? (
              <ul className="m-0 list-none divide-y divide-[#EEE9E0] border-b border-[#EEE9E0] bg-white p-0" aria-label="Timed install jobs">
                {installTimed.map((item) => <Row key={item.key} item={item} lead={leadFor(item)} across="your calendar" />)}
              </ul>
            ) : null}
            {installAllDay.length ? (
              <>
                <p className="m-0 px-4 pb-1.5 pt-3.5 text-[10px] font-semibold uppercase leading-[14px] tracking-[.12em] text-[#566063] sm:px-6">All day · {installAllDay.length}</p>
                <ul className="m-0 list-none px-1 pb-2 sm:px-3" aria-label="All-day install jobs">
                  {installAllDay.map((item) => <AllDayRow key={item.key} item={item} />)}
                </ul>
              </>
            ) : null}
          </Card>
        ) : null}

        {ready ? (
          <div className="flex flex-col gap-1.5 px-1">
            {canReadCalendar && !plan.outlook.available ? (
              <p className="m-0 flex items-start gap-1.5 text-[12px] leading-snug text-[#616A6D]">
                <Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" /><span className="break-words">{plan.outlook.note}</span>
              </p>
            ) : null}
            <details>
              <summary className="inline-flex min-h-8 cursor-pointer items-center text-[12.5px] font-medium text-[#34403F]">Day details</summary>
              <ul className="m-0 mt-1.5 flex list-none flex-col gap-1 rounded-[8px] border border-[#E2DCD1] bg-white p-3 text-[12.5px] leading-relaxed text-[#34403F]" aria-label="Day briefing">
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
    </div>
  );
}
