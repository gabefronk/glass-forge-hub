import { useMemo, useRef, useState, useEffect } from "react";
import { formatMoney, isFutureRow } from "@/lib/feeMath";
import { C, UNBILLED_GRID, statusTag, isZeroRow, noteTokens, formatDateGroup, ROW_SHADOW } from "@/lib/feeUI";
import CheckBox from "@/components/fees/CheckBox";
import { cn } from "@/lib/utils";

export default function NotYetBilled({ rows, selectedIds, onToggleRow, onToggleAll,
  hideZeros, onHideZerosChange, onEdit, onMarkAllBilled }) {

  const unbilled = useMemo(
    () => rows.filter((r) => !r.billed_to_bfs).sort((a, b) => a.job_date.localeCompare(b.job_date)),
    [rows]
  );

  const scheduled = useMemo(() => unbilled.filter(isFutureRow), [unbilled]);
  const current = useMemo(() => unbilled.filter((r) => !isFutureRow(r)), [unbilled]);

  const visibleCurrent = useMemo(
    () => hideZeros ? current.filter((r) => !isZeroRow(r)) : current,
    [current, hideZeros]
  );

  const dateGroups = useMemo(() => {
    const map = new Map();
    for (const r of visibleCurrent) {
      if (!map.has(r.job_date)) map.set(r.job_date, []);
      map.get(r.job_date).push(r);
    }
    return Array.from(map.entries()).sort(([a], [b]) => a.localeCompare(b));
  }, [visibleCurrent]);

  const visibleIds = useMemo(() => {
    const ids = [...scheduled, ...visibleCurrent].map((r) => r.id);
    return ids;
  }, [scheduled, visibleCurrent]);

  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const someSelected = visibleIds.some((id) => selectedIds.has(id));
  const indeterminate = someSelected && !allSelected;

  const totals = useMemo(() => {
    const labor = unbilled.reduce((s, r) => s + (Number(r.labor_amt) || 0), 0);
    const fee = unbilled.reduce((s, r) => s + (Number(r.fee_amt) || 0), 0);
    return { labor, fee, count: unbilled.length };
  }, [unbilled]);

  const scheduledTotals = useMemo(() => {
    const labor = scheduled.reduce((s, r) => s + (Number(r.labor_amt) || 0), 0);
    const fee = scheduled.reduce((s, r) => s + (Number(r.fee_amt) || 0), 0);
    return { labor, fee, count: scheduled.length };
  }, [scheduled]);

  const colBarRef = useRef(null);
  const [colBarH, setColBarH] = useState(0);
  useEffect(() => {
    if (colBarRef.current) setColBarH(colBarRef.current.offsetHeight);
  }, []);

  if (!unbilled.length) return null;

  const handleToggleAll = () => {
    if (allSelected) {
      visibleIds.forEach((id) => { if (selectedIds.has(id)) onToggleRow(id); });
    } else {
      onToggleAll(visibleIds);
    }
  };

  return (
    <section className="px-4 sm:px-8 pt-4">
      {/* Heading row */}
      <div className="flex flex-wrap items-center gap-3 mb-3">
        <h2 className="font-bold" style={{ fontSize: "17px", fontWeight: 700, color: C.accentDark, whiteSpace: "nowrap" }}>
          Not yet billed
        </h2>
        <span className="text-sm tabular-nums" style={{ color: C.text, opacity: 0.68, whiteSpace: "nowrap" }}>
          ${formatMoney(totals.fee)} · {totals.count} lines
        </span>
        <div className="ml-auto flex items-center gap-3">
          <label className="flex items-center gap-1.5 cursor-pointer whitespace-nowrap" style={{ fontSize: "13px", color: C.text, opacity: 0.72 }}>
            <input
              type="checkbox"
              checked={hideZeros}
              onChange={(e) => onHideZerosChange(e.target.checked)}
              className="w-3.5 h-3.5 cursor-pointer"
              style={{ accentColor: C.accent }}
            />
            Hide $0 lines
          </label>
          <button
            onClick={onMarkAllBilled}
            className="text-xs font-semibold uppercase tracking-wide whitespace-nowrap px-3 py-1.5 rounded-md transition-colors"
            style={{ backgroundColor: C.accentDark, color: "#eef2f0" }}
          >
            Mark all billed
          </button>
        </div>
      </div>

      {/* Card with internal scroll */}
      <div
        className="rounded-lg overflow-hidden"
        style={{ border: `1px solid ${C.border}`, backgroundColor: C.card, boxShadow: "0 1px 3px rgba(18,33,30,0.06)" }}
      >
        <div style={{ maxHeight: "460px", overflowY: "auto" }}>
          {/* Sticky column bar */}
          <div
            ref={colBarRef}
            className={cn(UNBILLED_GRID, "sticky top-0 z-10 px-4 py-2.5")}
            style={{ backgroundColor: C.headerBg, color: C.headerText, fontSize: "11px", fontWeight: 600, letterSpacing: "0.12em", textTransform: "uppercase" }}
          >
            <div><CheckBox checked={allSelected} indeterminate={indeterminate} onChange={handleToggleAll} /></div>
            <div>Line</div>
            <div className="text-right">Labor</div>
            <div className="text-right">Fee %</div>
            <div className="text-right">Fee</div>
            <div className="text-center">Status</div>
          </div>

          {/* Scheduled group */}
          {scheduled.length > 0 && (
            <div>
              <div
                className="px-4 py-2 flex items-center gap-2"
                style={{
                  background: "linear-gradient(to bottom, #edf1ef, #e6ebe8)",
                  borderTop: `1px solid #d8ddd9`,
                  borderBottom: `1px solid #d8ddd9`,
                  borderLeft: `3px solid ${C.amber}`,
                }}
              >
                <span className="font-bold uppercase tracking-wide whitespace-nowrap" style={{ fontSize: "11px", color: C.amber }}>
                  Scheduled — not yet billable
                </span>
                <span className="text-xs tabular-nums whitespace-nowrap" style={{ color: C.text, opacity: 0.68 }}>
                  {scheduledTotals.count} lines · ${formatMoney(scheduledTotals.labor)} labor · ${formatMoney(scheduledTotals.fee)} fee
                </span>
              </div>
              {scheduled.map((row) => (
                <UnbilledRow key={row.id} row={row} selected={selectedIds.has(row.id)} onToggle={() => onToggleRow(row.id)} onEdit={onEdit} />
              ))}
            </div>
          )}

          {/* Date groups */}
          {dateGroups.map(([date, groupRows]) => {
            const feeSub = groupRows.reduce((s, r) => s + (Number(r.fee_amt) || 0), 0);
            const noChargeCount = groupRows.filter(isZeroRow).length;
            return (
              <div key={date}>
                <div
                  className="sticky z-[5] px-4 py-1.5 flex items-center gap-2"
                  style={{
                    top: colBarH,
                    background: "linear-gradient(to bottom, #edf1ef, #e6ebe8)",
                    borderTop: `1px solid #d8ddd9`,
                    borderBottom: `1px solid #d8ddd9`,
                  }}
                >
                  <span className="font-semibold whitespace-nowrap" style={{ fontSize: "11px", color: C.accentDark }}>
                    {formatDateGroup(date)}
                  </span>
                  <span className="text-xs tabular-nums whitespace-nowrap" style={{ color: C.text, opacity: 0.68 }}>
                    {groupRows.length} lines · ${formatMoney(feeSub)} fee{noChargeCount > 0 ? ` · ${noChargeCount} no-charge` : ""}
                  </span>
                </div>
                {groupRows.map((row) => (
                  <UnbilledRow key={row.id} row={row} selected={selectedIds.has(row.id)} onToggle={() => onToggleRow(row.id)} onEdit={onEdit} />
                ))}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <div
          className="flex items-center justify-between px-4 py-3"
          style={{ borderTop: `1px solid ${C.border}`, backgroundColor: C.cardAlt }}
        >
          <span className="font-bold uppercase tracking-wide" style={{ fontSize: "11px", color: C.text, opacity: 0.68 }}>
            Unbilled Total
          </span>
          <span className="tabular-nums whitespace-nowrap" style={{ fontSize: "13px", color: C.text, opacity: 0.72 }}>
            ${formatMoney(totals.labor)} labor · 10% fee ·{" "}
            <span className="font-bold" style={{ fontSize: "18px", fontWeight: 700, color: C.accent }}>
              ${formatMoney(totals.fee)}
            </span>
          </span>
        </div>
      </div>
    </section>
  );
}

function UnbilledRow({ row, selected, onToggle, onEdit }) {
  const tag = statusTag(row);
  const zero = isZeroRow(row);
  const tokens = noteTokens(row.note_text);
  const isSplit = row.fee_type === "profit_split";

  return (
    <div
      className={cn(UNBILLED_GRID, "px-4 py-2 items-center cursor-pointer transition-colors hover:bg-black/[0.02]")}
      style={{
        borderTop: `1px solid ${C.rowBorder}`,
        boxShadow: ROW_SHADOW,
        borderLeft: `3px solid ${zero ? C.leftBarZero : C.accent}`,
      }}
      onClick={() => onToggle(row.id)}
    >
      {/* Checkbox */}
      <div onClick={(e) => e.stopPropagation()}>
        <CheckBox checked={selected} onChange={onToggle} />
      </div>

      {/* Line */}
      <div className="min-w-0" style={{ opacity: zero ? 0.68 : 1 }}>
        <div className="truncate" style={{ fontSize: "14px", color: C.text }}>
          {row.line_description || row.job_name_norm}
        </div>
        {tokens && (
          <div className="truncate" style={{ fontSize: "13px", color: C.text, opacity: 0.5 }}>
            {tokens}
          </div>
        )}
      </div>

      {/* Labor */}
      <div className="text-right tabular-nums" style={{ fontSize: "14px", color: zero ? C.mutedText : C.text, opacity: zero ? 0.5 : 1 }}>
        {zero ? "—" : `$${formatMoney(isSplit ? 0 : row.labor_amt)}`}
      </div>

      {/* Fee % */}
      <div className="text-right tabular-nums" style={{ fontSize: "14px", color: C.text, opacity: 0.68 }}>
        {isSplit ? `${Math.round((row.split_pct || 0.5) * 100)}%` : `${Math.round((row.fee_pct || 0) * 100)}%`}
      </div>

      {/* Fee */}
      <div className="text-right tabular-nums font-medium" style={{ fontSize: "14px", color: zero ? C.mutedText : C.accent, opacity: zero ? 0.5 : 1 }}>
        {zero ? "—" : `$${formatMoney(row.fee_amt)}`}
      </div>

      {/* Status */}
      <div className="flex items-center justify-center">
        <span
          className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full whitespace-nowrap"
          style={{ backgroundColor: tag.bg, color: tag.text }}
        >
          {tag.label}
        </span>
      </div>
    </div>
  );
}