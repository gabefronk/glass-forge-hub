// Purchase orders are owner-only: same admin-role + email check as isAgentCenterOwner,
// narrowed to the single owner login.
const PURCHASE_ORDER_OWNER_EMAILS = new Set(["gabefronk@gmail.com", "gabriel.fronk.wd@gmail.com"]);
export const isPurchaseOrderOwner = user => user?.role === "admin" && PURCHASE_ORDER_OWNER_EMAILS.has(String(user.email || "").trim().toLowerCase());
