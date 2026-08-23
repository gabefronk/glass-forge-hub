import { useMemo } from "react";
import { formatMoney, isFutureRow } from "@/lib/feeMath";
import { C, statusTag, isZeroRow, noteTokens, formatDateGroup } from "@/lib/feeUI";
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
    return [...scheduled, ...visibleCurrent].map((r) => r.id);
  }, [scheduled, visibleCurrent]);

  const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));
  const someSelected = visibleIds.some((id) => selectedIds.has(id));
  const indeterminate = someSelected && !allSelected;

  const totals = useMemo(() => {
    const labor = unbilled.reduce((s, r) => s + (Number(r.labor_amt) || 0), 0);
    const fee = unbilled.reduce((s, r) => s + (Number(r.fee_amt) || 0), 0);
    return { labor, fee, count: unbilled.length };
  }, [unbilled]);

  const selectedFee = useMemo(() => {
    return unbilled.filter((r) => selectedIds.has(r.id)).reduce((s, r) => s + (Number(r.fee_amt) || 0), 0);
  }, [unbilled, selectedIds]);

  if (!unbilled.length) return null;

  const handleToggleAll = () => {
    if (allSelected) {
      visibleIds.forEach((id) => { if (selectedIds.has(id)) onToggleRow(id); });
    } else {
      onToggleAll(visibleIds);
    }
  };

  return (
    <section className="pt-4">
      {/* Header */}
      <div className="flex items-center gap-2 mb-3 px-1">
        <h2 className="font-heading text-[15px] font-semibold" style={{ color: C.text }}>Not yet billed</h2>
        <span className="font-mono-num text-[12px]" style={{ color: C.textMuted }}>
          {totals.count} lines
        </span>
        <div className="ml-auto flex items-center gap-3">
          <label className="flex items-center gap-1.5 cursor-pointer whitespace-nowrap text-[12px]" style={{ color: C.textSecondary }}>
            <input
              type="checkbox"
              checked={hideZeros}
              onChange={(e) => onHideZerosChange(e.target.checked)}
              className="w-3.5 h-3.5 cursor-pointer"
              style={{ accentColor: C.accent }}
            />
            Hide $0
          </label>
        </div>
      </div>

      {/* Panel */}
      <div className="rounded-[16px] overflow-hidden" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
        <div style={{ maxHeight: "520px", overflowY: "auto" }} className="obsidian-scroll">
          {/* Column header */}
          <div
            className="sticky top-0 z-10 grid grid-cols-[22px_minmax(0,1fr)_70px_70px_70px] gap-2 px-4 py-2.5 items-center"
            style={{ backgroundColor: C.card, borderBottom: `1px solid ${C.border}` }}
          >
            <div><CheckBox checked={allSelected} indeterminate={indeterminate} onChange={handleToggleAll} /></div>
            <div className="mono-label-sm">Line</div>
            <div className="mono-label-sm text-right">Labor</div>
            <div className="mono-label-sm text-right">Fee</div>
            <div className="mono-label-sm text-center">Status</div>
          </div>

          {/* Scheduled group */}
          {scheduled.length > 0 && (
            <div>
              <div className="px-4 py-1.5 flex items-center gap-2" style={{ backgroundColor: "rgba(255,138,122,.06)", borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}`, borderLeft: `3px solid ${C.amber}` }}>
                <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] whitespace-nowrap" style={{ color: C.amber }}>
                  Scheduled
                </span>
                <span className="font-mono-num text-[11px] whitespace-nowrap" style={{ color: C.textMuted }}>
                  {scheduled.length} lines
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
            return (
              <div key={date}>
                <div className="sticky z-[5] px-4 py-2 flex items-center gap-2" style={{ top: "35px", backgroundColor: C.cardAlt, borderTop: `1px solid ${C.border}`, borderBottom: `1px solid ${C.border}` }}>
                  <span className="font-mono text-[13px] font-semibold uppercase tracking-[0.14em] whitespace-nowrap" style={{ color: C.textSecondary }}>
                    {formatDateGroup(date)}
                  </span>
                  <span className="font-mono-num text-[12px] whitespace-nowrap" style={{ color: C.textMuted }}>
                    {groupRows.length} lines · ${formatMoney(feeSub)}
                  </span>
                </div>
                {groupRows.map((row) => (
                  <UnbilledRow key={row.id} row={row} selected={selectedIds.has(row.id)} onToggle={() => onToggleRow(row.id)} onEdit={onEdit} />
                ))}
              </div>
            );
          })}
        </div>

        {/* Footer — desktop */}
        <div
          className="hidden min-[700px]:flex items-center justify-between px-4 py-3 gap-3"
          style={{ borderTop: `1px solid ${C.border}`, backgroundColor: C.cardAlt }}
        >
          <div className="min-w-0">
            <div className="mono-label-sm">Unbilled total</div>
            <div className="font-mono-num text-[12px] mt-0.5" style={{ color: C.textSecondary }}>
              ${formatMoney(totals.labor)} labor · 10% fee
            </div>
          </div>
          <div className="flex items-center gap-3 shrink-0">
            <span className="font-mono-num text-[12px] whitespace-nowrap" style={{ color: selectedIds.size > 0 ? C.accent : C.textMuted }}>
              {selectedIds.size} selected · ${formatMoney(selectedFee)}
            </span>
            <button
              onClick={onMarkAllBilled}
              className="font-mono text-[10px] font-semibold uppercase tracking-[0.13em] px-3.5 py-2 rounded-full whitespace-nowrap transition-colors"
              style={
                selectedIds.size > 0
                  ? { backgroundColor: C.accent, color: C.accentDark }
                  : { backgroundColor: "rgba(255,255,255,.08)", color: C.textMuted }
              }
            >
              Mark billed
            </button>
          </div>
        </div>
      </div>

      {/* Mobile sticky bar */}
      <div
        className="min-[700px]:hidden fixed bottom-[78px] left-0 right-0 z-20 flex items-center justify-between px-[18px] py-3 gap-3"
        style={{ borderTop: `1px solid ${C.border}`, backgroundColor: C.cardAlt }}
      >
        <div className="min-w-0">
          <div className="mono-label-sm">Unbilled total</div>
          <div className="font-mono-num text-[11px] mt-0.5" style={{ color: C.textSecondary }}>
            ${formatMoney(totals.labor)} labor · 10% fee
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="font-mono-num text-[11px] whitespace-nowrap" style={{ color: selectedIds.size > 0 ? C.accent : C.textMuted }}>
            {selectedIds.size} sel · ${formatMoney(selectedFee)}
          </span>
          <button
            onClick={onMarkAllBilled}
            className="font-mono text-[10px] font-semibold uppercase tracking-[0.13em] px-3.5 py-2 rounded-full whitespace-nowrap transition-colors"
            style={
              selectedIds.size > 0
                ? { backgroundColor: C.accent, color: C.accentDark }
                : { backgroundColor: "rgba(255,255,255,.08)", color: C.textMuted }
            }
          >
            Mark billed
          </button>
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
      className="grid grid-cols-[22px_minmax(0,1fr)_70px_70px_70px] gap-2 px-4 items-center cursor-pointer transition-colors"
      style={{
        minHeight: "56px",
        borderTop: `1px solid ${C.rowBorder}`,
        backgroundColor: selected ? C.accent06 : "transparent",
      }}
      onClick={() => onToggle(row.id)}
    >
      {/* Checkbox */}
      <div onClick={(e) => e.stopPropagation()}>
        <CheckBox checked={selected} onChange={onToggle} />
      </div>

      {/* Line */}
      <div className="min-w-0" style={{ opacity: zero ? 0.5 : 1 }}>
        <div className="truncate text-[13px] font-medium" style={{ color: C.text }}>
          {row.line_description || row.job_name_norm}
        </div>
        {tokens && (
          <div className="truncate text-[11px]" style={{ color: C.textMuted }}>
            {tokens}
          </div>
        )}
      </div>

      {/* Labor */}
      <div className="text-right font-mono-num text-[13px]" style={{ color: zero ? C.textMuted : C.text }}>
        {zero ? "—" : `$${formatMoney(isSplit ? 0 : row.labor_amt)}`}
      </div>

      {/* Fee */}
      <div className="text-right font-mono-num-bold text-[13px]" style={{ color: zero ? C.textMuted : C.accent }}>
        {zero ? "—" : `$${formatMoney(row.fee_amt)}`}
      </div>

      {/* Status */}
      <div className="flex items-center justify-center">
        <span
          className="font-mono text-[9px] font-semibold uppercase tracking-[0.13em] px-2 py-0.5 rounded-full whitespace-nowrap"
          style={{ backgroundColor: tag.bg, color: tag.text }}
        >
          {tag.label}
        </span>
      </div>
    </div>
  );
}