import { useEffect, useState } from "react";
import { ChevronRight, GitMerge } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { SheetCard, TILE } from "@/components/jobs/JobSheet";
import MergeLogRow from "@/components/jobs/MergeLogRow";

// Admin-only (gated by the parent on JobDetail): every combine this job took
// part in (as survivor or as the combined-away record), complete or partial,
// each with an exact-ID undo. Closed by default behind a subtle "Record
// history" disclosure; the history panel lazy-mounts on expand and resets
// closed when the job id changes. The exact-ID undo renderer (MergeLogRow)
// and the underlying JobMergeLog/Jobs data and API are untouched — no records
// are deleted here.
export default function CombinedRecordsPanel({ job, onChanged }) {
  const [open, setOpen] = useState(false);
  const [logs, setLogs] = useState([]);
  const [others, setOthers] = useState({});
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [version, setVersion] = useState(0);
  const [prevJobId, setPrevJobId] = useState(job.id);

  // Reset on job-id change DURING RENDER: clears stale logs/others/error and
  // closes the panel before the fetch effect runs, so no stale open panel
  // flashes and no wasteful fetch fires for the new id while still "open".
  if (job.id !== prevJobId) {
    setPrevJobId(job.id);
    setOpen(false);
    setLogs([]);
    setOthers({});
    setError("");
  }

  // Lazy: only fetch when expanded. The cleanup keeps a stale fetch off the
  // state of the next expand.
  useEffect(() => {
    if (!open) return;
    let active = true;
    (async () => {
      setLoading(true);
      try {
        const page = await base44.entities.JobMergeLog.filter(
          { $or: [{ target_job_id: job.id }, { source_job_id: job.id }] },
          { sort: "-merged_at", limit: 50 }
        );
        const items = page.items || [];
        const ids = [...new Set(items.map((l) => (l.target_job_id === job.id ? l.source_job_id : l.target_job_id)).filter(Boolean))];
        let byId = {};
        if (ids.length) {
          const jobs = await base44.entities.Jobs.filter(
            { id: { $in: ids } },
            { fields: ["id", "canonical_name", "drive_job_folder_id", "drive_job_folder_url", "merged_into"], limit: 100 }
          );
          for (const j of jobs.items || []) byId[j.id] = j;
        }
        if (!active) return;
        setLogs(items);
        setOthers(byId);
        setError("");
      } catch (e) {
        if (active) setError(e?.message || "Could not load combine history.");
      } finally {
        if (active) setLoading(false);
      }
    })();
    return () => { active = false; };
  }, [open, job.id, job.merged_into, version]);

  const undone = () => { setVersion((v) => v + 1); onChanged?.(); };

  return (
    <details className="group" open={open} onToggle={(e) => setOpen(e.currentTarget.open)}>
      <summary className="flex cursor-pointer list-none items-center gap-1.5 text-[12.5px] font-medium select-none [&::-webkit-details-marker]:hidden" style={{ color: "#8a8f93" }}>
        <ChevronRight className="h-3.5 w-3.5 transition-transform duration-150 group-open:rotate-90" />
        Record history
      </summary>
      {open ? (
        <div className="mt-2">
          <SheetCard icon={GitMerge} tile={TILE.bronze} title="Combined records" sub="admin · undo uses exact recorded records">
            {error ? <p role="alert" className="m-0 text-[13px]" style={{ color: "#a43432" }}>{error}</p> : null}
            {loading ? <p className="m-0 text-[13px]" style={{ color: "#8a8f93" }}>Loading…</p> : null}
            {!loading && !error && !logs.length ? <p className="m-0 text-[13px]" style={{ color: "#8a8f93" }}>No combine history.</p> : null}
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {logs.map((log) => (
                <MergeLogRow key={log.id} log={log} job={job} other={others[log.target_job_id === job.id ? log.source_job_id : log.target_job_id]} onUndone={undone} />
              ))}
            </ul>
          </SheetCard>
        </div>
      ) : null}
    </details>
  );
}