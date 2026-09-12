import { isFutureRow } from "@/lib/feeMath";
import { useMemo } from "react";
import { computeFeeAmt } from "@/lib/feeMath";
import DayHeader from "./DayHeader";
import LineRow from "./LineRow";

export default function LineList({ rows, sort, selectedIds, onToggle, onShiftClick, onEdit, onDelete, onAddReport, onMarkBilled, onOpenJob, onOpenDetails, reportAttached, onToggleDay, onClearFilters }) {
  const grouped = useMemo(() => {
    if (sort === "fee") {
      return [{ date: null, rows: [...rows].sort((a, b) => computeFeeAmt(b) - computeFeeAmt(a)) }];
    }
    const groups = {};
    for (const r of rows) {
      const d = r.job_date || "—";
      if (!groups[d]) groups[d] = [];
      groups[d].push(r);
    }
    return Object.entries(groups)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([date, rs]) => ({ date, rows: rs }));
  }, [rows, sort]);

  const dayFees = grouped.map((g) => g.rows.reduce((s, r) => s + (computeFeeAmt(r) || 0), 0));
  const maxDayFee = Math.max(...dayFees, 0);

  if (rows.length === 0) {
    return (
      <div style={{ padding: "80px 0", textAlign: "center" }}>
        <p className="text-[15px]" style={{ color: "var(--gf-ink-3)" }}>Nothing matches those filters.</p>
        <button onClick={onClearFilters} className="mt-3 min-h-10 rounded-lg px-4 text-[13px] font-medium" style={{ border: "1px solid var(--gf-border)", backgroundColor: "var(--gf-card)", color: "var(--gf-teal-600)", cursor: "pointer" }}>
          Clear filters
        </button>
      </div>
    );
  }

  return (
    <div style={{ position: "relative", paddingBottom: "8px" }}>
      {/* Desktop column headers */}
      <div className="hidden sm:flex items-center" style={{ height: "26px", padding: "0 16px", gap: "14px", borderBottom: "1px solid var(--gf-hairline)", backgroundColor: "var(--gf-card-band)" }}>
        <div style={{ width: "28px", flexShrink: 0 }} />
        <div style={{ width: "30px", flexShrink: 0 }} />
        <span className="text-[11px] font-semibold uppercase" style={{ color: "var(--gf-ink-3)", letterSpacing: "0.06em", flex: "1 1 auto" }}>Job</span>
        <span className="text-[11px] font-semibold uppercase text-right" style={{ color: "var(--gf-ink-3)", letterSpacing: "0.06em", width: "80px", flexShrink: 0 }}>Labor</span>
        <span className="text-[11px] font-semibold uppercase text-right" style={{ color: "var(--gf-ink-3)", letterSpacing: "0.06em", width: "128px", flexShrink: 0 }}>Status</span>
        <span className="text-[11px] font-semibold uppercase text-right" style={{ color: "var(--gf-ink-3)", letterSpacing: "0.06em", width: "100px", flexShrink: 0 }}>Fee</span>
        <div style={{ width: "28px", flexShrink: 0 }} />
      </div>
      {grouped.map((group, gi) => (
        <div key={group.date || "all"}>
          {group.date && sort === "date" && (
            <DayHeader
              date={group.date}
              lineCount={group.rows.length}
              dayFee={dayFees[gi]}
              isLargest={dayFees[gi] === maxDayFee && maxDayFee > 0}
              allSelected={group.rows.length > 0 && group.rows.every((r) => selectedIds.has(r.id))}
              onSelectDay={() => onToggleDay(group.rows)}
            />
          )}
          {group.rows.map((row) => (
            <LineRow
              key={row.id}
              row={row}
              selected={selectedIds.has(row.id)}
              blocked={(row.needs_review && !row.manually_adjusted) || row._reportBlocked}
              reportAttached={reportAttached.has(row.id)}
              isFuture={isFutureRow(row)}
              isBilled={!!row.billed_to_bfs}
              isZero={Number(row.labor_amt) === 0}
              onToggle={onToggle}
              onShiftClick={onShiftClick}
              onEdit={onEdit}
              onDelete={onDelete}
              onAddReport={onAddReport}
              onMarkBilled={onMarkBilled}
              onOpenJob={onOpenJob}
              onOpenDetails={onOpenDetails}
            />
          ))}
        </div>
      ))}
    </div>
  );
}