import test from 'node:test';
import assert from 'node:assert/strict';
import { createCheckpointContinuations, buildContinuationDispatchContent } from '../shared/checkpointContinuation.js';
import { makeDispatchMarker, findDispatchedMessage, DEFAULT_AGENT_ID } from '../shared/superagentTransport.js';
import { publicQuote } from '../shared/windowQuotesCore.js';

const clone = x => JSON.parse(JSON.stringify(x));
const nativeId = '12345678-1234-1234-1234-123456789abc';
const matching = (row, query) => Object.entries(query).every(([key,value]) => row[key] === value);
function fixture({ maxContinuations = 1, checkpoint = { native_quote_id: nativeId } } = {}) {
  let sequence = 0;
  const store = {
    QuoteRequests: [{ id: 'q1', input_revision: 1, state_version: 0, worker_status: 'running', sales_status: 'open', execution_provider: 'superagent', missing_details: [], checkpoint, agent_run: { operation_id: 'operation-1', execution_token: 'test-only-capability', input_revision: 1, conversation_id: 'conversation-1', slot_id: 'slot-1', phase: 'working', event_ids: [] } }],
    QuoteWorkers: [{ id: 'slot-1', busy_token: 'operation-1', active_quote_id: 'q1' }]
  };
  const controls = { sendError: false, onSend: null, loseSendingWriteReply: false, failSentWrite: false, terminalAfterSending: false };
  const calls = [];
  const db = Object.fromEntries(Object.entries(store).map(([name, rows]) => [name, {
    filter: async query => clone(rows.filter(row => matching(row, query))),
    updateMany: async (query, patch) => {
      const continuationState = patch.$set.agent_run?.continuations?.at(-1)?.state;
      if (controls.failSentWrite && continuationState === 'sent') throw new Error('Simulated state persistence failure');
      let updated = 0;
      for (const row of rows) if (matching(row, query)) { Object.assign(row, clone(patch.$set));updated++; }
      if (controls.terminalAfterSending && continuationState === 'sending') store.QuoteRequests[0].worker_status = 'ready';
      if (controls.loseSendingWriteReply && continuationState === 'sending') throw new Error('Simulated lost CAS response');
      return { updated };
    }
  }]));
  const current = () => clone(store.QuoteRequests[0]);
  const helper = createCheckpointContinuations({ conversationId: 'conversation-1', maxContinuations, uuid: () => 'continuation-' + (++sequence), now: () => new Date('2026-09-06T23:00:00Z'), sendContinuation: async payload => {
    calls.push(clone(payload));
    if (controls.onSend) await controls.onSend(payload);
    if (controls.sendError) throw new Error('Simulated uncertain provider acceptance');
    return { accepted: true };
  }});
  const body = (fields = {}) => ({ action: 'checkpoint', quote_id: 'q1', input_revision: 1, operation_id: 'operation-1', execution_token: 'test-only-capability', event_id: 'checkpoint-1', checkpoint: { native_quote_id: nativeId, progress: 'saved' }, request_continuation: true, continuation: { reason: 'batch_complete', browser_changes: 3, no_pending_user_action: true }, ...fields });
  // This mirrors only the proposed integration points around existing validated
  // checkpoint CAS/event dedup, not the full deployed quote validator.
  const accept = async (request = body(), { dispatch = true } = {}) => {
    const entered = await helper.enter({ db, q: current(), body: request });
    const q = entered.quote;
    if (!(q.agent_run.event_ids || []).includes(request.event_id)) {
      assert.equal(entered.permission, 'active');
      const basePatch = { worker_status: 'running', checkpoint: { ...q.checkpoint, ...request.checkpoint }, agent_run: { ...q.agent_run, event_ids: [...q.agent_run.event_ids, request.event_id] } };
      const patch = helper.augmentCheckpointPatch(q, basePatch, request);
      const result = await db.QuoteRequests.updateMany({ id: q.id, state_version: q.state_version }, { $set: { ...patch, state_version: q.state_version + 1 } });
      if (result.updated !== 1) throw new Error('Checkpoint CAS conflict');
    }
    return dispatch ? helper.dispatch({ db, body: request }) : current();
  };
  const acknowledge = async () => {
    const id = current().agent_run.continuations.at(-1).id;
    return helper.enter({ db, q: current(), body: body({ action: 'read', continuation_id: id }) });
  };
  return { db, store, controls, calls, current, helper, body, accept, acknowledge };
}

test('accepted checkpoint reserves and sends one continuation without changing operation, native quote or browser owner', async () => {
  const f = fixture(), receipt = await f.accept();
  assert.deepEqual(receipt, { state: 'sent', must_yield: true });assert.equal(f.calls.length, 1);
  const q = f.current(), item = q.agent_run.continuations[0];
  assert.equal(q.agent_run.operation_id, 'operation-1');assert.equal(q.checkpoint.native_quote_id, nativeId);
  assert.equal(item.checkpoint_event_id, 'checkpoint-1');assert.equal(item.state, 'sent');
  assert.equal(f.store.QuoteWorkers[0].busy_token, 'operation-1');
  assert.equal(f.calls[0].conversationId, 'conversation-1');assert.equal(f.calls[0].correlation.operation_id, 'operation-1');
  assert.ok(f.calls[0].content.includes('"continuation_id":"continuation-1"'));
  assert.ok(f.calls[0].content.includes('stop all native actions immediately'));
  assert.ok(f.calls[0].content.includes('accepted SAVED checkpoint'));
  assert.ok(f.calls[0].content.includes('never blindly navigate away, discard an unsaved form'));
  assert.ok(!JSON.stringify(receipt).includes('continuation-1'));
  assert.equal(publicQuote(q).agent_run, undefined);
});

test('distinct continuation markers preserve the single original dispatch match', () => {
  const correlation = { quote_id: 'q1', input_revision: 1, operation_id: 'operation-1' };
  const first = makeDispatchMarker(correlation) + '\nInitial work';
  const next = buildContinuationDispatchContent(correlation, 'segment-1', 'Continue this exact request');
  assert.notEqual(next.split('\n')[0], first.split('\n')[0]);
  const conversation = { id: 'conversation-1', app_id: DEFAULT_AGENT_ID, metadata: {}, messages: [{ role: 'user', content: first }, { role: 'user', content: next }] };
  assert.equal(findDispatchedMessage(conversation, correlation, { conversationId: 'conversation-1', agentId: DEFAULT_AGENT_ID }).state, 'accepted');
  assert.throws(() => buildContinuationDispatchContent(correlation, 'segment-1', first));
});

test('checkpoint replay cannot resend or attach new intent to an earlier ordinary checkpoint', async () => {
  const f = fixture();await f.accept();const snapshot = f.current();
  await f.accept(f.body({ checkpoint: { native_quote_id: 'different' } }));
  assert.equal(f.calls.length, 1);assert.deepEqual(f.current(), snapshot);
  const ordinary = fixture();await ordinary.accept(ordinary.body({ request_continuation: false }));
  assert.equal((await ordinary.accept()).state, 'not_reserved');assert.equal(ordinary.calls.length, 0);
});

test('concurrent delivery attempts race on one reserved-to-sending CAS and send at most once', async () => {
  const f = fixture();await f.accept(f.body(), { dispatch: false });
  const results = await Promise.allSettled([f.helper.dispatch({ db: f.db, body: f.body() }), f.helper.dispatch({ db: f.db, body: f.body() })]);
  assert.equal(f.calls.length, 1);assert.ok(results.some(result => result.status === 'fulfilled'));
});
test('concurrent checkpoint acceptance stores one event and one continuation intent atomically', async () => {
  const f = fixture();
  await Promise.allSettled([f.accept(), f.accept()]);
  assert.equal(f.current().agent_run.event_ids.length, 1);assert.equal(f.current().agent_run.continuations.length, 1);assert.equal(f.calls.length, 1);
});

test('reserved state survives a process gap; sending and uncertain states never automatically resend', async () => {
  const f = fixture();await f.accept(f.body(), { dispatch: false });
  assert.equal(f.current().agent_run.continuations[0].state, 'reserved');assert.equal(f.calls.length, 0);
  f.controls.sendError = true;assert.equal((await f.accept()).state, 'uncertain');
  await f.accept();assert.equal(f.calls.length, 1);assert.equal(f.store.QuoteWorkers[0].busy_token, 'operation-1');
  await assert.rejects(f.accept(f.body({ event_id: 'different-checkpoint' })), error => error.status === 409);
});

test('lost sending-CAS response blocks retries even when no network call was made', async () => {
  const f = fixture();f.controls.loseSendingWriteReply = true;
  await assert.rejects(f.accept());assert.equal(f.calls.length, 0);
  assert.equal(f.current().agent_run.continuations[0].state, 'sending');
  assert.equal((await f.accept()).state, 'sending');assert.equal(f.calls.length, 0);
});

test('lost post-acceptance persistence cannot result in another provider send', async () => {
  const f = fixture();f.controls.failSentWrite = true;
  await assert.rejects(f.accept());assert.equal(f.calls.length, 1);
  assert.equal(f.current().agent_run.continuations[0].state, 'sending');
  assert.equal((await f.accept()).state, 'sending');assert.equal(f.calls.length, 1);
});

test('reentrant next-segment acknowledgement wins over a late success or timeout callback', async () => {
  for (const sendError of [false, true]) {
    const f = fixture();f.controls.sendError = sendError;
    f.controls.onSend = async () => { await f.acknowledge(); };
    await f.accept();
    assert.equal(f.current().agent_run.continuations[0].state, 'acknowledged');
    assert.equal(f.current().agent_run.active_continuation_id, 'continuation-1');
    await assert.rejects(f.helper.enter({ db: f.db, q: f.current(), body: f.body({ action: 'report', status: 'ready', event_id: 'late-old-report' }) }), error => error.status === 409);
    assert.equal(f.calls.length, 1);
  }
});

test('reservation immediately fences old reads/new writes; next segment must acknowledge exact ID', async () => {
  const f = fixture();await f.accept(f.body(), { dispatch: false });
  for (const change of [{ action: 'read' }, { event_id: 'late' }, { action: 'report', status: 'failed' }, { action: 'read', continuation_id: 'wrong' }]) await assert.rejects(f.helper.enter({ db: f.db, q: f.current(), body: f.body(change) }), error => error.status === 409);
  await assert.rejects(f.acknowledge(), error => error.status === 409); // Cannot acknowledge before sending boundary.
  await f.accept();await f.acknowledge();
  const active = await f.helper.enter({ db: f.db, q: f.current(), body: f.body({ action: 'read', continuation_id: 'continuation-1' }) });
  assert.equal(active.permission, 'active');
  const replay = await f.helper.enter({ db: f.db, q: f.current(), body: f.body() });
  assert.equal(replay.permission, 'receipt_only');
});

test('wrong revision/token/operation/conversation/provider and terminal states block sends', async () => {
  const f = fixture();await f.accept(f.body(), { dispatch: false });
  for (const change of [{ input_revision: 2 }, { operation_id: 'other' }, { execution_token: 'other' }]) await assert.rejects(f.helper.dispatch({ db: f.db, body: f.body(change) }), error => error.status === 403);
  for (const change of [{ worker_status: 'ready' }, { worker_status: 'needs_details' }, { worker_status: 'needs_sign_in' }, { sales_status: 'won' }, { execution_provider: 'local_codex' }]) {
    const original = f.current();Object.assign(f.store.QuoteRequests[0], change);
    await assert.rejects(f.helper.dispatch({ db: f.db, body: f.body() }));f.store.QuoteRequests[0] = original;
  }
  f.store.QuoteRequests[0].agent_run.conversation_id = 'other-conversation';
  await assert.rejects(f.helper.dispatch({ db: f.db, body: f.body() }));assert.equal(f.calls.length, 0);
});

test('lost browser ownership and changed native identity reject dispatch', async () => {
  const f = fixture();await f.accept(f.body(), { dispatch: false });
  f.store.QuoteWorkers[0].busy_token = 'different-operation';
  await assert.rejects(f.helper.dispatch({ db: f.db, body: f.body() }), error => error.status === 409);
  f.store.QuoteWorkers[0].busy_token = 'operation-1';f.store.QuoteRequests[0].checkpoint.native_quote_id = 'other-native';
  await assert.rejects(f.helper.dispatch({ db: f.db, body: f.body() }), error => error.status === 409);assert.equal(f.calls.length, 0);
});

test('terminal transition before network stops dispatch without overwriting terminal state', async () => {
  const f = fixture();f.controls.terminalAfterSending = true;
  await assert.rejects(f.accept(), error => error.status === 409);assert.equal(f.calls.length, 0);assert.equal(f.current().worker_status, 'ready');
});

test('manual approval, MFA, sign-in, missing details, invalid batch and missing native identity never auto-continue', async () => {
  for (const change of [{ requires_approval: true }, { requires_mfa: true }, { requires_sign_in: true }, { pending_user_action: 'Confirm dealer change' }]) {
    const f = fixture();await assert.rejects(f.accept(f.body({ checkpoint: { native_quote_id: nativeId, ...change } })), error => error.status === 409);assert.equal(f.calls.length, 0);
  }
  for (const changes of [0, 10, 1.5]) {
    const f = fixture();await assert.rejects(f.accept(f.body({ continuation: { reason: 'batch_complete', browser_changes: changes, no_pending_user_action: true } })), error => error.status === 400);
  }
  const missing = fixture({ checkpoint: {} });await assert.rejects(missing.accept(missing.body({ checkpoint: {} })), error => error.status === 400);
  const question = fixture();question.store.QuoteRequests[0].missing_details = ['Which color?'];await assert.rejects(question.accept(), error => error.status === 409);
  const priorApproval = fixture({ checkpoint: { native_quote_id: nativeId, requires_approval: true } });
  await assert.rejects(priorApproval.accept(priorApproval.body({ checkpoint: { native_quote_id: nativeId, requires_approval: false } })), error => error.status === 409);
});

test('configured cap preserves the last checkpoint but performs no further send or lock release', async () => {
  const f = fixture();await f.accept();await f.acknowledge();
  const response = await f.accept(f.body({ continuation_id: 'continuation-1', event_id: 'checkpoint-cap', checkpoint: { native_quote_id: nativeId, progress: 'last batch saved' } }));
  assert.deepEqual(response, { state: 'limit_reached', must_yield: true });assert.equal(f.calls.length, 1);
  assert.equal(f.current().checkpoint.progress, 'last batch saved');assert.equal(f.store.QuoteWorkers[0].busy_token, 'operation-1');
  assert.equal(f.helper.policy(f.current()).remaining_continuations, 0);
});
