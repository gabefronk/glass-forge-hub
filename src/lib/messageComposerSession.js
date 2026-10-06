// In-memory (tab session) store of the frozen send plan + lock per owner+conversation.
// The composer is keyed by user+conversation and remounts on switch; keeping the plan and
// lock here means switching away and back cannot clear a lock or forget which steps were sent.
// Not persisted across reloads; the server-side ledger remains the source of truth.
const sessions = new Map();

export const sessionKey = (ownerId, conversationKey) => `${ownerId || ''}|${conversationKey || ''}`;

export function readSession(key) {
  return sessions.get(key) || { plan: null, locked: false, error: '' };
}

export function writeSession(key, patch) {
  const next = { ...readSession(key), ...patch };
  sessions.set(key, next);
  return next;
}

export function clearSession(key) {
  sessions.delete(key);
}