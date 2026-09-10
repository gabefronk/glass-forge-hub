export const isAgentCenterOwner = user => user?.role === "admin" && String(user.email || "").trim().toLowerCase() === "gabefronk@gmail.com";
