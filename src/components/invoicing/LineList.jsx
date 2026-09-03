import { useMemo } from "react";
import { computeFeeAmt, formatMoney } from "@/lib/feeMath";
import DayHeader from "./DayHeader";
import LineRow from "./LineRow";

export default function LineList({ rows, sort, selectedIds, onToggle, onShiftClick, onEdit, onDelete, onAddReport, onMarkBilled, onOpenJob, reportAttached, onToggleDay, onClearFilters }) {
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
        <p style={{ fontFamily: "'Archivo',sans-serif", fontSize: "15px", color: "#616D81" }}>Nothing matches those filters.</p>
        <button
          onClick={onClearFilters}
          style={{
            marginTop: "12px",
            padding: "8px 16px",
            borderRadius: "10px",
            border: "1px solid #DDE3EC",
            backgroundColor: "#FFFFFF",
            color: "#1E4A85",
            fontFamily: "'Archivo',sans-serif",
            fontSize: "13px",
            fontWeight: 500,
            cursor: "pointer",
          }}
        >
          Clear filters
        </button>
      </div>
    );
  }

  return (
    <div>
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
              blocked={row.needs_review && !row.manually_adjusted}
              reportAttached={reportAttached.has(row.id)}
              isFuture={row.job_date && row.job_date > new Date().toISOString().slice(0, 10)}
              isBilled={!!row.billed_to_bfs}
              isZero={Number(row.labor_amt) === 0}
              onToggle={onToggle}
              onShiftClick={onShiftClick}
              onEdit={onEdit}
              onDelete={onDelete}
              onAddReport={onAddReport}
              onMarkBilled={onMarkBilled}
              onOpenJob={onOpenJob}
            />
          ))}
        </div>
      ))}
    </div>
  );
}