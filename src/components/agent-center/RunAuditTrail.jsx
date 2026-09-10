import { History } from "lucide-react";
import RunStateBadge from "./RunStateBadge";
import { formatTime } from "@/lib/agentDailyRuns";

export default function RunAuditTrail({ runs }) {
  const sorted = [...runs].sort((a, b) => (b.started_at || "").localeCompare(a.started_at || ""));
  return (
    <div className="rounded-2xl border border-[#DDE3EC] bg-white p-5">
      <h3 className="flex items-center gap-2 font-semibold"><History className="h-4 w-4 text-[#2A5EA8]" />Audit trail</h3>
      <p className="mt-1 text-xs text-slate-500">Persistent run records. Autonomous runs reconcile internal status, create summaries, and update run records without per-run approval.</p>
      {sorted.length === 0 ? (
        <p className="mt-3 rounded-lg border border-dashed border-[#DDE3EC] bg-[#F6F8FC] p-3 text-sm text-slate-500">No runs recorded yet. The scheduler starts the first run at 07:00 MT, or use Run all now.</p>
      ) : (
        <ol className="mt-3 space-y-2">
          {sorted.map(r => (
            <li key={r.id} className="rounded-lg border border-[#E9EDF4] bg-[#F6F8FC] p-3 text-xs">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-slate-900">{r.lead_name}</span>
                <RunStateBadge state={r.state} />
              </div>
              <p className="mt-1 text-slate-500">{r.triggered_by === "manual" ? "Manual" : "Scheduled"} · started {formatTime(r.started_at)}{r.completed_at ? <> · finished {formatTime(r.completed_at)}</> : ""}</p>
              {r.summary && <p className="mt-1 text-slate-700">{r.summary}</p>}
              {r.exceptions?.length > 0 && <p className="mt-1 text-amber-800"><span className="font-semibold">Exceptions:</span> {r.exceptions.join("; ")}</p>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}