import { DAILY_PLANS, ORG_TREE, STATIC_NODES } from "./agentCenterRoles";

const KEY = "glassforge_agent_daily_runs_v1";

// Connector-backed actions each lead could one day perform. Disabled today — shown as planned.
export const PLANNED_ACTIONS = {
  calendar_ops_lead: ["Pull calendar event status (Google Calendar)", "Re-run field-report audit"],
  sales_order_lead: ["Pull sales tracker orders", "Verify OE/PO against open orders"],
  field_reporting_lead: ["Pull Probuild field reports", "Match reports to scheduled events"],
  quoting_lead: ["Run plan takeoff", "Process External Claude quote request"],
  development_lead: ["Check integration health", "Run ingest sync"],
};

export const SECTION_LEADS = ORG_TREE.sections.map(s => {
  const node = STATIC_NODES[s.leadId];
  return { id: s.leadId, label: s.label, name: node.name, department: node.department, plan: DAILY_PLANS[s.leadId] || [] };
});

export function loadRuns() {
  try { return JSON.parse(localStorage.getItem(KEY) || "[]"); } catch { return []; }
}
export function saveRuns(runs) {
  try { localStorage.setItem(KEY, JSON.stringify(runs)); } catch { /* ignore */ }
}
export function newRun(leadId) {
  const lead = SECTION_LEADS.find(l => l.id === leadId);
  return {
    id: crypto.randomUUID(),
    leadId,
    leadName: lead?.name || leadId,
    state: "running",
    startedAt: new Date().toISOString(),
    completedAt: null,
    summary: "",
    blockers: [],
    plan: lead?.plan || [],
    actions: [],
  };
}
export const formatTime = iso => iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";