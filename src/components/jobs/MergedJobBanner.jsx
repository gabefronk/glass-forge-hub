import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { GitMerge } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { C } from "@/lib/feeUI";

// Shows on a job that was merged into another (Jobs.merged_into). The record is
// hidden from lists and matching, but someone who opened it directly still needs
// to see what happened and where the surviving job lives.
export default function MergedJobBanner({ job }) {
  const [targetName, setTargetName] = useState("");
  const targetId = job?.merged_into;

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

  return (
    <div className="rounded-[10px] px-3 py-2.5 text-[12.5px] break-words" style={{ backgroundColor: C.amberLight, color: C.amber, border: "1px solid rgba(192,139,46,.3)" }}>
      <div className="flex items-center gap-1.5 font-semibold">
        <GitMerge className="h-3.5 w-3.5 shrink-0" />
        This job was merged {mergedAt ? `on ${mergedAt}` : ""} and is no longer active.
      </div>
      <div className="mt-1">
        All visits, reports and notes now belong to{" "}
        <Link to={`/jobs/${targetId}`} className="font-medium underline">
          {targetName || "the surviving job"}
        </Link>
        . Use it for any new activity or billing.
      </div>
    </div>
  );
}