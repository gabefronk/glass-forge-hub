// Static (documentation-only) organizational roles — no live provider data.
export const STATIC_NODES = {
  operations_director: { id: "operations_director", name: "Operations Director", department: "Executive", assignment: "Receives only daily section summaries, blockers, and decision requests. Does not perform external actions.", connection: "documentation", static: true },
  calendar_ops_lead: { id: "calendar_ops_lead", name: "Calendar Operations Lead", department: "Operations · Lead", assignment: "Owns calendar and report-status reconciliation. Reports a daily section summary to the Glass Forge manager.", connection: "documentation", static: true },
  sales_order_lead: { id: "sales_order_lead", name: "Sales & Order Lead", department: "Operations · Lead", assignment: "Owns sales, order, OE/PO and ETA verification. Reports a daily section summary to the Glass Forge manager.", connection: "documentation", static: true },
  field_reporting_lead: { id: "field_reporting_lead", name: "Field Reporting Lead", department: "Operations · Lead", assignment: "Owns Probuild field-report ingestion and evidence handoffs. Reports a daily section summary to the Glass Forge manager.", connection: "documentation", static: true },
  quoting_lead: { id: "quoting_lead", name: "Quoting Lead", department: "Product Engineering · Lead", assignment: "Owns plan takeoff, window quoting, and external AI results. Reports a daily section summary to the Glass Forge manager.", connection: "documentation", static: true },
  development_lead: { id: "development_lead", name: "Development Lead", department: "Product Engineering · Lead", assignment: "Owns the app, integrations, and automations. Reports a daily section summary to the Glass Forge manager.", connection: "documentation", static: true },
};

export const ROLE_DETAILS = {
  probuild_ipad_capture: {does:"Design only: collect prior-day ProBuild notes and photos from a verified iPad.",pulls:"Planned verified iPad surface; source event links, notes and photos.",sends:"Planned single dated review email; recipient unverified and sending disabled.",reportsTo:"Field Reporting Lead",nextHandoff:"Owner verification of iPad and Gmail recipient"},
  operations_director: {
    does: "Executive oversight. Receives daily section summaries, blockers, and decision requests only.",
    pulls: "Exception-only combined summary from the Glass Forge manager.",
    sends: "Owner escalations when a decision is needed. Performs no external actions.",
    reportsTo: "Owner (Gabriel Fronk)",
    nextHandoff: "Owner escalation queue",
  },
  manager_agent: {
    does: "Central private coordinator. Synthesizes status across every branch, enforces routing policy, and escalates consequential or unknown work.",
    pulls: "Daily section summaries from each lead; owner escalation queue.",
    sends: "Exception-only combined summary to the Operations Director; routing decisions to leads.",
    reportsTo: "Operations Director",
    nextHandoff: "Operations Director (exception summary) → Owner",
  },
  calendar_ops_lead: {
    does: "Owns calendar and report-status reconciliation across the section.",
    pulls: "Reconciled status from Calendar coordinator; compliance flags.",
    sends: "Daily section summary to the Glass Forge manager.",
    reportsTo: "Glass Forge manager",
    nextHandoff: "Glass Forge manager (daily section summary)",
  },
  sales_order_lead: {
    does: "Owns sales, customer orders, OE/PO and ETA verification.",
    pulls: "Verification feed from the Sales Tracker agent.",
    sends: "Daily section summary to the Glass Forge manager.",
    reportsTo: "Glass Forge manager",
    nextHandoff: "Glass Forge manager (daily section summary)",
  },
  field_reporting_lead: {
    does: "Owns Probuild field-report ingestion and evidence handoffs.",
    pulls: "Field reports and evidence from ProBuild reporting.",
    sends: "Daily section summary to the Glass Forge manager.",
    reportsTo: "Glass Forge manager",
    nextHandoff: "Glass Forge manager (daily section summary)",
  },
  quoting_lead: {
    does: "Owns plan takeoff, window quoting, and external AI results.",
    pulls: "Quote drafts from Construction Plan Quoting; results from External Claude agents.",
    sends: "Daily section summary to the Glass Forge manager.",
    reportsTo: "Glass Forge manager",
    nextHandoff: "Glass Forge manager (daily section summary)",
  },
  development_lead: {
    does: "Owns the app, integrations, and automations.",
    pulls: "Status and results from Glass Forge development.",
    sends: "Daily section summary to the Glass Forge manager.",
    reportsTo: "Glass Forge manager",
    nextHandoff: "Glass Forge manager (daily section summary)",
  },
  calendar_coordinator: {
    does: "Reconciles calendar events with field-report evidence and updates report status and audit outcomes.",
    pulls: "ProBuild photos, notes and field-report evidence; Sales Tracker customer, order, OE/PO and ETA data.",
    sends: "CalendarEvents report_status, audit results and compliance flags.",
    reportsTo: "Calendar Operations Lead",
    nextHandoff: "Calendar Operations Lead (reconciled status)",
  },
  probuild_reporting: {
    does: "Ingests Probuild field reports — photos, notes, man-hours and trip charges — and matches them to scheduled events.",
    pulls: "Probuild posts and attachments for each jobsite.",
    sends: "FieldReports and field-report evidence to Calendar coordinator.",
    reportsTo: "Field Reporting Lead",
    nextHandoff: "Calendar coordinator (photos, notes & field-report evidence)",
  },
  sales_tracker_agent: {
    does: "Tracks sales, customer orders and delivery ETA, verifying OE/PO and order status.",
    pulls: "Sales tracker data, order and ETA records.",
    sends: "Customer, order, OE/PO and ETA verification feed into Calendar coordinator.",
    reportsTo: "Sales & Order Lead",
    nextHandoff: "Calendar coordinator (verification feed)",
  },
  construction_plan_quoting: {
    does: "Performs plan takeoff and drafts window quotes from plan sets.",
    pulls: "Plan PDFs and takeoff data from the plans inbox.",
    sends: "Quote drafts and results to the Quoting Lead; escalations & approved results to the manager.",
    reportsTo: "Quoting Lead",
    nextHandoff: "Quoting Lead → manager (escalations & approved results)",
  },
  external_claude_agents: {
    does: "External AI integration for quote and plan processing through secure connectors.",
    pulls: "Quote requests and plan data through approved bridges.",
    sends: "Processed results and escalations to the Quoting Lead; escalations & approved results to the manager.",
    reportsTo: "Quoting Lead",
    nextHandoff: "Quoting Lead → manager (escalations & approved results)",
  },
  codex_development: {
    does: "Builds and maintains the app, integrations and automations.",
    pulls: "Codebase, integration status, and results from nested agents.",
    sends: "Features, fixes and approved results up to the Development Lead.",
    reportsTo: "Development Lead",
    nextHandoff: "Development Lead → manager",
  },
  mac_manager: {
    does: "Interactive manager workspace and operations support branch for the owner.",
    pulls: "Manager decisions and live status.",
    sends: "Manager workspace state and action routing.",
    reportsTo: "Glass Forge manager",
    nextHandoff: "Glass Forge manager",
  },
};

// Four-phase daily operating plan per role: Review → Reconcile/produce → Record → Escalate.
export const DAILY_PLANS = {
  probuild_ipad_capture: [
    {phase:"Review — disabled",task:"Verify iPad, ProBuild account and exact Gmail recipient before enabling any run. Use the prior local calendar day cutoff."},
    {phase:"Collect / draft — planned",task:"Collect complete notes and all photos; deduplicate event/asset identities; assemble one dated job-by-job review email."},
    {phase:"Record — planned",task:"Persist source links, counts, failures, draft/send states and unique run identity. Reconcile uncertain sends before retrying."},
    {phase:"Escalate — planned",task:"Queue missing data, unavailable device, unverified recipient and uncertain sends. No scheduler or device automation is enabled."}
  ],
  operations_director: [
    { phase: "Review", task: "Receive the exception-only combined summary from the Glass Forge manager." },
    { phase: "Reconcile / produce", task: "Identify blockers and decision requests across all sections." },
    { phase: "Record", task: "Log decisions and owner escalations." },
    { phase: "Escalate", task: "Create an owner escalation when a decision is needed." },
  ],
  manager_agent: [
    { phase: "Review", task: "Collect daily section summaries from each lead." },
    { phase: "Reconcile / produce", task: "Combine into an exception-only summary for the Operations Director." },
    { phase: "Record", task: "Synthesize status and routing decisions." },
    { phase: "Escalate", task: "Forward consequential or unknown work to the Operations Director." },
  ],
  calendar_ops_lead: [
    { phase: "Review", task: "Review Calendar coordinator's reconciled event and report status." },
    { phase: "Reconcile / produce", task: "Confirm calendar and report-status updates are complete." },
    { phase: "Record", task: "Send a daily section summary to the Glass Forge manager." },
    { phase: "Escalate", task: "Flag unresolved compliance or scheduling blockers." },
  ],
  sales_order_lead: [
    { phase: "Review", task: "Review Sales Tracker order, ETA, and OE/PO verification feed." },
    { phase: "Reconcile / produce", task: "Confirm customer and order verification against the calendar." },
    { phase: "Record", task: "Send a daily section summary to the Glass Forge manager." },
    { phase: "Escalate", task: "Flag unverified orders or ETA slips." },
  ],
  field_reporting_lead: [
    { phase: "Review", task: "Review ProBuild field reports — photos, notes, man-hours." },
    { phase: "Reconcile / produce", task: "Confirm evidence handoff to Calendar coordinator is complete." },
    { phase: "Record", task: "Send a daily section summary to the Glass Forge manager." },
    { phase: "Escalate", task: "Flag missing or incomplete field reports." },
  ],
  quoting_lead: [
    { phase: "Review", task: "Review Construction Plan Quoting takeoffs and External Claude results." },
    { phase: "Reconcile / produce", task: "Confirm quote drafts and escalations are ready." },
    { phase: "Record", task: "Send a daily section summary to the Glass Forge manager." },
    { phase: "Escalate", task: "Flag product review or pricing blockers." },
  ],
  development_lead: [
    { phase: "Review", task: "Review Glass Forge development status and integration health." },
    { phase: "Reconcile / produce", task: "Confirm features, fixes, and approved results." },
    { phase: "Record", task: "Send a daily section summary to the Glass Forge manager." },
    { phase: "Escalate", task: "Flag build or integration failures." },
  ],
  calendar_coordinator: [
    { phase: "Review", task: "Review ProBuild evidence and Sales Tracker verification feed." },
    { phase: "Reconcile / produce", task: "Update CalendarEvents report_status and audit results." },
    { phase: "Record", task: "Report reconciled status to the Calendar Operations Lead." },
    { phase: "Escalate", task: "Flag unmatched events or compliance failures." },
  ],
  probuild_reporting: [
    { phase: "Review", task: "Review Probuild posts and attachments for each jobsite." },
    { phase: "Reconcile / produce", task: "Match reports to scheduled events." },
    { phase: "Record", task: "Send photos, notes, and field-report evidence to Calendar coordinator." },
    { phase: "Escalate", task: "Flag missing reports or match failures." },
  ],
  sales_tracker_agent: [
    { phase: "Review", task: "Review sales tracker data, order, and ETA records." },
    { phase: "Reconcile / produce", task: "Verify OE/PO and order status." },
    { phase: "Record", task: "Send customer/order/OE-PO/ETA verification to Calendar coordinator." },
    { phase: "Escalate", task: "Flag unverified or slipped orders." },
  ],
  construction_plan_quoting: [
    { phase: "Review", task: "Review plan PDFs and takeoff data from the plans inbox." },
    { phase: "Reconcile / produce", task: "Draft window quotes from plan sets." },
    { phase: "Record", task: "Send quote drafts and results to the Quoting Lead." },
    { phase: "Escalate", task: "Flag product review or pricing blockers to the Quoting Lead." },
  ],
  external_claude_agents: [
    { phase: "Review", task: "Review quote requests and plan data via approved bridges." },
    { phase: "Reconcile / produce", task: "Process quotes and plans through external AI." },
    { phase: "Record", task: "Send processed results to the Quoting Lead." },
    { phase: "Escalate", task: "Flag failures or unavailable products to the Quoting Lead." },
  ],
  codex_development: [
    { phase: "Review", task: "Review codebase, integration status, and nested agent results." },
    { phase: "Reconcile / produce", task: "Build and maintain features, fixes, and automations." },
    { phase: "Record", task: "Send approved results to the Development Lead." },
    { phase: "Escalate", task: "Flag build or integration failures to the Development Lead." },
  ],
  mac_manager: [
    { phase: "Review", task: "Review manager decisions and live status." },
    { phase: "Reconcile / produce", task: "Route manager workspace actions." },
    { phase: "Record", task: "Reflect workspace state for the owner." },
    { phase: "Escalate", task: "Flag workspace or action-routing issues to the Glass Forge manager." },
  ],
};

// Three-level hierarchy: Director → Manager → Section leads (with specialists) + direct support.
export const ORG_TREE = {
  directorId: "operations_director",
  managerId: "manager_agent",
  directorToManagerLabel: "Exception-only combined summary",
  sections: [
    { leadId: "calendar_ops_lead", label: "Calendar Operations", leadToManagerLabel: "Daily section summary", members: [{ id: "calendar_coordinator" }] },
    { leadId: "sales_order_lead", label: "Sales & Order", leadToManagerLabel: "Daily section summary", members: [{ id: "sales_tracker_agent", crossLink: { to: "calendar_coordinator", label: "Customer · order · OE/PO · ETA verification" } }] },
    { leadId: "field_reporting_lead", label: "Field Reporting", leadToManagerLabel: "Daily section summary", members: [{ id: "probuild_reporting", crossLink: { to: "calendar_coordinator", label: "Photos, notes & field-report evidence" } }, { id: "probuild_ipad_capture", crossLink: { to: "manager_agent", label: "Planned review email and exception queue · disabled" } }] },
    { leadId: "quoting_lead", label: "Quoting", leadToManagerLabel: "Daily section summary", members: [
      { id: "construction_plan_quoting", crossLink: { to: "manager_agent", label: "Escalations & approved results" } },
      { id: "external_claude_agents", crossLink: { to: "manager_agent", label: "Escalations & approved results" } },
    ] },
    { leadId: "development_lead", label: "Development", leadToManagerLabel: "Daily section summary", members: [{ id: "codex_development" }] },
  ],
  directSupport: [{ id: "mac_manager" }, { id: "message_service_assistant" }],
};