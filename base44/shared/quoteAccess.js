// Immutable auth user ids granted full quoting access (Pella + dealer cost internals)
// without an admin/manager role. Bound by base44.auth.me().id — never request payload or names.
// Frontend twin: src/lib/quoteAccess.js (kept in sync manually; src/ cannot import base44/shared).
export const QUOTE_FULL_ACCESS_IDS = new Set([
  '6aa38008aeff51ae779a0b3c', // Jeremy Burr (burrcobuilders@gmail.com)
  '6a9f1c6b0c0b0a503245bcd6', // Israel Yedra (iryedra@gmail.com)
]);
export const canQuoteFull = (user) => !!user && QUOTE_FULL_ACCESS_IDS.has(user.id);