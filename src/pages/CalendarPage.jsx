import { refreshMonth } from "@/lib/refreshMonth";
import { currentMonthStr, shiftMonthStr } from "@/lib/feeMath";
import { denverDate } from "../../base44/shared/billingCore.js";
import { useEffect, useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { ArrowLeft, CalendarDays, ChevronLeft, ChevronRight, LayoutGrid, List, Plus, RefreshCw, Search, X } from "lucide-react";
import { fetchAllPages } from "@/lib/pagination";
import { C } from "@/lib/feeUI";
import { KIND, filterEvents, kindCounts, weekDays, weekLabel, addDays, byTime } from "@/lib/calendarModel";
import MonthGrid from "@/components/calendar/MonthGrid";
import WeekView from "@/components/calendar/WeekView";
import AgendaList from "@/components/calendar/AgendaList";
import EventCard from "@/components/calendar/EventCard";
import EventForm from "@/components/calendar/EventForm";
import EventBubble from "@/components/calendar/EventBubble";
import OutlookEventDetails from "@/components/calendar/OutlookEventDetails";
import CleanCalendar from "@/components/calendar/CleanCalendar";
import ServiceCalendar from "@/components/calendar/ServiceCalendar";
import JobKnowledge from "@/components/calendar/JobKnowledge";
import SourceCoverageBar from "@/components/calendar/SourceCoverageBar";


function formatMonth(m) {
  const [y, mm] = m.split("-").map(Number);
  return new Date(y, mm - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

const GF_JOBS_CAL_ID = "0236b85aa32e6358ebe5a232e970e6c9c2c47142f8c3f22cadd5b5b0eb34bf67@group.calendar.google.com";

const VIEWS = [
  { key: "month", label: "Month", icon: LayoutGrid },
  { key: "week", label: "Week", icon: CalendarDays },
  { key: "list", label: "List", icon: List },
];

// Admin-only tools that replace the calendar body, each with the same back bar.
function ToolView({ title, onBack, children }) {
  return (
    <div style={{ backgroundColor: C.pageBg, minHeight: "100vh" }}>
      <div className="px-[26px] max-[699px]:px-[18px] pt-[22px] pb-10">
        <div className="mb-5 flex items-center gap-3">
          <button type="button" onClick={onBack} className="inline-flex min-h-11 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium transition-colors hover:bg-[#F6F3EC]" style={{ border: `1px solid ${C.border}`, color: C.textSecondary, backgroundColor: C.card }}>
            <ArrowLeft className="h-4 w-4" />Calendar
          </button>
          <h1 className="font-heading text-[22px] font-semibold" style={{ color: C.text, letterSpacing: "-0.03em" }}>{title}</h1>
        </div>
        <div className="rounded-[14px] p-5 card-shadow" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>{children}</div>
      </div>
    </div>
  );
}

export default function CalendarPage() {
  const [events, setEvents] = useState([]);
  const [tool, setTool] = useState(null); // null | "install" | "ipad" | "knowledge"
  const [outlook, setOutlook] = useState(null);
  const [excludedEvents, setExcludedEvents] = useState([]);
  const [syncMessage, setSyncMessage] = useState("");
  const [ownership, setOwnership] = useState(null);
  const [ownershipError, setOwnershipError] = useState("");
  const [loading, setLoading] = useState(true);
  const [partialOutlook, setPartialOutlook] = useState(null);
  const [showIsrael, setShowIsrael] = useState(true);
  const [showGfJobs, setShowGfJobs] = useState(true);
  const [showOutlook, setShowOutlook] = useState(true);
  const [jobs, setJobs] = useState([]);
  const [month, setMonth] = useState(currentMonthStr);
  const [view, setView] = useState(() => {
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches) return "list";
    return "month";
  });
  const [creating, setCreating] = useState(null);
  const [selected, setSelected] = useState(null);
  // Denver calendar day, matching currentMonthStr(); UTC would roll to tomorrow in the evening.
  const [selectedDay, setSelectedDay] = useState(() => denverDate());
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [filter, setFilter] = useState("all"); // all | install | service | outlook | needs_report
  const [query, setQuery] = useState("");
  const [user, setUser] = useState(null);
  const today = denverDate();
  const isAdmin = user?.role === "admin";

  const load = async () => {
    setLoading(true); setOwnershipError(""); setSelected(null);
    try {
      const [response, jobsArr, me] = await Promise.all([
        base44.functions.invoke("ownedCalendar", {}),
        fetchAllPages(base44.entities.Jobs, "-created_date", 1000),
        base44.auth.me().catch(() => null),
      ]);
      if (response.data?.error) throw new Error(response.data.error);
      setEvents(response.data.groups || []);
      setExcludedEvents(response.data.excluded_events || []);
      setOwnership(response.data.ownership || null);
      setOutlook(response.data.outlook || null);
      setPartialOutlook(response.data.partial_outlook || null);
      setJobs(jobsArr);
      setUser(me);
    } catch (e) {
      setEvents([]); setOwnership(null);
      setOwnershipError(e?.response?.status === 403
        ? "This account does not have calendar access. Ask an admin to grant the manager role."
        : "Calendar ownership could not be verified against Sales Tracker. Reload to try again.");
    } finally { setLoading(false); }
  };
  useEffect(() => { load(); }, []);
  useEffect(() => {
    const phone = window.matchMedia("(max-width: 767px)");
    const adaptView = (event) => setView(event.matches ? "list" : "month");
    phone.addEventListener("change", adaptView);
    return () => phone.removeEventListener("change", adaptView);
  }, []);

  // Every group has verified tracker ownership. Choose one visible source per visit.
  const combined = useMemo(() => ({
    events: events.map(group => group.find(event => {
      if (event.source === "outlook") return showOutlook;
      if (event.google_calendar_id === GF_JOBS_CAL_ID) return showGfJobs;
      return showIsrael;
    })).filter(Boolean),
  }), [events, showIsrael, showOutlook, showGfJobs]);
  const ownershipCounts = ownership?.by_month?.[month];
  const monthAll = useMemo(() => combined.events.filter((e) => (e.event_date || "").slice(0, 7) === month), [combined, month]);
  const monthEvents = useMemo(() => filterEvents(monthAll, filter, today), [monthAll, filter, today]);
  // The week can cross into the next or previous month, so it filters every loaded event.
  const weekAll = useMemo(() => {
    const days = new Set(weekDays(selectedDay));
    return combined.events.filter((e) => days.has((e.event_date || "").slice(0, 10)));
  }, [combined, selectedDay]);
  const weekEvents = useMemo(() => filterEvents(weekAll, filter, today), [weekAll, filter, today]);
  const counts = useMemo(() => kindCounts(view === "week" ? weekAll : monthAll, today), [view, weekAll, monthAll, today]);
  // Quick search across every loaded event (all months), like the job tracker.
  const searchMatches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return combined.events
      .filter((e) => [e.job_name, e.builder, e.address, e.crew, e.po_number, e.oe_number]
        .filter(Boolean).some((v) => String(v).toLowerCase().includes(q)))
      .sort((a, b) => (a.event_date || "").localeCompare(b.event_date || "") || (a.start_time || "").localeCompare(b.start_time || ""))
      .slice(0, 50);
  }, [combined, query]);
  const selectedDayEvents = useMemo(() => {
    return monthEvents.filter((e) => (e.event_date || "").slice(0, 10) === selectedDay).sort(byTime);
  }, [monthEvents, selectedDay]);

  const shiftMonth = (delta) => {
    const newMonth = shiftMonthStr(month, delta);
    setMonth(newMonth);
    setSelectedDay(`${newMonth}-01`);
  };
  const goToDay = (day) => { setSelectedDay(day); setMonth(day.slice(0, 7)); };
  const step = (delta) => (view === "week" ? goToDay(addDays(selectedDay, 7 * delta)) : shiftMonth(delta));
  const goToday = () => goToDay(denverDate());

  const handleSave = async (f) => {
    setSaving(true);
    try {
      const payload = {
        ...f,
        labor_amt: f.labor_amt === "" ? 0 : Number(f.labor_amt),
        job_id: f.job_id || null,
      };
      if (selected?.id) payload.id = selected.id;
      const res = await base44.functions.invoke("pushCalendarEvent", payload);
      // The function reports failures as HTTP 200 + `error`. When `record` is present the
      // event was saved but a later step failed; close the form so it is not saved twice.
      if (res?.data?.error && !res.data.record) throw new Error(res.data.error);
      setCreating(null);
      setSelected(null);
      await load();
      if (res?.data?.error) setSyncMessage(`Event saved, but a later step failed (${res.data.error}). Check the installer calendar.`);
    } catch (error) {
      setSyncMessage("Event was not saved. " + (error?.response?.data?.error || error?.message || ""));
    } finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!selected || !confirm("Delete this event from both calendars?")) return;
    setSaving(true);
    try {
      const res = await base44.functions.invoke("deleteCalendarEvent", { id: selected.id });
      if (res?.data?.error) throw new Error(res.data.error);
      setSelected(null);
      await load();
    } catch (error) {
      setSyncMessage("Event was not deleted. " + (error?.response?.data?.error || error?.message || ""));
    } finally { setSaving(false); }
  };

  // Two-way move: drag writes the REAL Google calendar via moveCalendarEvent.
  // Optimistic UI; on any failure the snapshot is restored and the error shown.
  const handleMoveEvent = async (id, newDate, fromDate) => {
    const snapshot = events;
    const label = events.flat().find((e) => e.id === id)?.job_name || "Event";
    setEvents(events.map((group) => group.map((e) => (e.id === id ? { ...e, event_date: newDate } : e))));
    setSyncMessage(`Moving ${label} to ${dayLabel(newDate)} on Google Calendar...`);
    try {
      const res = await base44.functions.invoke("moveCalendarEvent", { id, new_date: newDate });
      if (res?.data?.error) {
        setEvents(snapshot);
        const detail = res.data.detail ? ` ${res.data.detail}` : "";
        setSyncMessage(`Move failed - Google Calendar was NOT changed.${detail}`);
        return;
      }
      setSyncMessage(`Moved ${label} from ${dayLabel(fromDate)} to ${dayLabel(newDate)} - Google Calendar updated for everyone.` +
        (res?.data?.installer_warning ? ` (Installer calendar copy needs a refresh: ${res.data.installer_warning})` : ""));
      await load();
    } catch (error) {
      setEvents(snapshot);
      setSyncMessage("Move failed - Google Calendar was NOT changed. " + (error?.response?.data?.error || error?.message || ""));
    }
  };

  const handleSync = async () => {
    setSyncing(true);
    try {
      await refreshMonth(month, setSyncMessage);
      await load();
      setSyncMessage("Google Calendar, ProBuild and billing refreshed for " + month + ". Outlook coverage is shown below.");
    } catch (error) { setSyncMessage("Refresh incomplete. " + error.message); await load(); } finally { setSyncing(false); }
  };

  const dayLabel = (d) => {
    const date = new Date(d + "T00:00:00");
    return date.toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" });
  };

  if (isAdmin && tool === "knowledge") return <ToolView title="Find a job update" onBack={() => setTool(null)}><JobKnowledge /></ToolView>;
  if (isAdmin && tool === "ipad") return <ToolView title="iPad schedules" onBack={() => setTool(null)}><ServiceCalendar /></ToolView>;
  if (isAdmin && tool === "install") return <ToolView title="Installation calendar" onBack={() => setTool(null)}><CleanCalendar /></ToolView>;

  const periodLabel = view === "week" ? weekLabel(weekDays(selectedDay)) : formatMonth(month);
  const periodCount = view === "week" ? weekEvents.length : monthEvents.length;
  const filterChips = [
    { key: "all", label: view === "week" ? "All this week" : "All this month", count: counts.all },
    { key: "install", label: "Installs", count: counts.install, dot: KIND.install.bar },
    { key: "service", label: "Service", count: counts.service, dot: KIND.service.bar },
    ...(counts.outlook ? [{ key: "outlook", label: "Outlook", count: counts.outlook, dot: KIND.outlook.bar }] : []),
    { key: "needs_report", label: "Needs report", count: counts.needs_report, dot: "#C08B2E" },
  ];
  const openCreate = (d) => { setSelected(null); setCreating({ event_date: d || selectedDay }); };
  const ghostBtn = { border: `1px solid ${C.border}`, color: C.textSecondary, backgroundColor: C.card };

  return (
    <div style={{ backgroundColor: C.pageBg, minHeight: "100vh" }}>
      <div className="px-[26px] max-[699px]:px-[18px] pt-[22px] max-[699px]:pt-[16px] pb-10">
        {/* Header: title, period nav, view switch, primary action */}
        <div className="mb-4 rounded-[16px] px-4 py-4 sm:px-5 card-shadow" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
          <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
            <div className="min-w-0 mr-auto">
              <div className="mono-label-sm mb-0.5">Schedule</div>
              <div className="flex flex-wrap items-baseline gap-x-3">
                <h1 className="font-heading text-[24px] sm:text-[26px] font-semibold" style={{ color: C.text, letterSpacing: "-0.03em" }}>{periodLabel}</h1>
                <span className="font-mono-num text-[13px]" style={{ color: C.textMuted }}>{periodCount} {periodCount === 1 ? "visit" : "visits"}</span>
              </div>
            </div>
            <div className="flex items-center gap-1" aria-label={view === "week" ? "Choose week" : "Choose month"}>
              <button type="button" onClick={() => step(-1)} className="inline-flex h-11 w-11 items-center justify-center rounded-full transition-colors hover:bg-[#F6F3EC]" style={ghostBtn} aria-label={view === "week" ? "Previous week" : "Previous month"}><ChevronLeft className="h-4 w-4" /></button>
              <button type="button" onClick={goToday} className="min-h-11 rounded-full px-4 text-[13px] font-medium transition-colors hover:bg-[#F6F3EC]" style={ghostBtn}>Today</button>
              <button type="button" onClick={() => step(1)} className="inline-flex h-11 w-11 items-center justify-center rounded-full transition-colors hover:bg-[#F6F3EC]" style={ghostBtn} aria-label={view === "week" ? "Next week" : "Next month"}><ChevronRight className="h-4 w-4" /></button>
            </div>
            <div className="flex rounded-full p-1" role="group" aria-label="Calendar view" style={{ backgroundColor: C.cardAlt, border: `1px solid ${C.border}` }}>
              {VIEWS.map(({ key, label, icon: Icon }) => (
                <button key={key} type="button" onClick={() => setView(key)} aria-pressed={view === key}
                  className="inline-flex min-h-9 items-center gap-1.5 px-3 rounded-full text-[12.5px] font-medium transition-colors"
                  style={view === key ? { backgroundColor: C.accent, color: "#fff" } : { color: C.textSecondary }}>
                  <Icon className="h-3.5 w-3.5" />{label}
                </button>
              ))}
            </div>
            <button type="button" onClick={() => openCreate()} className="inline-flex min-h-11 items-center gap-1.5 px-4 rounded-full text-[13px] font-semibold whitespace-nowrap transition-colors hover:bg-[#093431]" style={{ backgroundColor: C.accent, color: "#fff" }}>
              <Plus className="h-4 w-4" />New event
            </button>
          </div>

          {/* Filters, search, refresh */}
          <div className="mt-4 pt-4 flex flex-wrap items-center gap-2" style={{ borderTop: `1px solid ${C.rowBorder}` }}>
            <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter events">
              {filterChips.map((f) => (
                <button key={f.key} type="button" onClick={() => setFilter(f.key)} aria-pressed={filter === f.key}
                  className="inline-flex min-h-9 items-center gap-1.5 px-3 rounded-full text-[12.5px] font-medium whitespace-nowrap transition-colors"
                  style={filter === f.key ? { backgroundColor: C.text, color: "#fff" } : { border: `1px solid ${C.border}`, color: C.textSecondary }}>
                  {f.dot && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: f.dot }} aria-hidden="true" />}
                  {f.label}<span className="font-mono-num text-[11px]" style={{ opacity: 0.7 }}>{f.count}</span>
                </button>
              ))}
            </div>
            <div className="relative inline-flex items-center ml-auto max-[699px]:ml-0 max-[699px]:w-full">
              <Search className="absolute left-3 h-3.5 w-3.5 pointer-events-none" style={{ color: C.textSecondary }} />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search jobs, builders, addresses, crews"
                aria-label="Search all events"
                className="pl-8 pr-8 min-h-9 rounded-full text-[12.5px] w-64 max-[699px]:w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-[#10524C]"
                style={{ border: `1px solid ${C.border}`, color: C.text, backgroundColor: C.card }}
              />
              {query && <button type="button" onClick={() => setQuery("")} aria-label="Clear search" className="absolute right-1 inline-flex h-7 w-7 items-center justify-center rounded-full" style={{ color: C.textMuted }}><X className="h-3.5 w-3.5" /></button>}
            </div>
            <button type="button" onClick={handleSync} disabled={syncing} title="Pull Google Calendar, ProBuild and billing for this month" className="inline-flex min-h-9 items-center gap-1.5 px-3.5 rounded-full text-[12.5px] font-medium whitespace-nowrap transition-colors hover:bg-[#F6F3EC] disabled:opacity-60" style={ghostBtn}>
              <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} />{syncing ? "Refreshing…" : "Refresh month"}
            </button>
          </div>

          {isAdmin && (
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[12px]">
              <span style={{ color: C.textMuted }}>Admin tools:</span>
              {[["install", "Installation calendar"], ["ipad", "iPad schedules"], ["knowledge", "Find a job update"]].map(([k, label]) => (
                <button key={k} type="button" onClick={() => setTool(k)} className="inline-flex min-h-8 items-center px-3 rounded-full font-medium transition-colors hover:bg-[#F6F3EC]" style={ghostBtn}>{label}</button>
              ))}
            </div>
          )}
        </div>

        {syncMessage && (
          <div role="status" className="mb-4 flex items-start gap-3 rounded-[12px] p-3 text-[13px]" style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, color: C.text }}>
            <span className="flex-1">{syncMessage}</span>
            <button type="button" onClick={() => setSyncMessage("")} aria-label="Dismiss message" className="inline-flex h-7 w-7 items-center justify-center rounded-full" style={{ color: C.textMuted }}><X className="h-3.5 w-3.5" /></button>
          </div>
        )}

        {query.trim().length >= 2 && (
          <div className="mb-4 rounded-[14px] p-3 card-shadow" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
            <div className="mono-label-sm mb-2 px-1">{searchMatches.length} match{searchMatches.length === 1 ? "" : "es"}{searchMatches.length === 50 ? " (first 50 - narrow the search)" : ""}</div>
            {searchMatches.length === 0 && <p className="px-1 text-sm" style={{ color: C.textSecondary }}>No events match &quot;{query.trim()}&quot;.</p>}
            <div className="flex flex-col">
              {searchMatches.map((m) => {
                const d = m.event_date || "";
                return (
                  <button key={m.id} type="button" onClick={() => { goToDay(d.slice(0, 10)); setSelected(m); }} className="flex items-center gap-3 rounded-md px-2 py-2 text-left text-sm hover:bg-[#F6F3EC]">
                    <span className="font-mono-num text-[12px] w-[92px] shrink-0 whitespace-nowrap" style={{ color: C.textSecondary }}>{d.slice(5, 10)} {m.start_time || ""}</span>
                    <span className="truncate font-medium" style={{ color: C.text }}>{m.job_name || "(untitled)"}</span>
                    {m.address && <span className="truncate text-[12px] max-[699px]:hidden" style={{ color: C.textMuted }}>{m.address}</span>}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <SourceCoverageBar
          outlook={outlook}
          partialOutlook={partialOutlook}
          ownership={ownership}
          ownershipCounts={ownershipCounts}
          ownershipError={ownershipError}
          loading={loading}
          excludedEvents={excludedEvents}
          month={month}
          user={user}
          showIsrael={showIsrael}
          setShowIsrael={setShowIsrael}
          showGfJobs={showGfJobs}
          setShowGfJobs={setShowGfJobs}
          showOutlook={showOutlook}
          setShowOutlook={setShowOutlook}
          onReload={load}
        />
        {creating && (
          <div className="mb-4">
            <EventForm initial={creating} jobs={jobs} onSave={handleSave} onCancel={() => setCreating(null)} saving={saving} />
          </div>
        )}
        {selected?.source === "outlook" && <OutlookEventDetails event={selected} onClose={() => setSelected(null)} />}
        {selected && selected.source !== "outlook" && (
          <EventBubble event={selected} jobs={jobs} onEdit={handleSave} onDelete={handleDelete} onClose={() => setSelected(null)} saving={saving} user={user} onChanged={load} />
        )}

        {loading && !events.length ? (
          <div className="flex items-center justify-center rounded-[14px] py-16 card-shadow" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
            <div className="w-7 h-7 border-2 rounded-full animate-spin" style={{ borderColor: C.border, borderTopColor: C.accent }} aria-label="Loading calendar" />
          </div>
        ) : view === "month" ? (
          <>
            <MonthGrid
              month={month}
              events={monthEvents}
              onSelect={setSelected}
              onCreateForDate={openCreate}
              selectedDate={selectedDay}
              onSelectDay={setSelectedDay}
              onMoveEvent={handleMoveEvent}
            />
            {/* Selected day panel */}
            <div className="mt-4 rounded-[14px] p-5 card-shadow" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <h2 className="font-heading text-[15px] font-semibold" style={{ color: C.text }}>{selectedDay === today ? `Today · ${dayLabel(selectedDay)}` : dayLabel(selectedDay)}</h2>
                <div className="flex items-center gap-2">
                  <span className="font-mono-num text-[12px]" style={{ color: C.textMuted }}>{selectedDayEvents.length} {selectedDayEvents.length === 1 ? "visit" : "visits"}</span>
                  <button type="button" onClick={() => { setView("week"); }} className="inline-flex min-h-8 items-center px-3 rounded-full text-[12px] font-medium transition-colors hover:bg-[#F6F3EC]" style={ghostBtn}>See week</button>
                </div>
              </div>
              {selectedDayEvents.length === 0 ? (
                <div className="rounded-[12px] py-8 text-center" style={{ border: `1.5px dashed ${C.border}` }}>
                  <p className="text-[13px] mb-3" style={{ color: C.textMuted }}>Nothing scheduled{filter !== "all" ? " in this filter" : ""}.</p>
                  <button type="button" onClick={() => openCreate(selectedDay)} className="inline-flex min-h-9 items-center gap-1.5 text-[12.5px] font-semibold px-3.5 rounded-full whitespace-nowrap" style={{ backgroundColor: C.accent, color: "#fff" }}><Plus className="h-3.5 w-3.5" />Add event</button>
                </div>
              ) : (
                <div className="grid grid-cols-1 min-[700px]:grid-cols-2 xl:grid-cols-3 gap-2">
                  {selectedDayEvents.map((e) => <EventCard key={e.id} event={e} today={today} onSelect={setSelected} showJobLink />)}
                </div>
              )}
            </div>
          </>
        ) : view === "week" ? (
          <WeekView day={selectedDay} events={weekEvents} today={today} onSelect={setSelected} onSelectDay={goToDay} onCreateForDate={openCreate} selectedDay={selectedDay} />
        ) : (
          <AgendaList events={monthEvents} today={today} onSelect={setSelected} emptyText={filter === "all" ? "No events this month." : "No events in this filter this month."} />
        )}
      </div>
    </div>
  );
}
