import { isFutureRow } from "@/lib/feeMath";
import { useEffect, useMemo, useState } from "react";
import { formatMoney } from "@/lib/feeMath";
import { isMatchBlocked } from "@/lib/invoicingFilters";
import { UNBILLED_GRID, GRID_WIDE } from "@/lib/feeUI";
import { groupLines, lineSums } from "@/lib/invoiceGrid";
import DayHeader from "./DayHeader";
import LineRow from "./LineRow";

// Invoicing lines as one ruled grid (M1b, Oct 24): a sticky column header matching the
// Purchasing grid (warm #E9E2D4 band, 2px #34403F rule), day subtotal rows, and a total
// row for whatever the Show filter and search leave on screen. Keys: J / K move between
// lines, X selects the focused line.
const HEAD_BG = "#E9E2D4", HEAD_RULE = "#34403F", HEAD_INK = "#0B3F3B";
const COLUMNS = [
  { label: "" },
  { label: "Date" },
  { label: "Job" },
  { label: "PO" },
  { label: "Crew", wide: true },
  { label: "Work", wide: true },
  { label: "Labor", right: true },
  { label: "Fee %", right: true },
  { label: "Fee", right: true },
  { label: "Status" },
  { label: "Invoice", wide: true },
  { label: "" },
];

export default function LineList({ rows, sort, selectedIds, onToggle, onShiftClick, onEdit, onDelete, onAddReport, onMarkBilled, onOpenDetails, reportAttached, onToggleDay, onClearFilters, editRequestId, onEditRequestHandled, onReady, onSendForReview, jobs, onLinkJob, totalLabel = "All lines", cellEditing = true }) {
  const [expandedId, setExpandedId] = useState(null);
  const [focusId, setFocusId] = useState(null);
  // The drawer's Edit button asks a row to open its inline expansion.
  useEffect(() => {
    if (!editRequestId) return;
    setExpandedId(editRequestId);
    onEditRequestHandled?.();
  }, [editRequestId, onEditRequestHandled]);
  const toggleExpand = (row) => setExpandedId((prev) => (prev === row.id ? null : row.id));
  const collapse = () => setExpandedId(null);
  const grouped = useMemo(() => groupLines(rows, sort), [rows, sort]);
  const total = useMemo(() => lineSums(rows), [rows]);
  const maxDayFee = Math.max(...grouped.map((g) => g.fee), 0);
  const order = useMemo(() => grouped.flatMap((g) => g.rows.map((r) => r.id)), [grouped]);

  useEffect(() => {
    const handler = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target?.closest?.("input, textarea, select, [contenteditable='true'], [role='dialog']")) return;
      const key = e.key.toLowerCase();
      if (key !== "j" && key !== "k" && key !== "x") return;
      if (!order.length) return;
      e.preventDefault();
      if (key === "x") { if (focusId && order.includes(focusId)) onToggle(focusId); return; }
      const at = order.indexOf(focusId);
      const next = at === -1 ? 0 : Math.min(order.length - 1, Math.max(0, at + (key === "j" ? 1 : -1)));
      setFocusId(order[next]);
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [order, focusId, onToggle]);

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

  const totalBand = { backgroundColor: HEAD_BG, borderTop: `2px solid ${HEAD_RULE}` };
  const lines = `${total.count} ${total.count === 1 ? "line" : "lines"}`;

  return (
    <div role="table" aria-label="Invoice lines" style={{ position: "relative" }}>
      {/* Sticky column header */}
      <div role="row" className={`hidden ${UNBILLED_GRID}`} style={{ position: "sticky", top: 0, zIndex: 5, minHeight: "30px", padding: "0 12px", backgroundColor: HEAD_BG, borderBottom: `2px solid ${HEAD_RULE}` }}>
        {COLUMNS.map((c, i) => (
          <span key={i} role="columnheader" className={`${c.wide ? GRID_WIDE : ""} text-[10.5px] font-bold uppercase tracking-[0.07em] ${c.right ? "text-right" : ""}`} style={{ color: HEAD_INK, whiteSpace: "nowrap" }}>{c.label}</span>
        ))}
      </div>
      {grouped.map((group) => (
        <div key={group.date || "all"} role="rowgroup">
          {group.date && sort === "date" && (
            <DayHeader
              date={group.date}
              lineCount={group.count}
              dayLabor={group.labor}
              dayFee={group.fee}
              isLargest={group.fee === maxDayFee && maxDayFee > 0 && grouped.length > 1}
              allSelected={group.rows.length > 0 && group.rows.every((r) => selectedIds.has(r.id))}
              onSelectDay={() => onToggleDay(group.rows)}
            />
          )}
          {group.rows.map((row) => (
            <LineRow
              key={row.id}
              row={row}
              selected={selectedIds.has(row.id)}
              focused={focusId === row.id}
              blocked={isMatchBlocked(row) || row._reportBlocked}
              reportAttached={reportAttached.has(row.id)}
              isFuture={isFutureRow(row)}
              isBilled={!!row.billed_to_bfs}
              onToggle={onToggle}
              onShiftClick={onShiftClick}
              onEdit={onEdit}
              onDelete={onDelete}
              onAddReport={onAddReport}
              onMarkBilled={onMarkBilled}
              onOpenDetails={onOpenDetails}
              expanded={expandedId === row.id}
              onToggleExpand={toggleExpand}
              onReady={onReady}
              onSendForReview={onSendForReview}
              onCollapse={collapse}
              jobs={jobs}
              onLinkJob={onLinkJob}
              cellEditing={cellEditing}
            />
          ))}
        </div>
      ))}
      {/* Total row: follows the Show filter and search */}
      <div role="row" className={`hidden ${UNBILLED_GRID}`} style={{ ...totalBand, minHeight: "34px", padding: "4px 12px" }}>
        <span />
        <span className="whitespace-nowrap text-[12.5px] font-bold" style={{ color: "var(--gf-ink)", gridColumn: "span 2" }}>
          Total · {totalLabel} <span className="font-medium" style={{ color: "var(--gf-ink-2)" }}>· {lines}</span>
        </span>
        <span />
        <span className={GRID_WIDE} />
        <span className={GRID_WIDE} />
        <span className="font-mono-num-bold text-right text-[13px]" style={{ color: "var(--gf-ink)" }}>${formatMoney(total.labor)}</span>
        <span />
        <span className="font-mono-num-bold text-right text-[13px]" style={{ color: "var(--gf-ink)" }}>${formatMoney(total.fee)}</span>
        <span className="hidden text-[11px] font-medium lg:block" style={{ color: "var(--gf-ink-2)" }}>J / K move · X selects</span>
        <span className={GRID_WIDE} />
        <span />
      </div>
      <div className="flex items-center gap-2 md:hidden" style={{ ...totalBand, minHeight: "40px", padding: "4px 12px" }}>
        <span className="text-[12.5px] font-bold" style={{ color: "var(--gf-ink)" }}>Total · {lines}</span>
        <span style={{ flex: "1 1 0%" }} />
        <span className="font-mono-num text-[12px]" style={{ color: "var(--gf-ink-2)" }}>${formatMoney(total.labor)} labor</span>
        <span className="font-mono-num-bold text-[13px]" style={{ color: "var(--gf-ink)" }}>${formatMoney(total.fee)}</span>
      </div>
    </div>
  );
}
