import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Check, MoreHorizontal, ExternalLink, Trash2, Pencil } from "lucide-react";
import { computeFeeAmt, computeLaborAmt, formatMoney } from "@/lib/feeMath";
import { crewName, noteTokens, UNBILLED_GRID, GRID_WIDE } from "@/lib/feeUI";
import { isMatchBlocked } from "@/lib/invoicingFilters";
import { cellPatch, shortDay } from "@/lib/invoiceGrid";
import LineInlineExpansion from "./LineInlineExpansion";

// One invoice line as a ruled grid row (M1b, Oct 24): Date · Job · PO · Crew · Work ·
// Labor · Fee % · Fee · Status · Invoice, warm rules and no card per line, so about ten
// lines fit where six did. Job names wrap instead of being cut off. Clicking the row
// opens LineInlineExpansion as before. Labor and Fee % edit in the cell through the
// page's handleEdit (the same save path as the line menu), only on lines that carry no
// review or report hold, are not billed and are not profit splits.

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

function StatusDot({ label, dot, text, onClick, clickable }) {
  const Tag = clickable ? "button" : "span";
  return (
    <Tag
      data-no-open={clickable ? true : undefined}
      onClick={onClick}
      className="inline-flex items-center gap-1.5 whitespace-nowrap"
      style={{ fontSize: "12px", fontWeight: 600, color: text, background: "none", border: "none", cursor: clickable ? "pointer" : "default", padding: 0, textAlign: "left", textDecoration: clickable ? "underline" : "none", textDecorationColor: "var(--gf-hairline)", textUnderlineOffset: "3px" }}
    >
      <span style={{ width: "7px", height: "7px", borderRadius: "99px", backgroundColor: dot, flexShrink: 0 }} />
      {label}
    </Tag>
  );
}

// A Labor or Fee % cell: the figure, or a small input while editing. Enter or leaving
// the field saves; Escape cancels; a value that is not a valid amount is ignored.
function EditCell({ field, current, display, editable, onSave, label, bold }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState("");
  const done = useRef(false);
  const figure = <span className={bold ? "font-mono-num-bold" : "font-mono-num"}>{display}</span>;
  if (!editable) return <span className="block text-right text-[13px]" style={{ color: "var(--gf-ink)" }}>{figure}</span>;
  const commit = () => {
    if (done.current) return;
    done.current = true;
    setEditing(false);
    const patch = cellPatch(field, text);
    if (!patch) return;
    const next = field === "labor" ? patch.labor_amt : patch.fee_pct;
    if (Math.abs(next - (Number(current) || 0)) > 0.00001) onSave(patch);
  };
  if (editing) {
    return (
      <input
        data-no-open
        autoFocus
        inputMode="decimal"
        aria-label={label}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onFocus={(e) => e.target.select()}
        onKeyDown={(e) => {
          if (e.key === "Enter") { e.preventDefault(); commit(); }
          if (e.key === "Escape") { e.preventDefault(); done.current = true; setEditing(false); }
        }}
        onBlur={commit}
        className="font-mono-num"
        style={{ width: "100%", height: "24px", textAlign: "right", fontSize: "12.5px", border: "1.5px solid var(--gf-teal-600)", borderRadius: "4px", padding: "0 4px", outline: "none", backgroundColor: "#FFFFFF", color: "var(--gf-ink)" }}
      />
    );
  }
  return (
    <button
      data-no-open
      title={`Edit ${label.toLowerCase()}`}
      aria-label={`Edit ${label.toLowerCase()}`}
      onClick={(e) => {
        e.stopPropagation();
        done.current = false;
        setText(field === "labor" ? String(Number(current) || 0) : String(Math.round((Number(current) || 0) * 10000) / 100));
        setEditing(true);
      }}
      className="block w-full text-right text-[13px] hover:border-[#9A9080] hover:bg-white"
      style={{ color: "var(--gf-ink)", border: "1px dashed transparent", borderRadius: "4px", padding: "1px 4px", background: "none", cursor: "text" }}
    >
      {figure}
    </button>
  );
}

export default function LineRow({ row, selected, focused, blocked, reportAttached, onToggle, onShiftClick, onEdit, onDelete, onAddReport, onMarkBilled, onOpenDetails, isFuture, isBilled, expanded, onToggleExpand, onReady, onSendForReview, onCollapse, jobs, onLinkJob, cellEditing = true, selectionEnabled = true }) {
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuUp, setMenuUp] = useState(false);
  const menuRef = useRef(null);
  const menuRefMobile = useRef(null);
  const rowRef = useRef(null);

  // J / K move the keyboard focus; keep the focused line on screen.
  useEffect(() => {
    if (focused && rowRef.current?.scrollIntoView) rowRef.current.scrollIntoView({ block: "nearest" });
  }, [focused]);

  // Flip the menu upward when the trigger sits near the bottom of the viewport,
  // otherwise the popover renders off-screen (clipped at the page bottom).
  const toggleMenu = (e) => {
    e.stopPropagation();
    if (!menuOpen) {
      const rect = e.currentTarget.getBoundingClientRect();
      setMenuUp(window.innerHeight - rect.bottom < 300);
    }
    setMenuOpen(!menuOpen);
  };

  useEffect(() => {
    if (!menuOpen) return;
    const handler = (e) => {
      const inDesktop = menuRef.current && menuRef.current.contains(e.target);
      const inMobile = menuRefMobile.current && menuRefMobile.current.contains(e.target);
      if (!inDesktop && !inMobile) setMenuOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [menuOpen]);

  const fee = computeFeeAmt(row);
  const labor = computeLaborAmt(row);
  const isProfitSplit = row.fee_type === "profit_split";
  const jobName = row.job_name_raw || row.job_name_norm || row.line_description;
  const crew = crewName(row.calendar_creator);
  const work = reportAttached ? "Report attachment noted" : (noteTokens(row.note_text) || row.line_description || "");
  const editable = cellEditing && !isBilled && !isProfitSplit && !blocked && !row.sent_for_review;
  const saveCell = (patch) => onEdit(row.id, patch);
  const feePctLabel = isProfitSplit ? `Split ${Math.round((row.split_pct ?? 0.5) * 100)}%` : `${Math.round((Number(row.fee_pct) || 0) * 1000) / 10}%`;
  const isCustomFee = !isProfitSplit && Number(row.fee_pct) !== 0.1;

  const handleCheckboxClick = (e) => {
    e.stopPropagation();
    if (!selectionEnabled) return;
    if (e.shiftKey) onShiftClick(row.id);
    else onToggle(row.id);
  };

  const handleRowClick = (e) => {
    if (e.target.closest("[data-no-open]")) return;
    onToggleExpand(row);
  };

  // Status info
  let statusInfo = null;
  if (row.sent_for_review) {
    statusInfo = { label: "Sent for review", dot: "var(--gf-amber-500)", text: "var(--gf-amber-700)" };
  } else if (blocked) {
    const isMatch = isMatchBlocked(row);
    if (isMatch) {
      statusInfo = { label: row._billing_review ? "Check billing" : "Review pricing", dot: "var(--gf-amber-500)", text: "var(--gf-amber-700)", onClick: (e) => { e.stopPropagation(); if (row._billing_review) onOpenDetails(row); else onToggleExpand(row); }, clickable: true };
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

  const highlight = selected || expanded;
  const rowStyle = {
    borderBottom: "1px solid var(--gf-hairline)",
    backgroundColor: highlight ? "var(--gf-teal-050)" : "var(--gf-card)",
    boxShadow: highlight ? "inset 3px 0 0 var(--gf-teal-600)" : focused ? "inset 3px 0 0 var(--gf-ink-4)" : "none",
    outline: focused ? "1px solid var(--gf-ink-4)" : "none",
    outlineOffset: "-1px",
    cursor: "pointer",
  };
  const hoverBg = (e) => { if (!highlight) e.currentTarget.style.backgroundColor = "var(--gf-hover)"; };
  const leaveBg = (e) => { if (!highlight) e.currentTarget.style.backgroundColor = "var(--gf-card)"; };

  const checkbox = (size) => (
    <button
      data-no-open
      onClick={handleCheckboxClick}
      aria-label={`Select ${jobName || "invoice line"}`}
      aria-pressed={selected}
      style={{ width: size === "lg" ? "36px" : "22px", height: size === "lg" ? "36px" : "22px", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "var(--r-check)", border: "none", backgroundColor: "transparent", cursor: "pointer", flexShrink: 0, padding: 0, visibility: selectionEnabled ? "visible" : "hidden" }}
    >
      <span aria-hidden="true" style={{ width: size === "lg" ? "20px" : "16px", height: size === "lg" ? "20px" : "16px", borderRadius: "4.5px", border: selected ? "none" : "1.5px solid var(--gf-check)", backgroundColor: selected ? "var(--gf-teal-600)" : "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center" }}>
        {selected && <Check style={{ width: "11px", height: "11px", color: "#FFFFFF" }} strokeWidth={3} />}
      </span>
    </button>
  );

  const menu = (ref, big) => (
    <div data-no-open ref={ref} style={{ position: "relative", flexShrink: 0 }}>
      <button
        data-no-open
        onClick={toggleMenu}
        aria-label="Invoice line actions"
        aria-expanded={menuOpen}
        style={{ width: big ? "36px" : "26px", height: big ? "36px" : "26px", borderRadius: "6px", border: "none", backgroundColor: "transparent", color: "var(--gf-ink-3)", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
      >
        <MoreHorizontal style={{ width: "16px", height: "16px" }} />
      </button>
      {menuOpen && (
        <div style={{ position: "absolute", right: 0, ...(menuUp ? { bottom: "100%", marginBottom: "4px" } : { top: "100%" }), zIndex: 30, backgroundColor: "var(--gf-card)", border: "1px solid var(--gf-border)", borderRadius: "10px", padding: "4px", minWidth: "200px", boxShadow: "var(--shadow-float)" }}>
          <MenuItem icon={ExternalLink} label="Open details" onClick={() => { onOpenDetails(row); setMenuOpen(false); }} />
          <MenuItem icon={Pencil} label="Edit line" onClick={() => { onToggleExpand(row); setMenuOpen(false); }} />
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
  );

  const cellText = { fontSize: "12.5px", color: "var(--gf-ink-2)" };

  return (
    <>
      {/* Desktop grid row */}
      <div
        ref={rowRef}
        role="row"
        aria-selected={selected}
        data-line-id={row.id}
        onClick={handleRowClick}
        onMouseEnter={hoverBg}
        onMouseLeave={leaveBg}
        className={`hidden ${UNBILLED_GRID}`}
        style={{ ...rowStyle, minHeight: "34px", padding: "4px 12px" }}
      >
        {checkbox("sm")}
        <span className="font-mono-num whitespace-nowrap" style={cellText}>{shortDay(row.job_date)}</span>
        <button
          data-no-open
          onClick={(e) => { e.stopPropagation(); onToggleExpand(row); }}
          className="text-left text-[13px] font-semibold leading-snug"
          style={{ color: "var(--gf-ink)", textDecoration: isBilled ? "line-through" : "none", background: "none", border: "none", padding: 0, cursor: "pointer", font: "inherit", fontWeight: 600, overflowWrap: "anywhere" }}
        >
          {jobName}
        </button>
        <span className="font-mono-num truncate" style={cellText} title={row.po_number || ""}>{row.po_number || "—"}</span>
        <span className={`${GRID_WIDE} truncate`} style={cellText}>{crew || "—"}</span>
        <span className={`${GRID_WIDE} truncate`} style={{ ...cellText, color: reportAttached ? "var(--gf-teal-600)" : "var(--gf-ink-2)" }} title={work}>{work || "—"}</span>
        <EditCell field="labor" current={labor} display={`$${formatMoney(labor)}`} editable={editable} onSave={saveCell} label="Labor" />
        {isProfitSplit ? (
          <span className="text-right text-[11.5px] font-semibold whitespace-nowrap" style={{ color: "var(--gf-teal-800)" }} title={`Job sale $${formatMoney(row.sale_price)}`}>{feePctLabel}</span>
        ) : (
          <EditCell field="fee_pct" current={row.fee_pct} display={<span style={{ color: isCustomFee ? "var(--gf-teal-800)" : "var(--gf-ink-2)", fontWeight: isCustomFee ? 700 : 400 }}>{feePctLabel}</span>} editable={editable} onSave={saveCell} label="Fee percent" />
        )}
        <span className="font-mono-num-bold text-right text-[13px] whitespace-nowrap" style={{ color: fee === 0 ? "var(--gf-ink-3)" : "var(--gf-ink)" }}>${formatMoney(fee)}</span>
        <div style={{ minWidth: 0 }}>{statusInfo && <StatusDot {...statusInfo} />}</div>
        <span className={`${GRID_WIDE} font-mono-num truncate`} style={cellText} title={row.invoice_number ? `Invoice #${row.invoice_number}` : ""}>{row.invoice_number ? `#${row.invoice_number}` : "—"}</span>
        {menu(menuRef, false)}
      </div>

      {/* Phone row */}
      <div
        onClick={handleRowClick}
        onMouseEnter={hoverBg}
        onMouseLeave={leaveBg}
        className="md:hidden"
        style={{ ...rowStyle, padding: "8px 8px 8px 4px" }}
      >
        <div className="flex items-start gap-1.5">
          {checkbox("lg")}
          <div className="min-w-0 flex-1 pt-1">
            <div className="flex items-start justify-between gap-2">
              <button
                data-no-open
                onClick={(e) => { e.stopPropagation(); onToggleExpand(row); }}
                className="min-w-0 text-left text-[14px] font-semibold leading-snug"
                style={{ color: "var(--gf-ink)", textDecoration: isBilled ? "line-through" : "none", background: "none", border: "none", padding: 0, cursor: "pointer", font: "inherit", fontWeight: 600, overflowWrap: "anywhere" }}
              >
                {jobName}
              </button>
              <span className="font-mono-num-bold text-[14px]" style={{ color: fee === 0 ? "var(--gf-ink-3)" : "var(--gf-ink)", whiteSpace: "nowrap", flexShrink: 0 }}>${formatMoney(fee)}</span>
            </div>
            <div className="mt-0.5 flex items-center justify-between gap-2">
              <span className="min-w-0 truncate text-[12px]" style={{ color: "var(--gf-ink-2)" }}>
                {[shortDay(row.job_date), `$${formatMoney(labor)} labor`, feePctLabel, row.po_number && `PO ${row.po_number}`, crew].filter(Boolean).join(" · ")}
              </span>
              {statusInfo && <StatusDot {...statusInfo} />}
            </div>
          </div>
          {menu(menuRefMobile, true)}
        </div>
      </div>

      {expanded && (
        <LineInlineExpansion
          row={row}
          onReady={onReady}
          onDelete={onDelete}
          onSendForReview={onSendForReview}
          onClose={onCollapse}
          jobs={jobs}
          onLinkJob={onLinkJob}
        />
      )}
    </>
  );
}
