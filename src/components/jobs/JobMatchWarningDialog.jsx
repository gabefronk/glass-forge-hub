import { Link } from "react-router-dom";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

// Blocking dialog shown when the manual "New job" guard finds a STRONG or
// MEDIUM match. Lists the matches (name, address, builder, stage, link) with
// two buttons: "Open existing job" (default — closes the create form) and
// "Create anyway" (a deliberate second click that proceeds to create).
export default function JobMatchWarningDialog({ matches, onOpenExisting, onCreateAnyway, onCancel }) {
  const all = [...(matches.strong || []), ...(matches.medium || [])];
  const open = all.length > 0;
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onCancel?.(); }}>
      <DialogContent className="bottom-0 top-auto w-full max-w-none translate-y-0 rounded-b-none rounded-t-2xl sm:bottom-auto sm:top-1/2 sm:max-w-lg sm:-translate-y-1/2 sm:rounded-lg">
        <DialogHeader>
          <DialogTitle>This job may already exist</DialogTitle>
          <DialogDescription>
            A matching job{all.length === 1 ? "" : ` (${all.length})`} is on file. Open it to add this work there, or create a separate record only if you are sure.
          </DialogDescription>
        </DialogHeader>
        <ul className="max-h-64 space-y-2 overflow-y-auto">
          {all.map((job, i) => (
            <li key={job.id} className="rounded-xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-950">
              <div className="flex items-baseline justify-between gap-2">
                <Link className="font-semibold underline" to={`/jobs/${job.id}`} target="_blank" onClick={onOpenExisting}>{job.canonical_name || "Open job"}</Link>
                <span className="shrink-0 text-xs font-medium uppercase tracking-wide">{(matches.strong || []).includes(job) || i < (matches.strong || []).length ? "Strong" : "Medium"}</span>
              </div>
              <div className="mt-0.5 text-xs text-amber-800">
                {[job.address, job.builder, job.stage].filter(Boolean).join(" · ") || "No address or builder on file"}
              </div>
            </li>
          ))}
        </ul>
        <DialogFooter>
          <button type="button" onClick={onCancel} className="min-h-11 rounded-xl border px-4 text-sm font-medium">Cancel</button>
          <button type="button" onClick={onCreateAnyway} className="min-h-11 rounded-xl border border-amber-400 bg-white px-4 text-sm font-semibold text-amber-900">Create anyway</button>
          <button type="button" onClick={onOpenExisting} className="min-h-11 rounded-xl bg-emerald-900 px-4 text-sm font-semibold text-white">Open existing job</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}