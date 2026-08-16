import { useState } from "react";
import { AlertTriangle, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { feeMathString, formatMoney } from "@/lib/feeMath";
import { C } from "@/lib/feeUI";
import JobAssignPicker from "@/components/fees/JobAssignPicker";

export default function NeedsReviewSection({ rows, jobs, onAccept, onAssignToJob, onCreateJob }) {
  if (!rows.length) return null;
  const laborSub = rows.reduce((s, r) => s + (Number(r.labor_amt) || 0), 0);
  const feeSub = rows.reduce((s, r) => s + (Number(r.fee_amt) || 0), 0);
  return (
    <section className="px-4 sm:px-8 pt-4">
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle className="h-4 w-4" style={{ color: C.tagReview.text }} />
        <h2 className="font-bold uppercase tracking-wide" style={{ fontSize: "12px", color: C.accentDark }}>Needs Review</h2>
        <span className="text-xs" style={{ color: C.text, opacity: 0.68 }}>({rows.length})</span>
        <span className="ml-auto text-sm">
          <span className="text-xs uppercase tracking-wide mr-2" style={{ color: C.text, opacity: 0.68 }}>Held out</span>
          <span className="font-semibold tabular-nums" style={{ color: C.text }}>${formatMoney(laborSub)}</span>
          <span className="text-xs mx-1" style={{ color: C.text, opacity: 0.68 }}>labor ·</span>
          <span className="font-semibold tabular-nums" style={{ color: C.accent }}>${formatMoney(feeSub)}</span>
          <span className="text-xs ml-1" style={{ color: C.text, opacity: 0.68 }}>fee</span>
        </span>
      </div>
      <div className="space-y-3">
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
    <div className="rounded-lg p-4" style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, borderLeft: `4px solid ${C.accent}` }}>
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-sm" style={{ color: C.text }}>{row.job_name_raw}</span>
            <span className="text-xs" style={{ color: C.text, opacity: 0.68 }}>· {row.job_date}</span>
            <span className="text-xs px-1.5 py-0.5 rounded font-medium whitespace-nowrap" style={{ backgroundColor: C.tagReview.bg, color: C.tagReview.text }}>{row.match_confidence}</span>
            <span className="text-xs px-1.5 py-0.5 rounded font-medium whitespace-nowrap" style={{ backgroundColor: C.mutedBg, color: C.text, opacity: 0.68 }}>{row.source}</span>
          </div>
          {row.line_description && <div className="text-sm" style={{ color: C.text, opacity: 0.68 }}>{row.line_description}</div>}
          <div className="text-xs" style={{ color: C.tagReview.text }}>{reasons.join(" · ")}</div>
          <div className="text-xs font-mono" style={{ color: C.text, opacity: 0.68 }}>{feeMathString(row)}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Button size="sm" variant="default" className="gap-1.5" onClick={() => onAccept(row.id)}>
            <Check className="h-3.5 w-3.5" /> Accept
          </Button>
          {showPicker ? (
            <JobAssignPicker row={row} jobs={jobs} onAssign={(jobId) => { onAssignToJob(row.id, jobId); setShowPicker(false); }} onCreate={() => { onCreateJob(row.id); setShowPicker(false); }} />
          ) : (
            <Button size="sm" variant="outline" className="gap-1.5" style={{ borderColor: C.border }} onClick={() => setShowPicker(true)}>Assign to Job</Button>
          )}
        </div>
      </div>
    </div>
  );
}