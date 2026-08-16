import { Link } from "react-router-dom";
import { ChevronRight } from "lucide-react";
import { C, JOBS_GRID, ROW_SHADOW, formatShort } from "@/lib/feeUI";
import { formatMoney } from "@/lib/feeMath";
import { cn } from "@/lib/utils";

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
  const barColor = isZero ? C.leftBarZero : C.accent;
  const reportOverdue = status.key === "needs_report";
  const refs = refsLabel(job.po_numbers || [], job.oe_numbers || []);

  return (
    <Link
      to={`/jobs/${job.id}`}
      className={cn(JOBS_GRID, "px-4 py-3 items-center transition-colors hover:bg-[#f6f8f6]")}
      style={{ borderTop: `1px solid ${C.rowBorder}`, boxShadow: ROW_SHADOW }}
    >
      {/* JOB — two tight lines */}
      <div className="flex items-center gap-2 min-w-0">
        <div className="w-[3px] h-9 rounded-full shrink-0" style={{ backgroundColor: barColor }} />
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <span className="truncate whitespace-nowrap" style={{ fontSize: "14px", fontWeight: 600, color: C.accentDark }}>{job.canonical_name}</span>
            {job.builder && <span className="truncate whitespace-nowrap" style={{ fontSize: "11.5px", color: C.text, opacity: 0.68 }}>{job.builder}</span>}
          </div>
          <div className="flex items-center gap-2 mt-0.5">
            {job.address && <span className="truncate" style={{ fontSize: "11.5px", color: C.text, opacity: 0.68 }}>{job.address}</span>}
            {refs && (
              <span className="font-mono whitespace-nowrap px-1.5 py-0.5 rounded shrink-0" style={{ fontSize: "10px", backgroundColor: C.mutedBg, color: C.text, opacity: 0.72 }}>{refs}</span>
            )}
          </div>
        </div>
      </div>
      {/* Visits */}
      <div className="text-right tabular-nums" style={{ fontSize: "13px", color: C.text }}>{stats.visits}</div>
      {/* Last report */}
      <div className="text-right tabular-nums whitespace-nowrap" style={{ fontSize: "13px", color: reportOverdue ? C.amber : C.text, opacity: reportOverdue ? 1 : 0.68 }}>
        {stats.lastReport ? formatShort(stats.lastReport) : "—"}
      </div>
      {/* Labor */}
      <div className="text-right tabular-nums" style={{ fontSize: "13px", color: C.text, opacity: isZero ? 0.5 : 1 }}>
        {isZero ? "—" : `$${formatMoney(stats.labor)}`}
      </div>
      {/* Fee */}
      <div className="text-right tabular-nums font-semibold whitespace-nowrap" style={{ fontSize: "13px", color: isZero ? C.text : C.accent, opacity: isZero ? 0.5 : 1 }}>
        {isZero ? "—" : `$${formatMoney(stats.fee)}`}
      </div>
      {/* Status */}
      <div className="flex justify-end">
        <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full whitespace-nowrap" style={{ backgroundColor: status.bg, color: status.text }}>{status.label}</span>
      </div>
      {/* Chevron */}
      <div className="flex justify-end">
        <ChevronRight className="h-4 w-4" style={{ color: C.text, opacity: 0.4 }} />
      </div>
    </Link>
  );
}