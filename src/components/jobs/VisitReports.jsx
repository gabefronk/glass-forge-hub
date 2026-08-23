import { C, formatDateGroup } from "@/lib/feeUI";
import { Check, Clock, X, AlertCircle } from "lucide-react";

// Shows each scheduled visit for a job with its field-report status icon:
// green check = report complete, amber clock = awaiting, red X = late, grey clock = rescheduled
export default function VisitReports({ events }) {
  if (!events || !events.length) return null;

  const sorted = [...events].sort((a, b) => (a.event_date || "").localeCompare(b.event_date || ""));

  return (
    <div className="rounded-[16px] p-5" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
      <h3 className="font-heading text-[13px] font-semibold mb-3" style={{ color: C.text }}>Visit reports</h3>
      <div className="space-y-2">
        {sorted.map((ev) => {
          const icon = visitIcon(ev);
          return (
            <div key={ev.id} className="flex items-center gap-3">
              <div className="h-7 w-7 rounded-full flex items-center justify-center shrink-0" style={{ backgroundColor: icon.bg }}>
                {icon.icon}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-[13px] font-medium truncate" style={{ color: C.text }}>{ev.job_name}</div>
                <div className="text-[11px]" style={{ color: C.textMuted }}>
                  {ev.event_date ? formatDateGroup(ev.event_date) : "—"}
                  {ev.report_status === "rescheduled" && ev.original_scheduled_date ? ` · originally ${formatDateGroup(ev.original_scheduled_date)}` : ""}
                </div>
              </div>
              <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.1em] px-2 py-0.5 rounded-full whitespace-nowrap shrink-0" style={{ backgroundColor: icon.bg, color: icon.color }}>
                {icon.label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function visitIcon(ev) {
  if (!ev.report_required || ev.report_required === false) {
    return { icon: <Check className="h-3.5 w-3.5" style={{ color: C.textMuted }} />, label: "N/A", color: C.textMuted, bg: "rgba(255,255,255,.06)" };
  }
  if (ev.report_status === "ok") {
    return { icon: <Check className="h-3.5 w-3.5" style={{ color: C.accent }} />, label: "Complete", color: C.accent, bg: "rgba(110,231,192,.14)" };
  }
  if (ev.report_status === "waived") {
    return { icon: <Check className="h-3.5 w-3.5" style={{ color: C.textMuted }} />, label: "Waived", color: C.textMuted, bg: "rgba(255,255,255,.06)" };
  }
  if (ev.report_status === "rescheduled") {
    return { icon: <Clock className="h-3.5 w-3.5" style={{ color: C.textMuted }} />, label: "Rescheduled", color: C.textMuted, bg: "rgba(255,255,255,.06)" };
  }
  const days = ev.days_late || 0;
  if (days > 0) {
    return { icon: <X className="h-3.5 w-3.5" style={{ color: "#FF8A7A" }} />, label: `${days}d late`, color: "#FF8A7A", bg: "rgba(255,138,122,.14)" };
  }
  return { icon: <Clock className="h-3.5 w-3.5" style={{ color: C.amber }} />, label: "Awaiting", color: C.amber, bg: "rgba(255,138,122,.10)" };
}