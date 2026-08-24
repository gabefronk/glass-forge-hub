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
        backgroundColor: "#171B1A",
        border: "1px solid rgba(110,231,192,.30)",
        borderRadius: "99px",
        padding: "8px 8px 8px 16px",
        display: "flex",
        alignItems: "center",
        gap: "8px",
        boxShadow: "0 14px 30px -10px rgba(0,0,0,.9)",
        maxWidth: "calc(100vw - 36px)",
      }}
      className="max-[699px]:gap-1 max-[699px]:px-2"
    >
      <span
        className="max-[699px]:hidden"
        style={{
          fontFamily: "'IBM Plex Mono',monospace",
          fontSize: "12.5px",
          color: "#6EE7C0",
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
          color: "rgba(255,255,255,.5)",
          font: "500 12px 'Inter Tight',sans-serif",
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
            borderRadius: "99px",
            border: "1px solid rgba(255,255,255,.10)",
            backgroundColor: "transparent",
            color: "#fff",
            font: "500 12px 'Inter Tight',sans-serif",
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
              backgroundColor: "#171B1A",
              border: "1px solid rgba(255,255,255,.10)",
              borderRadius: "10px",
              padding: "4px",
              minWidth: "80px",
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
                  color: "#fff",
                  font: "500 12px 'IBM Plex Mono',monospace",
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
          borderRadius: "99px",
          border: "1px solid rgba(255,138,122,.30)",
          backgroundColor: "transparent",
          color: "#FF8A7A",
          font: "500 12px 'Inter Tight',sans-serif",
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
          borderRadius: "99px",
          border: "1px solid rgba(255,255,255,.10)",
          backgroundColor: "transparent",
          color: "rgba(255,255,255,.62)",
          font: "500 12px 'Inter Tight',sans-serif",
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
          borderRadius: "99px",
          border: "none",
          backgroundColor: "#6EE7C0",
          color: "#0A0C0C",
          font: "600 12px 'Inter Tight',sans-serif",
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
            fontFamily: "'IBM Plex Mono',monospace",
            fontSize: "9px",
            padding: "1px 3px",
            borderRadius: "3px",
            backgroundColor: "rgba(10,12,12,.20)",
          }}
        >
          ⌘↵
        </span>
      </button>
    </div>
  );
}