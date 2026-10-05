import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Check, ExternalLink, Trash2 } from "lucide-react";
import { computeFeeAmt, computeLaborAmt, formatMoney } from "@/lib/feeMath";
import { isMatchBlocked } from "@/lib/invoicingFilters";
import { base44 } from "@/api/base44Client";

// Inline expansion shown directly under a clicked invoicing line row.
// Reads only: it pulls the latest FieldReports for the job to show a field-report
// note block. It never writes, syncs or backfills anything; the only writes are
// the explicit Ready / Delete / Send for Review actions the user triggers here.
const inputStyle = {
  backgroundColor: "var(--gf-card)", border: "1px solid var(--gf-border)", borderRadius: "var(--r-control)",
  padding: "8px 10px", color: "var(--gf-ink)", fontFamily: "var(--font-body)",
  fontSize: "14px", outline: "none", width: "100%",
};

function NoteBlock({ label, children }) {
  return (
    <div className="rounded-lg p-3" style={{ border: "1px solid var(--gf-border)", backgroundColor: "var(--gf-card)" }}>
      <div className="text-[11px] font-semibold uppercase mb-1.5" style={{ color: "var(--gf-ink-3)", letterSpacing: "0.08em" }}>{label}</div>
      {children}
    </div>
  );
}

export default function LineInlineExpansion({ row, onReady, onDelete, onSendForReview, onClose }) {
  const navigate = useNavigate();
  const [description, setDescription] = useState(row.line_description || "");
  const [detail, setDetail] = useState(row.note_text || "");
  const [labor, setLabor] = useState(row.labor_amt || 0);
  const [feePct, setFeePct] = useState(Math.round((row.fee_pct || 0) * 100));
  const [reports, setReports] = useState(null); // null = loading, [] = loaded
  const [reportsHasMore, setReportsHasMore] = useState(false);

  const isProfitSplit = row.fee_type === "profit_split";
  const liveFee = useMemo(() => {
    const l = Number(labor) || 0;
    const p = (Number(feePct) || 0) / 100;
    return Math.round(l * p * 100) / 100;
  }, [labor, feePct]);

  // Read-only: latest field reports for this job (for the "Field report" note block).
  useEffect(() => {
    let active = true;
    if (!row.job_id) { setReports([]); setReportsHasMore(false); return; }
    setReports(null);
    base44.entities.FieldReports.filter({ job_id: row.job_id }, { sort: "-created_date", limit: 5 })
      .then((res) => { if (!active) return; setReports(res?.items || []); setReportsHasMore(!!res?.has_more); })
      .catch(() => { if (active) { setReports([]); setReportsHasMore(false); } });
    return () => { active = false; };
  }, [row.job_id]);

  const fee = computeFeeAmt(row);
  const laborSaved = computeLaborAmt(row);
  const needsReview = isMatchBlocked(row);
  const reviewReason = row._billing_review || (!row.manually_adjusted && row._companion_review) || row.pricing_review_reason;
  const orderRef = row.po_number || row.oe_number || "";
  const serviceNote = row.calendar_note_text || row.note_text || "";
  const latestReport = reports && reports.length > 0 ? reports[0] : null;
  const reportCount = reports ? reports.length : 0;
  const statusLabel = row.billed_to_bfs ? "Billed" : needsReview ? "Review pricing" : fee > 0 ? "Ready" : "—";
  const statusColor = row.billed_to_bfs ? "var(--gf-ink-3)" : needsReview ? "var(--gf-amber-700)" : "var(--gf-teal-800)";

  const editedFields = {
    line_description: description,
    note_text: detail,
    labor_amt: Number(labor) || 0,
    fee_pct: (Number(feePct) || 0) / 100,
  };

  const ready = () => { onReady(row.id, editedFields); onClose?.(); };
  const sendForReview = () => { onSendForReview(row.id); onClose?.(); };
  const remove = () => {
    if (!window.confirm(`Delete this line for "${row.job_name_raw || row.job_name_norm || ""}"?`)) return;
    onDelete(row.id);
  };
  const cancel = () => { onClose?.(); };

  return (
    <div className="rounded-xl mx-[10px] my-1" style={{ border: "1px solid var(--gf-teal-halo)", backgroundColor: "var(--gf-field)", boxShadow: "var(--shadow-row)" }}>
      {/* Header strip */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5" style={{ borderBottom: "1px solid var(--gf-hairline)", backgroundColor: "var(--gf-card-band)" }}>
        <span className="text-[14px] font-semibold truncate" style={{ color: "var(--gf-ink)", minWidth: 0, flex: "1 1 200px" }}>{row.job_name_raw || row.job_name_norm || row.line_description}</span>
        {orderRef && <span className="text-[12px] font-ref whitespace-nowrap" style={{ color: "var(--gf-ink-2)" }}>{row.po_number ? `PO ${row.po_number}` : `OE ${row.oe_number}`}</span>}
        {row.job_date && <span className="text-[12px] whitespace-nowrap" style={{ color: "var(--gf-ink-3)" }}>{row.job_date}</span>}
        <span className="text-[12px] whitespace-nowrap" style={{ color: statusColor }}>{statusLabel}</span>
        {reviewReason && <span className="text-[12px] truncate" style={{ color: "var(--gf-amber-700)", minWidth: 0, flex: "1 1 160px" }}>{reviewReason}</span>}
      </div>

      <div className="px-4 py-3 flex flex-col gap-3">
        {/* Fee breakdown */}
        <div className="flex flex-wrap items-baseline gap-x-2.5 gap-y-1 text-[13px]" style={{ color: "var(--gf-ink-2)" }}>
          {isProfitSplit ? (
            <>
              <span>Job sale <b className="font-mono-num-bold" style={{ color: "var(--gf-ink)" }}>${formatMoney(row.sale_price)}</b></span>
              <span>−</span>
              <span>Cost <b className="font-mono-num-bold" style={{ color: "var(--gf-ink)" }}>${formatMoney(row.cost)}</b></span>
              <span>×</span>
              <span>Split <b className="font-mono-num-bold" style={{ color: "var(--gf-ink)" }}>{Math.round((row.split_pct ?? 0.5) * 100)}%</b></span>
            </>
          ) : (
            <>
              <span>Labor <b className="font-mono-num-bold" style={{ color: "var(--gf-ink)" }}>${formatMoney(laborSaved)}</b></span>
              <span>×</span>
              <span>Fee % <b className="font-mono-num-bold" style={{ color: "var(--gf-ink)" }}>{Math.round((row.fee_pct || 0) * 100)}%</b></span>
            </>
          )}
          <span>=</span>
          <span className="font-mono-num-bold text-[15px]" style={{ color: "var(--gf-teal-600)" }}>${formatMoney(fee)}</span>
          {row.manually_adjusted && <span className="text-[11px] font-semibold rounded px-1.5 py-0.5" style={{ backgroundColor: "var(--gf-field)", border: "1px solid var(--gf-border)", color: "var(--gf-ink-3)" }}>Manually adjusted</span>}
        </div>

        {/* Note blocks */}
        <div className="grid gap-3 sm:grid-cols-2">
          <NoteBlock label="Service request">
            {serviceNote ? (
              <div className="text-[13px]" style={{ color: "var(--gf-ink)", lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{serviceNote}</div>
            ) : (
              <div className="text-[12.5px]" style={{ color: "var(--gf-ink-3)" }}>None on file</div>
            )}
          </NoteBlock>
          <NoteBlock label="Field report">
            {reports === null ? (
              <div className="text-[12.5px]" style={{ color: "var(--gf-ink-3)" }}>Loading…</div>
            ) : latestReport ? (
              <div>
                <div className="flex items-center justify-between gap-2 mb-1">
                  <span className="text-[11.5px]" style={{ color: "var(--gf-ink-3)" }}>{latestReport.job_date || ""}</span>
                  {(reportCount > 1 || reportsHasMore) && row.job_id && (
                    <button onClick={() => navigate(`/jobs/${row.job_id}`)} className="text-[11.5px] font-medium" style={{ color: "var(--gf-teal-600)", background: "none", border: "none", padding: 0, cursor: "pointer" }}>
                      {reportsHasMore ? `${reportCount}+ reports — view job ↗` : `${reportCount} reports — view job ↗`}
                    </button>
                  )}
                </div>
                <div className="text-[13px]" style={{ color: "var(--gf-ink)", lineHeight: 1.5, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{latestReport.message || "—"}</div>
              </div>
            ) : (
              <div className="text-[12.5px]" style={{ color: "var(--gf-ink-3)" }}>None on file</div>
            )}
          </NoteBlock>
        </div>

        {/* Edit fields */}
        <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2">
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

        {/* Action row: Ready | Send for Review | Link to Job | Cancel | Delete */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <span className="text-[12px]" style={{ color: "var(--gf-ink-2)" }}>Fee </span>
            <span className="font-mono-num-bold text-[18px]" style={{ color: "var(--gf-teal-600)" }}>${formatMoney(liveFee)}</span>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={ready} className="min-h-10 rounded-lg px-4 text-[13px] font-semibold flex items-center gap-1.5" style={{ border: "1px solid var(--gf-teal-700)", backgroundColor: "var(--gf-teal-600)", color: "#FFFFFF" }}><Check className="h-4 w-4" />Ready</button>
            <button onClick={sendForReview} className="min-h-10 rounded-lg px-3 text-[13px] font-semibold" style={{ border: "1px solid var(--gf-amber-100)", backgroundColor: "var(--gf-amber-050)", color: "var(--gf-amber-700)" }}>Send for Review</button>
            {row.job_id && <button onClick={() => navigate(`/jobs/${row.job_id}`)} className="min-h-10 rounded-lg px-3 text-[13px] font-semibold flex items-center gap-1.5" style={{ border: "1px solid var(--gf-border)", backgroundColor: "var(--gf-card)", color: "var(--gf-ink)" }}><ExternalLink className="h-4 w-4" />Link to Job</button>}
            <button onClick={cancel} className="min-h-10 rounded-lg px-3 text-[13px] font-medium" style={{ border: "1px solid var(--gf-border)", backgroundColor: "var(--gf-card)", color: "var(--gf-ink-2)" }}>Cancel</button>
            <span className="mx-1 hidden h-6 w-px sm:inline-block" style={{ backgroundColor: "var(--gf-hairline)" }} />
            <button onClick={remove} className="min-h-10 rounded-lg px-3 text-[13px] font-semibold flex items-center gap-1.5" style={{ border: "1px solid var(--gf-error-border, #F0C9C5)", backgroundColor: "transparent", color: "#A43432" }}><Trash2 className="h-4 w-4" />Delete</button>
          </div>
        </div>
      </div>
    </div>
  );
}