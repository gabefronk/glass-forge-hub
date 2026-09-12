const AGENT_CENTER_OWNER_EMAILS = new Set(["gabefronk@gmail.com", "gabriel.fronk.wd@gmail.com"]);
export const isAgentCenterOwner = user => user?.role === "admin" && AGENT_CENTER_OWNER_EMAILS.has(String(user.email || "").trim().toLowerCase());
export const canViewAgentCenter = user => isAgentCenterOwner(user) || (user?.role === 'admin' && String(user.email || '').trim().toLowerCase() === 'trevor.draney7@gmail.com');

