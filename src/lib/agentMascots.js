export const agentMascots = {
  manager_agent: { src: "/agent-mascots/manager-agent.png", alt: "Friendly operations manager mascot" },
  construction_plan_quoting: { src: "/agent-mascots/construction-plan-quoting.png", alt: "Friendly construction plan quoting mascot" },
  calendar_coordinator: { src: "/agent-mascots/calendar-field-reports.png", alt: "Friendly calendar and field reports mascot" },
  probuild_reporting: { src: "/agent-mascots/calendar-field-reports.png", alt: "Friendly field reports mascot" },
  sales_tracker_agent: { src: "/agent-mascots/sales-data.png", alt: "Friendly sales and data mascot" },
  codex_development: { src: "/agent-mascots/integrations-automation.png", alt: "Friendly integrations and automation mascot" },
  mac_manager: { src: "/agent-mascots/integrations-automation.png", alt: "Friendly operations workspace mascot" },
  external_claude_agents: { src: "/agent-mascots/integrations-automation.png", alt: "Friendly external AI integration mascot" }
};
export const agentMascotFor = id => agentMascots[id] || { src: "/agent-mascots/default-agent.png", alt: "Friendly agent mascot" };