import { useState } from "react";
import { Link } from "react-router-dom";
import { Check, ChevronDown } from "lucide-react";
import { computeFeeAmt, computeLaborAmt, formatMoney } from "@/lib/feeMath";
import { crewName } from "@/lib/feeUI";
import { shortDay } from "@/lib/invoiceGrid";
import { STATUS_LABELS } from "@/lib/invoiceMoneyBar";
import { deliveryRouting } from "@/lib/lineProduct";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuSub, DropdownMenuSubTrigger, DropdownMenuSubContent } from "@/components/ui/dropdown-menu";
import LineInlineExpansion from "./LineInlineExpansion";

// One invoice line (declutter, Oct 24): a flat 40px grid row with one click target. The
// Product cell shows only the product (lineProduct); crew, PO/OE, delivery routing and
// the full work notes live in the read panel the row opens, with Open job, More ▾ and Edit
// line; Edit line opens the existing editor (LineInlineExpansion). No per-row menu, chevron
// or avatar. Status is a dot and a word in the Show vocabulary.
export const GRID_CLASS = "md:grid md:[grid-template-columns:var(--inv-cols-n)] xl:[grid-template-columns:var(--inv-cols-w)]";
export const WIDE_ONLY = "hidden xl:block";

const STATUS_STYLE = {
  ready: { dot: "#0B3F3B", text: "#101617", weight: 500 },
  needs_review: { dot: "#C08B2E", text: "#6F4E10", weight: 600 },
  zero_confirm: { dot: "#C08B2E", text: "#6F4E10", weight: 600 },
  needs_report: { dot: "#C08B2E", text: "#6F4E10", weight: 600 },
  invoiced: { dot: "#34506A", text: "#101617", weight: 500 },
  paid: { dot: "#166447", text: "#101617", weight: 500 },
  scheduled: { dot: "#9A9080", text: "#566063", weight: 500 },
  none: { dot: "transparent", text: "#566063", weight: 500 },
};

export function StatusWord({ status }) {
  const s = STATUS_STYLE[status] || STATUS_STYLE.none;
  if (!STATUS_LABELS[status]) return null;
  return (
    <span className="inline-flex items-center gap-2 whitespace-nowrap text-[14px]" style={{ color: s.text, fontWeight: s.weight }}>
      <span aria-hidden="true" style={{ width: "8px", height: "8px", borderRadius: "99px", backgroundColor: s.dot, flexShrink: 0 }} />
      {STATUS_LABELS[status]}
    </span>
  );
}

export function CheckBox({ state, onClick, label }) {
  const on = state === "all" || state === true;
  const some = state === "some";
  return (
    <button
      type="button"
      data-no-open
      onClick={onClick}
      aria-label={label}
      aria-checked={some ? "mixed" : on}
      role="checkbox"
      style={{ width: "44px", height: "36px", display: "flex", alignItems: "center", justifyContent: "center", border: "none", background: "none", cursor: "pointer", padding: 0 }}
    >
      <span aria-hidden="true" style={{ width: "16px", height: "16px", borderRadius: "4px", border: on || some ? "none" : "1.5px solid #9A9080", backgroundColor: on || some ? "#0B3F3B" : "#FFFFFF", display: "flex", alignItems: "center", justifyContent: "center" }}>
        {on && <Check style={{ width: "11px", height: "11px", color: "#FFFFFF" }} strokeWidth={3} />}
        {some && <span style={{ width: "8px", height: "2px", backgroundColor: "#FFFFFF", borderRadius: "1px" }} />}
      </span>
    </button>
  );
}

const cell = { padding: "0 10px", minWidth: 0 };
const menuItem = "flex min-h-9 cursor-pointer items-center text-[14px]";

export default function LineRow({ row, selected, focused, showStatus, onCheck, onEdit, onDelete, onMarkBilled, onOpenDetails, expanded, editing, onToggleExpand, onStartEdit, onReady, onSendForReview, onCollapse, jobs, onLinkJob, reportAttached }) {
  const [hover, setHover] = useState(false);
  const fee = computeFeeAmt(row);
  const labor = computeLaborAmt(row);
  const isBilled = !!row.billed_to_bfs;
  const isProfitSplit = row.fee_type === "profit_split";
  const jobName = row.job_name_raw || row.job_name_norm || row.line_description;
  const crew = crewName(row.calendar_creator);
  const product = row._product || "—";
  const routing = deliveryRouting(row);
  const refs = [row.po_number && `PO ${row.po_number}`, row.oe_number && `OE ${row.oe_number}`].filter(Boolean).join(" · ");
  const status = row._status || "none";

  const bg = selected ? "#EEF5F3" : expanded ? "#FAF8F3" : hover ? "#F6F3EC" : "#FFFFFF";
  const open = (e) => { if (e.target.closest("[data-no-open]")) return; onToggleExpand(row); };
  const report = reportAttached ? "Attachment noted" : row._reportBlocked ? "Missing" : row.calendar_event_id ? "On file" : "Not needed";

  return (
    <>
      {/* Desktop grid row */}
      <div
        role="row"
        aria-selected={selected}
        data-line-id={row.id}
        onClick={open}
        onMouseEnter={() => setHover(true)}
        onMouseLeave={() => setHover(false)}
        className={`hidden items-center ${GRID_CLASS}`}
        style={{ minHeight: "40px", borderBottom: "1px solid #D6CCBA", backgroundColor: bg, cursor: "pointer", outline: focused ? "2px solid #34403F" : "none", outlineOffset: "-2px" }}
      >
        <CheckBox state={selected} onClick={(e) => { e.stopPropagation(); onCheck(row.id, e.shiftKey); }} label={`Select ${jobName || "line"}`} />
        <span className="tabular-nums text-[14px]" style={{ ...cell, color: "#34403F" }}>{shortDay(row.job_date)}</span>
        <button
          type="button"
          aria-expanded={expanded}
          onClick={(e) => { e.stopPropagation(); onToggleExpand(row); }}
          className="text-left text-[14px] font-semibold xl:whitespace-nowrap"
          style={{ ...cell, color: "#101617", background: "none", border: "none", cursor: "pointer", textDecoration: isBilled ? "line-through" : "none", lineHeight: 1.35, paddingTop: "8px", paddingBottom: "8px", overflowWrap: "anywhere" }}
        >
          {jobName}
        </button>
        <span className={`${WIDE_ONLY} truncate`} style={{ ...cell, fontFamily: "var(--font-mono)", fontSize: "13px", color: "#34403F" }}>{row.po_number || ""}</span>
        <span className={`${WIDE_ONLY} truncate text-[14px]`} style={{ ...cell, color: product === "—" ? "#566063" : "#101617" }} title={product}>{product}</span>
        <span className="font-mono-num text-right text-[14px]" style={{ ...cell, color: "#101617" }}>${formatMoney(labor)}</span>
        <span className="font-mono-num-bold text-right text-[14px] font-bold" style={{ ...cell, color: fee === 0 ? "#566063" : "#101617" }}>${formatMoney(fee)}</span>
        {showStatus && <span style={cell}><StatusWord status={status} /></span>}
      </div>

      {/* Phone row */}
      <div onClick={open} className="md:hidden" style={{ borderBottom: "1px solid #D6CCBA", backgroundColor: bg, padding: "8px 12px 8px 0" }}>
        <div className="flex items-start">
          <CheckBox state={selected} onClick={(e) => { e.stopPropagation(); onCheck(row.id, e.shiftKey); }} label={`Select ${jobName || "line"}`} />
          <div className="min-w-0 flex-1 pt-1.5">
            <div className="flex items-start justify-between gap-3">
              <span className="min-w-0 text-[15px] font-semibold leading-snug" style={{ color: "#101617", overflowWrap: "anywhere", textDecoration: isBilled ? "line-through" : "none" }}>{jobName}</span>
              <span className="font-mono-num-bold whitespace-nowrap text-[15px] font-bold" style={{ color: "#101617" }}>${formatMoney(fee)}</span>
            </div>
            <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1 text-[14px]" style={{ color: "#566063" }}>
              <span>{[shortDay(row.job_date), `$${formatMoney(labor)} labor`, product !== "—" && product].filter(Boolean).join(" · ")}</span>
              {showStatus && <StatusWord status={status} />}
            </div>
          </div>
        </div>
      </div>

      {expanded && !editing && (
        <div className="flex flex-wrap items-start justify-between gap-4 pl-4 md:pl-[118px]" style={{ backgroundColor: "#FAF8F3", paddingTop: "4px", paddingRight: "16px", paddingBottom: "14px", borderBottom: "1px solid #D6CCBA" }}>
          <dl className="grid min-w-0 flex-1 gap-x-5 gap-y-1 pt-2 text-[14px]" style={{ gridTemplateColumns: "max-content minmax(0,1fr)", color: "#101617" }}>
            <dt style={{ color: "#566063" }}>Crew</dt><dd>{crew || "—"}</dd>
            {refs && <><dt style={{ color: "#566063" }}>PO / OE</dt><dd style={{ fontFamily: "var(--font-mono)", fontSize: "13px", color: "#34403F" }}>{refs}</dd></>}
            {routing && <><dt style={{ color: "#566063" }}>Delivery</dt><dd>{routing}</dd></>}
            <dt style={{ color: "#566063" }}>Work</dt><dd style={{ whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{String(row.note_text || "").trim() || row.line_description || "—"}</dd>
            <dt style={{ color: "#566063" }}>Field report</dt><dd>{report}{report === "Missing" && <> · <Link data-no-open to="/calendar" className="font-semibold underline" style={{ color: "#0B3F3B" }}>Add it on the calendar</Link></>}</dd>
          </dl>
          <div data-no-open className="flex items-center gap-2 pt-2">
            {row.job_id && <Link to={`/jobs/${row.job_id}`} className="px-2 text-[14px] font-semibold underline" style={{ color: "#0B3F3B" }}>Open job</Link>}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button type="button" className="inline-flex items-center gap-1 text-[14px] font-semibold" style={{ height: "36px", borderRadius: "9px", border: "1px solid #9A9080", backgroundColor: "#FFFFFF", color: "#101617", padding: "0 10px 0 12px", cursor: "pointer" }}>
                  More <ChevronDown style={{ width: "16px", height: "16px" }} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-[220px] p-1">
                <DropdownMenuItem className={menuItem} onSelect={() => onOpenDetails(row)}>Open details</DropdownMenuItem>
                {!isProfitSplit && !isBilled && (
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger className={menuItem}>Set fee %</DropdownMenuSubTrigger>
                    <DropdownMenuSubContent className="p-1">
                      {[0, 8, 10, 12, 15].map((pct) => (
                        <DropdownMenuItem key={pct} className={menuItem} onSelect={() => onEdit(row.id, { fee_pct: pct / 100, manually_adjusted: true })}>{pct === 0 ? "0% (no charge)" : `${pct}%`}</DropdownMenuItem>
                      ))}
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                )}
                {status === "zero_confirm" && <DropdownMenuItem className={menuItem} onSelect={() => onEdit(row.id, { manually_adjusted: true })}>Mark covered, no charge</DropdownMenuItem>}
                {isBilled
                  ? <DropdownMenuItem className={menuItem} onSelect={() => onMarkBilled(row.id, false)}>Reopen line</DropdownMenuItem>
                  : status === "ready" && <DropdownMenuItem className={menuItem} onSelect={() => onMarkBilled(row.id, true)}>Record invoice…</DropdownMenuItem>}
                <DropdownMenuSeparator />
                <DropdownMenuItem className={menuItem} style={{ color: "#A43432", fontWeight: 600 }} onSelect={() => onDelete(row.id)}>Delete line</DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <button type="button" onClick={() => onStartEdit(row)} className="text-[14px] font-semibold" style={{ height: "36px", borderRadius: "9px", border: "none", backgroundColor: "#0B3F3B", color: "#FFFFFF", padding: "0 14px", cursor: "pointer" }}>Edit line</button>
          </div>
        </div>
      )}

      {expanded && editing && (
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
