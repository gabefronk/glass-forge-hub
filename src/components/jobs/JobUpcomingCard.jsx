import { useEffect, useState } from "react";
import { CalendarClock, ExternalLink, MapPin } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { SheetCard, TILE } from "@/components/jobs/JobSheet";
import { formatUpcomingLine, formatUpcomingPurpose, safeError } from "@/lib/jobCalendarShared";

// Owner-gated upcoming-visits card for one job. Calls the scoped jobCalendar
// read_upcoming action (no global calendar dump). Shows date/time/purpose even for
// a completed job — it never mutates completion status to fabricate scheduling.
// refreshKey lets the parent force a reload after a create succeeds.
export default function JobUpcomingCard({ jobId, refreshKey = 0 }) {
  const [state, setState] = useState({ loading: true, error: "", events: [] });
  useEffect(() => {
    let live = true;
    setState({ loading: true, error: "", events: [] });
    (async () => {
      try {
        const res = await base44.functions.invoke("jobCalendar", { action: "read_upcoming", job_id: jobId });
        if (!live) return;
        const d = res?.data || {};
        if (d.error) setState({ loading: false, error: safeError(d.error), events: [] });
        else setState({ loading: false, error: "", events: d.events || [] });
      } catch {
        if (!live) return;
        setState({ loading: false, error: safeError("job_calendar_failed"), events: [] });
      }
    })();
    return () => { live = false; };
  }, [jobId, refreshKey]);

  return (
    <SheetCard icon={CalendarClock} tile={TILE.green} title="Upcoming" sub="next visits on the crew calendar">
      {state.loading ? (
        <div className="flex items-center gap-2 py-3 text-[13px]" style={{ color: "#566063" }}>
          <span className="h-3.5 w-3.5 rounded-full border-2 animate-spin" style={{ borderColor: "#e2dcd1", borderTopColor: "#0b3f3b" }} /> Checking the crew calendar…
        </div>
      ) : state.error ? (
        <p role="alert" className="m-0 rounded-[9px] px-3 py-2 text-[12.5px]" style={{ color: "#a43432", backgroundColor: "#fcedec", border: "1px solid #f0c9c5" }}>
          Upcoming visits could not load. {state.error}
        </p>
      ) : !state.events.length ? (
        <p className="m-0 py-2 text-[13px]" style={{ color: "#566063" }}>No upcoming visits on the crew calendar.</p>
      ) : (
        <ul className="m-0 flex flex-col gap-2">
          {state.events.map((ev) => (
            <li key={ev.id} className="rounded-[10px] px-3 py-2.5" style={{ border: "1px solid #e2dcd1", backgroundColor: "#faf8f3" }}>
              <div className="flex items-center gap-2">
                <span className="font-mono-num text-[13px] font-semibold whitespace-nowrap" style={{ color: "#0b3f3b" }}>{formatUpcomingLine(ev)}</span>
                {ev.flagged ? <span className="rounded-[6px] px-1.5 py-0.5 text-[10.5px] font-semibold" style={{ backgroundColor: "#faf0da", color: "#6f4e10", border: "1px solid #efdfb7" }} title="Notes had pricing; only price-free text is shown">Notes trimmed</span> : null}
              </div>
              <p className="m-0 mt-1 whitespace-pre-wrap break-words text-[13px]" style={{ color: "#182422" }}>{formatUpcomingPurpose(ev)}</p>
              {ev.location ? (
                <div className="mt-1.5 flex items-center gap-1.5 text-[12px]" style={{ color: "#566063" }}>
                  <MapPin className="h-3.5 w-3.5 shrink-0" /> <span className="break-words">{ev.location}</span>
                </div>
              ) : null}
              {ev.link ? <a href={ev.link} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[12px] font-semibold hover:underline" style={{ color: "#0b3f3b" }}>Open in Google Calendar<ExternalLink className="h-3 w-3" /></a> : null}
            </li>
          ))}
        </ul>
      )}
    </SheetCard>
  );
}