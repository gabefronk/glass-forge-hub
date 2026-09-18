import { Link } from "react-router-dom";
import { AlertTriangle, Layers } from "lucide-react";
import { C } from "@/lib/feeUI";
import { sanitizeText } from "@/lib/jobsSanitize";

// Explains a read-only duplicate group (see lib/jobDedupe.js): which records are
// shown together, and which other jobs look like duplicates but need a person to
// decide. Nothing here changes a record.
export default function DuplicateJobNotice({ group, currentId, className = "" }) {
  if (!group) return null;
  const others = group.merged ? group.members.filter((m) => m.id !== currentId) : [];
  const review = group.review || [];
  if (!others.length && !review.length) return null;
  return (
    <div className={`space-y-2 ${className}`}>
      {others.length > 0 && (
        <div className="rounded-[10px] px-3 py-2 text-[12px] break-words" style={{ backgroundColor: C.tagCal.bg, color: C.tagCal.text, border: `1px solid ${C.tagCal.border}` }}>
          <div className="flex items-center gap-1.5 font-semibold">
            <Layers className="h-3.5 w-3.5 shrink-0" />
            Shown as one job: {group.members.length} records share this customer and address
          </div>
          <div className="mt-1">
            Also includes{" "}
            {others.map((m, i) => (
              <span key={m.id}>
                {i > 0 ? ", " : ""}
                <span className="font-medium">{sanitizeText(m.canonical_name)}</span>
              </span>
            ))}
            . Their visits, reports and notes appear below. The records themselves are unchanged.
          </div>
        </div>
      )}
      {review.map((r) => (
        <div key={r.reason} role="note" className="rounded-[10px] px-3 py-2 text-[12px] break-words" style={{ backgroundColor: C.amberLight, color: C.amber }}>
          <div className="flex items-center gap-1.5 font-semibold">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            Possible duplicate, needs review: {r.reason.toLowerCase()}
          </div>
          <div className="mt-1">
            {r.jobs.map((j, i) => (
              <span key={j.id}>
                {i > 0 ? ", " : ""}
                <Link to={`/jobs/${j.id}`} className="underline">{sanitizeText(j.name)}</Link>
              </span>
            ))}
            . Not merged automatically because the match is not certain.
          </div>
        </div>
      ))}
    </div>
  );
}
