import { useState } from "react";
import { X, MoreHorizontal } from "lucide-react";
import { formatMoney } from "@/lib/feeMath";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";

// Selection actions. The main action sits on the right (Mark billed, or Covered for
// $0 confirmations); Delete and Export live under More so Delete is never next to it.
const ghost = { border: "1px solid rgba(255,255,255,.16)", backgroundColor: "rgba(255,255,255,.07)", color: "var(--gf-sidebar-text-on)", cursor: "pointer" };

export default function FloatingActionBar({ selectedCount, selectedFee, onClear, onSetFeePct, onDelete, onExport, onMarkBilled, onCovered, coveredCount = 0, disabled = false, eligibleCount = selectedCount, laborCount = selectedCount, monthLabel = '' }) {
  const [feeMenuOpen, setFeeMenuOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  return (
    <div
      className="fixed left-1/2 -translate-x-1/2 bottom-[calc(72px+env(safe-area-inset-bottom))] lg:bottom-4 flex flex-wrap items-center gap-2 rounded-xl"
      style={{ zIndex: 55, backgroundColor: "var(--gf-graphite-900)", border: "1px solid rgba(255,255,255,.1)", padding: "6px 6px 6px 16px", minHeight: "46px", boxShadow: "var(--shadow-float)", maxWidth: "calc(100vw - 32px)" }}
    >
      <span className="text-[13px] font-semibold" style={{ color: "var(--gf-brass-300)", whiteSpace: "nowrap" }}>
        {selectedCount} selected · ${formatMoney(selectedFee)}{eligibleCount !== selectedCount ? ` · ${eligibleCount} ready` : ""}
      </span>

      <span style={{ width: "1px", height: "20px", backgroundColor: "rgba(255,255,255,.14)" }} />

      <Popover open={feeMenuOpen} onOpenChange={setFeeMenuOpen}>
        <PopoverTrigger asChild>
          <button type="button" disabled={disabled || !laborCount} className="min-h-9 rounded-lg px-3 text-[12px] font-medium whitespace-nowrap" style={ghost}>Fee %</button>
        </PopoverTrigger>
        <PopoverContent side="top" align="start" collisionPadding={16} className="z-[70] w-24 overflow-y-auto overscroll-contain p-1" style={{ maxHeight: "min(240px, var(--radix-popover-content-available-height))", backgroundColor: "#FFFFFF", border: "1px solid var(--gf-border)", borderRadius: "8px", padding: "4px", minWidth: "80px" }}>
          {laborCount !== selectedCount && <p className="px-2 py-1 text-[11px] text-slate-600">Applies to {laborCount} lines. {selectedCount - laborCount} profit-split lines skipped.</p>}
          {[0, 8, 10, 12, 15].map((pct) => (
            <button key={pct} disabled={disabled} onClick={() => { onSetFeePct(pct); setFeeMenuOpen(false); }} className="block w-full rounded-md px-2.5 py-1.5 text-[13px] font-medium text-left" style={{ border: "none", backgroundColor: "transparent", color: "var(--gf-ink)", cursor: "pointer" }}>
              {pct}%
            </button>
          ))}
        </PopoverContent>
      </Popover>

      <Popover open={moreOpen} onOpenChange={setMoreOpen}>
        <PopoverTrigger asChild>
          <button type="button" disabled={disabled} aria-label="More actions" className="min-h-9 rounded-lg px-2.5 text-[12px] font-medium inline-flex items-center gap-1" style={ghost}>
            <MoreHorizontal className="h-4 w-4" /> More
          </button>
        </PopoverTrigger>
        <PopoverContent side="top" align="start" collisionPadding={16} className="z-[70] w-44 p-1" style={{ backgroundColor: "#FFFFFF", border: "1px solid var(--gf-border)", borderRadius: "8px", padding: "4px" }}>
          <button type="button" onClick={() => { onExport(); setMoreOpen(false); }} className="block w-full rounded-md px-2.5 py-2 text-left text-[13px] font-medium hover:bg-[#F3EEE4]" style={{ color: "var(--gf-ink)" }}>Export CSV</button>
          <button type="button" disabled={disabled} onClick={() => { setMoreOpen(false); onDelete(); }} className="block w-full rounded-md px-2.5 py-2 text-left text-[13px] font-semibold hover:bg-[#FDE8E7]" style={{ color: "#A43432" }}>{disabled ? "Deleting…" : `Delete ${selectedCount} ${selectedCount === 1 ? "line" : "lines"}`}</button>
        </PopoverContent>
      </Popover>

      <span className="hidden sm:block" style={{ flex: "1 1 auto" }} />

      {coveredCount > 0 && (
        <button disabled={disabled} onClick={onCovered} title="Confirm these $0 lines were covered by the original install. They leave $0 to confirm and bill nothing." className="min-h-9 rounded-lg px-3.5 text-[12px] font-semibold whitespace-nowrap" style={{ border: "1px solid var(--gf-brass-300)", backgroundColor: "transparent", color: "var(--gf-brass-300)", cursor: "pointer" }}>
          Covered, no charge ({coveredCount})
        </button>
      )}

      <button disabled={disabled || !eligibleCount} title={monthLabel ? `Record the QuickBooks invoice for ready lines · ${monthLabel}` : undefined} onClick={onMarkBilled} className="min-h-9 rounded-lg px-3.5 text-[12px] font-semibold whitespace-nowrap flex items-center gap-1.5 disabled:opacity-50" style={{ border: "none", backgroundColor: "var(--gf-brass-400)", color: "var(--gf-on-brass)", cursor: "pointer" }}>
        Mark {eligibleCount} billed
        <span className="max-[699px]:hidden text-[9px] rounded px-1" style={{ backgroundColor: "rgba(0,0,0,.15)" }}>⌘↵</span>
      </button>

      <button onClick={onClear} aria-label="Clear selection" className="flex items-center justify-center" style={{ width: "34px", height: "34px", borderRadius: "8px", border: "none", backgroundColor: "transparent", color: "var(--gf-sidebar-muted)", cursor: "pointer", flexShrink: 0 }}>
        <X style={{ width: "16px", height: "16px" }} strokeWidth={1.8} strokeLinecap="round" />
      </button>
    </div>
  );
}
