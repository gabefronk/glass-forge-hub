import test from 'node:test';
import assert from 'node:assert/strict';
import { previewReply } from '../base44/shared/replyPreview.js';
import { createMessageAssistantHandler } from '../base44/shared/messageAssistant.js';

const NOW = '2026-09-13T03:30:00.000Z';
const OBSERVED = '2026-09-13T03:29:55.000Z';
const CONVERSATION_KEY = 'test-conversation-1';
const SOURCE_CHAT_GUID = 'iMessage;+;test-chat-1';
const DEVICE_ID = 'test-mac-1';
const PARTICIPANTS = ['+13035550123'];
const GOAL = 'Ask for the project location and approximate size so I can prepare an estimate.';
const OWNER = { role: 'admin', email: 'gabefronk@gmail.com' };

function record(source_guid, direction, text, sent_at) {
  return {
    source_guid, conversation_key: CONVERSATION_KEY, device_id: DEVICE_ID,
    direction, text, sent_at, attachments: [], edited_at: '', retracted_at: '',
  };
}

function draft() {
  return {
    decision: 'reply', intent: 'ask_details',
    reply_text: 'Yeah, what part of town are you in? And about how big is the deck?',
    source_message_guids: ['latest-in'], owner_note: '',
  };
}

function fixture() {
  return {
    MessageConversation: [{
      id: 'conversation-row', conversation_key: CONVERSATION_KEY,
      source_chat_guid: SOURCE_CHAT_GUID, device_id: DEVICE_ID,
      participants: [...PARTICIPANTS], last_message_at: '2026-09-13T03:29:00.000Z',
    }],
    MessageAssistantCapture: [{
      conversation_key: CONVERSATION_KEY, captured_at: OBSERVED,
      history_complete: true, message_count: 3,
    }],
    MessageBridgeDevice: [{
      device_id: DEVICE_ID, enabled: true, source_ok: true, last_seen_at: OBSERVED,
    }],
    MessageAssistantDevice: [],
    MessageRecord: [
      record('latest-in', 'incoming', 'I need help fixing the deck.', '2026-09-13T03:29:00.000Z'),
      record('owner-style', 'outgoing', 'Yeah for sure, send me a little more info.', '2026-09-13T03:20:00.000Z'),
      record('old-in', 'incoming', 'Could you help with a project?', '2026-09-13T03:15:00.000Z'),
    ],
  };
}

// Every mock read returns a detached snapshot, matching a remote API. Unexpected
// writes, sends, uploads, or external function calls are counted and fail closed.
function harness({ user = OWNER, authError = false, onInvoke } = {}) {
  const state = fixture();
  const calls = { reads: [], model: [], writes: [], effects: [], directory: 0 };
  const entities = new Map();
  const api = new Proxy({}, {
    get(_target, entityName) {
      if (!entities.has(entityName)) {
        entities.set(entityName, new Proxy({}, {
          get(_entity, operation) {
            if (operation === 'filter' || operation === 'list') {
              return async (...args) => {
                calls.reads.push({ entity: entityName, operation, args });
                const data = state[entityName] || [];
                const query = operation === 'filter' ? args[0] : null;
                const filtered = query
                  ? data.filter(row => Object.entries(query).every(([key, value]) => row[key] === value))
                  : data;
                return structuredClone(filtered);
              };
            }
            return async (...args) => {
              calls.writes.push({ entity: entityName, operation, args });
              throw new Error(`Unexpected mutation: ${String(entityName)}.${String(operation)}`);
            };
          },
        }));
      }
      return entities.get(entityName);
    },
  });
  const invoke = async request => {
    calls.model.push(structuredClone(request));
    if (onInvoke) return onInvoke({ state, calls, request });
    return draft();
  };
  const integrations = new Proxy({}, {
    get(_target, name) {
      if (name === 'InvokeLLM') return invoke;
      return async (...args) => {
        calls.effects.push({ name, args });
        throw new Error(`Unexpected external effect: ${String(name)}`);
      };
    },
  });
  const client = {
    auth: { me: async () => { if (authError) throw new Error('Mock expired session'); return user; } },
    asServiceRole: {
      entities: api,
      integrations: { Core: integrations },
      functions: { invoke: integrations.UnexpectedFunction },
    },
  };
  const handler = createMessageAssistantHandler({
    getClient: async () => client,
    now: () => new Date(NOW),
    loadDirectory: async () => { calls.directory += 1; throw new Error('Preview must not load the service directory'); },
  });
  return {
    state, calls,
    preview: overrides => previewReply({ api, invoke, conversationKey: CONVERSATION_KEY, goal: GOAL, now: NOW, ...overrides }),
    handle: (body = {}, headers = {}) => handler(new Request('https://test.invalid/message-assistant', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ action: 'reply_preview', conversation_key: CONVERSATION_KEY, goal: GOAL, ...body }),
    })),
  };
}

function assertReadOnly(calls) {
  assert.deepEqual(calls.writes, []);
  assert.deepEqual(calls.effects, []);
  assert.equal(calls.directory, 0);
}

function assertPreviewOnly(body) {
  assert.equal(body.model, 'gpt_5_6_sol');
  assert.equal(body.preview_only, true);
  assert.equal(body.send_enabled, false);
}

function withJob(state) {
  state.MessageConversation[0].job_id = 'job-1';
  state.JobKnowledgeRun = [{ id:'run-1',status:'complete',started_at:OBSERVED,completed_at:OBSERVED }];
  state.JobKnowledge = [{id:'prepared-1',run_id:'run-1',job_id:'job-1',context:{
    job_id:'job-1',job_name:'Example lot 12',generated_at:OBSERVED,status:'ready',time_zone:'America/Denver',
    conflicts:[],sources:{live_google:{source_type:'live_google',state:'current',available:true,complete:true,checked_at:OBSERVED}},
    evidence:[{source_key:'live_google:event-1',source_type:'live_google',matched_job_id:'job-1',job_id:'job-1',active:true,category:'installation',certainty:'scheduled_only',status:'confirmed',date:'2026-09-15',source_checked_at:OBSERVED}],
  }}];
}

test('verified prepared job facts are read without importing other private job notes or writing', async () => {
  const h=harness();withJob(h.state);
  h.state.JobKnowledge[0].context.latest_notes=[{text:'private access detail that must stay out of drafts'}];
  const result=await h.preview();
  assert.equal(result.body.job_context.facts_used,1);
  assert.match(h.calls.model[0].prompt,/2026-09-15/);
  assert.doesNotMatch(h.calls.model[0].prompt,/private access detail/);
  assertReadOnly(h.calls);
});

test('job reassignment or replacement preparation during generation invalidates the preview', async () => {
  for(const mutate of [state=>{state.MessageConversation[0].job_id='job-2';},state=>{state.JobKnowledgeRun[0].id='run-2';},state=>{state.JobKnowledge[0].context.evidence[0].status='cancelled';}]){
    const h=harness({onInvoke:({state})=>{mutate(state);return draft();}});withJob(h.state);
    const result=await h.preview();
    assert.equal(result.body.plan.decision,'owner_needed');assert.equal(result.body.plan.reply_text,'');
    assertReadOnly(h.calls);
  }
});

test('invalid preview inputs are rejected before any data or provider lookup', async () => {
  for (const overrides of [
    { conversationKey: undefined }, { conversationKey: '' }, { conversationKey: 1 },
    { conversationKey: 'a'.repeat(501) }, { goal: undefined }, { goal: '' },
    { goal: '   ' }, { goal: 1 }, { goal: 'a'.repeat(1001) },
  ]) {
    const h = harness();
    const result = await h.preview(overrides);
    assert.equal(result.status, 400);
    assertPreviewOnly(result.body);
    assert.equal(h.calls.reads.length, 0);
    assert.equal(h.calls.model.length, 0);
    assertReadOnly(h.calls);
  }
});

test('missing conversations return 404 without querying a provider', async () => {
  const h = harness();
  h.state.MessageConversation = [];
  const result = await h.preview();
  assert.equal(result.status, 404);
  assert.equal(h.calls.reads.length, 1);
  assert.equal(h.calls.model.length, 0);
  assertReadOnly(h.calls);
});

test('unauthorized or expired owner sessions are rejected before reading messages or calling a model', async () => {
  for (const options of [
    { user: null }, { user: { role: 'user', email: OWNER.email } },
    { user: { role: 'admin', email: 'stranger@example.com' } }, { authError: true },
  ]) {
    const h = harness(options);
    const response = await h.handle();
    assert.equal(response.status, 403);
    assert.match(response.headers.get('Cache-Control'), /no-store/u);
    assert.equal(h.calls.reads.length, 0);
    assert.equal(h.calls.model.length, 0);
    assertReadOnly(h.calls);
  }
});

test('collector authentication cannot authorize owner-only reply previews', async () => {
  const h = harness();
  const mockKey = 'only-a-local-test-device-token-'.repeat(2);
  const token_hash = Array.from(new Uint8Array(await crypto.subtle.digest(
    'SHA-256', new TextEncoder().encode(mockKey),
  )), value => value.toString(16).padStart(2, '0')).join('');
  h.state.MessageAssistantDevice = [{ id: 'mock-collector', token_hash, enabled: true }];
  const response = await h.handle({}, { 'x-glass-forge-assistant-key': mockKey });
  assert.equal(response.status, 403);
  assert.equal(h.calls.reads.length, 1);
  assert.equal(h.calls.reads[0].entity, 'MessageAssistantDevice');
  assert.equal(h.calls.model.length, 0);
  assertReadOnly(h.calls);
});

test('invalid collector tokens do not fall back to an owner session', async () => {
  for (const mockKey of ['short', 'x'.repeat(201), 'valid-length-but-unregistered-test-token-only']) {
    const h = harness();
    const response = await h.handle({}, { 'x-glass-forge-assistant-key': mockKey });
    assert.equal(response.status, 401);
    assert.equal(h.calls.model.length, 0);
    assert.ok(h.calls.reads.every(call => call.entity === 'MessageAssistantDevice'));
    assertReadOnly(h.calls);
  }
});

test('missing, disabled, unhealthy, stale, or future source/capture snapshots stop before the model', async () => {
  for (const mutate of [
    state => { state.MessageBridgeDevice = []; },
    state => { state.MessageBridgeDevice[0].enabled = false; },
    state => { state.MessageBridgeDevice[0].source_ok = false; },
    state => { state.MessageBridgeDevice[0].last_seen_at = '2026-09-13T03:24:59.999Z'; },
    state => { state.MessageBridgeDevice[0].last_seen_at = '2026-09-13T03:30:01.000Z'; },
    state => { state.MessageAssistantCapture = []; },
    state => { state.MessageAssistantCapture[0].captured_at = '2026-09-13T03:24:59.999Z'; },
    state => { state.MessageAssistantCapture[0].captured_at = '2026-09-13T03:30:01.000Z'; },
    state => { state.MessageAssistantCapture[0].captured_at = 'invalid'; },
  ]) {
    const h = harness();
    mutate(h.state);
    const result = await h.preview();
    assert.equal(result.status, 200);
    assert.equal(result.body.plan.decision, 'owner_needed');
    assert.equal(result.body.plan.reply_text, '');
    assertPreviewOnly(result.body);
    assert.equal(h.calls.model.length, 0);
    assertReadOnly(h.calls);
  }
});

test('newer conversation metadata than imported records blocks a premature preview', async () => {
  const h = harness();
  h.state.MessageConversation[0].last_message_at = '2026-09-13T03:29:30.000Z';
  const result = await h.preview();
  assert.equal(result.body.plan.decision, 'owner_needed');
  assert.match(result.body.plan.owner_note, /finish importing/u);
  assert.equal(h.calls.model.length, 0);
  assertReadOnly(h.calls);
});

test('an existing owner reply makes the preview wait without invoking a model', async () => {
  const h = harness();
  h.state.MessageRecord.unshift(record('owner-takeover', 'outgoing', 'Got it, I will take it from here.', '2026-09-13T03:29:30.000Z'));
  h.state.MessageConversation[0].last_message_at = '2026-09-13T03:29:30.000Z';
  const result = await h.preview();
  assert.equal(result.body.plan.decision, 'wait');
  assert.equal(result.body.plan.reply_text, '');
  assert.equal(h.calls.model.length, 0);
  assertReadOnly(h.calls);
});

test('normal owner preview accepts captured empty optional dates and uses the Base44 Sol contract without sends or writes', async () => {
  const h = harness();
  const before = structuredClone(h.state);
  const response = await h.handle();
  const body = await response.json();
  assert.equal(response.status, 200);
  assertPreviewOnly(body);
  assert.equal(body.plan.decision, 'reply');
  assert.equal(body.plan.reply_text, draft().reply_text);
  assert.equal(body.plan.semantic_review_required, true);
  assert.equal(body.history_complete, true);
  assert.equal(body.observed_at, OBSERVED);
  assert.equal(h.calls.model.length, 1);
  const request = h.calls.model[0];
  assert.equal(request.model, 'gpt_5_6_sol');
  assert.equal(typeof request.prompt, 'string');
  assert.ok(request.prompt.includes(GOAL));
  assert.equal(request.response_json_schema.type, 'object');
  assert.equal(Object.hasOwn(request, 'messages'), false);
  assert.equal(Object.hasOwn(request, 'response_format'), false);
  assert.match(response.headers.get('Cache-Control'), /no-store/u);
  assert.deepEqual(h.state, before);
  assertReadOnly(h.calls);
});

test('owner reply arriving during generation invalidates the draft', async () => {
  const h = harness({ onInvoke: ({ state }) => {
    state.MessageRecord.unshift(record('new-owner-reply', 'outgoing', 'I have this covered.', '2026-09-13T03:29:58.000Z'));
    state.MessageConversation[0].last_message_at = '2026-09-13T03:29:58.000Z';
    return draft();
  } });
  const result = await h.preview();
  assert.equal(h.calls.model.length, 1);
  assert.equal(result.body.plan.decision, 'owner_needed');
  assert.equal(result.body.plan.reply_text, '');
  assert.match(result.body.plan.owner_note, /changed while preparing/u);
  assertPreviewOnly(result.body);
  assertReadOnly(h.calls);
});

test('recipient, chat, or source-device changes during generation invalidate the draft', async () => {
  for (const mutate of [
    state => { state.MessageConversation[0].participants.push('+17205550111'); },
    state => { state.MessageConversation[0].source_chat_guid = 'iMessage;+;another-chat'; },
    state => { state.MessageConversation[0].device_id = 'another-source'; },
    state => { state.MessageConversation = []; },
  ]) {
    const h = harness({ onInvoke: ({ state }) => { mutate(state); return draft(); } });
    const result = await h.preview();
    assert.equal(h.calls.model.length, 1);
    assert.equal(result.body.plan.decision, 'owner_needed');
    assert.equal(result.body.plan.reply_text, '');
    assertReadOnly(h.calls);
  }
});

test('message edits, retractions, and source loss during generation invalidate the draft', async () => {
  for (const mutate of [
    state => { state.MessageRecord[0].text = 'Actually, never mind.'; state.MessageRecord[0].edited_at = '2026-09-13T03:29:58.000Z'; },
    state => { state.MessageRecord[0].retracted_at = '2026-09-13T03:29:58.000Z'; },
    state => { state.MessageBridgeDevice[0].enabled = false; },
    state => { state.MessageBridgeDevice[0].source_ok = false; },
    state => { state.MessageBridgeDevice = []; },
  ]) {
    const h = harness({ onInvoke: ({ state }) => { mutate(state); return draft(); } });
    const result = await h.preview();
    assert.equal(h.calls.model.length, 1);
    assert.equal(result.body.plan.decision, 'owner_needed');
    assert.equal(result.body.plan.reply_text, '');
    assertReadOnly(h.calls);
  }
});

test('provider exceptions fail closed through the handler with no side effects', async () => {
  const h = harness({ onInvoke: () => { throw new Error('Mock provider unavailable'); } });
  const response = await h.handle();
  const body = await response.json();
  assert.equal(response.status, 500);
  assert.match(body.error, /No texts were sent/u);
  assert.equal(Object.hasOwn(body, 'plan'), false);
  assert.equal(h.calls.model.length, 1);
  assertReadOnly(h.calls);
});

test('slow generation cannot return a draft after its observed snapshot expires', async () => {
  const h = harness();
  const result = await h.preview({ getNow: () => '2026-09-13T03:34:55.001Z' });
  assert.equal(h.calls.model.length, 1);
  assert.equal(result.body.plan.decision, 'owner_needed');
  assert.equal(result.body.plan.reply_text, '');
  assertPreviewOnly(result.body);
  assertReadOnly(h.calls);
});

test('a stale replacement source heartbeat during generation invalidates the draft', async () => {
  const h = harness({ onInvoke: ({ state }) => {
    state.MessageBridgeDevice[0].last_seen_at = '2026-09-13T03:20:00.000Z';
    return draft();
  } });
  const result = await h.preview();
  assert.equal(h.calls.model.length, 1);
  assert.equal(result.body.plan.decision, 'owner_needed');
  assert.equal(result.body.plan.reply_text, '');
  assertReadOnly(h.calls);
});
