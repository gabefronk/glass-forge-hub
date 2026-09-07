import { useState } from "react";
import { formatMoney } from "@/lib/feeMath";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";

export default function FloatingActionBar({ selectedCount, selectedFee, onClear, onSetFeePct, onDelete, onExport, onMarkBilled }) {
  const [feeMenuOpen, setFeeMenuOpen] = useState(false);

  return (
    <div
      style={{
        position: "fixed",
        zIndex: 55,
        backgroundColor: "#FFFFFF",
        border: "1px solid #DDE3EC",
        borderRadius: "16px",
        padding: "12px",
        display: "flex",
        flexWrap: "wrap",
        alignItems: "center",
        gap: "8px",
        boxShadow: "0 1px 2px rgba(19,26,38,.05), 0 10px 24px -18px rgba(19,26,38,.22)",
      }}
      className="bottom-[calc(88px+env(safe-area-inset-bottom))] left-4 right-4 mx-auto max-w-[820px] lg:bottom-4 lg:left-[232px]"
    >
      <span
        className="w-full sm:w-auto"
        style={{
          fontFamily: "'Archivo',sans-serif",
          fontSize: "12.5px",
          fontWeight: 600,
          color: "#1E4A85",
          whiteSpace: "nowrap",
        }}
      >
        {selectedCount} selected · ${formatMoney(selectedFee)}
      </span>

      <button
        onClick={onClear}
        style={{
          padding: "6px 10px",
          borderRadius: "99px",
          border: "none",
          backgroundColor: "transparent",
          color: "#616D81",
          fontFamily: "'Archivo',sans-serif",
          fontSize: "12px",
          fontWeight: 500,
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        Clear
      </button>

      <Popover open={feeMenuOpen} onOpenChange={setFeeMenuOpen}>
        <PopoverTrigger asChild>
        <button
          type="button"
          style={{
            padding: "6px 12px",
            borderRadius: "10px",
            border: "1px solid #DDE3EC",
            backgroundColor: "#FFFFFF",
            color: "#131A26",
            fontFamily: "'Archivo',sans-serif",
            fontSize: "12px",
            fontWeight: 500,
            cursor: "pointer",
            whiteSpace: "nowrap",
          }}
        >
          Fee %
        </button>
        </PopoverTrigger>
          <PopoverContent
            side="top"
            align="start"
            collisionPadding={16}
            className="z-[70] w-24 overflow-y-auto overscroll-contain p-1"
            style={{
              maxHeight: "min(240px, var(--radix-popover-content-available-height))",
              backgroundColor: "#FFFFFF",
              border: "1px solid #DDE3EC",
              borderRadius: "10px",
              padding: "4px",
              minWidth: "80px",
              boxShadow: "0 1px 2px rgba(19,26,38,.05), 0 10px 24px -18px rgba(19,26,38,.22)",
            }}
          >
            {[0, 8, 10, 12, 15].map((pct) => (
              <button
                key={pct}
                onClick={() => { onSetFeePct(pct); setFeeMenuOpen(false); }}
                style={{
                  display: "block",
                  width: "100%",
                  padding: "6px 10px",
                  borderRadius: "6px",
                  border: "none",
                  backgroundColor: "transparent",
                  color: "#131A26",
                  fontFamily: "'Archivo',sans-serif",
                  fontSize: "12px",
                  fontWeight: 500,
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                {pct}%
              </button>
            ))}
          </PopoverContent>
      </Popover>

      <button
        onClick={onDelete}
        style={{
          padding: "6px 12px",
          borderRadius: "10px",
          border: "1px solid #EFD2CA",
          backgroundColor: "#FBEDEA",
          color: "#8A4038",
          fontFamily: "'Archivo',sans-serif",
          fontSize: "12px",
          fontWeight: 500,
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        Delete
      </button>

      <button
        onClick={onExport}
        style={{
          padding: "6px 12px",
          borderRadius: "10px",
          border: "1px solid #DDE3EC",
          backgroundColor: "#FFFFFF",
          color: "#131A26",
          fontFamily: "'Archivo',sans-serif",
          fontSize: "12px",
          fontWeight: 500,
          cursor: "pointer",
          whiteSpace: "nowrap",
        }}
      >
        Export CSV
      </button>

      <button
        onClick={onMarkBilled}
        style={{
          padding: "6px 14px",
          borderRadius: "10px",
          border: "1px solid #1E4A85",
          backgroundColor: "#2A5EA8",
          color: "#FFFFFF",
          fontFamily: "'Archivo',sans-serif",
          fontSize: "12px",
          fontWeight: 600,
          cursor: "pointer",
          display: "flex",
          alignItems: "center",
          gap: "6px",
          whiteSpace: "nowrap",
        }}
      >
        Mark billed
        <span
          className="max-[699px]:hidden"
          style={{
            fontFamily: "'Archivo',sans-serif",
            fontSize: "9px",
            padding: "1px 3px",
            borderRadius: "3px",
            backgroundColor: "rgba(255,255,255,.20)",
          }}
        >
          ⌘↵
        </span>
      </button>
    </div>
  );
}
