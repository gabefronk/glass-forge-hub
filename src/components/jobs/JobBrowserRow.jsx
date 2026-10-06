import { Link } from "react-router-dom";
import { Check } from "lucide-react";
import { titleCase } from "@/lib/displayName";
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

const FLAG_TONES = { warn: ["#faf0da", "#8a5a12"], bad: ["#fcedec", "#a43432"], info: ["#e7edf2", "#34506a"] };

// The one flag worth showing on a row, if any.
export function rowFlag(stats, group) {
  if (stats?.status?.key === "needs_report") return { label: "Report due", tone: "warn" };
  if (stats?.status?.key === "needs_review") return { label: "Review", tone: "info" };
  if (group?.review?.length) return { label: "Duplicate?", tone: "info" };
  return null;
}

// Job card for the Jobs list: bold name, builder · address, kind, and the
// next (or last) visit on the right. The selected job turns dark.
export default function JobBrowserRow({ job, group = null, stats, selected, onSelect, href, serviceCount = 0, selectMode = false, combineSelected = false, onToggleCombine }) {
  const today = denverDate();
  const when = stats?.nextVisit ? friendlyDay(stats.nextVisit, today) : stats?.lastVisit ? friendlyDay(stats.lastVisit, today) : "";
  const upcoming = Boolean(stats?.nextVisit);
  const flag = rowFlag(stats, group);
  const [fbg, fink] = flag ? FLAG_TONES[flag.tone] : [];
  const sub = [job.builder && sanitizeText(job.builder), job.address && sanitizeText(job.address)].filter(Boolean).join(" · ") || "No builder or address";
  const kindLine = [stats?.kind, group?.merged ? `${group.members.length} records` : ""].filter(Boolean).join(" · ");
  // Already-merged jobs can't be combined: disable the checkbox in select mode.
  const merged = Boolean(job.merged_into);
  const disabledInSelect = selectMode && merged;
  const body = (
    <>
      {selectMode ? (
        <span
          className="mt-[5px] flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[6px] border-2"
          aria-hidden="true"
          style={{
            backgroundColor: combineSelected ? "#0b3f3b" : disabledInSelect ? "#eee9e0" : "#ffffff",
            borderColor: combineSelected ? "#0b3f3b" : disabledInSelect ? "#d3cabb" : "#b8b0a4",
            color: "#ffffff",
          }}
        >
          {combineSelected ? <Check className="h-3.5 w-3.5" /> : null}
        </span>
      ) : (
        <span className="mt-[7px] h-[9px] w-[9px] shrink-0 rounded-full" style={{ backgroundColor: selected ? "#e0c994" : stats?.thisWeek ? "#0b3f3b" : "#c9c2b5" }} aria-hidden="true" />
      )}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[15.5px] font-bold" style={{ letterSpacing: "-0.02em" }}>{titleCase(sanitizeText(job.canonical_name))}</span>
        <span className="mt-0.5 block truncate text-[13px]" style={{ color: selected ? "#c9d0d1" : "#566063" }}>{sub}</span>
        {selectMode && <span className="mt-0.5 block font-mono text-[10.5px]" style={{ color: "#8a8f93" }}>ID {job.id}</span>}
        {kindLine ? <span className="mt-0.5 block truncate text-[12.5px]" style={{ color: selected ? "#aeb5b7" : "#6b7477" }}>{kindLine}</span> : null}
        {merged ? <span className="mt-0.5 block truncate text-[11.5px] font-semibold" style={{ color: "#8a6420" }}>Merged away</span> : null}
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        {when ? (
          <span className="whitespace-nowrap text-[13px] font-bold" style={{ color: selected ? "#e0c994" : upcoming ? "#0b3f3b" : "#6b7477" }} title={upcoming ? "Next visit" : "Last visit"}>{when}</span>
        ) : null}
        {serviceCount ? <span className="whitespace-nowrap rounded-md px-[7px] py-0.5 text-[11.5px] font-bold uppercase tracking-[.04em]" style={{ backgroundColor: "#a43432", color: "#fff" }} title="Open service item on this job">Service{serviceCount > 1 ? ` ×${serviceCount}` : ""}</span> : null}
        {flag ? <span className="whitespace-nowrap rounded-md px-[7px] py-0.5 text-[11.5px] font-semibold" style={{ backgroundColor: fbg, color: fink }}>{flag.label}</span> : null}
      </span>
    </>
  );
  const cls = "flex w-full items-start gap-3 rounded-[14px] px-3.5 py-[13px] text-left transition-shadow";
  // In select mode the whole row toggles combine selection and never navigates.
  if (selectMode) {
    const selStyle = disabledInSelect
      ? { backgroundColor: "#f7f5f0", color: "#8a8f93", border: "1px solid #e2dcd1", opacity: 0.7 }
      : combineSelected
        ? { backgroundColor: "#eaf5ee", color: "#101617", border: "1px solid #c7e4d2", boxShadow: "0 1px 2px rgba(10,29,31,.08), 0 6px 14px -8px rgba(10,29,31,.18)" }
        : { backgroundColor: "#ffffff", color: "#101617", border: "1px solid #d3cabb", boxShadow: "0 1px 2px rgba(10,29,31,.08), 0 6px 14px -8px rgba(10,29,31,.18)" };
    return (
      <button
        type="button"
        onClick={disabledInSelect ? undefined : () => onToggleCombine?.(job.id)}
        disabled={disabledInSelect}
        aria-pressed={combineSelected}
        aria-label={combineSelected ? `Unselect ${sanitizeText(job.canonical_name)}` : `Select ${sanitizeText(job.canonical_name)}`}
        className={`${cls} ${disabledInSelect ? "" : "hover:shadow-md"}`}
        style={selStyle}
      >
        {body}
      </button>
    );
  }
  const style = selected
    ? { backgroundColor: "#0e2426", color: "#ffffff", border: `1px solid ${serviceCount ? "#a43432" : "#0e2426"}`, boxShadow: "0 8px 20px -12px rgba(14,36,38,.6)" }
    : { backgroundColor: "#ffffff", color: "#101617", border: `1px solid ${serviceCount ? "#a43432" : "#d3cabb"}`, borderLeftWidth: serviceCount ? 4 : 1, boxShadow: "0 1px 2px rgba(10,29,31,.08), 0 6px 14px -8px rgba(10,29,31,.18)" };
  if (href) return <Link to={href} className={`${cls} hover:shadow-md`} style={style}>{body}</Link>;
  return (
    <button type="button" onClick={onSelect} aria-current={selected ? "true" : undefined} className={`${cls} ${selected ? "" : "hover:shadow-md"}`} style={style}>
      {body}
    </button>
  );
}