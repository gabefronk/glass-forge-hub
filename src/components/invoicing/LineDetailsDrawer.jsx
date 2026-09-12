import { useEffect, useRef } from "react";
import { X, Pencil, Trash2, Check, ExternalLink } from "lucide-react";
import { computeFeeAmt, computeLaborAmt, formatMoney, feeMathString } from "@/lib/feeMath";
import { crewName } from "@/lib/feeUI";

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

function FactRow({ label, children }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2" style={{ borderBottom: "1px solid var(--gf-hairline)" }}>
      <span className="text-[12px] font-medium" style={{ color: "var(--gf-ink-3)", flexShrink: 0 }}>{label}</span>
      <span className="text-[13px] text-right min-w-0 break-words" style={{ color: "var(--gf-ink)" }}>{children}</span>
    </div>
  );
}

function Pill({ children, bg, color, border, dashed }) {
  return (
    <span className="inline-flex items-center text-[11px] font-semibold rounded-[7px] px-2.5 py-0.5 whitespace-nowrap" style={{
      height: "26px",
      backgroundColor: dashed ? "transparent" : (bg || "var(--gf-field)"),
      color: color || "var(--gf-ink-2)",
      border: `1px ${dashed ? "dashed" : "solid"} ${border || "var(--gf-border)"}`,
    }}>
      {children}
    </span>
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
  const needsReview = row.needs_review && !row.manually_adjusted;
  const photoCount = Array.isArray(row.photo_urls) ? row.photo_urls.length : 0;
  const builderName = builderFromName(row.job_name_raw || row.job_name_norm || "");
  const tile = builderTile(builderName || row.job_name_raw || row.job_name_norm || "?");
  const initials = builderInitials(builderName || row.job_name_raw || row.job_name_norm || "?");
  const orderRef = row.po_number || row.oe_number || "";
  const authorEmail = row.calendar_creator || row.calendar_organizer || "";
  const authorName = authorEmail ? crewName(authorEmail) : "";
  const ruleText = isProfitSplit ? "(Sale − Cost) × Split %" : "Labor × Fee %";

  return (
    <>
      {/* Scrim */}
      <div onClick={onClose} style={{ position: "fixed", inset: 0, backgroundColor: "rgba(244,241,234,.45)", zIndex: 60 }} />
      {/* Drawer */}
      <aside
        ref={drawerRef}
        role="dialog"
        aria-modal="true"
        aria-label="Line details"
        style={{
          position: "fixed", right: 0, top: 0, bottom: 0, width: "100%", maxWidth: "480px",
          backgroundColor: "var(--gf-card)", borderLeft: "1px solid var(--gf-border)", zIndex: 61,
          boxShadow: "-24px 0 48px -32px rgba(21,24,26,.35)",
          display: "flex", flexDirection: "column",
        }}
      >
        {/* Header */}
        <div style={{ flexShrink: 0, backgroundColor: "var(--gf-card)", borderBottom: "1px solid var(--gf-border)", padding: "14px 26px 12px" }}>
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-[12px]" style={{ color: "var(--gf-ink-3)" }}>
              {row.job_date || "—"}
              {orderRef && <> · <span className="font-ref">{row.po_number ? `PO ${row.po_number}` : `OE ${row.oe_number}`}</span></>}
            </span>
            <button ref={closeBtnRef} onClick={onClose} aria-label="Close details" className="min-w-11 min-h-11 lg:min-w-7 lg:min-h-7" style={{ width: "28px", height: "28px", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "6px", border: "none", backgroundColor: "transparent", color: "var(--gf-ink-3)", cursor: "pointer", flexShrink: 0 }}>
              <X style={{ width: "16px", height: "16px" }} strokeWidth={1.8} />
            </button>
          </div>
          <div className="flex items-start gap-3">
            <div style={{ width: "40px", height: "40px", borderRadius: "10px", backgroundColor: tile.bg, color: tile.ink, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "14px", fontWeight: 600, flexShrink: 0, letterSpacing: "-0.01em" }}>
              {initials}
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[19px] font-semibold truncate" style={{ color: "var(--gf-ink)", letterSpacing: "-0.02em", lineHeight: 1.25 }}>{row.job_name_raw || row.job_name_norm || row.line_description}</div>
              <div className="text-[12.5px] truncate" style={{ color: "var(--gf-ink-3)" }}>
                {row.source && <span style={{ textTransform: "capitalize" }}>{row.source}</span>}
                {authorName && <> · {authorName}</>}
              </div>
            </div>
          </div>
          {/* Pills */}
          <div className="flex flex-wrap gap-1.5 mt-2.5">
            {isBilled && <Pill bg="var(--gf-teal-050)" color="var(--gf-teal-800)" border="var(--gf-teal-halo)">Billed</Pill>}
            {needsReview && <Pill bg="var(--gf-amber-050)" color="var(--gf-amber-700)" border="var(--gf-amber-100)">Review pricing</Pill>}
            {row.manually_adjusted && <Pill bg="var(--gf-field)" color="var(--gf-ink-3)" border="var(--gf-border)">Manually adjusted</Pill>}
            {isProfitSplit && row.split_candidate_amt != null && <Pill bg="var(--gf-field)" color="var(--gf-ink-2)" border="var(--gf-border)">Profit-split candidate</Pill>}
            {row.billable === false && <Pill color="var(--gf-ink-3)" border="var(--gf-ink-3)" dashed>Excluded from totals</Pill>}
          </div>
        </div>

        {/* Body */}
        <div className="obsidian-scroll" style={{ flex: "1 1 auto", overflowY: "auto", padding: "18px 26px 24px", display: "flex", flexDirection: "column", gap: "24px" }}>
          {/* Calculation */}
          <div>
            <div className="flex items-baseline justify-between mb-2">
              <span className="text-[11px] font-semibold uppercase" style={{ color: "var(--gf-ink-3)", letterSpacing: "0.08em" }}>How this fee is calculated</span>
              <span className="text-[11.5px] font-medium" style={{ color: "var(--gf-ink-2)" }}>{ruleText}</span>
            </div>
            <div style={{ borderRadius: "10px", border: "1px solid var(--gf-border)", overflow: "hidden" }}>
              <div className="flex items-center justify-between" style={{ padding: "10px 14px", borderBottom: "1px solid var(--gf-hairline)", whiteSpace: "nowrap" }}>
                <span className="text-[13px]" style={{ color: "var(--gf-ink-2)" }}>Labor</span>
                <span className="font-mono-num-bold text-[14px]" style={{ color: "var(--gf-ink)" }}>${formatMoney(labor)}</span>
              </div>
              <div className="flex items-center justify-between" style={{ padding: "10px 14px", borderBottom: "1px solid var(--gf-hairline)", whiteSpace: "nowrap" }}>
                <span className="text-[13px]" style={{ color: "var(--gf-ink-2)" }}>Fee %</span>
                <span className="font-mono-num-bold text-[14px]" style={{ color: "var(--gf-ink)" }}>{Math.round((row.fee_pct || 0) * 100)}%</span>
              </div>
              {isProfitSplit && (
                <>
                  <div className="flex items-center justify-between" style={{ padding: "10px 14px", borderBottom: "1px solid var(--gf-hairline)", whiteSpace: "nowrap" }}>
                    <span className="text-[13px]" style={{ color: "var(--gf-ink-2)" }}>Sale price</span>
                    <span className="font-mono-num-bold text-[14px]" style={{ color: "var(--gf-ink)" }}>${formatMoney(row.sale_price)}</span>
                  </div>
                  <div className="flex items-center justify-between" style={{ padding: "10px 14px", borderBottom: "1px solid var(--gf-hairline)", whiteSpace: "nowrap" }}>
                    <span className="text-[13px]" style={{ color: "var(--gf-ink-2)" }}>Cost</span>
                    <span className="font-mono-num-bold text-[14px]" style={{ color: "var(--gf-ink)" }}>${formatMoney(row.cost)}</span>
                  </div>
                  <div className="flex items-center justify-between" style={{ padding: "10px 14px", borderBottom: "1px solid var(--gf-hairline)", whiteSpace: "nowrap" }}>
                    <span className="text-[13px]" style={{ color: "var(--gf-ink-2)" }}>Split %</span>
                    <span className="font-mono-num-bold text-[14px]" style={{ color: "var(--gf-ink)" }}>{Math.round((row.split_pct || 0.5) * 100)}%</span>
                  </div>
                </>
              )}
              {needsReview && (
                <div className="flex items-center justify-between" style={{ padding: "10px 14px", borderBottom: "1px solid var(--gf-hairline)", whiteSpace: "nowrap", backgroundColor: "var(--gf-amber-row)" }}>
                  <span className="text-[13px]" style={{ color: "var(--gf-amber-700)" }}>Held for review</span>
                  <span className="text-[12px]" style={{ color: "var(--gf-amber-700)" }}>{row.pricing_review_reason || "Pricing needs confirmation"}</span>
                </div>
              )}
              <div className="flex items-center justify-between" style={{ padding: "10px 14px", whiteSpace: "nowrap", backgroundColor: "var(--gf-card-band)" }}>
                <span className="text-[13px] font-semibold" style={{ color: "var(--gf-ink)" }}>Counts toward Recorded fees</span>
                <span className="font-mono-num-bold text-[15px]" style={{ color: "var(--gf-ink)", fontWeight: 600 }}>${formatMoney(fee)}</span>
              </div>
            </div>
            <div className="text-[12.5px] mt-2" style={{ color: "var(--gf-ink-2)", lineHeight: 1.5, wordBreak: "break-word" }}>
              {feeMathString(row)}
            </div>
          </div>

          {/* Review reason */}
          {row.pricing_review_reason && (
            <div className="rounded-[10px] p-3" style={{ backgroundColor: "var(--gf-amber-050)", border: "1px solid var(--gf-amber-100)" }}>
              <div className="text-[11px] font-semibold uppercase mb-1" style={{ color: "var(--gf-amber-700)", letterSpacing: "0.08em" }}>Review reason</div>
              <div className="text-[13px]" style={{ color: "var(--gf-amber-700)" }}>{row.pricing_review_reason}</div>
              {row.split_candidate_amt != null && <div className="text-[12px] mt-1" style={{ color: "var(--gf-amber-700)" }}>Candidate split: ${formatMoney(row.split_candidate_amt)} (excluded from totals).</div>}
            </div>
          )}

          {/* Facts */}
          <div>
            <div className="text-[11px] font-semibold uppercase mb-1" style={{ color: "var(--gf-ink-3)", letterSpacing: "0.08em" }}>Facts</div>
            <FactRow label="Job date">{row.job_date || "—"}</FactRow>
            <FactRow label="Line description">{row.line_description || "—"}</FactRow>
            {row.po_number && <FactRow label="PO number"><span className="font-ref">{row.po_number}</span></FactRow>}
            {row.oe_number && <FactRow label="OE number"><span className="font-ref">{row.oe_number}</span></FactRow>}
            {row.calendar_creator && <FactRow label="Calendar creator">{row.calendar_creator} ({crewName(row.calendar_creator)})</FactRow>}
            {row.calendar_organizer && <FactRow label="Calendar organizer">{row.calendar_organizer}</FactRow>}
            {row.probuild_project_id && <FactRow label="ProBuild project"><span className="font-ref">{row.probuild_project_id}</span></FactRow>}
            {row.probuild_post_id && <FactRow label="ProBuild post"><span className="font-ref">{row.probuild_post_id}</span></FactRow>}
          </div>

          {/* Notes */}
          {row.note_text && (
            <div>
              <div className="text-[11px] font-semibold uppercase mb-2" style={{ color: "var(--gf-ink-3)", letterSpacing: "0.08em" }}>Notes</div>
              <div className="flex items-start gap-2.5">
                {authorEmail && (
                  <div style={{ width: "28px", height: "28px", borderRadius: "7px", backgroundColor: tile.bg, color: tile.ink, display: "flex", alignItems: "center", justifyContent: "center", fontSize: "10px", fontWeight: 600, flexShrink: 0 }}>
                    {builderInitials(authorName || authorEmail)}
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2 mb-1">
                    <div className="flex items-baseline gap-2 min-w-0">
                      {authorName && <span className="text-[12.5px] font-semibold truncate" style={{ color: "var(--gf-ink)" }}>{authorName}</span>}
                      {row.job_date && <span className="text-[11px]" style={{ color: "var(--gf-ink-3)" }}>{row.job_date}</span>}
                    </div>
                    {row.source && <Pill bg="var(--gf-field)" color="var(--gf-ink-3)" border="var(--gf-border)"><span style={{ textTransform: "capitalize" }}>{row.source}</span></Pill>}
                  </div>
                  <div className="text-[13.5px]" style={{ color: "var(--gf-ink)", lineHeight: 1.55, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>
                    {row.note_text}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Photos */}
          <div>
            <div className="text-[11px] font-semibold uppercase mb-2" style={{ color: "var(--gf-ink-3)", letterSpacing: "0.08em" }}>Photos & attachments</div>
            <div className="text-[13px]" style={{ color: "var(--gf-ink-3)" }}>
              {photoCount > 0 ? `${photoCount} photo${photoCount === 1 ? "" : "s"} available` : "No photos attached to this line."}
            </div>
            {photoCount > 0 && (
              <div className="grid grid-cols-3 gap-2 mt-2">
                {row.photo_urls.map((url, i) => (
                  <a key={i} href={url} target="_blank" rel="noreferrer" className="block rounded-lg overflow-hidden" style={{ border: "1px solid var(--gf-border)", aspectRatio: "1" }}>
                    <img src={url} alt={`Photo ${i + 1}`} className="w-full h-full object-cover" />
                  </a>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-wrap gap-2" style={{ flexShrink: 0, backgroundColor: "var(--gf-card-band)", borderTop: "1px solid var(--gf-hairline)", padding: "12px 26px" }}>
          <button onClick={() => onEdit(row.id)} className="flex-1 rounded-[9px] flex items-center justify-center gap-2 text-[13px] font-semibold" style={{ backgroundColor: "var(--gf-card)", border: "1px solid var(--gf-border)", color: "var(--gf-ink)", minHeight: "44px" }}>
            <Pencil className="h-4 w-4" /> Edit
          </button>
          {row.job_id && (
            <button onClick={() => onOpenJob(row.job_id)} className="rounded-[9px] flex items-center justify-center gap-2 text-[13px] font-semibold px-4" style={{ backgroundColor: "var(--gf-card)", border: "1px solid var(--gf-border)", color: "var(--gf-ink)", minHeight: "44px" }}>
              <ExternalLink className="h-4 w-4" /> Job
            </button>
          )}
          {isBilled ? (
            <button onClick={() => onMarkBilled(row.id, false)} className="flex-1 rounded-[9px] flex items-center justify-center gap-2 text-[13px] font-semibold" style={{ backgroundColor: "var(--gf-card)", border: "1px solid var(--gf-border)", color: "var(--gf-ink-2)", minHeight: "44px" }}>
              Reopen
            </button>
          ) : (
            <button onClick={() => onMarkBilled(row.id, true)} className="flex-1 rounded-[9px] flex items-center justify-center gap-2 text-[13px] font-semibold" style={{ backgroundColor: "var(--gf-teal-600)", border: "1px solid var(--gf-teal-700)", color: "#FFFFFF", minHeight: "44px" }}>
              <Check className="h-4 w-4" /> Mark billed
            </button>
          )}
          <button onClick={() => onDelete(row.id)} className="min-w-11 rounded-[9px] flex items-center justify-center px-3" style={{ backgroundColor: "var(--gf-error-bg)", border: "1px solid var(--gf-error-border)", color: "var(--gf-error)", minHeight: "44px" }} aria-label="Delete line">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </aside>
    </>
  );
}