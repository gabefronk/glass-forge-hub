import { History, Trash2 } from "lucide-react";
import RunStateBadge from "./RunStateBadge";
import { formatTime } from "@/lib/agentDailyRuns";

export default function RunAuditTrail({ runs, onClear }) {
  const sorted = [...runs].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  return (
    <div className="rounded-2xl border border-[#DDE3EC] bg-white p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 font-semibold"><History className="h-4 w-4 text-[#2A5EA8]" /> Audit trail</h3>
        {runs.length > 0 && (
          <button onClick={onClear} className="inline-flex min-h-9 items-center gap-1.5 rounded-lg border border-[#EFD2CA] bg-white px-2.5 py-1.5 text-xs font-medium text-[#8A4038] hover:bg-[#FBEDEA]"><Trash2 className="h-3.5 w-3.5" /> Clear</button>
        )}
      </div>
      <p className="mt-1 text-xs text-slate-500">Client-side record only. No server calls, record modifications, or external actions.</p>
      {sorted.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-[#DDE3EC] bg-[#F6F8FC] p-3 text-sm text-slate-500">No runs recorded yet.</p>
      ) : (
        <ol className="mt-3 space-y-2">
          {sorted.map(r => (
            <li key={r.id} className="rounded-lg border border-[#E9EDF4] bg-[#F6F8FC] p-3 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-slate-900">{r.leadName}</span>
                <RunStateBadge state={r.state} />
              </div>
              <p className="mt-1 text-slate-500">Started {formatTime(r.startedAt)}{r.completedAt ? <> · finished {formatTime(r.completedAt)}</> : ""}</p>
              {r.summary && <p className="mt-1 text-slate-700">{r.summary}</p>}
              {r.blockers.length > 0 && <p className="mt-1 text-amber-800"><span className="font-semibold">Blockers:</span> {r.blockers.join("; ")}</p>}
              <p className="mt-1 text-slate-400">Plan used: {r.plan.length} steps</p>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}