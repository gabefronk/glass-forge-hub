import { formatShort } from "@/lib/feeUI";
import { sanitizeText } from "@/lib/jobsSanitize";
import { C } from "@/lib/feeUI";

// Refined light row for the desktop job browser: flush, hairline-divided,
// 3px left accent when selected, status dot + label, last-visit date.
export default function JobBrowserRow({ job, stats, selected, onSelect }) {
  const st = stats?.status;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={`w-full text-left flex items-center gap-3 px-3.5 transition-colors ${selected ? "bg-[#EEF5F3]" : "hover:bg-[#F6F3EC]"}`}
      style={{ minHeight: 56, borderTop: `1px solid ${C.rowBorder}`, boxShadow: selected ? `inset 3px 0 0 ${C.accent}` : "none" }}
    >
      <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: st?.text || C.textFaint }} />
      <div className="min-w-0 flex-1">
        <div className="text-[13.5px] font-semibold truncate" style={{ color: C.text }}>{sanitizeText(job.canonical_name)}</div>
        <div className="text-[11px] truncate mt-0.5" style={{ color: C.textMuted }}>
          {job.builder ? `${sanitizeText(job.builder)} · ` : ""}{sanitizeText(job.address || "")}
        </div>
      </div>
      <div className="text-right shrink-0">
        <div className="font-mono-num text-[11px] whitespace-nowrap" style={{ color: C.textMuted }}>{st?.lastReport ? formatShort(st.lastReport) : "—"}</div>
        <div className="font-mono text-[9px] font-semibold uppercase tracking-[0.08em] mt-0.5" style={{ color: st?.text || C.textMuted }}>{st?.label}</div>
      </div>
    </button>
  );
}