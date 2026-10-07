// Immutable auth user ids that own email/tax content. Only these ids may read or mutate
// mailbox content (bodies, metadata, attachments, drafts, tax rows). Bound by
// base44.auth.me().id — never email (mutable) or names. Admin-only is NOT enough: multiple
// users are admin. Server twin: base44/shared/emailAgent.js OWNER_IDS (kept in sync manually).
export const EMAIL_OWNER_IDS = new Set([
  '6a7f0d834a5f825c724273ea', // Gabriel (gabefronk@gmail.com)
  '6a8229a9801b2aef9278ff47', // Gabriel (gabriel.fronk.wd@gmail.com)
]);
export const isEmailOwner = (user) => !!user && EMAIL_OWNER_IDS.has(user.id);

// Owner-only inline text correction on job history cards (crew field-report
// message + job-note body). Same immutable Gabriel ids as email ownership —
// admin role alone is NOT enough (multiple admins). Server twin:
// base44/shared/historyEdit.js HISTORY_EDIT_OWNER_IDS (kept in sync manually).
export const HISTORY_EDIT_OWNER_IDS = new Set([
  '6a7f0d834a5f825c724273ea', // Gabriel (gabefronk@gmail.com)
  '6a8229a9801b2aef9278ff47', // Gabriel (gabriel.fronk.wd@gmail.com)
]);
export const canEditHistoryText = (user) => !!user && HISTORY_EDIT_OWNER_IDS.has(user.id);