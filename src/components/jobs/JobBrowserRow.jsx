import { addedTimestamp, C } from "@/lib/feeUI";
import { sanitizeText } from "@/lib/jobsSanitize";

// Small tags for a read-only duplicate group (lib/jobDedupe.js): how many records
// are shown as this one job, and whether another job may be a duplicate.
export function DuplicateTags({ group }) {
  if (!group) return null;
  const others = group.review.flatMap((r) => r.jobs.map((j) => sanitizeText(j.name)));
  return (
    <>
      {group.merged && (
        <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.08em] px-1.5 py-0.5 rounded-full whitespace-nowrap" style={{ backgroundColor: C.tagCal.bg, color: C.tagCal.text }}
          title={`Shown as one job: ${group.members.map((m) => sanitizeText(m.canonical_name)).join(" · ")}`}>
          {group.members.length} records
        </span>
      )}
      {group.review.length > 0 && (
        <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.08em] px-1.5 py-0.5 rounded-full whitespace-nowrap" style={{ backgroundColor: C.amberLight, color: C.amber }}
          title={`${group.review.map((r) => r.reason).join("; ")}: ${others.join(" · ")}`}>
          Possible duplicate
        </span>
      )}
    </>
  );
}

// Refined light row for the desktop job browser: flush, hairline-divided,
// 3px left accent when selected, status dot + label, last-visit date.
export default function JobBrowserRow({ job, group = null, stats, selected, onSelect }) {
  const st = stats?.status;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={`w-full text-left flex items-center gap-3 px-3.5 transition-colors ${selected ? "bg-[#EEF5F3]" : "hover:bg-[#F6F3EC]"}`}
      style={{ minHeight: 64, borderTop: `1px solid ${C.rowBorder}`, boxShadow: selected ? `inset 3px 0 0 ${C.accent}` : "none" }}
    >
      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: st?.text || C.textFaint }} />
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-bold truncate" style={{ color: C.text }}>{sanitizeText(job.canonical_name)}</div>
        <div className="text-[12px] truncate mt-0.5" style={{ color: C.textMuted }}>
          {job.builder ? `${sanitizeText(job.builder)} · ` : ""}{sanitizeText(job.address || "")}
        </div>
        {group && (group.merged || group.review.length > 0) && (
          <div className="flex flex-wrap items-center gap-1 mt-1"><DuplicateTags group={group} /></div>
        )}
      </div>
      <div className="text-right shrink-0">
        <div className="font-mono-num text-[11px] whitespace-nowrap" style={{ color: C.textMuted }}>{addedTimestamp(job.created_date)}</div>
        <div className="font-mono text-[10px] font-bold uppercase tracking-[0.08em] mt-0.5" style={{ color: st?.text || C.textMuted }}>{st?.label}</div>
      </div>
    </button>
  );
}
