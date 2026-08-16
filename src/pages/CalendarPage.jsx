import { useEffect, useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Plus, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
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
  const [view, setView] = useState("month");
  const [creating, setCreating] = useState(null);
  const [selected, setSelected] = useState(null);
  const [saving, setSaving] = useState(false);
  const [syncing, setSyncing] = useState(false);

  const load = async () => {
    const [evs, jobsArr] = await Promise.all([
      base44.entities.CalendarEvents.list("-created_date", 2000),
      base44.entities.Jobs.list("-created_date", 500),
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
        <h1 className="font-heading text-xl font-semibold">Calendar</h1>
        <div className="flex items-center gap-1">
          <Button variant="outline" size="sm" onClick={() => shiftMonth(-1)}>Prev</Button>
          <span className="font-medium px-2 min-w-[140px] text-center">{formatMonth(month)}</span>
          <Button variant="outline" size="sm" onClick={() => shiftMonth(1)}>Next</Button>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex rounded-md border border-border overflow-hidden">
            <button type="button" onClick={() => setView("month")} className={cn("px-3 py-1.5 text-sm", view === "month" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-accent")}>Month</button>
            <button type="button" onClick={() => setView("list")} className={cn("px-3 py-1.5 text-sm", view === "list" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-accent")}>List</button>
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
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-teal-200" />App-authored</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-3 w-3 rounded bg-slate-200" />Google (read-only)</span>
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
        <div className="rounded-lg border border-border divide-y divide-border">
          {monthEvents.length === 0 && <div className="px-4 py-10 text-center text-sm text-muted-foreground">No events this month.</div>}
          {monthEvents.map((e) => (
            <button key={e.id} type="button" onClick={() => setSelected(e)} className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-accent/60">
              <span className="text-sm tabular-nums text-muted-foreground w-24">{e.event_date}{e.start_time ? ` ${e.start_time}` : ""}</span>
              <span className={cn("px-1.5 py-0.5 rounded text-xs font-medium", e.source === "app" ? "bg-teal-100 text-teal-900" : "bg-slate-100 text-slate-700")}>{e.source === "app" ? "App" : "Google"}</span>
              <span className="text-sm font-medium truncate flex-1">{e.job_name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}