import { useState, useEffect, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Check, MoreHorizontal, ExternalLink, Trash2, Pencil } from "lucide-react";
import { computeFeeAmt, formatMoney } from "@/lib/feeMath";
import { crewName, noteTokens } from "@/lib/feeUI";

function MenuItem({ icon: Icon, label, onClick, danger }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: "8px", width: "100%",
        padding: "8px 10px", borderRadius: "6px", border: "none",
        backgroundColor: "transparent", color: danger ? "#A43432" : "#53615B",
        fontFamily: "'Archivo',sans-serif", fontSize: "13px", fontWeight: 500,
        cursor: "pointer", textAlign: "left", whiteSpace: "nowrap",
      }}
    >
      {Icon && <Icon style={{ width: "14px", height: "14px" }} />}
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
    backgroundColor: "#FFFFFF", border: "1px solid #DDE0DA", borderRadius: "8px",
    padding: "8px 10px", color: "#182422", fontFamily: "'Archivo',sans-serif",
    fontSize: "14px", outline: "none", width: "100%",
  };

  return (
    <div className="rounded-xl p-4 my-1" style={{ backgroundColor: "#F0F1ED", border: "1px solid #C7E4D2" }}>
      <div className="mb-3 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="text-[12px] font-medium block mb-1" style={{ color: "#53615B" }}>Description</label>
          <input value={description} onChange={(e) => setDescription(e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label className="text-[12px] font-medium block mb-1" style={{ color: "#53615B" }}>Detail</label>
          <input value={detail} onChange={(e) => setDetail(e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label className="text-[12px] font-medium block mb-1" style={{ color: "#53615B" }}>Labor $</label>
          <input type="number" value={labor} onChange={(e) => setLabor(e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label className="text-[12px] font-medium block mb-1" style={{ color: "#53615B" }}>Fee %</label>
          <input type="number" value={feePct} onChange={(e) => setFeePct(e.target.value)} style={inputStyle} />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className="text-[12px]" style={{ color: "#53615B" }}>Fee </span>
          <span className="font-mono-num-bold text-[18px]" style={{ color: "#166447" }}>${formatMoney(liveFee)}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => onDelete(row.id)} className="min-h-10 rounded-lg px-3 text-[13px] font-semibold" style={{ border: "1px solid #F0C9C5", backgroundColor: "transparent", color: "#A43432" }}>Delete line</button>
          <button onClick={onCancel} className="min-h-10 rounded-lg px-3 text-[13px] font-medium" style={{ border: "1px solid #DDE0DA", backgroundColor: "#FFFFFF", color: "#53615B" }}>Cancel</button>
          <button onClick={() => onSave(row.id, { line_description: description, note_text: detail, labor_amt: Number(labor) || 0, fee_pct: (Number(feePct) || 0) / 100, manually_adjusted: true })} className="min-h-10 rounded-lg px-4 text-[13px] font-semibold" style={{ border: "1px solid #104E44", backgroundColor: "#146556", color: "#FFFFFF" }}>Save</button>
        </div>
      </div>
    </div>
  );
}

export default function LineRow({ row, selected, blocked, reportAttached, onToggle, onShiftClick, onEdit, onDelete, onAddReport, onMarkBilled, onOpenJob, onOpenDetails, isFuture, isBilled, isZero }) {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const menuRef = useRef(null);

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e) => { if (menuRef.current && !menuRef.current.contains(e.target)) setMenuOpen(false); };
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
  const isCustomFee = row.fee_type !== "profit_split" && Number(row.fee_pct) !== 0.1;
  const opacity = isBilled ? 0.55 : 1;
  const insetBar = selected ? "inset 3px 0 0 #146556" : blocked ? "inset 3px 0 0 #F0DBA8" : "none";

  // Compact subline: PO · crew · note preview (2 lines max, no repeated job name)
  const notePreview = noteTokens(row.note_text);
  const sublineParts = [row.po_number && `PO ${row.po_number}`, crewName(row.calendar_creator)].filter(Boolean);
  const subline = reportAttached
    ? "Report attachment noted"
    : [sublineParts.join(" · "), notePreview].filter(Boolean).join(" — ") || "—";

  const handleCheckboxClick = (e) => {
    e.stopPropagation();
    if (e.shiftKey) onShiftClick(row.id);
    else onToggle(row.id);
  };

  const handleRowClick = (e) => {
    // Don't open details if clicking checkbox or menu
    if (e.target.closest("[data-no-open]")) return;
    onOpenDetails(row);
  };

  // Status pill
  let statusPill = null;
  if (blocked) {
    const isMatch = row.needs_review && !row.manually_adjusted;
    statusPill = (
      <button
        data-no-open
        onClick={(e) => { e.stopPropagation(); if (isMatch) setEditing(true); else onAddReport(row.id); }}
        className="text-[11px] font-semibold rounded-full px-2.5 py-1 whitespace-nowrap"
        style={{ border: "1px solid #F0DBA8", backgroundColor: "#FFF3DF", color: "#89511A" }}
      >
        {isMatch ? "Review pricing" : "Review report"}
      </button>
    );
  } else if (isFuture) {
    statusPill = <span className="text-[11px] font-semibold rounded-full px-2.5 py-1 whitespace-nowrap" style={{ backgroundColor: "#EBF2FC", border: "1px solid #C7D8EF", color: "#335E91" }}>Scheduled</span>;
  } else if (isBilled) {
    statusPill = <span className="text-[11px] font-semibold rounded-full px-2.5 py-1 whitespace-nowrap" style={{ backgroundColor: "#EAF5EE", border: "1px solid #C7E4D2", color: "#166447" }}>Billed</span>;
  } else if (fee > 0) {
    statusPill = <span className="text-[11px] font-semibold rounded-full px-2.5 py-1 whitespace-nowrap" style={{ backgroundColor: "#EAF5EE", border: "1px solid #C7E4D2", color: "#166447" }}>Ready</span>;
  }

  return (
    <div
      onClick={handleRowClick}
      className={`grid min-w-0 grid-cols-[40px_minmax(0,1fr)_36px] items-center gap-x-2 xl:grid-cols-[40px_minmax(0,1fr)_90px_90px_120px_36px] xl:gap-x-3 ${selected ? "bg-[#EAF5EE]" : "hover:bg-[#F8F9F6] focus-within:bg-[#F8F9F6]"}`}
      style={{
        padding: "10px 12px", minHeight: "56px", borderRadius: "10px",
        borderBottom: "1px solid #ECEEEA", boxShadow: insetBar,
        cursor: "pointer", opacity, transition: "background-color .15s",
      }}
    >
      {/* Checkbox — separate from row click */}
      <button
        data-no-open
        onClick={handleCheckboxClick}
        aria-label={`Select ${row.job_name_raw || row.job_name_norm || "invoice line"}`}
        aria-pressed={selected}
        className="col-start-1 row-start-1 flex items-center justify-center"
        style={{ width: "40px", height: "40px", borderRadius: "8px", border: "none", backgroundColor: "transparent", cursor: "pointer", flexShrink: 0 }}
      >
        <span aria-hidden="true" style={{ width: "24px", height: "24px", borderRadius: "6px", border: selected ? "none" : "1.5px solid #C9CCC4", backgroundColor: selected ? "#146556" : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
          {selected && <Check style={{ width: "14px", height: "14px", color: "#FFFFFF" }} strokeWidth={3} />}
        </span>
      </button>

      {/* Title + subline */}
      <div className="col-start-2 row-start-1" style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: "2px" }}>
        <div className="flex flex-wrap items-center gap-1.5 min-w-0">
          <button
            data-no-open
            onClick={(e) => { e.stopPropagation(); onOpenDetails(row); }}
            className="text-[14px] font-semibold line-clamp-2 text-left"
            style={{ color: "#182422", textDecoration: isBilled ? "line-through" : "none", opacity: isZero && !isBilled ? 0.6 : 1, minWidth: 0, background: "none", border: "none", padding: 0, cursor: "pointer", font: "inherit" }}
          >
            {row.job_name_raw || row.job_name_norm || row.line_description}
          </button>
          {isCustomFee && (
            <span className="text-[10px] font-semibold rounded px-1.5 py-0.5 whitespace-nowrap" style={{ backgroundColor: "#E6F0EC", border: "1px solid #C7E4D2", color: "#104E44" }}>
              {Math.round((row.fee_pct || 0) * 100)}%
            </span>
          )}
        </div>
        <span className="text-[12px] line-clamp-2" style={{ color: reportAttached ? "#166447" : "#53615B", opacity: isZero && !isBilled ? 0.6 : 1 }}>
          {subline}
        </span>
      </div>

      {/* Labor — desktop only */}
      <span className="hidden xl:block xl:col-start-3 xl:row-start-1 xl:text-right font-mono-num text-[13px]" style={{ color: "#53615B", whiteSpace: "nowrap" }}>
        ${formatMoney(row.labor_amt)}
      </span>

      {/* Fee — desktop only */}
      <span className="hidden xl:block xl:col-start-4 xl:row-start-1 xl:text-right font-mono-num-bold text-[14px]" style={{ color: "#166447", whiteSpace: "nowrap" }}>
        ${formatMoney(fee)}
      </span>

      {/* Status */}
      <div className="col-start-2 row-start-2 flex items-center gap-2 xl:col-start-5 xl:row-start-1 xl:justify-end">
        {/* Mobile labor/fee inline */}
        <span className="xl:hidden font-mono-num text-[12px]" style={{ color: "#53615B" }}>${formatMoney(row.labor_amt)}</span>
        <span className="xl:hidden font-mono-num-bold text-[13px]" style={{ color: "#166447" }}>${formatMoney(fee)}</span>
        {statusPill}
      </div>

      {/* Menu */}
      <div data-no-open className="col-start-3 row-start-1 self-start xl:col-start-6 xl:self-center" ref={menuRef} style={{ position: "relative", display: "flex", justifyContent: "flex-end" }}>
        <button
          data-no-open
          onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
          aria-label="Invoice line actions"
          aria-expanded={menuOpen}
          style={{ width: "36px", height: "36px", borderRadius: "6px", border: "none", backgroundColor: "transparent", color: "#8A958F", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
        >
          <MoreHorizontal style={{ width: "16px", height: "16px" }} />
        </button>
        {menuOpen && (
          <div style={{ position: "absolute", right: 0, top: "100%", zIndex: 30, backgroundColor: "#FFFFFF", border: "1px solid #DDE0DA", borderRadius: "10px", padding: "4px", minWidth: "200px", boxShadow: "0 1px 2px rgba(24,36,34,.04), 0 8px 20px -12px rgba(24,36,34,.16)" }}>
            <MenuItem icon={ExternalLink} label="Open details" onClick={() => { onOpenDetails(row); setMenuOpen(false); }} />
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