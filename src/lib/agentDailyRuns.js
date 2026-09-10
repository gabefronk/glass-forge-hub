import { DAILY_PLANS, ORG_TREE, STATIC_NODES } from "./agentCenterRoles";

// Connector-backed routine actions each lead could perform once its connector
// is configured. Disabled until the connector is actually available.
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

export const DEFAULT_ENABLEMENT = Object.fromEntries(SECTION_LEADS.map(l => [l.id, true]));

export const formatTime = iso => iso ? new Date(iso).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "—";

export function nextRunDate(scheduledTime) {
  const [h, m] = String(scheduledTime || "07:00").split(":").map(Number);
  const now = new Date();
  const next = new Date(now);
  next.setHours(h || 7, m || 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next;
}