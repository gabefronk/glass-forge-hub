import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { base44 } from "@/api/base44Client";
import { SECTION_LEADS, DEFAULT_ENABLEMENT, nextRunDate } from "@/lib/agentDailyRuns";
import AutonomousBanner from "./AutonomousBanner";
import LeadEnablementCard from "./LeadEnablementCard";
import ExceptionSummary from "./ExceptionSummary";
import RunAuditTrail from "./RunAuditTrail";

export default function DailyRunsPanel() {
  const client = useQueryClient();
  const [busy, setBusy] = useState("");
  const configQuery = useQuery({ queryKey: ["agentOpsConfig"], queryFn: async () => (await base44.entities.AgentOpsConfig.filter({ config_key: "autonomous_ops" }, "-updated_date", 1))[0] || null, refetchInterval: 20000 });
  const runsQuery = useQuery({ queryKey: ["agentDailyRuns"], queryFn: async () => base44.entities.AgentDailyRun.list("-started_at", 50), refetchInterval: 20000 });
  const config = configQuery.data || null;
  const runs = runsQuery.data || [];

  const refetch = () => { client.invalidateQueries({ queryKey: ["agentOpsConfig"] }); client.invalidateQueries({ queryKey: ["agentDailyRuns"] }); };
  const enabled = config?.autonomous_enabled !== false;
  const paused = config?.paused === true;
  const enablement = config?.lead_enablement || DEFAULT_ENABLEMENT;
  const scheduledTime = config?.scheduled_time || "07:00";

  const saveConfig = async patch => {
    setBusy("config");
    try {
      if (config) await base44.entities.AgentOpsConfig.update(config.id, patch);
      else await base44.entities.AgentOpsConfig.create({ config_key: "autonomous_ops", autonomous_enabled: true, paused: false, lead_enablement: DEFAULT_ENABLEMENT, scheduled_time: "07:00", ...patch });
      await refetch();
    } finally { setBusy(""); }
  };
  const togglePause = () => saveConfig({ paused: !paused });
  const toggleLead = id => saveConfig({ lead_enablement: { ...enablement, [id]: enablement[id] === false ? true : false } });
  const runAll = async () => { setBusy("all"); try { await base44.functions.invoke("runDailyOperations", { triggered_by: "manual" }); await refetch(); } finally { setBusy(""); } };
  const runOne = async id => { setBusy(id); try { await base44.functions.invoke("runDailyOperations", { triggered_by: "manual", lead_id: id }); await refetch(); } finally { setBusy(""); } };

  const lastRunFor = id => runs.find(r => r.lead_id === id);

  return (
    <section className="rounded-2xl border border-[#DDE3EC] bg-white p-5 sm:p-6">
      <div className="mb-4">
        <h2 className="text-lg font-semibold">Daily Runs</h2>
        <p className="mt-1 max-w-3xl text-sm text-slate-600">Autonomous operations start all enabled section-lead runs each morning at 07:00 MT. Each lead reconciles internal status, records a summary, and updates run records without per-run approval. The Glass Forge manager escalates only true exceptions to the owner.</p>
      </div>
      <AutonomousBanner enabled={enabled} paused={paused} nextRun={nextRunDate(scheduledTime)} lastRunAt={config?.last_run_at} busy={busy} onTogglePause={togglePause} onRunAll={runAll} />
      <div className="mt-5 grid gap-4 lg:grid-cols-2">
        {SECTION_LEADS.map(lead => (
          <LeadEnablementCard key={lead.id} lead={lead} enabled={enablement[lead.id] !== false} lastRun={lastRunFor(lead.id)} busy={busy} onToggle={() => toggleLead(lead.id)} onRunNow={() => runOne(lead.id)} />
        ))}
      </div>
      <div className="mt-5 space-y-4">
        <ExceptionSummary runs={runs} />
        <RunAuditTrail runs={runs} />
      </div>
    </section>
  );
}