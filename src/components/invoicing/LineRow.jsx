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
        color: danger ? "#8A4038" : "#535E72",
        fontFamily: "'Archivo',sans-serif",
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
    backgroundColor: "#FFFFFF",
    border: "1px solid #DDE3EC",
    borderRadius: "9px",
    padding: "8px 10px",
    color: "#131A26",
    fontFamily: "'Archivo',sans-serif",
    fontSize: "13px",
    outline: "none",
    width: "100%",
  };

  return (
    <div
      style={{
        backgroundColor: "#F6F8FC",
        border: "1px solid #C3D4EE",
        borderRadius: "14px",
        padding: "16px",
        margin: "4px 0",
      }}
    >
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px", marginBottom: "12px" }} className="max-[699px]:grid-cols-1">
        <div>
          <label style={{ fontFamily: "'Archivo',sans-serif", fontSize: "9px", letterSpacing: ".01em", color: "#616D81", display: "block", marginBottom: "4px" }}>Description</label>
          <input value={description} onChange={(e) => setDescription(e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label style={{ fontFamily: "'Archivo',sans-serif", fontSize: "9px", letterSpacing: ".01em", color: "#616D81", display: "block", marginBottom: "4px" }}>Detail</label>
          <input value={detail} onChange={(e) => setDetail(e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label style={{ fontFamily: "'Archivo',sans-serif", fontSize: "9px", letterSpacing: ".01em", color: "#616D81", display: "block", marginBottom: "4px" }}>Labor $</label>
          <input type="number" value={labor} onChange={(e) => setLabor(e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label style={{ fontFamily: "'Archivo',sans-serif", fontSize: "9px", letterSpacing: ".01em", color: "#616D81", display: "block", marginBottom: "4px" }}>Fee %</label>
          <input type="number" value={feePct} onChange={(e) => setFeePct(e.target.value)} style={inputStyle} />
        </div>
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px" }}>
        <div>
          <span style={{ fontFamily: "'Archivo',sans-serif", fontSize: "10px", letterSpacing: ".01em", color: "#616D81" }}>Fee </span>
          <span style={{ fontFamily: "'Archivo',sans-serif", fontSize: "17px", fontWeight: 700, color: "#1E4A85" }}>${formatMoney(liveFee)}</span>
        </div>
        <div style={{ display: "flex", gap: "8px" }}>
          <button onClick={() => onDelete(row.id)} style={{ padding: "7px 14px", borderRadius: "10px", border: "1px solid #EFD2CA", backgroundColor: "transparent", color: "#8A4038", fontFamily: "'Archivo',sans-serif", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}>Delete line</button>
          <button onClick={onCancel} style={{ padding: "7px 14px", borderRadius: "10px", border: "1px solid #DDE3EC", backgroundColor: "#FFFFFF", color: "#535E72", fontFamily: "'Archivo',sans-serif", fontSize: "12px", fontWeight: 500, cursor: "pointer" }}>Cancel</button>
          <button onClick={() => onSave(row.id, { line_description: description, note_text: detail, labor_amt: Number(labor) || 0, fee_pct: (Number(feePct) || 0) / 100, manually_adjusted: true })} style={{ padding: "7px 16px", borderRadius: "10px", border: "1px solid #1E4A85", backgroundColor: "#2A5EA8", color: "#FFFFFF", fontFamily: "'Archivo',sans-serif", fontSize: "12px", fontWeight: 600, cursor: "pointer" }}>Save</button>
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
  const bg = selected ? "#E7EEFA" : blocked ? "#FBEDEA" : "transparent";
  const insetBar = selected ? "inset 3px 0 0 #2A5EA8" : blocked ? "inset 3px 0 0 #8A4038" : "none";

  const subline = reportAttached
    ? "Report attached · ready to bill"
    : [row.line_description, row.po_number && `PO ${row.po_number}`, crewName(row.calendar_creator), noteTokens(row.note_text)].filter(Boolean).join(" · ") || "—";

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
        borderBottom: "1px solid #E9EDF4",
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
          border: selected ? "none" : "1.5px solid #CBD4E1",
          backgroundColor: selected ? "#2A5EA8" : "transparent",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        {selected && <Check style={{ width: "12px", height: "12px", color: "#FFFFFF" }} strokeWidth={3} />}
      </button>

      {/* Title + subline + chip */}
      <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: "6px", minWidth: 0 }}>
          <span
            style={{
              fontFamily: "'Archivo',sans-serif",
              fontSize: "15px",
              fontWeight: 600,
              color: "#131A26",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              textDecoration: isBilled ? "line-through" : "none",
              opacity: textOpacity,
              minWidth: 0,
            }}
          >
            {row.job_name_raw || row.job_name_norm || row.line_description}
          </span>
          {isCustomFee && (
            <span
              style={{
                fontFamily: "'Archivo',sans-serif",
                fontSize: "10px",
                fontWeight: 600,
                padding: "2px 6px",
                borderRadius: "4px",
                backgroundColor: "#E7EEFA",
                border: "1px solid #C3D4EE",
                color: "#1E4A85",
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
            fontFamily: "'Archivo',sans-serif",
            fontSize: "12.5px",
            color: reportAttached ? "#1E4A85" : "#616D81",
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
          fontFamily: "'Archivo',sans-serif",
          fontSize: "13.5px",
          fontWeight: 500,
          color: "#535E72",
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
          fontFamily: "'Archivo',sans-serif",
          fontSize: isBig ? "17px" : "13.5px",
          fontWeight: isBig ? 700 : 600,
          color: "#1E4A85",
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
              fontFamily: "'Archivo',sans-serif",
              fontSize: "10px",
              fontWeight: 600,
              letterSpacing: ".01em",
              padding: "5px 10px",
              borderRadius: "99px",
              border: "1px solid #EFD2CA",
              cursor: "pointer",
              backgroundColor: "#FBEDEA",
              color: "#8A4038",
              whiteSpace: "nowrap",
            }}
          >
            Add report
          </button>
        )}
        {!blocked && isFuture && (
          <span
            style={{
              fontFamily: "'Archivo',sans-serif",
              fontSize: "10px",
              fontWeight: 600,
              letterSpacing: ".01em",
              padding: "4px 8px",
              borderRadius: "99px",
              backgroundColor: "#F6F8FC",
              border: "1px solid #DDE3EC",
              color: "#616D81",
              whiteSpace: "nowrap",
            }}
          >
            Scheduled
          </span>
        )}
        {!blocked && !isFuture && isBilled && (
          <span
            style={{
              fontFamily: "'Archivo',sans-serif",
              fontSize: "10px",
              fontWeight: 600,
              letterSpacing: ".01em",
              padding: "4px 8px",
              borderRadius: "99px",
              backgroundColor: "#E7EEFA",
              border: "1px solid #C3D4EE",
              color: "#1E4A85",
              whiteSpace: "nowrap",
            }}
          >
            Billed
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
            color: "#77839A",
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
              backgroundColor: "#FFFFFF",
              border: "1px solid #DDE3EC",
              borderRadius: "10px",
              padding: "4px",
              minWidth: "190px",
              boxShadow: "0 1px 2px rgba(19,26,38,.05), 0 10px 24px -18px rgba(19,26,38,.22)",
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