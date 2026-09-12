import { useEffect, useRef } from "react";
import { X, Pencil, Trash2, Check, ExternalLink } from "lucide-react";
import { computeFeeAmt, computeLaborAmt, formatMoney, feeMathString } from "@/lib/feeMath";
import { crewName } from "@/lib/feeUI";

function Field({ label, children }) {
  return (
    <div>
      <div className="text-[11px] font-semibold uppercase mb-1" style={{ color: "#8A958F", letterSpacing: "0.06em" }}>{label}</div>
      <div className="text-[14px]" style={{ color: "#182422" }}>{children}</div>
    </div>
  );
}

export default function LineDetailsDrawer({ row, onClose, onEdit, onDelete, onMarkBilled, onOpenJob }) {
  const drawerRef = useRef(null);
  const closeBtnRef = useRef(null);
  const openerRef = useRef(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!row) return;
    openerRef.current = document.activeElement;
    closeBtnRef.current?.focus();

    const getFocusable = () => {
      if (!drawerRef.current) return [];
      return Array.from(drawerRef.current.querySelectorAll(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
      )).filter((el) => !el.hasAttribute("disabled"));
    };

    const handleKeyDown = (e) => {
      if (e.key === "Escape") { e.preventDefault(); onCloseRef.current(); return; }
      if (e.key !== "Tab") return;
      const focusable = getFocusable();
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (e.shiftKey) {
        if (document.activeElement === first || !drawerRef.current.contains(document.activeElement)) {
          e.preventDefault(); last.focus();
        }
      } else {
        if (document.activeElement === last || !drawerRef.current.contains(document.activeElement)) {
          e.preventDefault(); first.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (openerRef.current && typeof openerRef.current.focus === "function") {
        openerRef.current.focus();
      }
    };
  }, [row]);

  if (!row) return null;

  const fee = computeFeeAmt(row);
  const labor = computeLaborAmt(row);
  const isBilled = !!row.billed_to_bfs;
  const isProfitSplit = row.fee_type === "profit_split";
  const photoCount = Array.isArray(row.photo_urls) ? row.photo_urls.length : 0;

  return (
    <>
      {/* Overlay */}
      <div onClick={onClose} style={{ position: "fixed", inset: 0, backgroundColor: "rgba(24,36,34,.32)", zIndex: 60 }} />
      {/* Drawer */}
      <aside
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label="Line details"
        style={{
          position: "fixed", right: 0, top: 0, bottom: 0, width: "100%", maxWidth: "480px",
          backgroundColor: "#FFFFFF", borderLeft: "1px solid #DDE0DA", zIndex: 61,
          overflowY: "auto", boxShadow: "0 0 40px -8px rgba(24,36,34,.18)",
        }}
        className="obsidian-scroll"
      >
        {/* Header */}
        <div className="sticky top-0 flex items-center justify-between gap-3 px-5 py-4" style={{ backgroundColor: "#FFFFFF", borderBottom: "1px solid #DDE0DA", zIndex: 2 }}>
          <div className="min-w-0">
            <div className="text-[11px] font-medium" style={{ color: "#53615B" }}>Invoice line</div>
            <div className="text-[16px] font-semibold truncate" style={{ color: "#182422" }}>{row.job_name_raw || row.job_name_norm || row.line_description}</div>
          </div>
          <button ref={closeBtnRef} onClick={onClose} aria-label="Close details" className="shrink-0 flex items-center justify-center rounded-lg" style={{ height: "40px", width: "40px", color: "#53615B" }}>
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body */}
        <div className="px-5 py-5 space-y-5">
          {/* Amounts */}
          <div className="grid grid-cols-3 gap-3">
            <div className="rounded-xl p-3" style={{ backgroundColor: "#F0F1ED", border: "1px solid #DDE0DA" }}>
              <div className="text-[11px] font-medium mb-1" style={{ color: "#53615B" }}>Labor</div>
              <div className="font-mono-num-bold text-[18px]" style={{ color: "#182422" }}>${formatMoney(labor)}</div>
            </div>
            <div className="rounded-xl p-3" style={{ backgroundColor: "#EAF5EE", border: "1px solid #C7E4D2" }}>
              <div className="text-[11px] font-medium mb-1" style={{ color: "#166447" }}>Fee</div>
              <div className="font-mono-num-bold text-[18px]" style={{ color: "#166447" }}>${formatMoney(fee)}</div>
            </div>
            <div className="rounded-xl p-3" style={{ backgroundColor: "#F0F1ED", border: "1px solid #DDE0DA" }}>
              <div className="text-[11px] font-medium mb-1" style={{ color: "#53615B" }}>Fee %</div>
              <div className="font-mono-num-bold text-[18px]" style={{ color: "#182422" }}>{Math.round((row.fee_pct || 0) * 100)}%</div>
            </div>
          </div>

          {/* Status badges */}
          <div className="flex flex-wrap gap-2">
            {isBilled && <span className="text-[12px] font-semibold rounded-full px-3 py-1" style={{ backgroundColor: "#EAF5EE", color: "#166447", border: "1px solid #C7E4D2" }}>Billed</span>}
            {row.needs_review && !row.manually_adjusted && <span className="text-[12px] font-semibold rounded-full px-3 py-1" style={{ backgroundColor: "#FFF3DF", color: "#89511A", border: "1px solid #F0DBA8" }}>Needs review</span>}
            {row.manually_adjusted && <span className="text-[12px] font-semibold rounded-full px-3 py-1" style={{ backgroundColor: "#F0F1ED", color: "#53615B", border: "1px solid #DDE0DA" }}>Manually adjusted</span>}
            {isProfitSplit && <span className="text-[12px] font-semibold rounded-full px-3 py-1" style={{ backgroundColor: "#EAF5EE", color: "#166447", border: "1px solid #C7E4D2" }}>Profit split</span>}
            <span className="text-[12px] font-semibold rounded-full px-3 py-1" style={{ backgroundColor: "#F0F1ED", color: "#53615B", border: "1px solid #DDE0DA", textTransform: "capitalize" }}>{row.source}</span>
          </div>

          {/* Calculation explanation */}
          <div className="rounded-xl p-4" style={{ backgroundColor: "#F0F1ED", border: "1px solid #DDE0DA" }}>
            <div className="text-[11px] font-semibold uppercase mb-2" style={{ color: "#8A958F", letterSpacing: "0.06em" }}>Calculation</div>
            <div className="text-[13px]" style={{ color: "#182422", fontFamily: "'Archivo',sans-serif", fontVariantNumeric: "tabular-nums" }}>
              {feeMathString(row)}
            </div>
          </div>

          {/* Review reason */}
          {row.pricing_review_reason && (
            <div className="rounded-xl p-4" style={{ backgroundColor: "#FFF3DF", border: "1px solid #F0DBA8" }}>
              <div className="text-[11px] font-semibold uppercase mb-2" style={{ color: "#89511A", letterSpacing: "0.06em" }}>Review reason</div>
              <div className="text-[13px]" style={{ color: "#89511A" }}>{row.pricing_review_reason}</div>
              {row.split_candidate_amt != null && <div className="text-[12px] mt-1" style={{ color: "#89511A" }}>Candidate split: ${formatMoney(row.split_candidate_amt)} (excluded from totals).</div>}
            </div>
          )}

          {/* Source details */}
          <div className="space-y-3">
            <div className="text-[11px] font-semibold uppercase" style={{ color: "#8A958F", letterSpacing: "0.06em" }}>Source details</div>
            <Field label="Job date">{row.job_date || "—"}</Field>
            <Field label="Line description">{row.line_description || "—"}</Field>
            {row.po_number && <Field label="PO number">{row.po_number}</Field>}
            {row.oe_number && <Field label="OE number">{row.oe_number}</Field>}
            {row.calendar_creator && <Field label="Calendar creator">{row.calendar_creator} ({crewName(row.calendar_creator)})</Field>}
            {row.calendar_organizer && <Field label="Calendar organizer">{row.calendar_organizer}</Field>}
            {row.probuild_project_id && <Field label="ProBuild project">{row.probuild_project_id}</Field>}
            {row.probuild_post_id && <Field label="ProBuild post">{row.probuild_post_id}</Field>}
          </div>

          {/* Original notes — never discarded */}
          {row.note_text && (
            <div>
              <div className="text-[11px] font-semibold uppercase mb-2" style={{ color: "#8A958F", letterSpacing: "0.06em" }}>Original notes</div>
              <div className="rounded-xl p-4 text-[13px] whitespace-pre-wrap" style={{ backgroundColor: "#F0F1ED", border: "1px solid #DDE0DA", color: "#182422" }}>
                {row.note_text}
              </div>
            </div>
          )}

          {/* Photos / attachments */}
          <div>
            <div className="text-[11px] font-semibold uppercase mb-2" style={{ color: "#8A958F", letterSpacing: "0.06em" }}>Photos & attachments</div>
            <div className="text-[13px]" style={{ color: "#53615B" }}>
              {photoCount > 0 ? `${photoCount} photo${photoCount === 1 ? "" : "s"} available` : "No photos attached to this line."}
            </div>
            {photoCount > 0 && (
              <div className="grid grid-cols-3 gap-2 mt-3">
                {row.photo_urls.map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noreferrer" className="block rounded-lg overflow-hidden" style={{ border: "1px solid #DDE0DA", aspectRatio: "1" }}>
                    <img src={url} alt={`Photo ${i + 1}`} className="w-full h-full object-cover" />
                  </a>
                ))}
              </div>
            )}
          </div>

          {/* Profit split fields */}
          {isProfitSplit && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="Sale price">${formatMoney(row.sale_price)}</Field>
              <Field label="Cost">${formatMoney(row.cost)}</Field>
              <Field label="Split %">{Math.round((row.split_pct || 0.5) * 100)}%</Field>
            </div>
          )}
        </div>

        {/* Footer actions */}
        <div className="sticky bottom-0 flex gap-2 px-5 py-4" style={{ backgroundColor: "#FFFFFF", borderTop: "1px solid #DDE0DA" }}>
          <button onClick={() => onEdit(row.id)} className="min-h-11 flex-1 rounded-xl flex items-center justify-center gap-2 text-[13px] font-semibold" style={{ backgroundColor: "#F0F1ED", border: "1px solid #DDE0DA", color: "#182422" }}>
            <Pencil className="h-4 w-4" /> Edit
          </button>
          {row.job_id && (
            <button onClick={() => onOpenJob(row.job_id)} className="min-h-11 rounded-xl flex items-center justify-center gap-2 text-[13px] font-semibold px-4" style={{ backgroundColor: "#F0F1ED", border: "1px solid #DDE0DA", color: "#182422" }}>
              <ExternalLink className="h-4 w-4" /> Job
            </button>
          )}
          {isBilled ? (
            <button onClick={() => onMarkBilled(row.id, false)} className="min-h-11 flex-1 rounded-xl flex items-center justify-center gap-2 text-[13px] font-semibold" style={{ backgroundColor: "#F0F1ED", border: "1px solid #DDE0DA", color: "#53615B" }}>
              Reopen
            </button>
          ) : (
            <button onClick={() => onMarkBilled(row.id, true)} className="min-h-11 flex-1 rounded-xl flex items-center justify-center gap-2 text-[13px] font-semibold" style={{ backgroundColor: "#146556", border: "1px solid #104E44", color: "#FFFFFF" }}>
              <Check className="h-4 w-4" /> Mark billed
            </button>
          )}
          <button onClick={() => onDelete(row.id)} className="min-h-11 rounded-xl flex items-center justify-center px-4" style={{ backgroundColor: "#FCEDEC", border: "1px solid #F0C9C5", color: "#A43432" }} aria-label="Delete line">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </aside>
    </>
  );
}