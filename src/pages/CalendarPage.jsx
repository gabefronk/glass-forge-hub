import { refreshMonth } from "@/lib/refreshMonth";
import { currentMonthStr } from "@/lib/feeMath";
import { useEffect, useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { ChevronLeft, ChevronRight, Plus, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { fetchAllPages } from "@/lib/pagination";
import { C } from "@/lib/feeUI";
import MonthGrid from "@/components/calendar/MonthGrid";
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

const INSTALL_COLOR = "#146556";
const SERVICE_COLOR = "#A43432";
const OUTLOOK_COLOR = "#7042A1";

export default function CalendarPage() {
  const [events, setEvents] = useState([]);
  const [cleanView,setCleanView] = useState(false);
  const [serviceView,setServiceView]=useState(false);
  const [knowledgeView,setKnowledgeView]=useState(false);
  const [outlook, setOutlook] = useState(null);
  const [excludedEvents, setExcludedEvents] = useState([]);
  const [syncMessage, setSyncMessage] = useState("");
  const [ownership, setOwnership] = useState(null);
  const [ownershipError, setOwnershipError] = useState("");
  const [loading, setLoading] = useState(true);
  const [partialOutlook, setPartialOutlook] = useState(null);
  const [showIsrael, setShowIsrael] = useState(true);
  const [showOutlook, setShowOutlook] = useState(true);
  const [jobs, setJobs] = useState([]);
  const [month, setMonth] = useState(currentMonthStr);
  const [view, setView] = useState(() => {
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches) return "list";
    return "month";
  });
  const [creating, setCreating] = useState(null);
  const [selected, setSelected] = useState(null);
  const [selectedDay, setSelectedDay] = useState(() => new Date().toISOString().slice(0, 10));
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [unreportedOnly, setUnreportedOnly] = useState(false);
  const [user, setUser] = useState(null);

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
    } catch {
      setEvents([]); setOwnership(null);
      setOwnershipError("Calendar ownership could not be verified against Sales Tracker. Reload to try again.");
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
    events: events.map(group => group.find(event => event.source === "outlook" ? showOutlook : showIsrael)).filter(Boolean),
  }), [events, showIsrael, showOutlook]);
  const ownershipCounts = ownership?.by_month?.[month];
  const monthEvents = useMemo(() => {
    let filtered = combined.events.filter((e) => (e.event_date || "").slice(0, 7) === month);
    if (unreportedOnly) {
      filtered = filtered.filter((e) => e.report_required !== false &&
        ["pending", "missing_photos", "missing_notes", "missing_all", "rescheduled"].includes(e.report_status));
    }
    return filtered;
  }, [combined, month, unreportedOnly]);
  const selectedDayEvents = useMemo(() => {
    return monthEvents.filter((e) => (e.event_date || "").slice(0, 10) === selectedDay).sort((a, b) => (a.start_time || "99").localeCompare(b.start_time || "99"));
  }, [monthEvents, selectedDay]);

  const shiftMonth = (delta) => {
    const [y, m] = month.split("-").map(Number);
    const newMonth = new Date(y, m - 1 + delta, 1).toISOString().slice(0, 7);
    setMonth(newMonth);
    setSelectedDay(`${newMonth}-01`);
  };

  const handleSave = async (f) => {
    setSaving(true);
    try {
      const payload = {
        ...f,
        labor_amt: f.labor_amt === "" ? 0 : Number(f.labor_amt),
        job_id: f.job_id || null,
      };
      if (selected?.id) payload.id = selected.id;
      await base44.functions.invoke("pushCalendarEvent", payload);
      setCreating(null);
      setSelected(null);
      await load();
    } finally { setSaving(false); }
  };

  const handleDelete = async () => {
    if (!selected || !confirm("Delete this event from both calendars?")) return;
    setSaving(true);
    try {
      await base44.functions.invoke("deleteCalendarEvent", { id: selected.id });
      setSelected(null);
      await load();
    } finally { setSaving(false); }
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

  if(user?.role==="admin" && knowledgeView)return <div className="p-5"><button className="underline mb-4" onClick={()=>setKnowledgeView(false)}>Back to calendar</button><JobKnowledge /></div>;
  if(user?.role==="admin" && serviceView)return <div className="p-5"><button className="underline mb-4" onClick={()=>setServiceView(false)}>Back to calendar</button><ServiceCalendar /></div>;
  if(user?.role==="admin" && cleanView) return <div className="p-5" style={{backgroundColor:C.pageBg,minHeight:"100vh"}}><button className="mb-4 underline" onClick={()=>setCleanView(false)}>Back to calendar</button><button className="mb-4 ml-4 underline" onClick={()=>setServiceView(true)}>Service calendar</button><button className="mb-4 ml-4 underline" onClick={()=>setKnowledgeView(true)}>Find job update</button><CleanCalendar /></div>;
  return (
    <div style={{ backgroundColor: C.pageBg, minHeight: "100vh" }}>
      <div className="hero-glow px-[26px] max-[699px]:px-[18px] pt-[26px] max-[699px]:pt-[18px] pb-10">
        {/* Header */}
        <div className="mb-6 rounded-[16px] border bg-white px-4 py-4 shadow-sm sm:px-5">
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0">
              <div className="mono-label-sm mb-1">Schedule</div>
              <h1 className="font-heading text-[22px] font-semibold tracking-[-0.03em]" style={{ color: C.text }}>Calendar</h1>
            </div>
            {user?.role==="admin"&&<button className="ml-auto rounded-full border px-3 py-2 text-[12px] font-semibold" style={{borderColor:C.border,color:C.textSecondary}} onClick={()=>setCleanView(true)}>Installation calendar</button>}
          </div>
          <div className="mt-4 flex w-full flex-wrap items-center gap-2">
            <div className="flex rounded-full p-0.5" style={{ border: `1px solid ${C.border}` }}>
              <button type="button" onClick={() => setView("month")} className={cn("px-3 py-1.5 rounded-full text-[10px] font-semibold tracking-[0.01em] transition-colors", view === "month" ? "" : "")} style={view === "month" ? { backgroundColor: C.accent, color: C.accentDark } : { color: C.textSecondary }}>Month</button>
              <button type="button" onClick={() => setView("list")} className={cn("px-3 py-1.5 rounded-full text-[10px] font-semibold tracking-[0.01em] transition-colors", view === "list" ? "" : "")} style={view === "list" ? { backgroundColor: C.accent, color: C.accentDark } : { color: C.textSecondary }}>List</button>
            </div>
            <button type="button" onClick={() => setUnreportedOnly(!unreportedOnly)} className="px-3 py-1.5 rounded-full text-[10px] font-semibold tracking-[0.01em] whitespace-nowrap transition-colors" style={unreportedOnly ? { backgroundColor: C.amber, color: "#FFFFFF" } : { border: `1px solid ${C.border}`, color: C.textSecondary }}>Unreported only</button>
            <button onClick={handleSync} disabled={syncing} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[12px] font-medium whitespace-nowrap transition-colors hover:bg-[#F8F9F6]" style={{ border: `1px solid ${C.border}`, color: C.textSecondary }}>
              <RefreshCw className="h-3.5 w-3.5" />{syncing ? "Syncing…" : "Refresh whole month"}
            </button>
            <button onClick={() => { setSelected(null); setCreating({ event_date: selectedDay }); }} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[12px] font-semibold whitespace-nowrap" style={{ backgroundColor: C.accent, color: C.accentDark }}>
              <Plus className="h-3.5 w-3.5" />New event
            </button>
          </div>
        </div>

        {syncMessage && <p role="status" className="mb-4 rounded-lg border bg-white p-3 text-sm">{syncMessage}</p>}

        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 mb-4">
          <h1 className="font-heading text-[22px] sm:text-[24px] font-semibold" style={{ color: C.text, letterSpacing: "-0.03em" }}>{formatMonth(month)}</h1>
          <div className="flex items-center gap-1" aria-label="Choose calendar month">
            <button type="button" onClick={() => shiftMonth(-1)} className="inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-[#F8F9F6]" style={{ border: `1px solid ${C.border}`, color: C.textSecondary }} aria-label="Previous month"><ChevronLeft className="h-4 w-4" /></button>
            <button type="button" onClick={() => { const today = new Date(); const day = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`; setMonth(day.slice(0, 7)); setSelectedDay(day); }} className="min-h-11 rounded-full px-3 text-xs font-medium hover:bg-[#F8F9F6]" style={{ color: C.textSecondary }}>Today</button>
            <button type="button" onClick={() => shiftMonth(1)} className="inline-flex h-11 w-11 items-center justify-center rounded-full hover:bg-[#F8F9F6]" style={{ border: `1px solid ${C.border}`, color: C.textSecondary }} aria-label="Next month"><ChevronRight className="h-4 w-4" /></button>
          </div>
          <div className="flex items-center gap-3 text-[11px]">
            <span className="inline-flex items-center gap-1.5" style={{ color: C.textSecondary }}>
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: INSTALL_COLOR }} />Install
            </span>
            <span className="inline-flex items-center gap-1.5" style={{ color: C.textSecondary }}>
              <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: SERVICE_COLOR }} />Service
            </span>
          </div>
        </div>

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

        {view === "month" ? (
          <>
            <MonthGrid
              month={month}
              events={monthEvents}
              onSelect={setSelected}
              onCreateForDate={(d) => { setSelected(null); setCreating({ event_date: d }); }}
              selectedDate={selectedDay}
              onSelectDay={setSelectedDay}
            />
            {/* Selected day panel */}
            <div className="mt-4 rounded-[14px] p-5 card-shadow" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <h3 className="font-heading text-[14px] font-semibold" style={{ color: C.text }}>{dayLabel(selectedDay)}</h3>
                <span className="font-mono-num text-[12px]" style={{ color: C.textMuted }}>{selectedDayEvents.length} {selectedDayEvents.length === 1 ? "event" : "events"}</span>
              </div>
              {selectedDayEvents.length === 0 ? (
                <div className="rounded-[12px] py-8 text-center" style={{ border: `1.5px dashed ${C.border}` }}>
                  <p className="text-[13px] mb-2" style={{ color: C.textMuted }}>Nothing scheduled</p>
                  <button onClick={() => { setCreating({ event_date: selectedDay }); }} className="text-[10px] font-semibold tracking-[0.01em] px-3 py-1.5 rounded-full whitespace-nowrap" style={{ backgroundColor: C.accent, color: C.accentDark }}>Add event</button>
                </div>
              ) : (
                <div className="grid grid-cols-1 min-[700px]:grid-cols-2 gap-3">
                  {selectedDayEvents.map((e) => {
                    const isInstall = e.source === "app";
                    const color = e.source === "outlook" ? OUTLOOK_COLOR : isInstall ? INSTALL_COLOR : SERVICE_COLOR;
                    return (
                      <button key={e.id} type="button" onClick={() => setSelected(e)} className="flex items-center gap-3 rounded-[12px] p-3 text-left transition-colors hover:bg-white/[0.03]" style={{ border: `1px solid ${C.border}`, backgroundColor: C.cardAlt }}>
                        <div className="w-[2px] self-stretch shrink-0 rounded-full" style={{ backgroundColor: color }} />
                        <div className="font-mono-num text-[13px] w-[52px] shrink-0" style={{ color: C.textSecondary }}>{e.start_time || "—"}</div>
                        <div className="min-w-0 flex-1">
                          <div className="text-[13px] font-medium truncate" style={{ color: C.text }}>{e.job_name}</div>
                          {e.address && <div className="text-[11px] truncate" style={{ color: C.textMuted }}>{e.address}</div>}
                        </div>
                        <span className="text-[9px] font-semibold tracking-[0.01em] px-2 py-0.5 rounded-full whitespace-nowrap shrink-0" style={{ backgroundColor: isInstall ? "#EAF5EE" : "#FCEDEC", border: isInstall ? "1px solid #C7E4D2" : "1px solid #F0C9C5", color }}>{e.source === "outlook" ? "Outlook" : isInstall ? "Install" : "Service"}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="rounded-[14px] overflow-hidden card-shadow" style={{ border: `1px solid ${C.border}`, backgroundColor: C.card }}>
            {monthEvents.length === 0 && <div className="px-4 py-10 text-center text-[13px]" style={{ color: C.textMuted }}>No events this month.</div>}
            {monthEvents.sort((a, b) => (a.event_date || "").localeCompare(b.event_date || "")).map((e) => {
              const isInstall = e.source === "app";
              const color = e.source === "outlook" ? OUTLOOK_COLOR : isInstall ? INSTALL_COLOR : SERVICE_COLOR;
              const bg = e.source === "outlook" ? "#F0E9FA" : isInstall ? "#EAF5EE" : "#FCEDEC";
              return (
                <button
                  key={e.id}
                  type="button"
                  onClick={() => setSelected(e)}
                  className="w-full flex items-center gap-3 px-4 py-2 text-left transition-colors hover:bg-[#F8F9F6]"
                  style={{ minHeight: "56px", borderTop: `1px solid ${C.rowBorder}` }}
                >
                  <div className="flex flex-col items-center justify-center min-w-[42px] pr-1" style={{ borderRight: `1px solid ${C.border}` }}>
                    <span className="text-[10px] tracking-[0.01em] leading-none" style={{ color: C.textMuted }}>
                      {new Date(e.event_date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short" })}
                    </span>
                    <span className="font-mono-num-bold text-[18px] leading-tight" style={{ color: C.text }}>
                      {e.event_date.slice(8)}
                    </span>
                  </div>
                  <div className="flex-1 min-w-0 break-words rounded-[4px] px-2.5 py-1.5" style={{ backgroundColor: bg, borderLeft: `2px solid ${color}` }}>
                    {e.start_time && (
                      <span className="font-mono-num text-[12px] font-semibold mr-1.5" style={{ color }}>{e.start_time}</span>
                    )}
                    <span className="break-words text-[13px] font-medium" style={{ color: C.text }}>{e.job_name}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}