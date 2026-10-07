// Owner-id gate for the unified Purchasing page and its money entity.
// Binds by auth user id (base44.auth.me().id), never role or email. Reuses
// the single source of truth for the owner ids from ownerAccess. Server
// twin: base44/shared/purchasingMoneyPure.js OWNER_IDS (kept in sync).
import { EMAIL_OWNER_IDS } from './ownerAccess.js';

export const isPurchasingMoneyOwner = (user) => !!user && EMAIL_OWNER_IDS.has(user.id);