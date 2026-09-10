import { Play, Loader2, Lock } from "lucide-react";
import Portrait from "./Portrait";
import RunStateBadge from "./RunStateBadge";
import { PLANNED_ACTIONS, formatTime } from "@/lib/agentDailyRuns";

export default function LeadEnablementCard({ lead, enabled, lastRun, busy, onToggle, onRunNow }) {
  const planned = PLANNED_ACTIONS[lead.id] || [];
  return (
    <div className="flex flex-col rounded-2xl border border-[#DDE3EC] bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Portrait id={lead.id} />
          <div>
            <p className="text-xs font-medium uppercase tracking-wide text-[#2A5EA8]">{lead.label}</p>
            <h3 className="mt-1 font-semibold">{lead.name}</h3>
          </div>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-xs font-medium text-slate-600">
          <input type="checkbox" className="h-5 w-5 accent-[#2A5EA8]" checked={enabled} onChange={onToggle} disabled={!!busy} />
          Enabled
        </label>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
        <span className="text-slate-500">Last run:</span>
        {lastRun ? <RunStateBadge state={lastRun.state} /> : <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-500">None</span>}
        {lastRun && <span className="text-slate-400">{formatTime(lastRun.completed_at || lastRun.started_at)}</span>}
      </div>
      {lastRun?.summary && <p className="mt-2 line-clamp-2 text-xs text-slate-600">{lastRun.summary}</p>}
      <div className="mt-3 rounded-lg border border-dashed border-[#D8E3F4] bg-[#F6F8FC] p-3">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-500"><Lock className="h-3.5 w-3.5" />Connector routine actions</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {planned.map(a => <span key={a} className="rounded-lg bg-white px-2 py-1 text-xs text-slate-400">{a}</span>)}
        </div>
      </div>
      <div className="mt-auto pt-3">
        <button onClick={onRunNow} disabled={!!busy} className="inline-flex min-h-11 w-full items-center justify-center gap-1.5 rounded-lg bg-[#2A5EA8] px-3 py-2.5 text-sm font-semibold text-white disabled:opacity-50">
          {busy === lead.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}Run now
        </button>
      </div>
    </div>
  );
}