export const TEAM_PROFILES = {
  gabe: {
    names: ["gabe fronk", "gabriel fronk", "gabe", "gabriel"],
    emails: ["gabefronk@gmail.com", "gabriel.fronk.wd@gmail.com"],
    title: "Sales, Growth & Business Systems",
    focus: ["Glass Forge Hub development", "Amsco ordering automation", "Repeatable quoting and ordering systems"]
  },
  mylan: {
    names: ["milan fronk", "mylan fronk", "milan", "mylan"],
    emails: ["milanfronk@gmail.com"],
    title: "Project Delivery & Commercial Development",
    focus: ["Commercial/storefront development", "Commercial estimating", "Cutting & glazing processes"]
  },
  jeremy: {
    names: ["jeremy burr", "jeremy"],
    emails: ["burrcobuilders@gmail.com"],
    title: "Sales, Business Development & New Markets",
    focus: ["Glass railing systems", "St. George expansion", "New product playbooks"]
  },
  israel: {
    names: ["israel yedra", "israel"],
    emails: ["iryedra@gmail.com"],
    title: "Install & Service Operations",
    focus: ["Shower systems", "Specialty field processes", "Field execution development"]
  },
  yelian: {
    names: ["yelian"],
    emails: [],
    title: "Install & Service Operations",
    focus: ["Installation standards", "Crew development", "Quality-control systems"]
  },
  toma: {
    names: ["toma"],
    emails: [],
    title: "Shower Glass Estimating",
    focus: ["Repeatable shower quoting standards"]
  },
  trevor: {
    names: ["trevor draney", "trevor zelney", "trevor"],
    emails: ["trevor.draney7@gmail.com"],
    title: "Systems, IT & Process Development",
    focus: ["Hub development", "Automation", "Turn recurring bottlenecks into scalable tools"]
  }
};

export function teamProfileForUser(user) {
  if (!user) return null;
  const email = String(user.email || "").trim().toLowerCase();
  const name = String(user.full_name || "").trim().toLowerCase();
  return Object.values(TEAM_PROFILES).find((profile) =>
    profile.emails.includes(email) || profile.names.includes(name)
  ) || null;
}