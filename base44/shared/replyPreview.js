import { DEFAULT_MODEL, buildReplyRequest, validateReplyPlan } from './replyPlanner.mjs';
import { readPreparedJob } from './jobKnowledgeService.mjs';
import { buildJobReplyFacts } from './jobReplyContext.mjs';
import { MESSAGE_DRAFT_POLICY_VERSION } from './messageDraftPolicy.mjs';
export { MESSAGE_DRAFT_POLICY_VERSION, MESSAGE_DRAFT_GUIDANCE } from './messageDraftPolicy.mjs';
export const REPLY_MODEL = DEFAULT_MODEL;

const previewResult = (body, status = 200) => ({
  status,
  body: { ...body, model: DEFAULT_MODEL, drafting_policy_version: MESSAGE_DRAFT_POLICY_VERSION, preview_only: true, send_enabled: false },
});
const needsOwner = note => previewResult({ plan: {
  decision: 'owner_needed', intent: 'none', reply_text: '', source_message_guids: [],
  owner_note: note, preview_only: true, send_enabled: false,
} });
const snapshot = messages => JSON.stringify(messages.map(m => [
  m.source_guid, m.conversation_key, m.direction, m.text, m.sent_at,
  m.edited_at, m.retracted_at, m.attachments,
]).sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
const route = c => JSON.stringify([c?.conversation_key, c?.source_chat_guid,
  c?.device_id, [...(c?.participants || [])].sort()]);
const fresh = (value, now) => {
  const age = Date.parse(now) - Date.parse(value || '');
  return Number.isFinite(age) && age >= 0 && age <= 300000;
};

// Called only after the owner's session has been authorized. Never sends or writes data.
export async function previewReply({ api, invoke, conversationKey, goal, now, getNow = () => now }) {
  if (typeof conversationKey !== 'string' || !conversationKey || conversationKey.length > 500 ||
      typeof goal !== 'string' || !goal.trim() || goal.length > 1000) {
    return previewResult({ error: 'Select a conversation and describe what you want handled (up to 1,000 characters).' }, 400);
  }
  const convo = (await api.MessageConversation.filter({ conversation_key: conversationKey }, '-created_date', 1))[0];
  if (!convo) return previewResult({ error: 'Conversation not found.' }, 404);
  const [captures, devices, records] = await Promise.all([
    api.MessageAssistantCapture.filter({ conversation_key: conversationKey }, '-created_date', 1),
    api.MessageBridgeDevice.filter({ device_id: convo.device_id }, '-created_date', 1),
    api.MessageRecord.filter({ conversation_key: conversationKey }, '-sent_at', 251),
  ]);
  const capture = captures[0], device = devices[0];
  if (!device?.enabled || !device.source_ok || !fresh(device.last_seen_at, now) || !fresh(capture?.captured_at, now)) {
    return needsOwner('This conversation needs a fresh import from the connected Mac before a reply can be prepared.');
  }
  const messages = records.slice(0, 250);
  const latestDate = Math.max(...messages.map(m => Date.parse(m.sent_at)));
  if (Date.parse(convo.last_message_at || '') > latestDate) {
    return needsOwner('A newer message has arrived. Wait for this conversation to finish importing.');
  }
  const jobPrepared = convo.job_id ? await readPreparedJob({ entities: api }, convo.job_id, now).catch(() => null) : null;
  const jobFacts = buildJobReplyFacts({ conversation: convo, prepared: jobPrepared, now });
  const prepared = buildReplyRequest({
    conversation: convo, messages, now, observed_at: capture.captured_at,
    policy: {
      conversation_key: conversationKey, source_chat_guid: convo.source_chat_guid,
      participants: convo.participants, goal: goal.trim(), style_examples: [], approved_facts: jobFacts.facts,
    },
  });
  if (prepared.preflight_plan) return previewResult({ plan: prepared.preflight_plan });
  const modelResult = await invoke(prepared.request);
  const plan = validateReplyPlan(modelResult, prepared.context);
  // A generation can take time. An owner reply, edit, retraction or recipient change
  // invalidates the preview instead of presenting a reply to an obsolete snapshot.
  const [newConvos, newRecords, newDevices, newestJob] = await Promise.all([
    api.MessageConversation.filter({ conversation_key: conversationKey }, '-created_date', 1),
    api.MessageRecord.filter({ conversation_key: conversationKey }, '-sent_at', 251),
    api.MessageBridgeDevice.filter({ device_id: convo.device_id }, '-created_date', 1),
    convo.job_id ? readPreparedJob({ entities: api }, convo.job_id, getNow()).catch(() => null) : null,
  ]);
  const latestFacts = buildJobReplyFacts({ conversation: newConvos[0], prepared: newestJob, now: getNow() });
  if (route(newConvos[0]) !== route(convo) || snapshot(newRecords.slice(0, 250)) !== snapshot(messages) ||
      newConvos[0]?.job_id !== convo.job_id || (jobFacts.facts.length > 0 &&
        (latestFacts.run_id !== jobFacts.run_id || JSON.stringify(latestFacts.facts) !== JSON.stringify(jobFacts.facts))) ||
      newConvos[0]?.last_message_at !== convo.last_message_at || !newDevices[0]?.enabled || !newDevices[0]?.source_ok ||
      !fresh(newDevices[0]?.last_seen_at, getNow()) || !fresh(capture.captured_at, getNow())) {
    return needsOwner('The conversation or connection changed while preparing this reply. Review the latest messages and try again.');
  }
  return previewResult({ plan, observed_at: capture.captured_at,
    job_context: { job_id: jobFacts.job_id, run_id: jobFacts.run_id, facts_used: jobFacts.facts.length, notes: jobFacts.notes },
    history_complete: capture.history_complete === true && records.length <= 250,
  });
}
