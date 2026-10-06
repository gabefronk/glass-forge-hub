// SEND guard for the Messages composer: exact owner user ids only (never email or role).
// Mirrors SEND_OWNER_IDS in base44/shared/messagesDispatch.js. The READ guard is unchanged.
export const MESSAGE_SEND_OWNER_IDS = Object.freeze(['6a7f0d834a5f825c724273ea', '6a8229a9801b2aef9278ff47']);

export function isMessageSendOwner(user) {
  return !!user && typeof user.id === 'string' && MESSAGE_SEND_OWNER_IDS.includes(user.id);
}