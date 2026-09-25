import { C, formatShort } from "@/lib/feeUI";
import { sanitizeText } from "@/lib/jobsSanitize";
import { addDays } from "@/lib/jobsOverview";
import { denverDate } from "../../../base44/shared/billingCore.js";

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

// "Today", "Tomorrow", or a short date, all in Denver days.
export function friendlyDay(day, today = denverDate()) {
  if (!day) return "";
  if (day === today) return "Today";
  if (day === addDays(today, 1)) return "Tomorrow";
  if (day === addDays(today, -1)) return "Yesterday";
  return formatShort(day);
}

// Next visit when one is scheduled, otherwise the last one; nothing when the job has no visits.
export function VisitInfo({ stats, align = "right" }) {
  if (!stats) return null;
  const today = denverDate();
  if (stats.nextVisit) {
    return (
      <div className={align === "right" ? "text-right" : ""}>
        <div className="text-[10px] font-medium uppercase tracking-[0.08em]" style={{ color: C.textMuted }}>Next visit</div>
        <div className="font-mono-num text-[13px] font-semibold whitespace-nowrap" style={{ color: stats.thisWeek ? C.accent : C.text }}>{friendlyDay(stats.nextVisit, today)}</div>
      </div>
    );
  }
  if (stats.lastVisit) {
    return (
      <div className={align === "right" ? "text-right" : ""}>
        <div className="text-[10px] font-medium uppercase tracking-[0.08em]" style={{ color: C.textMuted }}>Last visit</div>
        <div className="font-mono-num text-[13px] whitespace-nowrap" style={{ color: C.textSecondary }}>{friendlyDay(stats.lastVisit, today)}</div>
      </div>
    );
  }
  return (
    <div className={align === "right" ? "text-right" : ""}>
      <div className="text-[12px] whitespace-nowrap" style={{ color: C.textMuted }}>No visits yet</div>
    </div>
  );
}

export function StatusChip({ status }) {
  if (!status) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] font-medium px-2 py-0.5 rounded-[7px] whitespace-nowrap" style={{ backgroundColor: status.bg, color: status.text, border: `1px solid ${status.border || "transparent"}` }}>
      <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: status.text }} aria-hidden="true" />
      {status.label}
    </span>
  );
}

// Light row for the desktop job browser: flush, hairline-divided, 3px left
// accent when selected; name, builder · address, status and next/last visit.
export default function JobBrowserRow({ job, group = null, stats, selected, onSelect }) {
  const st = stats?.status;
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={`w-full text-left flex items-start gap-3 px-4 py-3 transition-colors ${selected ? "bg-[#EEF5F3]" : "hover:bg-[#F6F3EC]"}`}
      style={{ borderTop: `1px solid ${C.rowBorder}`, boxShadow: selected ? `inset 3px 0 0 ${C.accent}` : "none" }}
    >
      <div className="min-w-0 flex-1">
        <div className="text-[14px] font-semibold truncate" style={{ color: C.text, letterSpacing: "-0.01em" }}>{sanitizeText(job.canonical_name)}</div>
        <div className="text-[12px] truncate mt-0.5" style={{ color: C.textMuted }}>
          {[job.builder && sanitizeText(job.builder), job.address && sanitizeText(job.address)].filter(Boolean).join(" · ") || "No builder or address"}
        </div>
        <div className="flex flex-wrap items-center gap-1 mt-1.5">
          <StatusChip status={st} />
          {group && <DuplicateTags group={group} />}
        </div>
      </div>
      <div className="shrink-0 pt-0.5"><VisitInfo stats={stats} /></div>
    </button>
  );
}
