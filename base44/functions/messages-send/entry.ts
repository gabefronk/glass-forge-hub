import {createClientFromRequest} from 'npm:@base44/sdk@0.8.48';
import {createMessagesSendHandler, DisabledDispatchAdapter} from '../../shared/messagesDispatch.js';

// PRODUCTION FAIL-CLOSED. Sending is hard-disabled: Base44 offers no atomic unique-claim
// primitive, so exactly-once dispatch cannot be guaranteed. We ship disabled rather than fake
// safety with list-then-create, a process-local Map, or a presumed-unique entity field. No
// provider call, no secret read, no file fetch, no registration store. Every action (including
// register_upload) returns 502 'disabled' until `enabled` is flipped AND a proven atomic adapter
// AND a real registration store are wired. Until then nothing runs.
const enabled = false;

// Never reached while enabled=false. Resolves the persisted BlueBubbles chatGuid from
// MessageConversation.source_chat_guid, bound to the configured send device
// (BLUEBUBBLES_DEVICE_ID). A GUID from any other paired device is refused.
async function resolveMapping(client, conversation_key) {
  const row = (await client.asServiceRole.entities.MessageConversation.filter({conversation_key}, '-created_date', 1))[0];
  if (!row || !row.source_chat_guid) return null;
  let configuredDeviceId = '';
  try { configuredDeviceId = (Deno.env.get('BLUEBUBBLES_DEVICE_ID') || '').trim(); } catch { configuredDeviceId = ''; }
  return {chatGuid: row.source_chat_guid, device_id: row.device_id || '', configuredDeviceId};
}

Deno.serve(createMessagesSendHandler({
  getClient: createClientFromRequest,
  adapter: DisabledDispatchAdapter,
  enabled,
  resolveMapping,
}));