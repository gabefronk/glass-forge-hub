// Immutable auth user ids that own email/tax content. Only these ids may read or mutate
// mailbox content (bodies, metadata, attachments, drafts, tax rows). Bound by
// base44.auth.me().id — never email (mutable) or names. Admin-only is NOT enough: multiple
// users are admin. Server twin: base44/shared/emailAgent.js OWNER_IDS (kept in sync manually).
export const EMAIL_OWNER_IDS = new Set([
  '6a7f0d834a5f825c724273ea', // Gabriel (gabefronk@gmail.com)
  '6a8229a9801b2aef9278ff47', // Gabriel (gabriel.fronk.wd@gmail.com)
]);
export const isEmailOwner = (user) => !!user && EMAIL_OWNER_IDS.has(user.id);