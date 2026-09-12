import { useState } from "react";
import { formatMoney } from "@/lib/feeMath";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";

export default function FloatingActionBar({ selectedCount, selectedFee, onClear, onSetFeePct, onDelete, onExport, onMarkBilled }) {
  const [feeMenuOpen, setFeeMenuOpen] = useState(false);

  return (
    <div
      className="bottom-[calc(72px+env(safe-area-inset-bottom))] left-4 right-4 mx-auto max-w-[820px] lg:bottom-4 lg:left-[248px] flex flex-wrap items-center gap-2 rounded-2xl"
      style={{
        position: "fixed", zIndex: 55, backgroundColor: "#1B2925", border: "1px solid #2A3A35",
        padding: "12px", boxShadow: "0 8px 24px -12px rgba(24,36,34,.30)",
      }}
    >
      <span className="w-full sm:w-auto text-[13px] font-semibold" style={{ color: "#E8EAE5", whiteSpace: "nowrap" }}>
        {selectedCount} selected · ${formatMoney(selectedFee)}
      </span>

      <button onClick={onClear} className="text-[12px] font-medium rounded-full px-2.5 py-1 whitespace-nowrap" style={{ border: "none", backgroundColor: "transparent", color: "#8A958F", cursor: "pointer" }}>
        Clear
      </button>

      <Popover open={feeMenuOpen} onOpenChange={setFeeMenuOpen}>
        <PopoverTrigger asChild>
          <button type="button" className="min-h-9 rounded-lg px-3 text-[12px] font-medium whitespace-nowrap" style={{ border: "1px solid #3A4A44", backgroundColor: "#2A3A35", color: "#E8EAE5", cursor: "pointer" }}>
            Fee %
          </button>
        </PopoverTrigger>
        <PopoverContent side="top" align="start" collisionPadding={16} className="z-[70] w-24 overflow-y-auto overscroll-contain p-1" style={{ maxHeight: "min(240px, var(--radix-popover-content-available-height))", backgroundColor: "#FFFFFF", border: "1px solid #DDE0DA", borderRadius: "8px", padding: "4px", minWidth: "80px" }}>
          {[0, 8, 10, 12, 15].map((pct) => (
            <button key={pct} onClick={() => { onSetFeePct(pct); setFeeMenuOpen(false); }} className="block w-full rounded-md px-2.5 py-1.5 text-[13px] font-medium text-left" style={{ border: "none", backgroundColor: "transparent", color: "#182422", cursor: "pointer" }}>
              {pct}%
            </button>
          ))}
        </PopoverContent>
      </Popover>

      <button onClick={onDelete} className="min-h-9 rounded-lg px-3 text-[12px] font-medium whitespace-nowrap" style={{ border: "1px solid #F0C9C5", backgroundColor: "#FCEDEC", color: "#A43432", cursor: "pointer" }}>
        Delete
      </button>

      <button onClick={onExport} className="min-h-9 rounded-lg px-3 text-[12px] font-medium whitespace-nowrap" style={{ border: "1px solid #3A4A44", backgroundColor: "#2A3A35", color: "#E8EAE5", cursor: "pointer" }}>
        Export CSV
      </button>

      <button onClick={onMarkBilled} className="min-h-9 rounded-lg px-3.5 text-[12px] font-semibold whitespace-nowrap flex items-center gap-1.5" style={{ border: "1px solid #104E44", backgroundColor: "#146556", color: "#FFFFFF", cursor: "pointer" }}>
        Mark billed
        <span className="max-[699px]:hidden text-[9px] rounded px-1" style={{ backgroundColor: "rgba(255,255,255,.20)" }}>⌘↵</span>
      </button>
    </div>
  );
}