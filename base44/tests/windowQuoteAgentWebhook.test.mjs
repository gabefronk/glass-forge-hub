import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac, webcrypto } from 'node:crypto';
import { createAgentWebhookHandler } from '../shared/windowQuoteAgentWebhook.js';
import { createAgentExecution } from '../shared/windowQuoteAgentService.js';
import { createSuperagentTransport, DEFAULT_AGENT_ID, makeDispatchMarker } from '../shared/superagentTransport.js';
globalThis.crypto ??= webcrypto;

const clone = x => JSON.parse(JSON.stringify(x));
const SECRET = 'synthetic-webhook-test-secret-not-a-production-key';
const time = '2026-09-06T22:00:00.000Z';
const correlation = { quote_id: 'quote-test', input_revision: 3, operation_id: 'operation-test' };
const valueAt = (row, key) => key.split('.').reduce((value, part) => value?.[part], row);
function matches(row, query) {
  return Object.entries(query || {}).every(([key, value]) => valueAt(row, key) === value);
}
function readyEnvelope() {
  const nativeId = '12345678-1234-1234-1234-123456789abc';
  return {
    schema_version: 1, ...correlation, outcome: 'ready',
    result: { verified: true, native_quote_id: nativeId, native_quote_number: 'TEST-123', native_quote_url: 'https://amsco.wtsparadigm.com/quotes/' + nativeId + '/line-items', lines: [{ qty: 1, unit_prices: { customer: 142.27 }, line_totals: { customer: 142.27 } }], totals: { customer_total: 142.27, dealer_cost: 100, gross_margin: 29.71, currency: 'USD' } },
    verification: { reopened: true, dealer: 'BFS', yard: 'BFS-UTAH DESIGN (11)', gross_margin: 29.71, checked_at: time },
  };
}
function fixture(outcome = { schema_version: 1, ...correlation, outcome: 'failed', message: 'Synthetic test failure' }) {
  const controls = { failReleaseOnce: false, clientCalls: 0, reads: 0, reports: [] };
  const records = {
    QuoteRequests: [{
      id: correlation.quote_id, requester_email: 'test@example.invalid', request_id: 'synthetic-request', state_version: 0, input_revision: 3,
      settings: { dealer: 'BFS', yard: 'BFS-UTAH DESIGN (11)', gross_margin: 29.71 }, lines: [{ qty: 1, width: 36, height: 60, dimension_basis: 'call', units: 'in', style: 'Single Hung' }],
      execution_provider: 'superagent', worker_status: 'running', sales_status: 'open', history: [],
      conversation: [{ role: 'user', content: 'Synthetic test request', revision: 3, client_message_id: 'input-test', kind: 'initial_request' }],
      checkpoint: { native_quote_id: readyEnvelope().result.native_quote_id },
      agent_run: { ...correlation, conversation_id: 'conversation-test', execution_token: 'synthetic-execution-token', phase: 'sent', slot_id: 'slot-test', event_ids: [] },
    }],
    QuoteWorkers: [{ id: 'slot-test', name: 'Base44 Window Quotes browser', busy_token: correlation.operation_id, active_quote_id: correlation.quote_id, poll_generation: 1 }],
  };
  const db = Object.fromEntries(Object.entries(records).map(([name, rows]) => [name, {
    async filter(query, _sort, limit = 100) { return clone(rows.filter(row => matches(row, query)).slice(0, limit)); },
    async updateMany(query, update) {
      if (name === 'QuoteWorkers' && update.$set?.busy_token === '' && controls.failReleaseOnce) { controls.failReleaseOnce = false; throw new Error('Synthetic release failure'); }
      let updated = 0;
      for (const row of rows) if (matches(row, query)) { Object.assign(row, clone(update.$set)); updated++; }
      return { updated };
    },
  }]));
  const conversation = {
    id: 'conversation-test', app_id: DEFAULT_AGENT_ID, metadata: { window_quote: clone(correlation) },
    messages: [
      { id: 'dispatch-test', role: 'user', content: makeDispatchMarker(correlation) + '\nSynthetic dispatch' },
      { id: 'message-test', role: 'assistant', content: typeof outcome === 'string' ? outcome : JSON.stringify(outcome) },
    ],
  };
  const transport = createSuperagentTransport({ apiKey: 'synthetic-provider-key', fetchImpl: async (url, options) => {
    controls.reads++;
    assert.equal(options.method, 'GET');
    assert.ok(url.endsWith('/conversations/conversation-test'));
    return new Response(JSON.stringify(conversation), { status: 200 });
  } });
  const service = createAgentExecution({ transport, browserSlotId: 'slot-test', now: () => new Date(time) });
  const execution = { report: async args => { controls.reports.push(clone(args.body)); return service.report(args); } };
  const handler = createAgentWebhookHandler({ secret: SECRET, transport, execution, getClient: async () => {
    controls.clientCalls++; return { asServiceRole: { entities: db } };
  } });
  async function call({ payload = {}, message = {}, delivery = 'delivery-test', signature, mutateBody, event = 'message.completed' } = {}) {
    let rawBody = JSON.stringify({ event: 'message.completed', app_id: DEFAULT_AGENT_ID, conversation_id: 'conversation-test', timestamp: time,
      data: { message: { id: 'message-test', role: 'assistant', content: conversation.messages.at(-1).content, ...message } }, ...payload });
    const signed = signature ?? 'sha256=' + createHmac('sha256', SECRET).update(rawBody).digest('hex');
    if (mutateBody) rawBody = mutateBody(rawBody);
    const response = await handler(new Request('https://example.invalid/webhook', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Base44-Signature': signed, 'X-Base44-Event': event, 'X-Base44-Delivery': delivery }, body: rawBody }));
    return { status: response.status, ...await response.json() };
  }
  return { call, handler, controls, records, conversation, q: records.QuoteRequests[0], slot: records.QuoteWorkers[0] };
}

test('invalid signature, tampered body and wrong signed agent stop before database access', async () => {
  for (const options of [{ signature: 'sha256=' + '0'.repeat(64) }, { mutateBody: body => body + ' ' }, { payload: { app_id: 'wrong-agent' } }]) {
    const f = fixture(), response = await f.call(options);
    assert.equal(response.status, 401); assert.equal(response.error, 'Invalid agent event');
    assert.equal(f.controls.clientCalls, 0); assert.equal(f.controls.reports.length, 0); assert.equal(f.controls.reads, 0);
  }
});

test('unknown conversation or quote does not resolve or mutate any quote', async () => {
  const missing = fixture();
  assert.deepEqual(await missing.call({ payload: { conversation_id: 'unrelated-conversation' } }), { status: 200, ok: true, ignored: true });
  assert.equal(missing.controls.reads, 0); assert.equal(missing.controls.reports.length, 0);
  const unknown = fixture({ schema_version: 1, ...correlation, quote_id: 'unrelated-quote', outcome: 'failed' });
  assert.equal((await unknown.call()).ignored, true); assert.equal(unknown.controls.reports.length, 0); assert.equal(unknown.controls.reads, 0);
});

test('wrong authoritative conversation cannot reach execution reporting', async () => {
  const f = fixture(); f.conversation.id = 'wrong-conversation';
  assert.notEqual((await f.call()).status, 200); assert.equal(f.controls.reports.length, 0); assert.equal(f.q.worker_status, 'running');
});

test('signed envelope must match current quote, revision and operation', async () => {
  for (const wrong of [{ input_revision: 2 }, { operation_id: 'old-operation' }]) {
    const f = fixture({ schema_version: 1, ...correlation, ...wrong, outcome: 'failed', message: 'Test only' });
    assert.equal((await f.call()).status, 401); assert.equal(f.controls.reports.length, 0); assert.equal(f.q.worker_status, 'running');
  }
  const staleRun = fixture(); staleRun.q.input_revision = 4;
  assert.equal((await staleRun.call()).status, 401); assert.equal(staleRun.controls.reads, 0); assert.equal(staleRun.controls.reports.length, 0);
});

test('generic ready prose is never a verified quote', async () => {
  const f = fixture('Your quote is ready. Total $142.27.');
  assert.equal((await f.call()).status, 200); assert.equal(f.controls.reports.length, 0);
  assert.equal(f.q.worker_status, 'running'); assert.equal(f.q.result, undefined);
  assert.equal(f.controls.clientCalls, 0); assert.equal(f.controls.reads, 0);
});

test('signed payload text cannot replace the authoritative API message', async () => {
  const f = fixture('Still working');
  assert.equal((await f.call({ message: { content: JSON.stringify(readyEnvelope()) } })).status, 200);
  assert.equal(f.controls.reports.length, 0); assert.equal(f.q.worker_status, 'running');
});

test('clarification maps to needs_details with questions and current scoped identifiers', async () => {
  const questions = ['Which dealer and yard?', 'What gross margin?'];
  const f = fixture({ schema_version: 1, ...correlation, outcome: 'clarification', questions });
  assert.equal((await f.call()).status, 200); assert.equal(f.q.worker_status, 'needs_details');
  assert.deepEqual(f.q.missing_details, questions); assert.equal(f.q.conversation.at(-1).kind, 'clarification');
  assert.deepEqual(f.controls.reports[0].missing_details, questions);
  assert.equal(f.controls.reports[0].execution_token, 'synthetic-execution-token');
  assert.equal(f.controls.reports[0].event_id, 'webhook:message-test'); assert.equal(f.slot.busy_token, '');
});

test('needs_sign_in and failed outcomes remain non-ready and release the browser slot', async () => {
  for (const outcome of ['needs_sign_in', 'failed']) {
    const f = fixture({ schema_version: 1, ...correlation, outcome, message: 'The authorized BFS session is unavailable.' });
    assert.equal((await f.call()).status, 200); assert.equal(f.q.worker_status, outcome);
    assert.equal(f.q.result, undefined); assert.equal(f.q.agent_run.terminal_status, outcome); assert.equal(f.slot.busy_token, '');
  }
});

test('ready envelope still requires reopened evidence in the real execution service', async () => {
  for (const verification of [undefined, { ...readyEnvelope().verification, reopened: false }, { ...readyEnvelope().verification, dealer: 'BTB' }]) {
    const f = fixture({ ...readyEnvelope(), verification });
    assert.notEqual((await f.call()).status, 200); assert.equal(f.q.worker_status, 'running'); assert.equal(f.q.result, undefined);
  }
  const valid = fixture(readyEnvelope());
  assert.equal((await valid.call()).status, 200); assert.equal(valid.q.worker_status, 'ready');
  assert.equal(valid.q.result.totals.customer_total, 142.27); assert.equal(valid.q.history.length, 1);
  assert.equal(valid.q.conversation.at(-1).content, 'Your quote is ready to be viewed.');
});

test('terminal callbacks dedupe by message across delivery IDs', async () => {
  const f = fixture(readyEnvelope());
  assert.equal((await f.call({ delivery: 'attempt-one' })).status, 200);
  assert.equal((await f.call({ delivery: 'attempt-two' })).status, 200);
  assert.equal(f.q.history.length, 1); assert.equal(f.q.conversation.filter(message => message.kind === 'ready').length, 1);
  assert.deepEqual(f.q.agent_run.event_ids, ['webhook:message-test']); assert.equal(f.controls.reports.length, 2);
});

test('retry repairs a terminal report whose slot release failed without duplicating result', async () => {
  const f = fixture(readyEnvelope()); f.controls.failReleaseOnce = true;
  assert.equal((await f.call()).status, 503); assert.equal(f.q.worker_status, 'ready'); assert.equal(f.slot.busy_token, correlation.operation_id);
  assert.equal((await f.call({ delivery: 'retry-after-release-failure' })).status, 200);
  assert.equal(f.slot.busy_token, ''); assert.equal(f.q.history.length, 1); assert.equal(f.q.conversation.length, 2);
});

test('new callbacks after a terminal operation are ignored, not accepted as another result', async () => {
  const f = fixture(); assert.equal((await f.call()).status, 200);
  const count = f.controls.reports.length;
  assert.equal((await f.call({ message: { id: 'new-message-after-completion' } })).status, 200);
  assert.equal(f.controls.reports.length, count); assert.equal(f.q.worker_status, 'failed');
});

test('shared conversation resolves the named current quote even with multiple historical records', async () => {
  const f = fixture({ schema_version: 1, ...correlation, outcome: 'needs_sign_in', message: 'Authorized BFS browser needed.' });
  f.conversation.metadata = { analytics_channel: 'in_app' };
  const historical = [1, 2, 3].map(number => ({ ...clone(f.q), id: 'historical-' + number, worker_status: 'ready', agent_run: { ...clone(f.q.agent_run), operation_id: 'historical-operation-' + number, phase: 'completed', event_ids: ['webhook:historical-message-' + number] } }));
  f.records.QuoteRequests.unshift(...historical);
  const before = clone(historical);
  assert.equal((await f.call()).status, 200); assert.equal(f.q.worker_status, 'needs_sign_in');
  assert.equal(f.controls.reports.length, 1); assert.equal(f.controls.reports[0].quote_id, f.q.id);
  assert.deepEqual(historical, before);
});

test('terminal retry repairs only its historical quote and cannot release a later active run', async () => {
  const f = fixture(readyEnvelope()); f.conversation.metadata = {};
  assert.equal((await f.call()).status, 200);
  const later = { ...clone(f.q), id: 'later-quote', worker_status: 'running', agent_run: { ...clone(f.q.agent_run), operation_id: 'later-operation', phase: 'sent', event_ids: [] } };
  f.records.QuoteRequests.push(later); f.slot.busy_token = later.agent_run.operation_id; f.slot.active_quote_id = later.id;
  const before = clone(later);
  assert.equal((await f.call({ delivery: 'historical-retry' })).status, 200);
  assert.equal(f.q.history.length, 1); assert.equal(f.q.conversation.filter(message => message.kind === 'ready').length, 1);
  assert.equal(f.slot.busy_token, 'later-operation'); assert.equal(f.slot.active_quote_id, 'later-quote');
  assert.deepEqual(later, before); assert.equal(f.controls.reports.at(-1).quote_id, f.q.id);
});

test('signed routing quote is only a candidate and authoritative different quote still rejects', async () => {
  const f = fixture({ schema_version: 1, ...correlation, quote_id: 'different-quote', outcome: 'failed' });
  f.conversation.metadata = {};
  const signed = { schema_version: 1, ...correlation, outcome: 'failed' };
  assert.equal((await f.call({ message: { content: JSON.stringify(signed) } })).status, 401);
  assert.equal(f.controls.reports.length, 0); assert.equal(f.q.worker_status, 'running');
});

test('signed quote selector accepts fenced JSON but ignores invalid IDs and oversized content', async () => {
  const envelope = { schema_version: 1, ...correlation, outcome: 'failed', message: 'Synthetic failure' };
  const valid = fixture('```json\n' + JSON.stringify(envelope) + '\n```');
  assert.equal((await valid.call()).status, 200); assert.equal(valid.q.worker_status, 'failed');
  for (const quote_id of [{ $ne: '' }, '../quote-test', 'quote id', 'q'.repeat(151)]) {
    const f = fixture({ ...envelope, quote_id });
    assert.equal((await f.call()).ignored, true); assert.equal(f.controls.clientCalls, 0); assert.equal(f.controls.reports.length, 0);
  }
  const large = fixture(JSON.stringify({ ...envelope, padding: 'x'.repeat(500000) }));
  assert.equal((await large.call()).ignored, true); assert.equal(large.controls.clientCalls, 0);
});

