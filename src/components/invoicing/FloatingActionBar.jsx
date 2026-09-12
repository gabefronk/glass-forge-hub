import { useState } from "react";
import { X } from "lucide-react";
import { formatMoney } from "@/lib/feeMath";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";

export default function FloatingActionBar({ selectedCount, selectedFee, onClear, onSetFeePct, onDelete, onExport, onMarkBilled }) {
  const [feeMenuOpen, setFeeMenuOpen] = useState(false);

  return (
    <div
      className="fixed left-1/2 -translate-x-1/2 bottom-[calc(72px+env(safe-area-inset-bottom))] lg:bottom-4 flex flex-wrap items-center gap-2 rounded-xl"
      style={{
        zIndex: 55,
        backgroundColor: "var(--gf-graphite-900)",
        border: "1px solid rgba(255,255,255,.08)",
        padding: "0 6px 0 16px",
        height: "46px",
        boxShadow: "var(--shadow-float)",
        maxWidth: "calc(100vw - 32px)",
      }}
    >
      <span className="text-[13px] font-semibold" style={{ color: "var(--gf-brass-300)", whiteSpace: "nowrap" }}>
        {selectedCount} selected · ${formatMoney(selectedFee)}
      </span>

      <span style={{ width: "1px", height: "20px", backgroundColor: "rgba(255,255,255,.12)" }} />

      <Popover open={feeMenuOpen} onOpenChange={setFeeMenuOpen}>
        <PopoverTrigger asChild>
          <button type="button" className="min-h-9 rounded-lg px-3 text-[12px] font-medium whitespace-nowrap" style={{ border: "1px solid rgba(255,255,255,.12)", backgroundColor: "rgba(255,255,255,.06)", color: "var(--gf-sidebar-text-on)", cursor: "pointer" }}>
            Fee %
          </button>
        </PopoverTrigger>
        <PopoverContent side="top" align="start" collisionPadding={16} className="z-[70] w-24 overflow-y-auto overscroll-contain p-1" style={{ maxHeight: "min(240px, var(--radix-popover-content-available-height))", backgroundColor: "#FFFFFF", border: "1px solid var(--gf-border)", borderRadius: "8px", padding: "4px", minWidth: "80px" }}>
          {[0, 8, 10, 12, 15].map((pct) => (
            <button key={pct} onClick={() => { onSetFeePct(pct); setFeeMenuOpen(false); }} className="block w-full rounded-md px-2.5 py-1.5 text-[13px] font-medium text-left" style={{ border: "none", backgroundColor: "transparent", color: "var(--gf-ink)", cursor: "pointer" }}>
              {pct}%
            </button>
          ))}
        </PopoverContent>
      </Popover>

      <button onClick={onDelete} className="min-h-9 rounded-lg px-3 text-[12px] font-medium whitespace-nowrap" style={{ border: "1px solid rgba(255,255,255,.12)", backgroundColor: "rgba(255,255,255,.06)", color: "#E8807E", cursor: "pointer" }}>
        Delete
      </button>

      <button onClick={onExport} className="min-h-9 rounded-lg px-3 text-[12px] font-medium whitespace-nowrap" style={{ border: "1px solid rgba(255,255,255,.12)", backgroundColor: "rgba(255,255,255,.06)", color: "var(--gf-sidebar-text-on)", cursor: "pointer" }}>
        Export CSV
      </button>

      <button onClick={onMarkBilled} className="min-h-9 rounded-lg px-3.5 text-[12px] font-semibold whitespace-nowrap flex items-center gap-1.5" style={{ border: "none", backgroundColor: "var(--gf-brass-400)", color: "var(--gf-on-brass)", cursor: "pointer" }}>
        Mark billed
        <span className="max-[699px]:hidden text-[9px] rounded px-1" style={{ backgroundColor: "rgba(0,0,0,.15)" }}>⌘↵</span>
      </button>

      <button onClick={onClear} aria-label="Clear selection" className="flex items-center justify-center" style={{ width: "34px", height: "34px", borderRadius: "8px", border: "none", backgroundColor: "transparent", color: "var(--gf-sidebar-muted)", cursor: "pointer", flexShrink: 0 }}>
        <X style={{ width: "16px", height: "16px" }} strokeWidth={1.8} strokeLinecap="round" />
      </button>
    </div>
  );
}