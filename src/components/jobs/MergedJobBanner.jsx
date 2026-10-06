import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { GitMerge, Undo2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { C } from "@/lib/feeUI";
import { useAuth } from "@/lib/AuthContext";

// Shows on a job that was merged into another (Jobs.merged_into). The record is
// hidden from lists and matching, but someone who opened it directly still needs
// to see what happened and where the surviving job lives. Admins also get an
// Undo that calls the existing reverseMerge backend, which moves all linked
// records back and clears merged_into. Nothing here deletes anything.
export default function MergedJobBanner({ job, onReversed }) {
  const { user } = useAuth();
  const [targetName, setTargetName] = useState("");
  const [undoing, setUndoing] = useState(false);
  const [error, setError] = useState("");
  const targetId = job?.merged_into;
  const isAdmin = user?.role === "admin";

  useEffect(() => {
    let active = true;
    if (!targetId) { setTargetName(""); return; }
    base44.entities.Jobs.get(targetId)
      .then((t) => { if (active) setTargetName(t?.canonical_name || ""); })
      .catch(() => { if (active) setTargetName(""); });
    return () => { active = false; };
  }, [targetId]);

  if (!targetId) return null;

  const mergedAt = job.merged_at
    ? new Date(job.merged_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })
    : null;

  const undo = async () => {
    if (!window.confirm(`Undo this combine? ${job.canonical_name || "This job"} becomes active again and its linked records move back here.`)) return;
    setUndoing(true); setError("");
    try {
      const res = await base44.functions.invoke("reverseMerge", { source_job_id: job.id });
      const r = res?.data;
      if (r?.error) throw new Error(r.error);
      onReversed?.();
    } catch (e) {
      setError(e?.message || "Could not undo the combine.");
      setUndoing(false);
    }
  };

  return (
    <div className="rounded-[10px] px-3 py-2.5 text-[12.5px] break-words" style={{ backgroundColor: C.amberLight, color: C.amber, border: "1px solid rgba(192,139,46,.3)" }}>
      <div className="flex items-center gap-1.5 font-semibold">
        <GitMerge className="h-3.5 w-3.5 shrink-0" />
        This job was combined {mergedAt ? `on ${mergedAt}` : ""} and is no longer active.
      </div>
      <div className="mt-1">
        All visits, reports and notes now belong to{" "}
        <Link to={`/jobs/${targetId}`} className="font-medium underline">
          {targetName || "the surviving job"}
        </Link>
        . Use it for any new activity or billing.
      </div>
      {isAdmin && (
        <div className="mt-2 flex items-center gap-2">
          <button type="button" onClick={undo} disabled={undoing} className="inline-flex h-[30px] items-center gap-1.5 rounded-[8px] px-2.5 text-[12px] font-semibold disabled:opacity-60" style={{ backgroundColor: "rgba(192,139,46,.16)", color: "#6f4e10", border: "1px solid rgba(192,139,46,.3)" }}>
            <Undo2 className="h-3.5 w-3.5" />{undoing ? "Undoing…" : "Undo combine"}
          </button>
          {error && <span role="alert" className="text-[12px]" style={{ color: "#a43432" }}>{error}</span>}
        </div>
      )}
    </div>
  );
}