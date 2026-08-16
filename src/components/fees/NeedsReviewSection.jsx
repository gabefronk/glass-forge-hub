import { useState } from "react";
import { AlertTriangle, Check, Link2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { feeMathString, formatMoney, isFutureRow } from "@/lib/feeMath";

// rows: fee lines needing review for the selected month
// jobs: all jobs (for "Assign to Job")
// onAccept(id), onAssignToJob(id, jobId)
export default function NeedsReviewSection({ rows, jobs, onAccept, onAssignToJob }) {
  if (!rows.length) return null;
  const laborSub = rows.reduce((s, r) => s + (Number(r.labor_amt) || 0), 0);
  const feeSub = rows.reduce((s, r) => s + (Number(r.fee_amt) || 0), 0);
  return (
    <section className="px-4 sm:px-8 pt-6">
      <div className="flex items-center gap-2 mb-3">
        <AlertTriangle className="h-4 w-4 text-accent" />
        <h2 className="font-heading text-xs font-bold uppercase tracking-widest">Needs Review</h2>
        <span className="text-xs text-muted-foreground">({rows.length})</span>
        <span className="ml-auto text-sm text-accent">
          <span className="text-xs uppercase tracking-wide mr-2">Held out</span>
          <span className="font-semibold tabular-nums">${formatMoney(laborSub)}</span>
          <span className="text-xs mx-1">labor ·</span>
          <span className="font-semibold tabular-nums">${formatMoney(feeSub)}</span>
          <span className="text-xs ml-1">fee</span>
        </span>
      </div>
      <div className="space-y-3">
        {rows.map((row) => (
          <ReviewRow
            key={row.id}
            row={row}
            jobs={jobs}
            onAccept={onAccept}
            onAssignToJob={onAssignToJob}
          />
        ))}
      </div>
    </section>
  );
}

function ReviewRow({ row, jobs, onAccept, onAssignToJob }) {
  const [pickedJob, setPickedJob] = useState("");
  const isUnmatched = row.match_confidence === "unmatched";
  const suggested = isUnmatched ? suggestJob(row, jobs) : null;

  const reasons = [];
  if (isUnmatched) reasons.push("Unmatched job name — no job linked");
  else if (row.match_confidence === "low") reasons.push("Low-confidence job match");
  if (!row.job_id) reasons.push("No job assigned");
  if (row.source === "both" && (row.calendar_labor_amt == null || row.calendar_labor_amt === "")) {
    reasons.push("Both sources but no calendar labor amount");
  }

  return (
    <div className="rounded-lg border border-border bg-[#f9f9f9] p-4 border-l-4 border-l-accent">
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0 flex-1 space-y-1.5">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-sm">{row.job_name_raw}</span>
            <span className="text-xs text-muted-foreground">· {row.job_date}</span>
            <span className="text-xs px-1.5 py-0.5 rounded bg-primary text-primary-foreground font-medium">{row.match_confidence}</span>
            <span className="text-xs px-1.5 py-0.5 rounded bg-muted text-muted-foreground">{row.source}</span>
          </div>
          {row.line_description && (
            <div className="text-sm text-muted-foreground">{row.line_description}</div>
          )}
          <div className="text-xs text-accent">
            {reasons.join(" · ")}
          </div>
          <div className="text-xs text-muted-foreground font-mono">{feeMathString(row)}</div>
          {isUnmatched && suggested && (
            <div className="text-xs text-muted-foreground">
              Suggested Job:{" "}
              <span className="font-medium text-foreground">{suggested.canonical_name}</span>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <Button size="sm" variant="default" className="gap-1.5" onClick={() => onAccept(row.id)}>
            <Check className="h-3.5 w-3.5" />
            Accept
          </Button>
          <div className="flex items-center gap-1.5">
            <Select value={pickedJob} onValueChange={setPickedJob}>
              <SelectTrigger size="sm" className="h-8 w-[12rem]">
                <SelectValue placeholder="Assign to Job" />
              </SelectTrigger>
              <SelectContent>
                {jobs.map((j) => (
                  <SelectItem key={j.id} value={j.id}>{j.canonical_name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              size="sm"
              variant="outline"
              className="gap-1.5"
              disabled={!pickedJob}
              onClick={() => onAssignToJob(row.id, pickedJob)}
            >
              <Link2 className="h-3.5 w-3.5" />
              Assign
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function suggestJob(row, jobs) {
  if (!jobs.length) return null;
  const norm = row.job_name_norm.toLowerCase();
  // exact alias match first
  for (const j of jobs) {
    if ((j.aliases || []).some((a) => a.toLowerCase() === norm)) return j;
  }
  // canonical includes norm
  for (const j of jobs) {
    if (j.canonical_name.toLowerCase().includes(norm) || norm.includes(j.canonical_name.toLowerCase())) return j;
  }
  // shared token
  const tokens = norm.split(/\s+/).filter((t) => t.length > 3);
  for (const j of jobs) {
    const cn = j.canonical_name.toLowerCase();
    if (tokens.some((t) => cn.includes(t))) return j;
  }
  return jobs[0];
}