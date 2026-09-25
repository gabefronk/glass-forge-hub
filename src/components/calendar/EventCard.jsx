import { Link } from "react-router-dom";
import { MapPin, Users, ExternalLink } from "lucide-react";
import { C } from "@/lib/feeUI";
import { KIND, eventKind, reportBadge } from "@/lib/calendarModel";

export function Chip({ tone, children, title }) {
  return (
    <span title={title} className="inline-flex items-center text-[10.5px] font-medium px-1.5 py-0.5 rounded-[6px] whitespace-nowrap" style={{ color: tone.text, backgroundColor: tone.bg, border: `1px solid ${tone.border}` }}>
      {children}
    </span>
  );
}

function timeRange(e) {
  if (!e.start_time) return "All day";
  return e.end_time ? `${e.start_time}–${e.end_time}` : e.start_time;
}

// One visit as a card: kind bar, time, job, address and crew, kind and report chips.
// `compact` drops the address and crew lines for the narrow week columns.
export default function EventCard({ event, today, onSelect, compact = false, showJobLink = false }) {
  const kind = KIND[eventKind(event)];
  const report = reportBadge(event, today);
  return (
    <div className="group relative flex rounded-[10px] overflow-hidden transition-shadow hover:shadow-[0_1px_2px_rgba(21,24,26,.06),0_4px_12px_-4px_rgba(21,24,26,.16)]" style={{ border: `1px solid ${C.border}`, backgroundColor: C.card }}>
      <span className="w-[3px] shrink-0" style={{ backgroundColor: kind.bar }} aria-hidden="true" />
      <button type="button" onClick={() => onSelect?.(event)} className={`min-w-0 flex-1 text-left ${compact ? "px-2 py-1.5" : "px-3 py-2.5"}`}>
        <div className="flex items-center gap-2">
          <span className="font-mono-num text-[11.5px] font-semibold whitespace-nowrap" style={{ color: kind.text }}>{timeRange(event)}</span>
          {!compact && <Chip tone={kind}>{kind.label}</Chip>}
        </div>
        <div className={`${compact ? "text-[12px]" : "text-[13.5px]"} font-semibold mt-0.5 break-words`} style={{ color: C.text, letterSpacing: "-0.01em" }}>{event.job_name || "(untitled)"}</div>
        {!compact && event.address && (
          <div className="mt-1 flex items-start gap-1.5 text-[12px]" style={{ color: C.textMuted }}>
            <MapPin className="h-3.5 w-3.5 mt-px shrink-0" aria-hidden="true" /><span className="break-words">{event.address}</span>
          </div>
        )}
        {!compact && event.crew && (
          <div className="mt-0.5 flex items-start gap-1.5 text-[12px]" style={{ color: C.textMuted }}>
            <Users className="h-3.5 w-3.5 mt-px shrink-0" aria-hidden="true" /><span className="break-words">{event.crew}</span>
          </div>
        )}
        {report && <div className={compact ? "mt-1" : "mt-2"}><Chip tone={report}>{report.label}</Chip></div>}
      </button>
      {showJobLink && event.job_id && (
        <Link to={`/jobs/${event.job_id}`} aria-label={`Open job ${event.job_name || ""}`} title="Open job" className="shrink-0 inline-flex w-11 items-center justify-center transition-colors hover:bg-[#F6F3EC]" style={{ color: C.textMuted, borderLeft: `1px solid ${C.rowBorder}` }}>
          <ExternalLink className="h-4 w-4" />
        </Link>
      )}
    </div>
  );
}
