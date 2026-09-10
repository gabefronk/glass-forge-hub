export const agentMascots = {
  manager_agent: { src: "https://media.base44.com/images/public/6a7f0d7a4a5f825c724273e9/7c9804d80_glass-forge-manager-portrait.jpg", alt: "Glass Forge manager portrait" },
  sales_tracker_agent: { src: "https://media.base44.com/images/public/6a7f0d7a4a5f825c724273e9/305d8af67_generated_image.png", alt: "Sales Tracker agent portrait" },
  calendar_coordinator: { src: "https://media.base44.com/images/public/6a7f0d7a4a5f825c724273e9/3ac64f3e7_generated_image.png", alt: "Calendar coordinator portrait" },
  probuild_reporting: { src: "https://media.base44.com/images/public/6a7f0d7a4a5f825c724273e9/c62a4123a_generated_image.png", alt: "ProBuild field reporting portrait" },
  codex_development: { src: "https://media.base44.com/images/public/6a7f0d7a4a5f825c724273e9/a50273b92_generated_image.png", alt: "Glass Forge development portrait" },
  mac_manager: { src: "https://media.base44.com/images/public/6a7f0d7a4a5f825c724273e9/b80102340_generated_image.png", alt: "MacBook manager workspace portrait" },
  external_claude_agents: { src: "https://media.base44.com/images/public/6a7f0d7a4a5f825c724273e9/12de8c871_generated_image.png", alt: "External Claude agents portrait" },
  construction_plan_quoting: { src: "https://media.base44.com/images/public/6a7f0d7a4a5f825c724273e9/5db1fe840_generated_image.png", alt: "Construction plan quoting portrait" }
};
export const agentMascotFor = id => agentMascots[id] || { src: "/agent-mascots/default-agent.png", alt: "Friendly agent mascot" };