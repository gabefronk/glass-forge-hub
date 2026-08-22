import { useState } from "react";
import { AlertTriangle, Check } from "lucide-react";
import { feeMathString, formatMoney } from "@/lib/feeMath";
import { C } from "@/lib/feeUI";
import JobAssignPicker from "@/components/fees/JobAssignPicker";

export default function NeedsReviewSection({ rows, jobs, onAccept, onAssignToJob, onCreateJob }) {
  if (!rows.length) return null;
  const laborSub = rows.reduce((s, r) => s + (Number(r.labor_amt) || 0), 0);
  const feeSub = rows.reduce((s, r) => s + (Number(r.fee_amt) || 0), 0);
  return (
    <section className="px-[26px] max-[699px]:px-[18px] pt-4">
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle className="h-4 w-4" style={{ color: C.amber }} />
        <h2 className="font-mono text-[11px] font-semibold uppercase tracking-[0.14em]" style={{ color: C.amber }}>Needs review</h2>
        <span className="font-mono-num text-[12px]" style={{ color: C.textMuted }}>({rows.length})</span>
        <span className="ml-auto flex items-center gap-1.5 text-[12px]">
          <span className="mono-label-sm mr-1">Held out</span>
          <span className="font-mono-num text-[13px]" style={{ color: C.text }}>${formatMoney(laborSub)}</span>
          <span className="text-[11px]" style={{ color: C.textMuted }}>labor ·</span>
          <span className="font-mono-num-bold text-[13px]" style={{ color: C.accent }}>${formatMoney(feeSub)}</span>
          <span className="text-[11px]" style={{ color: C.textMuted }}>fee</span>
        </span>
      </div>
      <div className="space-y-2">
        {rows.map((row) => (
          <ReviewRow key={row.id} row={row} jobs={jobs} onAccept={onAccept} onAssignToJob={onAssignToJob} onCreateJob={onCreateJob} />
        ))}
      </div>
    </section>
  );
}

function ReviewRow({ row, jobs, onAccept, onAssignToJob, onCreateJob }) {
  const [showPicker, setShowPicker] = useState(false);
  const isUnmatched = row.match_confidence === "unmatched";

  const reasons = [];
  if (isUnmatched) reasons.push("Unmatched job name — no job linked");
  else if (row.match_confidence === "low") reasons.push("Low-confidence job match");
  if (!row.job_id) reasons.push("No job assigned");
  if (row.source === "both" && (row.calendar_labor_amt == null || row.calendar_labor_amt === "")) {
    reasons.push("Both sources but no calendar labor amount");
  }

  return (
    <div className="rounded-[14px] p-4" style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderLeft: `3px solid ${C.amber}` }}>
      <div className="flex flex-col gap-3 min-[700px]:flex-row min-[700px]:items-start min-[700px]:justify-between">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[13px] font-medium" style={{ color: C.text }}>{row.job_name_raw}</span>
            <span className="font-mono-num text-[11px]" style={{ color: C.textMuted }}>· {row.job_date}</span>
            <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.13em] px-1.5 py-0.5 rounded-full whitespace-nowrap" style={{ backgroundColor: C.tagReview.bg, color: C.tagReview.text }}>{row.match_confidence}</span>
            <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.13em] px-1.5 py-0.5 rounded-full whitespace-nowrap" style={{ backgroundColor: C.mutedBg, color: C.textSecondary }}>{row.source}</span>
          </div>
          {row.line_description && <div className="text-[12px]" style={{ color: C.textMuted }}>{row.line_description}</div>}
          <div className="text-[11px]" style={{ color: C.amber }}>{reasons.join(" · ")}</div>
          <div className="font-mono-num text-[11px]" style={{ color: C.textMuted }}>{feeMathString(row)}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button onClick={() => onAccept(row.id)} className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[12px] font-semibold whitespace-nowrap" style={{ backgroundColor: C.accent, color: C.accentDark }}>
            <Check className="h-3.5 w-3.5" /> Accept
          </button>
          {showPicker ? (
            <JobAssignPicker row={row} jobs={jobs} onAssign={(jobId) => { onAssignToJob(row.id, jobId); setShowPicker(false); }} onCreate={() => { onCreateJob(row.id); setShowPicker(false); }} />
          ) : (
            <button onClick={() => setShowPicker(true)} className="px-3 py-1.5 rounded-full text-[12px] font-medium whitespace-nowrap" style={{ border: `1px solid ${C.border}`, color: C.textSecondary }}>Assign to job</button>
          )}
        </div>
      </div>
    </div>
  );
}