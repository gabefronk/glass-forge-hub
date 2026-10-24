import { useEffect, useMemo, useRef, useState } from "react";
import { formatMoney } from "@/lib/feeMath";
import { groupLines, lineSums, selectionState } from "@/lib/invoiceGrid";
import DayHeader from "./DayHeader";
import LineRow, { GRID_CLASS, WIDE_ONLY, CheckBox } from "./LineRow";

// Invoicing lines as one flat grid (declutter, Oct 24). Columns: ☐ 44 · Date 64 · Job (as
// wide as the longest name, min 240) · PO 92 · Work (the only column that truncates) ·
// Labor 108 · Fee 96 · Status 160 (only under Show = All lines). Below 1280px PO and Work
// drop out and job names may wrap. Sticky header; click Date, Job, Labor or Fee to sort.
// The header checkbox selects every line in the current filter; shift-click selects a
// range. Day subtotal rows appear when sorted by date, and a total row follows the filter.
// Keys: J / K move between lines, X selects the focused line.
const HEAD_BG = "#E9E2D4", HEAD_RULE = "#34403F";
const COLS = [
  { key: "check" },
  { key: "date", label: "Date", sort: "date" },
  { key: "job", label: "Job", sort: "job" },
  { key: "po", label: "PO", wide: true },
  { key: "work", label: "Work", wide: true },
  { key: "labor", label: "Labor", sort: "labor", right: true },
  { key: "fee", label: "Fee", sort: "fee", right: true },
  { key: "status", label: "Status", status: true },
];

let measureCtx = null;
function jobColumnWidth(rows) {
  if (typeof document === "undefined") return 240;
  measureCtx = measureCtx || document.createElement("canvas").getContext("2d");
  if (!measureCtx) return 340;
  measureCtx.font = "600 14px Geist, system-ui, sans-serif";
  const widest = rows.reduce((w, r) => Math.max(w, measureCtx.measureText(String(r.job_name_raw || r.job_name_norm || r.line_description || "")).width), 0);
  return Math.min(480, Math.max(240, Math.ceil(widest) + 30));
}

export default function LineList({ rows, sort, onSortChange, showStatus, selectedIds, onToggle, onSelectIds, onEdit, onDelete, onMarkBilled, onOpenDetails, reportAttached, onClearFilters, editRequestId, onEditRequestHandled, onReady, onSendForReview, jobs, onLinkJob, totalLabel = "All lines" }) {
  const [expandedId, setExpandedId] = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [focusId, setFocusId] = useState(null);
  const lastChecked = useRef(null);
  // The drawer's Edit button opens a line straight in the editor.
  useEffect(() => {
    if (!editRequestId) return;
    setExpandedId(editRequestId);
    setEditingId(editRequestId);
    onEditRequestHandled?.();
  }, [editRequestId, onEditRequestHandled]);
  const toggleExpand = (row) => { setEditingId(null); setExpandedId((prev) => (prev === row.id ? null : row.id)); };
  const startEdit = (row) => { setExpandedId(row.id); setEditingId(row.id); };
  const collapse = () => { setExpandedId(null); setEditingId(null); };

  const grouped = useMemo(() => groupLines(rows, sort), [rows, sort]);
  const total = useMemo(() => lineSums(rows), [rows]);
  const order = useMemo(() => grouped.flatMap((g) => g.rows.map((r) => r.id)), [grouped]);
  const jobW = useMemo(() => jobColumnWidth(rows), [rows]);
  const status = showStatus ? " 160px" : "";
  const vars = {
    "--inv-cols-w": `44px 64px ${jobW}px 92px minmax(0,1fr) 108px 96px${status}`,
    "--inv-cols-n": `44px 64px minmax(200px,1fr) 108px 96px${status}`,
  };
  const all = selectionState(order, selectedIds);

  const check = (id, shift) => {
    if (shift && lastChecked.current && order.includes(lastChecked.current)) {
      const a = order.indexOf(lastChecked.current), b = order.indexOf(id);
      onSelectIds(order.slice(Math.min(a, b), Math.max(a, b) + 1), true);
    } else {
      onToggle(id);
    }
    lastChecked.current = id;
  };

  useEffect(() => {
    const handler = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.target?.closest?.("input, textarea, select, [contenteditable='true'], [role='dialog'], [role='menu']")) return;
      const key = e.key.toLowerCase();
      if (key !== "j" && key !== "k" && key !== "x") return;
      if (!order.length) return;
      e.preventDefault();
      if (key === "x") { if (focusId && order.includes(focusId)) onToggle(focusId); return; }
      const at = order.indexOf(focusId);
      const next = at === -1 ? 0 : Math.min(order.length - 1, Math.max(0, at + (key === "j" ? 1 : -1)));
      setFocusId(order[next]);
      document.querySelector(`[data-line-id="${order[next]}"]`)?.scrollIntoView?.({ block: "nearest" });
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [order, focusId, onToggle]);

  if (rows.length === 0) {
    return (
      <div style={{ padding: "80px 0", textAlign: "center" }}>
        <p className="text-[15px]" style={{ color: "#566063" }}>Nothing matches those filters.</p>
        <button onClick={onClearFilters} className="mt-3 min-h-10 rounded-lg px-4 text-[14px] font-semibold" style={{ border: "1px solid #9A9080", backgroundColor: "#FFFFFF", color: "#0B3F3B", cursor: "pointer" }}>
          Clear filters
        </button>
      </div>
    );
  }

  const lines = `${total.count} ${total.count === 1 ? "line" : "lines"}`;

  return (
    <div role="table" aria-label="Invoice lines" style={vars}>
      <div role="row" className={`hidden items-center ${GRID_CLASS}`} style={{ position: "sticky", top: 0, zIndex: 5, minHeight: "36px", backgroundColor: HEAD_BG, borderBottom: `2px solid ${HEAD_RULE}` }}>
        {COLS.filter((c) => !c.status || showStatus).map((c) => {
          if (c.key === "check") return <CheckBox key="check" state={all} label={all === "all" ? "Clear selection" : "Select every line in this filter"} onClick={() => onSelectIds(order, all !== "all")} />;
          const active = c.sort && sort.key === c.sort;
          const label = <span className="text-[11.5px] font-semibold uppercase tracking-[0.06em]" style={{ color: "#34403F" }}>{c.label}</span>;
          return (
            <span key={c.key} role="columnheader" aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined} className={`${c.wide ? WIDE_ONLY : ""} ${c.right ? "text-right" : ""}`} style={{ padding: "0 10px", whiteSpace: "nowrap" }}>
              {c.sort ? (
                <button type="button" onClick={() => onSortChange(c.sort)} className={`inline-flex items-center gap-1 ${c.right ? "flex-row-reverse" : ""}`} style={{ background: "none", border: "none", padding: 0, cursor: "pointer" }}>
                  {label}
                  <span aria-hidden="true" style={{ fontSize: "9px", color: "#34403F", visibility: active ? "visible" : "hidden" }}>{sort.dir === "asc" ? "▲" : "▼"}</span>
                </button>
              ) : label}
            </span>
          );
        })}
      </div>
      <div className="flex items-center md:hidden" style={{ minHeight: "44px", borderBottom: `2px solid ${HEAD_RULE}`, backgroundColor: HEAD_BG }}>
        <CheckBox state={all} label={all === "all" ? "Clear selection" : "Select every line in this filter"} onClick={() => onSelectIds(order, all !== "all")} />
        <span className="text-[14px] font-semibold" style={{ color: "#34403F" }}>Select all {lines}</span>
      </div>
      {grouped.map((group) => (
        <div key={group.date || "all"} role="rowgroup">
          {group.date && (
            <DayHeader
              date={group.date}
              lineCount={group.count}
              dayLabor={group.labor}
              dayFee={group.fee}
              showStatus={showStatus}
              selection={selectionState(group.rows.map((r) => r.id), selectedIds)}
              onSelectDay={() => onSelectIds(group.rows.map((r) => r.id), !group.rows.every((r) => selectedIds.has(r.id)))}
            />
          )}
          {group.rows.map((row) => (
            <LineRow
              key={row.id}
              row={row}
              selected={selectedIds.has(row.id)}
              focused={focusId === row.id}
              showStatus={showStatus}
              reportAttached={reportAttached.has(row.id)}
              onCheck={check}
              onEdit={onEdit}
              onDelete={onDelete}
              onMarkBilled={onMarkBilled}
              onOpenDetails={onOpenDetails}
              expanded={expandedId === row.id}
              editing={editingId === row.id}
              onToggleExpand={toggleExpand}
              onStartEdit={startEdit}
              onReady={onReady}
              onSendForReview={onSendForReview}
              onCollapse={collapse}
              jobs={jobs}
              onLinkJob={onLinkJob}
            />
          ))}
        </div>
      ))}
      <div role="row" className={`hidden items-center ${GRID_CLASS}`} style={{ minHeight: "40px", backgroundColor: HEAD_BG, borderTop: `2px solid ${HEAD_RULE}` }}>
        <span />
        <span className="whitespace-nowrap text-[14px] font-semibold" style={{ padding: "0 10px", color: "#101617", gridColumn: "span 2" }}>
          Total · {totalLabel} <span className="font-normal" style={{ color: "#566063" }}>· {lines}</span>
        </span>
        <span className={WIDE_ONLY} />
        <span className={WIDE_ONLY} />
        <span className="font-mono-num-bold text-right text-[14px]" style={{ padding: "0 10px", color: "#101617" }}>${formatMoney(total.labor)}</span>
        <span className="font-mono-num-bold text-right text-[14px] font-bold" style={{ padding: "0 10px", color: "#101617" }}>${formatMoney(total.fee)}</span>
        {showStatus && <span />}
      </div>
      <div className="flex items-center gap-2 md:hidden" style={{ minHeight: "44px", padding: "0 12px", backgroundColor: HEAD_BG, borderTop: `2px solid ${HEAD_RULE}` }}>
        <span className="text-[14px] font-semibold" style={{ color: "#101617" }}>Total · {lines}</span>
        <span style={{ flex: "1 1 0%" }} />
        <span className="font-mono-num-bold text-[14px] font-bold" style={{ color: "#101617" }}>${formatMoney(total.fee)}</span>
      </div>
    </div>
  );
}
