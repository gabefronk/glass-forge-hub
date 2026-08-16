import { useEffect, useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Plus, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { fetchAllPages } from "@/lib/pagination";
import MonthGrid from "@/components/calendar/MonthGrid";
import EventForm from "@/components/calendar/EventForm";
import EventDetail from "@/components/calendar/EventDetail";

function formatMonth(m) {
  const [y, mm] = m.split("-").map(Number);
  return new Date(y, mm - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
}

export default function CalendarPage() {
  const [events, setEvents] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [view, setView] = useState(() => {
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches) return "list";
    return "month";
  });
  const [creating, setCreating] = useState(null);
  const [selected, setSelected] = useState(null);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const load = async () => {
    const [evs, jobsArr] = await Promise.all([
      fetchAllPages(base44.entities.CalendarEvents, "-created_date", 1000),
      fetchAllPages(base44.entities.Jobs, "-created_date", 1000),
    ]);
    setEvents(evs);
    setJobs(jobsArr);
  };
  useEffect(() => { load(); }, []);

  const monthEvents = useMemo(() => events.filter((e) => (e.event_date || "").slice(0, 7) === month), [events, month]);

  const shiftMonth = (delta) => {
    const [y, m] = month.split("-").map(Number);
    setMonth(new Date(y, m - 1 + delta, 1).toISOString().slice(0, 7));
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
      await base44.functions.invoke("syncGoogleCalendarEvents", {});
      await base44.functions.invoke("fetchCalendarEvents", {});
      await load();
    } finally { setSyncing(false); }
  };

  return (
    <div className="px-4 sm:px-8 pt-6 pb-16">
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <h1 className="font-heading text-xl font-bold uppercase tracking-tight">Installation Schedule</h1>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={() => shiftMonth(-1)}>Prev</Button>
          <span className="font-medium px-2 min-w-[140px] text-center">{formatMonth(month)}</span>
          <Button variant="outline" size="sm" onClick={() => shiftMonth(1)}>Next</Button>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex rounded-md border border-border overflow-hidden">
            <button type="button" onClick={() => setView("month")} className={cn("px-3 py-1.5 text-xs uppercase tracking-wide font-semibold", view === "month" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted text-foreground")}>Month</button>
            <button type="button" onClick={() => setView("list")} className={cn("px-3 py-1.5 text-xs uppercase tracking-wide font-semibold", view === "list" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted text-foreground")}>List</button>
          </div>
          <Button variant="outline" size="sm" onClick={handleSync} disabled={syncing}>
            <RefreshCw className="h-4 w-4 mr-1" />{syncing ? "Syncing…" : "Sync Google"}
          </Button>
          <Button size="sm" onClick={() => { setSelected(null); setCreating({ event_date: month + "-01" }); }}>
            <Plus className="h-4 w-4 mr-1" />New event
          </Button>
        </div>
      </div>

      <div className="flex gap-4 mb-3 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm" style={{ backgroundColor: "#d6f5f0", borderLeft: "3px solid #0d9488" }} />Install</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded-sm" style={{ backgroundColor: "#fce4e4", borderLeft: "3px solid #c1625a" }} />Service</span>
      </div>

      {creating && (
        <div className="mb-4">
          <EventForm initial={creating} jobs={jobs} onSave={handleSave} onCancel={() => setCreating(null)} saving={saving} />
        </div>
      )}
      {selected && (
        <div className="mb-4">
          <EventDetail event={selected} jobs={jobs} onEdit={handleSave} onDelete={handleDelete} onClose={() => setSelected(null)} saving={saving} />
        </div>
      )}

      {view === "month" ? (
        <MonthGrid month={month} events={monthEvents} onSelect={setSelected} onCreateForDate={(d) => { setSelected(null); setCreating({ event_date: d }); }} />
      ) : (
        <div className="rounded-lg border border-border overflow-hidden">
          {monthEvents.length === 0 && <div className="px-4 py-10 text-center text-sm text-muted-foreground">No events this month.</div>}
          {monthEvents.map((e) => {
            const isInstall = e.source === "app";
            const bg = isInstall ? "#d6f5f0" : "#fce4e4";
            const bar = isInstall ? "#0d9488" : "#c1625a";
            return (
              <button
                key={e.id}
                type="button"
                onClick={() => setSelected(e)}
                className="w-full flex items-center gap-3 px-3 py-2.5 text-left border-b border-border last:border-b-0 hover:bg-accent/40"
              >
                <div className="flex flex-col items-center justify-center min-w-[42px] pr-1 border-r border-border/60">
                  <span className="text-[10px] uppercase text-muted-foreground leading-none">
                    {new Date(e.event_date + "T00:00:00").toLocaleDateString("en-US", { weekday: "short" })}
                  </span>
                  <span className="text-lg font-bold tabular-nums leading-tight">
                    {e.event_date.slice(8)}
                  </span>
                </div>
                <div className="flex-1 min-w-0 rounded-[3px] px-2 py-1.5" style={{ backgroundColor: bg, borderLeft: `3px solid ${bar}` }}>
                  {e.start_time && (
                    <span className="text-xs tabular-nums font-semibold mr-1.5" style={{ color: bar }}>{e.start_time}</span>
                  )}
                  <span className="text-sm font-medium truncate">{e.job_name}</span>
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}