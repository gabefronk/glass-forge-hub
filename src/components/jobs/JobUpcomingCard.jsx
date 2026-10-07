import { useState } from "react";
import { CalendarClock, ExternalLink, MapPin } from "lucide-react";
import { SheetCard, TILE } from "@/components/jobs/JobSheet";
import { formatUpcomingLine, truncatePurpose } from "@/lib/jobCalendarShared";

// Owner-gated upcoming-visits card for one job. Pure presentational: the read
// lives in useJobUpcoming (lifted to the page so the hero and card share one
// bounded call). Shows date/time/purpose even for a completed job — it never
// mutates completion status to fabricate scheduling. Purpose shows a short
// word-boundary preview with an expand toggle to the full sanitized punch list.
function EventRow({ ev }) {
  const full = String(ev.purpose || "").trim();
  const preview = truncatePurpose(full, 120);
  const expandable = preview !== full && full.length > 0;
  const [expanded, setExpanded] = useState(false);
  const shown = expandable && expanded ? full : preview;
  return (
    <li className="rounded-[10px] px-3 py-2.5" style={{ border: "1px solid #e2dcd1", backgroundColor: "#faf8f3" }}>
      <div className="flex items-center gap-2">
        <span className="font-mono-num text-[13px] font-semibold whitespace-nowrap" style={{ color: "#0b3f3b" }}>{formatUpcomingLine(ev)}</span>
        {ev.flagged ? <span className="rounded-[6px] px-1.5 py-0.5 text-[10.5px] font-semibold" style={{ backgroundColor: "#faf0da", color: "#6f4e10", border: "1px solid #efdfb7" }} title="Notes had pricing; only price-free text is shown">Notes trimmed</span> : null}
      </div>
      <p className="m-0 mt-1 whitespace-pre-wrap break-words text-[13px]" style={{ color: "#182422" }}>
        {shown || "No notes."}
        {expandable ? <button type="button" onClick={() => setExpanded((v) => !v)} className="ml-1.5 text-[12px] font-semibold hover:underline" style={{ color: "#0b3f3b" }}>{expanded ? "Show less" : "Show more"}</button> : null}
      </p>
      {ev.location ? (
        <div className="mt-1.5 flex items-center gap-1.5 text-[12px]" style={{ color: "#566063" }}>
          <MapPin className="h-3.5 w-3.5 shrink-0" /> <span className="break-words">{ev.location}</span>
        </div>
      ) : null}
      {ev.link ? <a href={ev.link} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[12px] font-semibold hover:underline" style={{ color: "#0b3f3b" }}>Open in Google Calendar<ExternalLink className="h-3 w-3" /></a> : null}
    </li>
  );
}

export default function JobUpcomingCard({ upcoming }) {
  const { loading, error, events } = upcoming || { loading: false, error: "", events: [] };
  return (
    <SheetCard icon={CalendarClock} tile={TILE.green} title="Upcoming" sub="next visits on the crew calendar">
      {loading ? (
        <div className="flex items-center gap-2 py-3 text-[13px]" style={{ color: "#566063" }}>
          <span className="h-3.5 w-3.5 rounded-full border-2 animate-spin" style={{ borderColor: "#e2dcd1", borderTopColor: "#0b3f3b" }} /> Checking the crew calendar…
        </div>
      ) : error ? (
        <p role="alert" className="m-0 rounded-[9px] px-3 py-2 text-[12.5px]" style={{ color: "#a43432", backgroundColor: "#fcedec", border: "1px solid #f0c9c5" }}>
          Upcoming visits could not load. {error}
        </p>
      ) : !events.length ? (
        <p className="m-0 py-2 text-[13px]" style={{ color: "#566063" }}>No upcoming visits on the crew calendar.</p>
      ) : (
        <ul className="m-0 flex flex-col gap-2">
          {events.map((ev) => <EventRow key={ev.id} ev={ev} />)}
        </ul>
      )}
    </SheetCard>
  );
}