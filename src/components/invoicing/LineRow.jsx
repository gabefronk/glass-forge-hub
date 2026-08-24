import { useState, useEffect, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Check, MoreHorizontal, ExternalLink, Trash2, Pencil, X } from "lucide-react";
import { computeFeeAmt, formatMoney } from "@/lib/feeMath";
import { crewName, noteTokens } from "@/lib/feeUI";

function MenuItem({ icon: Icon, label, onClick, danger }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: "8px",
        width: "100%",
        padding: "8px 10px",
        borderRadius: "6px",
        border: "none",
        backgroundColor: "transparent",
        color: danger ? "#FF8A7A" : "rgba(255,255,255,.72)",
        fontFamily: "'Inter Tight',sans-serif",
        fontSize: "12.5px",
        fontWeight: 500,
        cursor: "pointer",
        textAlign: "left",
        whiteSpace: "nowrap",
      }}
    >
      {Icon && <Icon style={{ width: "13px", height: "13px" }} />}
      {label}
    </button>
  );
}

function InlineEditor({ row, onSave, onCancel, onDelete }) {
  const [description, setDescription] = useState(row.line_description || "");
  const [detail, setDetail] = useState(row.note_text || "");
  const [labor, setLabor] = useState(row.labor_amt || 0);
  const [feePct, setFeePct] = useState(Math.round((row.fee_pct || 0) * 100));

  const liveFee = useMemo(() => {
    const l = Number(labor) || 0;
    const p = (Number(feePct) || 0) / 100;
    return Math.round(l * p * 100) / 100;
  }, [labor, feePct]);

  const inputStyle = {
    backgroundColor: "rgba(255,255,255,.05)",
    border: "1px solid rgba(255,255,255,.10)",
    borderRadius: "8px",
    padding: "8px 10px",
    color: "#fff",
    fontFamily: "'Inter Tight',sans-serif",
    fontSize: "13px",
    outline: "none",
    width: "100%",
  };

  return (
    <div
      style={{
        backgroundColor: "rgba(255,255,255,.04)",
        border: "1px solid rgba(110,231,192,.30)",
        borderRadius: "10px",
        padding: "16px",
        margin: "4px 0",
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }} className="max-[699px]:grid-cols-1">
        <div>
          <label style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "9px", letterSpacing: ".12em", color: "rgba(255,255,255,.4)", display: "block", marginBottom: "4px" }}>DESCRIPTION</label>
          <input value={description} onChange={(e) => setDescription(e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "9px", letterSpacing: ".12em", color: "rgba(255,255,255,.4)", display: "block", marginBottom: "4px" }}>DETAIL</label>
          <input value={detail} onChange={(e) => setDetail(e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "9px", letterSpacing: ".12em", color: "rgba(255,255,255,.4)", display: "block", marginBottom: "4px" }}>LABOR $</label>
          <input type="number" value={labor} onChange={(e) => setLabor(e.target.value)} style={{ ...inputStyle, fontFamily: "'IBM Plex Mono',monospace" }} />
        </div>
        <div>
          <label style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "9px", letterSpacing: ".12em", color: "rgba(255,255,255,.4)", display: "block", marginBottom: "4px" }}>FEE %</label>
          <input type="number" value={feePct} onChange={(e) => setFeePct(e.target.value)} style={{ ...inputStyle, fontFamily: "'IBM Plex Mono',monospace" }} />
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
        <div>
          <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "10px", letterSpacing: ".12em", color: "rgba(255,255,255,.4)" }}>FEE </span>
          <span style={{ fontFamily: "'IBM Plex Mono',monospace", fontSize: "17px", fontWeight: 600, color: "#6EE7C0" }}>${formatMoney(liveFee)}</span>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button onClick={() => onDelete(row.id)} style={{ padding: "7px 14px", borderRadius: "99px", border: "1px solid rgba(255,138,122,.30)", backgroundColor: "transparent", color: "#FF8A7A", fontFamily: "'Inter Tight',sans-serif", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}>Delete line</button>
          <button onClick={onCancel} style={{ padding: "7px 14px", borderRadius: "99px", border: "1px solid rgba(255,255,255,.10)", backgroundColor: "transparent", color: "rgba(255,255,255,.62)", fontFamily: "'Inter Tight',sans-serif", fontSize: "12px", fontWeight: 500, cursor: "pointer" }}>Cancel</button>
          <button onClick={() => onSave(row.id, { line_description: description, note_text: detail, labor_amt: Number(labor) || 0, fee_pct: (Number(feePct) || 0) / 100, manually_adjusted: true })} style={{ padding: "7px 16px", borderRadius: "99px", border: "none", backgroundColor: "#6EE7C0", color: "#0A0C0C", fontFamily: "'Inter Tight',sans-serif", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}>Save</button>
        </div>
      </div>
    </div>
  );
}

export default function LineRow({ row, selected, blocked, reportAttached, onToggle, onShiftClick, onEdit, onDelete, onAddReport, onMarkBilled, onOpenJob, isFuture, isBilled, isZero }) {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e) => {
      if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  if (editing) {
    return (
      <InlineEditor
        row={row}
        onSave={(id, patch) => { onEdit(id, patch); setEditing(false); }}
        onCancel={() => setEditing(false)}
        onDelete={onDelete}
      />
    );
  }

  const fee = computeFeeAmt(row);
  const isBig = fee >= 300;
  const isCustomFee = row.fee_type !== "profit_split" && Number(row.fee_pct) !== 0.1;
  const opacity = isBilled ? 0.45 : 1;
  const textOpacity = isZero && !isBilled ? 0.48 : 1;
  const bg = selected ? "rgba(110,231,192,.07)" : blocked ? "rgba(255,138,122,.05)" : "transparent";
  const insetBar = selected ? "inset 3px 0 0 #6EE7C0" : blocked ? "inset 3px 0 0 #FF8A7A" : "none";

  const subline = reportAttached
    ? "Report attached · ready to bill"
    : [row.po_number && `PO ${row.po_number}`, crewName(row.calendar_creator), noteTokens(row.note_text)].filter(Boolean).join(" · ") || "—";

  const handleClick = (e) => {
    if (e.shiftKey) onShiftClick(row.id);
    else onToggle(row.id);
  };

  return (
    <div
      className="inv-line-grid"
      onClick={handleClick}
      style={{
        padding: "15px 12px",
        minHeight: "64px",
        borderRadius: "10px",
        borderBottom: "1px solid rgba(255,255,255,.05)",
        backgroundColor: bg,
        boxShadow: insetBar,
        cursor: "pointer",
        opacity,
        transition: "background-color .15s",
      }}
    >
      {/* Checkbox */}
      <button
        onClick={(e) => { e.stopPropagation(); handleClick(e); }}
        style={{
          width: "19px",
          height: "19px",
          borderRadius: "99px",
          border: selected ? "none" : "1.5px solid rgba(255,255,255,.20)",
          backgroundColor: selected ? "#6EE7C0" : "transparent",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        {selected && <Check style={{ width: "12px", height: "12px", color: "#0A0C0C" }} strokeWidth={3} />}
      </button>

      {/* Title + subline + chip */}
      <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px", minWidth: 0 }}>
          <span
            style={{
              fontFamily: "'Inter Tight',sans-serif",
              fontSize: "15px",
              fontWeight: 500,
              color: "#fff",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              textDecoration: isBilled ? "line-through" : "none",
              opacity: textOpacity,
              minWidth: 0,
            }}
          >
            {row.line_description || row.job_name_raw || row.job_name_norm}
          </span>
          {isCustomFee && (
            <span
              style={{
                fontFamily: "'IBM Plex Mono',monospace",
                fontSize: "10px",
                fontWeight: 600,
                padding: "2px 6px",
                borderRadius: "4px",
                backgroundColor: "rgba(110,231,192,.14)",
                color: "#6EE7C0",
                whiteSpace: "nowrap",
                flexShrink: 0,
              }}
            >
              {Math.round((row.fee_pct || 0) * 100)}%
            </span>
          )}
        </div>
        <span
          style={{
            fontFamily: "'Inter Tight',sans-serif",
            fontSize: "12.5px",
            color: reportAttached ? "#6EE7C0" : "rgba(255,255,255,.34)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            opacity: textOpacity,
          }}
        >
          {subline}
        </span>
      </div>

      {/* Labor */}
      <span
        className="max-[699px]:hidden"
        style={{
          textAlign: "right",
          fontFamily: "'IBM Plex Mono',monospace",
          fontSize: "13.5px",
          fontWeight: 500,
          color: "rgba(255,255,255,.5)",
          whiteSpace: "nowrap",
          opacity: textOpacity,
        }}
      >
        ${formatMoney(row.labor_amt)}
      </span>

      {/* Fee */}
      <span
        style={{
          textAlign: "right",
          fontFamily: "'IBM Plex Mono',monospace",
          fontSize: isBig ? "17px" : "13.5px",
          fontWeight: isBig ? 600 : 500,
          color: "#6EE7C0",
          whiteSpace: "nowrap",
          opacity: textOpacity,
        }}
      >
        ${formatMoney(fee)}
      </span>

      {/* Status */}
      <div className="max-[699px]:hidden" style={{ display: "flex", justifyContent: "flex-end" }}>
        {blocked && (
          <button
            onClick={(e) => { e.stopPropagation(); onAddReport(row.id); }}
            style={{
              fontFamily: "'IBM Plex Mono',monospace",
              fontSize: "10px",
              fontWeight: 600,
              letterSpacing: ".05em",
              padding: "5px 10px",
              borderRadius: "6px",
              border: "none",
              cursor: "pointer",
              backgroundColor: "#FF8A7A",
              color: "#0A0C0C",
              whiteSpace: "nowrap",
            }}
          >
            Add report
          </button>
        )}
        {!blocked && isFuture && (
          <span
            style={{
              fontFamily: "'IBM Plex Mono',monospace",
              fontSize: "10px",
              fontWeight: 600,
              letterSpacing: ".1em",
              padding: "4px 8px",
              borderRadius: "4px",
              backgroundColor: "rgba(255,255,255,.06)",
              color: "rgba(255,255,255,.5)",
              whiteSpace: "nowrap",
            }}
          >
            SCHEDULED
          </span>
        )}
        {!blocked && !isFuture && isBilled && (
          <span
            style={{
              fontFamily: "'IBM Plex Mono',monospace",
              fontSize: "10px",
              fontWeight: 600,
              letterSpacing: ".1em",
              padding: "4px 8px",
              borderRadius: "4px",
              backgroundColor: "rgba(110,231,192,.14)",
              color: "#6EE7C0",
              whiteSpace: "nowrap",
            }}
          >
            BILLED
          </span>
        )}
      </div>

      {/* Menu */}
      <div ref={menuRef} style={{ position: "relative", display: "flex", justifyContent: "flex-end" }}>
        <button
          onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
          style={{
            width: "28px",
            height: "28px",
            borderRadius: "6px",
            border: "none",
            backgroundColor: "transparent",
            color: "rgba(255,255,255,.34)",
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <MoreHorizontal style={{ width: "16px", height: "16px" }} />
        </button>
        {menuOpen && (
          <div
            style={{
              position: "absolute",
              right: 0,
              top: "100%",
              zIndex: 30,
              backgroundColor: "#171B1A",
              border: "1px solid rgba(255,255,255,.10)",
              borderRadius: "10px",
              padding: "4px",
              minWidth: "190px",
              boxShadow: "0 14px 26px -10px rgba(0,0,0,.9)",
            }}
          >
            <MenuItem icon={Pencil} label="Edit line" onClick={() => { setEditing(true); setMenuOpen(false); }} />
            {row.job_id && <MenuItem icon={ExternalLink} label="Open job ↗" onClick={() => { navigate(`/jobs/${row.job_id}`); setMenuOpen(false); }} />}
            {isBilled ? (
              <MenuItem label="Reopen line" onClick={() => { onMarkBilled(row.id, false); setMenuOpen(false); }} />
            ) : (
              <MenuItem label="Mark billed" onClick={() => { onMarkBilled(row.id, true); setMenuOpen(false); }} />
            )}
            <MenuItem label="Set fee to 0% (no charge)" onClick={() => { onEdit(row.id, { fee_pct: 0, manually_adjusted: true }); setMenuOpen(false); }} />
            <MenuItem icon={Trash2} label="Delete line" danger onClick={() => { onDelete(row.id); setMenuOpen(false); }} />
          </div>
        )}
      </div>
    </div>
  );
}