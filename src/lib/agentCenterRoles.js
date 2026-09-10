export const ROLE_DETAILS = {
  manager_agent: {
    does: "Central private coordinator. Synthesizes status across every branch, enforces routing policy, and escalates consequential or unknown work to the owner.",
    pulls: "Live status from every branch and the owner escalation queue.",
    sends: "Owner decisions and routing directions. Performs no direct external execution.",
    reportsTo: "Gabriel Fronk (owner)",
    nextHandoff: "Owner decision queue",
  },
  calendar_coordinator: {
    does: "Reconciles calendar events with field-report evidence and updates report status and audit outcomes.",
    pulls: "ProBuild photos, notes and field-report evidence; Sales Tracker customer, order, OE/PO and ETA data.",
    sends: "CalendarEvents report_status, audit results and compliance flags.",
    reportsTo: "Glass Forge manager",
    nextHandoff: "Manager (compliance status) → Invoicing",
  },
  probuild_reporting: {
    does: "Ingests Probuild field reports — photos, notes, man-hours and trip charges — and matches them to scheduled events.",
    pulls: "Probuild posts and attachments for each jobsite.",
    sends: "FieldReports and field-report evidence upward to Calendar coordinator.",
    reportsTo: "Calendar coordinator",
    nextHandoff: "Calendar coordinator (photos, notes & field-report evidence)",
  },
  sales_tracker_agent: {
    does: "Tracks sales, customer orders and delivery ETA, verifying OE/PO and order status.",
    pulls: "Sales tracker data, order and ETA records.",
    sends: "Customer, order, OE/PO and ETA verification feed into Calendar coordinator.",
    reportsTo: "Glass Forge manager",
    nextHandoff: "Calendar coordinator (verification feed)",
  },
  codex_development: {
    does: "Builds and maintains the app, integrations and automations; nests external AI and plan-quoting agents beneath it.",
    pulls: "Codebase, integration status, and results from nested agents.",
    sends: "Features, fixes and approved results up to the manager.",
    reportsTo: "Glass Forge manager",
    nextHandoff: "Manager (escalations & approved results)",
  },
  external_claude_agents: {
    does: "External AI integration for quote and plan processing through secure connectors.",
    pulls: "Quote requests and plan data through approved bridges.",
    sends: "Processed results and escalations up to Glass Forge development.",
    reportsTo: "Glass Forge development",
    nextHandoff: "Glass Forge development → Manager",
  },
  construction_plan_quoting: {
    does: "Performs plan takeoff and drafts window quotes from plan sets.",
    pulls: "Plan PDFs and takeoff data from the plans inbox.",
    sends: "Quote drafts and results up to Glass Forge development.",
    reportsTo: "Glass Forge development",
    nextHandoff: "Glass Forge development → Manager",
  },
  mac_manager: {
    does: "Interactive manager workspace and operations support branch for the owner.",
    pulls: "Manager decisions and live status.",
    sends: "Manager workspace state and action routing.",
    reportsTo: "Glass Forge manager",
    nextHandoff: "Manager",
  },
};

// Group → members. A member may nest children and carry a crossLink (directional data flow)
// or a childLink label (label on the solid parent-child line).
export const ORG_TREE = [
  {
    id: "operations",
    label: "Operations",
    members: [
      { id: "calendar_coordinator", childLink: "ProBuild reporting → Calendar coordinator: Photos, notes & field-report evidence", children: [{ id: "probuild_reporting" }] },
      { id: "sales_tracker_agent", crossLink: { to: "calendar_coordinator", label: "Customer · order · OE/PO · ETA verification" } },
    ],
  },
  {
    id: "product_engineering",
    label: "Product Engineering",
    members: [
      {
        id: "codex_development",
        children: [
          { id: "external_claude_agents", crossLink: { to: "manager_agent", label: "Escalations & approved results" } },
          { id: "construction_plan_quoting", crossLink: { to: "manager_agent", label: "Escalations & approved results" } },
        ],
      },
    ],
  },
  {
    id: "support",
    label: "Support",
    members: [{ id: "mac_manager" }],
  },
];