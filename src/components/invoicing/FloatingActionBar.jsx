import { ChevronDown } from "lucide-react";
import { formatMoney } from "@/lib/feeMath";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent } from "@/components/ui/dropdown-menu";

// Bulk bar (declutter, Oct 24), shown only while lines are selected: count, labor and fee,
// Clear, More ▾ (Set fee %, Export selected, Delete lines) and one primary action that
// follows the selection: Record invoice for ready lines, Mark covered for $0
// confirmations, Approve for lines that need a decision. On a mixed selection it acts only
// on the lines it applies to and says so ("Record invoice (12 of 14)").
const item = "flex min-h-9 cursor-pointer items-center text-[14px]";

export default function FloatingActionBar({ selectedCount, selectedLabor, selectedFee, primary, onClear, onSetFeePct, onDelete, onExport, laborCount = selectedCount, disabled = false }) {
  const label = primary.count < selectedCount ? `${primary.label} (${primary.count} of ${selectedCount})` : primary.label;
  return (
    <div
      className="fixed left-1/2 -translate-x-1/2 bottom-[calc(72px+env(safe-area-inset-bottom))] lg:bottom-6 lg:ml-[116px] flex items-center whitespace-nowrap rounded-[12px]"
      style={{ zIndex: 55, backgroundColor: "#0E2426", minHeight: "56px", padding: "0 10px 0 20px", gap: "16px", boxShadow: "0 12px 32px -8px rgba(21,24,26,.5)", maxWidth: "calc(100vw - 24px)" }}
    >
      <span className="text-[15px] font-bold" style={{ color: "#F2EEE8" }}>{selectedCount} selected</span>
      <span className="text-[14px] tabular-nums max-[699px]:hidden" style={{ color: "#AEB5B7" }}>
        ${formatMoney(selectedLabor)} labor · <strong style={{ color: "#E0C994", fontWeight: 700 }}>${formatMoney(selectedFee)} fee</strong>
      </span>
      <span className="text-[14px] font-bold tabular-nums min-[700px]:hidden" style={{ color: "#E0C994" }}>${formatMoney(selectedFee)}</span>
      <button type="button" onClick={onClear} className="text-[14px] underline max-[699px]:hidden" style={{ color: "#F2EEE8", background: "none", border: "none", cursor: "pointer" }}>Clear</button>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button type="button" disabled={disabled} className="inline-flex items-center gap-1 text-[14px] font-semibold max-[699px]:hidden" style={{ height: "40px", borderRadius: "9px", border: "1px solid rgba(242,238,232,.35)", backgroundColor: "transparent", color: "#F2EEE8", padding: "0 10px 0 14px", cursor: "pointer" }}>
            More <ChevronDown style={{ width: "16px", height: "16px" }} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent side="top" align="end" className="z-[70] min-w-[220px] p-1">
          <DropdownMenuSub>
            <DropdownMenuSubTrigger className={item} disabled={!laborCount}>Set fee %{laborCount < selectedCount ? ` (${laborCount} lines)` : ""}</DropdownMenuSubTrigger>
            <DropdownMenuSubContent className="z-[71] p-1">
              {[0, 8, 10, 12, 15].map((pct) => <DropdownMenuItem key={pct} className={item} onSelect={() => onSetFeePct(pct)}>{pct === 0 ? "0% (no charge)" : `${pct}%`}</DropdownMenuItem>)}
            </DropdownMenuSubContent>
          </DropdownMenuSub>
          <DropdownMenuItem className={item} onSelect={onExport}>Export selected (CSV)</DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem className={item} disabled={disabled} style={{ color: "#A43432", fontWeight: 600 }} onSelect={onDelete}>{disabled ? "Deleting…" : `Delete ${selectedCount} ${selectedCount === 1 ? "line" : "lines"}`}</DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <button
        type="button"
        disabled={disabled || !primary.count}
        onClick={primary.onClick}
        title={primary.title}
        className="text-[14px] font-bold disabled:opacity-50"
        style={{ height: "40px", borderRadius: "9px", border: "none", backgroundColor: "#B8955A", color: "#1D160A", padding: "0 16px", cursor: "pointer" }}
      >
        {label}
      </button>
    </div>
  );
}
