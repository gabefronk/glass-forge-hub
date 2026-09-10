import { useState } from "react";
import { Play, Plus, CheckCircle2, AlertTriangle, SkipForward, Lock } from "lucide-react";
import Portrait from "./Portrait";
import RunStateBadge from "./RunStateBadge";
import { PLANNED_ACTIONS, formatTime } from "@/lib/agentDailyRuns";

const btn = "inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg px-3 py-2.5 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50";
const primary = btn + " bg-[#2A5EA8] text-white hover:bg-[#234F8E]";
const secondary = btn + " border border-[#DDE3EC] bg-white text-[#1E4A85] hover:bg-[#F6F8FC]";
const danger = btn + " border border-[#EFD2CA] bg-white text-[#8A4038] hover:bg-[#FBEDEA]";

export default function LeadRunCard({ lead, active, last, onStart, onQueue, onBegin, onUpdate, onComplete, onBlock, onSkip }) {
  const [blockerText, setBlockerText] = useState("");
  const run = active;
  const planned = PLANNED_ACTIONS[lead.id] || [];
  const addBlocker = () => { if (!blockerText.trim() || !run) return; onUpdate(run.id, { blockers: [...run.blockers, blockerText.trim()] }); setBlockerText(""); };
  const removeBlocker = i => onUpdate(run.id, { blockers: run.blockers.filter((_, idx) => idx !== i) });

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
        {run ? <RunStateBadge state={run.state} /> : last ? <RunStateBadge state={last.state} /> : <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-500">Not started</span>}
      </div>

      <ol className="mt-3 space-y-1.5 text-xs leading-relaxed text-slate-700">
        {lead.plan.map((step, i) => (
          <li key={i} className="flex gap-2"><span className="font-semibold text-[#2A5EA8]">{i + 1}.</span><span><span className="font-semibold text-slate-900">{step.phase}:</span> {step.task}</span></li>
        ))}
      </ol>

      <div className="mt-3 rounded-lg border border-dashed border-[#D8E3F4] bg-[#F6F8FC] p-3">
        <p className="flex items-center gap-1.5 text-xs font-semibold text-slate-500"><Lock className="h-3.5 w-3.5" /> External actions disabled</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {planned.map(a => <span key={a} className="rounded-lg bg-white px-2 py-1 text-xs text-slate-400" title="Planned — disabled today">{a}</span>)}
        </div>
      </div>

      <div className="mt-auto" />
      {!run && !last && (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-[#E9EDF4] pt-3">
          <button className={primary} onClick={onStart}><Play className="h-4 w-4" /> Start read-only run</button>
          <button className={secondary} onClick={onQueue}>Queue</button>
        </div>
      )}
      {!run && last && (
        <div className="mt-3 border-t border-[#E9EDF4] pt-3">
          <p className="text-xs text-slate-600"><span className="font-semibold">Last run:</span> {last.summary || "No summary recorded"}{last.blockers.length > 0 ? <> · blockers: {last.blockers.join("; ")}</> : ""}</p>
          <p className="text-xs text-slate-400">{formatTime(last.completedAt || last.startedAt)}</p>
          <div className="mt-2 flex flex-wrap gap-2">
            <button className={primary} onClick={onStart}><Play className="h-4 w-4" /> Start new run</button>
            <button className={secondary} onClick={onQueue}>Queue</button>
          </div>
        </div>
      )}
      {run && run.state === "queued" && (
        <div className="mt-3 flex flex-wrap gap-2 border-t border-[#E9EDF4] pt-3">
          <button className={primary} onClick={() => onBegin(run.id)}><Play className="h-4 w-4" /> Begin run</button>
          <button className={secondary} onClick={() => onSkip(run.id)}><SkipForward className="h-4 w-4" /> Skip</button>
        </div>
      )}
      {run && run.state === "running" && (
        <div className="mt-3 space-y-3 border-t border-[#E9EDF4] pt-3">
          <label className="block text-xs font-medium text-slate-600">Section summary
            <textarea className="mt-1 min-h-20 w-full rounded-lg border border-[#DDE3EC] bg-white p-2 text-sm" placeholder="Summarize what this section completed today…" value={run.summary} onChange={e => onUpdate(run.id, { summary: e.target.value })} />
          </label>
          <div>
            <span className="block text-xs font-medium text-slate-600">Blockers</span>
            {run.blockers.length > 0 && (
              <ul className="mt-1 space-y-1">
                {run.blockers.map((b, i) => (
                  <li key={i} className="flex items-center justify-between rounded-lg bg-amber-50/60 px-2 py-1 text-xs text-amber-800">
                    <span className="break-words">{b}</span>
                    <button type="button" className="ml-2 shrink-0 text-amber-600 hover:underline" onClick={() => removeBlocker(i)}>Remove</button>
                  </li>
                ))}
              </ul>
            )}
            <div className="mt-1 flex gap-2">
              <input className="min-h-10 flex-1 rounded-lg border border-[#DDE3EC] bg-white px-2 text-sm" placeholder="Add a blocker…" value={blockerText} onChange={e => setBlockerText(e.target.value)} onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); addBlocker(); } }} />
              <button type="button" className={secondary} onClick={addBlocker}><Plus className="h-4 w-4" /> Add</button>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className={primary} onClick={() => onComplete(run.id)}><CheckCircle2 className="h-4 w-4" /> Complete</button>
            <button className={danger} onClick={() => onBlock(run.id)}><AlertTriangle className="h-4 w-4" /> Mark blocked</button>
            <button className={secondary} onClick={() => onSkip(run.id)}><SkipForward className="h-4 w-4" /> Skip</button>
          </div>
        </div>
      )}
    </div>
  );
}