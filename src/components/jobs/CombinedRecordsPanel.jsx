import { useEffect, useState } from "react";
import { GitMerge } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { SheetCard, TILE } from "@/components/jobs/JobSheet";
import MergeLogRow from "@/components/jobs/MergeLogRow";

// Admin-only: every combine this job took part in (as survivor or as the
// combined-away record), complete or partial, each with an exact-ID undo.
// Hidden when the job has no combine history.
export default function CombinedRecordsPanel({ job, onChanged }) {
  const [logs, setLogs] = useState([]);
  const [others, setOthers] = useState({});
  const [error, setError] = useState("");
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let active = true;
    (async () => {
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
      }
    })();
    return () => { active = false; };
  }, [job.id, job.merged_into, version]);

  if (!logs.length && !error) return null;

  const undone = () => { setVersion((v) => v + 1); onChanged?.(); };

  return (
    <SheetCard icon={GitMerge} tile={TILE.bronze} title="Combined records" sub="admin · undo uses exact recorded records">
      {error ? <p role="alert" className="m-0 text-[13px]" style={{ color: "#a43432" }}>{error}</p> : null}
      <ul className="m-0 flex list-none flex-col gap-2 p-0">
        {logs.map((log) => (
          <MergeLogRow key={log.id} log={log} job={job} other={others[log.target_job_id === job.id ? log.source_job_id : log.target_job_id]} onUndone={undone} />
        ))}
      </ul>
    </SheetCard>
  );
}