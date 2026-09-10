export const agentMascots = {
  manager_agent: { src: "https://media.base44.com/images/public/6a7f0d7a4a5f825c724273e9/7c9804d80_glass-forge-manager-portrait.jpg", alt: "Glass Forge manager portrait" },
  construction_plan_quoting: { src: "/agent-mascots/construction-plan-quoting-portrait.jpg", alt: "Professional construction plan quoting portrait" },
  calendar_coordinator: { src: "/agent-mascots/calendar-field-reports-portrait.jpg", alt: "Professional calendar and field reports portrait" },
  probuild_reporting: { src: "/agent-mascots/calendar-field-reports-portrait.jpg", alt: "Professional field reports portrait" },
  sales_tracker_agent: { src: "/agent-mascots/sales-data-portrait.jpg", alt: "Professional sales and data portrait" },
  codex_development: { src: "/agent-mascots/integrations-automation-portrait.jpg", alt: "Professional integrations and automation portrait" },
  mac_manager: { src: "/agent-mascots/integrations-automation-portrait.jpg", alt: "Professional operations workspace portrait" },
  external_claude_agents: { src: "/agent-mascots/integrations-automation-portrait.jpg", alt: "Professional external AI integration portrait" }
};
export const agentMascotFor = id => agentMascots[id] || { src: "/agent-mascots/default-agent.png", alt: "Friendly agent mascot" };