import { useEffect, useState } from "react";
import { Lock, Activity } from "lucide-react";
import { SECTION_LEADS, loadRuns, saveRuns, newRun } from "@/lib/agentDailyRuns";
import LeadRunCard from "./LeadRunCard";
import ExceptionSummary from "./ExceptionSummary";
import RunAuditTrail from "./RunAuditTrail";

export default function DailyRunsPanel() {
  const [runs, setRuns] = useState(loadRuns);
  useEffect(() => { saveRuns(runs); }, [runs]);

  const activeFor = leadId => runs.find(r => r.leadId === leadId && ["queued", "running"].includes(r.state));
  const lastFor = leadId => runs
    .filter(r => r.leadId === leadId && !["queued", "running"].includes(r.state))
    .sort((a, b) => (b.completedAt || b.startedAt).localeCompare(a.completedAt || a.startedAt))[0];

  const start = leadId => setRuns(rs => [...rs, newRun(leadId)]);
  const queue = leadId => setRuns(rs => [...rs, { ...newRun(leadId), state: "queued" }]);
  const begin = id => setRuns(rs => rs.map(r => r.id === id ? { ...r, state: "running" } : r));
  const update = (id, patch) => setRuns(rs => rs.map(r => r.id === id ? { ...r, ...patch } : r));
  const finalize = (id, state) => setRuns(rs => rs.map(r => r.id === id ? { ...r, state, completedAt: r.completedAt || new Date().toISOString() } : r));
  const clearAll = () => { if (confirm("Clear the audit trail? This removes all recorded runs.")) setRuns([]); };

  return (
    <section className="rounded-2xl border border-[#DDE3EC] bg-white p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-lg font-semibold"><Activity className="h-5 w-5 text-[#2A5EA8]" />Daily Runs</h2>
          <p className="mt-1 max-w-3xl text-sm text-slate-600">Manually start a read-only daily run for each section lead. Each run follows the lead's existing daily plan and captures a timestamped summary and blocker list. Exceptions combine upward to the Glass Forge manager and Operations Director.</p>
        </div>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-800"><Lock className="h-3.5 w-3.5" /> External actions disabled</span>
      </div>
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        {SECTION_LEADS.map(lead => (
          <LeadRunCard
            key={lead.id}
            lead={lead}
            active={activeFor(lead.id)}
            last={lastFor(lead.id)}
            onStart={() => start(lead.id)}
            onQueue={() => queue(lead.id)}
            onBegin={begin}
            onUpdate={update}
            onComplete={id => finalize(id, "completed")}
            onBlock={id => finalize(id, "blocked")}
            onSkip={id => finalize(id, "skipped")}
          />
        ))}
      </div>
      <div className="mt-5 space-y-4">
        <ExceptionSummary runs={runs} />
        <RunAuditTrail runs={runs} onClear={clearAll} />
      </div>
    </section>
  );
}