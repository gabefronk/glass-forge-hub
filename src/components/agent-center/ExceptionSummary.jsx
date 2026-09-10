import { ShieldAlert } from "lucide-react";
import RunStateBadge from "./RunStateBadge";
import { formatTime } from "@/lib/agentDailyRuns";

export default function ExceptionSummary({ runs }) {
  const exceptions = runs
    .filter(r => r.state === "blocked" || r.state === "skipped")
    .sort((a, b) => (b.completed_at || b.started_at || "").localeCompare(a.completed_at || a.started_at || ""));
  return (
    <div className="rounded-2xl border border-[#B8CBE8] bg-[#F4F8FE] p-5">
      <h3 className="flex items-center gap-2 font-semibold"><ShieldAlert className="h-4 w-4 text-[#1E4A85]" />Exception-only summary</h3>
      <p className="mt-1 text-xs text-slate-600">Combined for Glass Forge manager → Operations Director. Only blocked or skipped section runs escalate; completed sections are not escalated.</p>
      {exceptions.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-[#B8CBE8] bg-white p-3 text-sm text-slate-500">No exceptions. All completed sections cleared.</p>
      ) : (
        <ul className="mt-3 space-y-2">
          {exceptions.map(r => (
            <li key={r.id} className="rounded-lg border border-[#DDE3EC] bg-white p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold">{r.lead_name}{r.escalated ? " · escalated to owner" : ""}</span>
                <RunStateBadge state={r.state} />
              </div>
              {r.summary && <p className="mt-1 text-slate-700">{r.summary}</p>}
              {r.exceptions?.length > 0 && <p className="mt-1 text-xs text-amber-800"><span className="font-semibold">Exceptions:</span> {r.exceptions.join("; ")}</p>}
              <p className="mt-1 text-xs text-slate-400">{formatTime(r.completed_at || r.started_at)}</p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}