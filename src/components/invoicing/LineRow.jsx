import { useState, useEffect, useRef, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Check, MoreHorizontal, ExternalLink, Trash2, Pencil } from "lucide-react";
import { computeFeeAmt, formatMoney } from "@/lib/feeMath";
import { crewName, noteTokens } from "@/lib/feeUI";
import { isMatchBlocked } from "@/lib/invoicingFilters";

const TILES = [
  { bg: "var(--gf-tile-teal)", ink: "var(--gf-tile-teal-ink)" },
  { bg: "var(--gf-tile-slate)", ink: "var(--gf-tile-slate-ink)" },
  { bg: "var(--gf-tile-sage)", ink: "var(--gf-tile-sage-ink)" },
  { bg: "var(--gf-tile-sand)", ink: "var(--gf-tile-sand-ink)" },
  { bg: "var(--gf-tile-stone)", ink: "var(--gf-tile-stone-ink)" },
];

function builderFromName(name) {
  if (!name) return "";
  const dashIdx = name.indexOf("-");
  if (dashIdx > 0) return name.slice(0, dashIdx).trim();
  return name.trim();
}

function builderInitials(name) {
  if (!name) return "?";
  const parts = name.trim().split(/[\s\-]+/).filter(Boolean);
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function builderTile(name) {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = ((hash << 5) - hash + name.charCodeAt(i)) | 0;
  return TILES[Math.abs(hash) % TILES.length];
}

function MenuItem({ icon: Icon, label, onClick, danger }) {
  return (
    <button
      onClick={onClick}
      style={{
        display: "flex", alignItems: "center", gap: "8px", width: "100%",
        padding: "8px 10px", borderRadius: "6px", border: "none",
        backgroundColor: "transparent", color: danger ? "#A43432" : "#53615B",
        fontFamily: "var(--font-body)", fontSize: "13px", fontWeight: 500,
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
    backgroundColor: "var(--gf-card)", border: "1px solid var(--gf-border)", borderRadius: "var(--r-control)",
    padding: "8px 10px", color: "var(--gf-ink)", fontFamily: "var(--font-body)",
    fontSize: "14px", outline: "none", width: "100%",
  };

  return (
    <div className="rounded-xl p-4 my-1" style={{ backgroundColor: "var(--gf-field)", border: "1px solid var(--gf-border)" }}>
      <div className="mb-3 grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
        <div>
          <label className="text-[12px] font-medium block mb-1" style={{ color: "var(--gf-ink-2)" }}>Description</label>
          <input value={description} onChange={(e) => setDescription(e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label className="text-[12px] font-medium block mb-1" style={{ color: "var(--gf-ink-2)" }}>Detail</label>
          <input value={detail} onChange={(e) => setDetail(e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label className="text-[12px] font-medium block mb-1" style={{ color: "var(--gf-ink-2)" }}>Labor $</label>
          <input type="number" value={labor} onChange={(e) => setLabor(e.target.value)} style={inputStyle} />
        </div>
        <div>
          <label className="text-[12px] font-medium block mb-1" style={{ color: "var(--gf-ink-2)" }}>Fee %</label>
          <input type="number" value={feePct} onChange={(e) => setFeePct(e.target.value)} style={inputStyle} />
        </div>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <span className="text-[12px]" style={{ color: "var(--gf-ink-2)" }}>Fee </span>
          <span className="font-mono-num-bold text-[18px]" style={{ color: "var(--gf-teal-600)" }}>${formatMoney(liveFee)}</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <button onClick={() => onDelete(row.id)} className="min-h-10 rounded-lg px-3 text-[13px] font-semibold" style={{ border: "1px solid var(--gf-error-border, #F0C9C5)", backgroundColor: "transparent", color: "#A43432" }}>Delete line</button>
          <button onClick={onCancel} className="min-h-10 rounded-lg px-3 text-[13px] font-medium" style={{ border: "1px solid var(--gf-border)", backgroundColor: "var(--gf-card)", color: "var(--gf-ink-2)" }}>Cancel</button>
          <button onClick={() => onSave(row.id, { line_description: description, note_text: detail, labor_amt: Number(labor) || 0, fee_pct: (Number(feePct) || 0) / 100, manually_adjusted: true })} className="min-h-10 rounded-lg px-4 text-[13px] font-semibold" style={{ border: "1px solid var(--gf-teal-600)", backgroundColor: "var(--gf-teal-600)", color: "#FFFFFF" }}>Save</button>
        </div>
      </div>
    </div>
  );
}

function StatusDot({ label, dot, text, onClick, clickable }) {
  const Tag = clickable ? "button" : "span";
  return (
    <Tag
      onClick={onClick}
      className="inline-flex items-center gap-1.5 whitespace-nowrap"
      style={{
        fontSize: "12.5px",
        fontWeight: 500,
        color: text,
        background: "none",
        border: "none",
        cursor: clickable ? "pointer" : "default",
        padding: 0,
        textAlign: "left",
      }}
    >
      <span style={{ position: "relative", width: "7px", height: "7px", flexShrink: 0 }}>
        <span style={{ position: "absolute", inset: "-3px", borderRadius: "99px", backgroundColor: dot, opacity: 0.2 }} />
        <span style={{ position: "absolute", inset: 0, borderRadius: "99px", backgroundColor: dot }} />
      </span>
      {label}
    </Tag>
  );
}

export default function LineRow({ row, selected, blocked, reportAttached, onToggle, onShiftClick, onEdit, onDelete, onAddReport, onMarkBilled, onOpenJob, onOpenDetails, isFuture, isBilled, isZero, editRequested, onEditRequestHandled }) {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [editing, setEditing] = useState(false);
  const menuRef = useRef(null);

  // The details drawer's Edit button asks the row to open its inline editor.
  useEffect(() => {
    if (!editRequested) return;
    setEditing(true);
    onEditRequestHandled?.();
  }, [editRequested, onEditRequestHandled]);

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
  const builderName = builderFromName(row.job_name_raw || row.job_name_norm || "");
  const tile = builderTile(builderName || row.job_name_raw || row.job_name_norm || "?");
  const initials = builderInitials(builderName || row.job_name_raw || row.job_name_norm || "?");

  // Compact subline: PO · crew · note preview
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
    if (e.target.closest("[data-no-open]")) return;
    onOpenDetails(row);
  };

  // Status info
  let statusInfo = null;
  if (blocked) {
    const isMatch = isMatchBlocked(row);
    if (isMatch) {
      statusInfo = { label: "Review pricing", dot: "var(--gf-amber-500)", text: "var(--gf-amber-700)", onClick: (e) => { e.stopPropagation(); setEditing(true); }, clickable: true };
    } else {
      statusInfo = { label: "Needs report", dot: "var(--gf-stone-300)", text: "var(--gf-ink-2)", onClick: (e) => { e.stopPropagation(); onAddReport(row.id); }, clickable: true };
    }
  } else if (isFuture) {
    statusInfo = { label: "Scheduled", dot: "var(--gf-slate-300)", text: "var(--gf-slate-700)" };
  } else if (isBilled) {
    statusInfo = { label: "Billed", dot: "var(--gf-ink-3)", text: "var(--gf-ink-2)" };
  } else if (fee > 0) {
    statusInfo = { label: "Ready", dot: "var(--gf-teal-600)", text: "var(--gf-teal-800)" };
  }

  const rowStyle = {
    margin: "4px 10px",
    border: "1px solid var(--gf-hairline)",
    borderRadius: "var(--r-row)",
    backgroundColor: selected ? "var(--gf-teal-050)" : "var(--gf-card)",
    boxShadow: selected ? `inset 2px 0 0 var(--gf-teal-600), var(--shadow-row)` : "var(--shadow-row)",
    cursor: "pointer",
    transition: "background-color .15s, box-shadow .15s",
  };

  const hoverBg = (e) => { if (!selected) { e.currentTarget.style.backgroundColor = "var(--gf-hover)"; e.currentTarget.style.boxShadow = "var(--shadow-row-hover)"; } };
  const leaveBg = (e) => { if (!selected) { e.currentTarget.style.backgroundColor = "var(--gf-card)"; e.currentTarget.style.boxShadow = "var(--shadow-row)"; } };

  return (
    <>
      {/* Desktop row */}
      <div
        onClick={handleRowClick}
        onMouseEnter={hoverBg}
        onMouseLeave={leaveBg}
        className="hidden sm:flex items-center"
        style={{ ...rowStyle, height: "52px", padding: "0 16px", gap: "14px", whiteSpace: "nowrap" }}
      >
        {/* Checkbox */}
        <button
          data-no-open
          onClick={handleCheckboxClick}
          aria-label={`Select ${row.job_name_raw || row.job_name_norm || "invoice line"}`}
          aria-pressed={selected}
          style={{ width: "28px", height: "28px", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "var(--r-check)", border: "none", backgroundColor: "transparent", cursor: "pointer", flexShrink: 0 }}
        >
          <span aria-hidden="true" style={{ width: "16px", height: "16px", borderRadius: "4.5px", border: selected ? "none" : `1.5px solid var(--gf-check)`, backgroundColor: selected ? "var(--gf-teal-600)" : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
            {selected && <Check style={{ width: "11px", height: "11px", color: "#FFFFFF" }} strokeWidth={3} />}
          </span>
        </button>

        {/* Builder monogram tile */}
        <div style={{ width: "30px", height: "30px", borderRadius: "8px", backgroundColor: tile.bg, color: tile.ink, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "11px", fontWeight: 600, flexShrink: 0, letterSpacing: "-0.01em" }}>
          {initials}
        </div>

        {/* Job name + meta */}
        <div className="flex items-baseline gap-2 min-w-0" style={{ flex: "1 1 auto" }}>
          <button
            data-no-open
            onClick={(e) => { e.stopPropagation(); onOpenDetails(row); }}
            className="text-[14px] font-medium truncate text-left"
            style={{ color: "var(--gf-ink)", textDecoration: isBilled ? "line-through" : "none", flexShrink: 0, flexBasis: "220px", minWidth: "180px", maxWidth: "280px", background: "none", border: "none", padding: 0, cursor: "pointer", font: "inherit" }}
          >
            {row.job_name_raw || row.job_name_norm || row.line_description}
          </button>
          {isCustomFee && (
            <span className="text-[10px] font-semibold rounded px-1.5 py-0.5 whitespace-nowrap" style={{ backgroundColor: "var(--gf-teal-050)", border: "1px solid var(--gf-teal-halo)", color: "var(--gf-teal-600)", flexShrink: 0 }}>
              {Math.round((row.fee_pct || 0) * 100)}%
            </span>
          )}
          <span className="text-[12.5px] truncate" style={{ color: reportAttached ? "var(--gf-teal-600)" : "var(--gf-ink-3)", flex: "1 1 0", minWidth: 0 }}>
            {subline}
          </span>
        </div>

        {/* Labor */}
        <span className="font-mono-num text-[13px] text-right" style={{ color: "var(--gf-ink-3)", whiteSpace: "nowrap", width: "80px", flexShrink: 0 }}>
          ${formatMoney(row.labor_amt)}
        </span>

        {/* Status */}
        <div style={{ width: "128px", flexShrink: 0, display: "flex", justifyContent: "flex-end" }}>
          {statusInfo && <StatusDot {...statusInfo} />}
        </div>

        {/* Fee */}
        <span className="font-mono-num-bold text-[14px] text-right" style={{ color: fee === 0 ? "var(--gf-ink-3)" : "var(--gf-ink)", whiteSpace: "nowrap", width: "100px", flexShrink: 0 }}>
          ${formatMoney(fee)}
        </span>

        {/* Menu */}
        <div data-no-open ref={menuRef} style={{ position: "relative", flexShrink: 0 }}>
          <button
            data-no-open
            onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
            aria-label="Invoice line actions"
            aria-expanded={menuOpen}
            style={{ width: "28px", height: "28px", borderRadius: "6px", border: "none", backgroundColor: "transparent", color: "var(--gf-ink-3)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
          >
            <MoreHorizontal style={{ width: "16px", height: "16px" }} />
          </button>
          {menuOpen && (
            <div style={{ position: "absolute", right: 0, top: "100%", zIndex: 30, backgroundColor: "var(--gf-card)", border: "1px solid var(--gf-border)", borderRadius: "10px", padding: "4px", minWidth: "200px", boxShadow: "var(--shadow-float)" }}>
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

      {/* Mobile row */}
      <div
        onClick={handleRowClick}
        onMouseEnter={hoverBg}
        onMouseLeave={leaveBg}
        className="sm:hidden"
        style={{ ...rowStyle, padding: "12px" }}
      >
        <div className="flex items-center gap-3">
          {/* Checkbox */}
          <button
            data-no-open
            onClick={handleCheckboxClick}
            aria-label={`Select ${row.job_name_raw || row.job_name_norm || "invoice line"}`}
            aria-pressed={selected}
            style={{ width: "36px", height: "36px", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "var(--r-check)", border: "none", backgroundColor: "transparent", cursor: "pointer", flexShrink: 0 }}
          >
            <span aria-hidden="true" style={{ width: "20px", height: "20px", borderRadius: "4.5px", border: selected ? "none" : `1.5px solid var(--gf-check)`, backgroundColor: selected ? "var(--gf-teal-600)" : "transparent", display: "flex", alignItems: "center", justifyContent: "center" }}>
              {selected && <Check style={{ width: "13px", height: "13px", color: "#FFFFFF" }} strokeWidth={3} />}
            </span>
          </button>

          {/* Builder monogram tile */}
          <div style={{ width: "34px", height: "34px", borderRadius: "8px", backgroundColor: tile.bg, color: tile.ink, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "12px", fontWeight: 600, flexShrink: 0, letterSpacing: "-0.01em" }}>
            {initials}
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            {/* Line 1: job name + fee */}
            <div className="flex items-center justify-between gap-2">
              <button
                data-no-open
                onClick={(e) => { e.stopPropagation(); onOpenDetails(row); }}
                className="text-[14px] font-medium truncate text-left"
                style={{ color: "var(--gf-ink)", textDecoration: isBilled ? "line-through" : "none", minWidth: 0, background: "none", border: "none", padding: 0, cursor: "pointer", font: "inherit" }}
              >
                {row.job_name_raw || row.job_name_norm || row.line_description}
              </button>
              <span className="font-mono-num-bold text-[14px]" style={{ color: fee === 0 ? "var(--gf-ink-3)" : "var(--gf-ink)", whiteSpace: "nowrap", flexShrink: 0 }}>
                ${formatMoney(fee)}
              </span>
            </div>
            {/* Line 2: labor · meta · status */}
            <div className="flex items-center justify-between gap-2 mt-1">
              <span className="text-[12px] truncate" style={{ color: "var(--gf-ink-3)", minWidth: 0 }}>
                <span className="font-mono-num">${formatMoney(row.labor_amt)}</span>
                {subline !== "—" && <span> · {subline}</span>}
              </span>
              {statusInfo && <StatusDot {...statusInfo} />}
            </div>
          </div>

          {/* Menu */}
          <div data-no-open ref={menuRef} style={{ position: "relative", flexShrink: 0 }}>
            <button
              data-no-open
              onClick={(e) => { e.stopPropagation(); setMenuOpen(!menuOpen); }}
              aria-label="Invoice line actions"
              aria-expanded={menuOpen}
              style={{ width: "36px", height: "36px", borderRadius: "6px", border: "none", backgroundColor: "transparent", color: "var(--gf-ink-3)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
            >
              <MoreHorizontal style={{ width: "18px", height: "18px" }} />
            </button>
            {menuOpen && (
              <div style={{ position: "absolute", right: 0, top: "100%", zIndex: 30, backgroundColor: "var(--gf-card)", border: "1px solid var(--gf-border)", borderRadius: "10px", padding: "4px", minWidth: "200px", boxShadow: "var(--shadow-float)" }}>
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
      </div>
    </>
  );
}