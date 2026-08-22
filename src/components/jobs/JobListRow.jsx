import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { C, formatShort } from "@/lib/feeUI";
import { formatMoney } from "@/lib/feeMath";

function refsLabel(pos, oes) {
  const total = pos.length + oes.length;
  if (total === 0) return null;
  if (total === 1) return pos.length === 1 ? `PO ${pos[0]}` : `OE ${oes[0]}`;
  const parts = [];
  if (pos.length > 0) parts.push(`${pos.length} PO`);
  if (oes.length > 0) parts.push(`${oes.length} OE`);
  return parts.join(" · ");
}

export default function JobListRow({ job, stats }) {
  const status = stats.status;
  const isZero = stats.labor === 0;
  const reportOverdue = status.key === "needs_report";
  const refs = refsLabel(job.po_numbers || [], job.oe_numbers || []);

  return (
    <Link
      to={`/jobs/${job.id}`}
      className="grid grid-cols-[minmax(180px,1fr)_64px_96px_92px_78px_104px_18px] gap-3 items-center px-4 transition-colors hover:bg-white/[0.02]"
      style={{ minHeight: "56px", borderTop: `1px solid ${C.rowBorder}` }}
    >
      {/* JOB */}
      <div className="flex items-center gap-2 min-w-0">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate text-[14px] font-semibold" style={{ color: C.text }}>{job.canonical_name}</span>
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            {job.address && <span className="truncate text-[11px]" style={{ color: C.textMuted }}>{job.address}</span>}
            {refs && (
              <span className="font-mono whitespace-nowrap px-1.5 py-0.5 rounded shrink-0 text-[10px]" style={{ backgroundColor: C.mutedBg, color: C.textSecondary }}>{refs}</span>
            )}
          </div>
        </div>
      </div>
      {/* BUILDER */}
      <div className="truncate text-[12px]" style={{ color: C.textSecondary }}>{job.builder || "—"}</div>
      {/* VISITS */}
      <div className="text-right font-mono-num text-[13px]" style={{ color: C.text }}>{stats.visits}</div>
      {/* REPORT */}
      <div className="text-right font-mono-num text-[12px] whitespace-nowrap" style={{ color: reportOverdue ? C.amber : C.textMuted }}>
        {stats.lastReport ? formatShort(stats.lastReport) : "—"}
      </div>
      {/* LABOR */}
      <div className="text-right font-mono-num text-[13px]" style={{ color: isZero ? C.textMuted : C.text }}>
        {isZero ? "—" : `$${formatMoney(stats.labor)}`}
      </div>
      {/* FEE */}
      <div className="text-right font-mono-num-bold text-[13px] whitespace-nowrap" style={{ color: isZero ? C.textMuted : C.accent }}>
        {isZero ? "—" : `$${formatMoney(stats.fee)}`}
      </div>
      {/* STATUS */}
      <div className="flex justify-end">
        <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.13em] px-2 py-0.5 rounded-full whitespace-nowrap" style={{ backgroundColor: status.bg, color: status.text }}>{status.label}</span>
      </div>
      {/* Chevron */}
      <div className="flex justify-end">
        <ChevronRight className="h-4 w-4" style={{ color: C.textFaint }} />
      </div>
    </Link>
  );
}