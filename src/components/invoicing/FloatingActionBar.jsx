import { useState, useRef, useEffect } from "react";
import { formatMoney } from "@/lib/feeMath";

export default function FloatingActionBar({ selectedCount, selectedFee, onClear, onSetFeePct, onDelete, onExport, onMarkBilled }) {
  const [feeMenuOpen, setFeeMenuOpen] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!feeMenuOpen) return;
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setFeeMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [feeMenuOpen]);

  return (
    <div
      style={{
        position: "fixed",
        bottom: "28px",
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 55,
        backgroundColor: "#FFFFFF",
        border: "1px solid #DDE3EC",
        borderRadius: "99px",
        padding: "8px 8px 8px 16px",
        display: "flex",
        alignItems: "center",
        gap: "8px",
        boxShadow: "0 1px 2px rgba(19,26,38,.05), 0 10px 24px -18px rgba(19,26,38,.22)",
        maxWidth: "calc(100vw - 36px)",
      }}
      className="max-[699px]:gap-1 max-[699px]:px-2"
    >
      <span
        className="max-[699px]:hidden"
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

      <div ref={menuRef} style={{ position: "relative" }}>
        <button
          onClick={() => setFeeMenuOpen(!feeMenuOpen)}
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
        {feeMenuOpen && (
          <div
            style={{
              position: "absolute",
              bottom: "100%",
              right: "0",
              marginBottom: "4px",
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
          </div>
        )}
      </div>

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
        className="max-[699px]:hidden"
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