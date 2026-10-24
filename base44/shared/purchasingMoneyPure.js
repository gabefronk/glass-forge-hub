// Owner-id guard shared by the purchasing backends (procurementService,
// purchasingQuoteIngest, customerCollections, etaCalendar). No I/O, no SDK.
// (The file keeps its old name; the purchasingMoney endpoint and its JobMoneyInputs
// table it was written for were retired Oct 24 - the budget holds job money now.)
//
// Owner binding is by immutable auth user id (base44.auth.me().id), never
// role or email. Admin-only is NOT enough: multiple users are admin.
// Frontend twin: src/lib/purchasingMoneyAccess.js (reuses ownerAccess ids).
export const OWNER_IDS = new Set([
  '6a7f0d834a5f825c724273ea',
  '6a8229a9801b2aef9278ff47',
]);

export const isPurchasingMoneyOwner = (user) => !!user && typeof user.id === 'string' && OWNER_IDS.has(user.id);

// Base44 record ids are 24 lowercase hex characters. Exact ids only.
export const isEntityId = (v) => typeof v === 'string' && /^[a-f0-9]{24}$/.test(v);
