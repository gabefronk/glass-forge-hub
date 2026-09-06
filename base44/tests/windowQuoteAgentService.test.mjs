import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createAgentExecution, createAgentToolHandler, buildAgentPrompt } from '../shared/windowQuoteAgentService.js';
globalThis.crypto ??= webcrypto;
const clone = x => JSON.parse(JSON.stringify(x));
const matches = (row, query) => Object.entries(query || {}).every(([key, value]) => row[key] === value);
const NATIVE_ID = '12345678-1234-1234-1234-123456789abc';
const NATIVE_URL = 'https://amsco.wtsparadigm.com/quotes/' + NATIVE_ID + '/details';
async function fixture({ noSlot = false, fixedSlot = false } = {}) {
  let sequence = 0, timestamp = Date.parse('2026-09-06T22:00:00Z');
  const records = { QuoteRequests: [], QuoteWorkers: [] };
  const controls = { uncertainSend: false, failSendingWrite: false, failRelease: false };
  const calls = { create: [], send: [] };
  const db = Object.fromEntries(Object.entries(records).map(([name, rows]) => [name, {
    async filter(query, sort, limit = 1000) {
      const result = rows.filter(row => matches(row, query));
      if (sort) result.sort((a,b) => String(a[sort] || '').localeCompare(String(b[sort] || '')));
      return clone(result.slice(0, limit));
    },
    async create(data) {
      const row = { ...clone(data), id: name + '-' + (++sequence), created_date: new Date(timestamp + sequence).toISOString() };
      rows.push(row);return clone(row);
    },
    async updateMany(query, patch) {
      if (name === 'QuoteRequests' && controls.failSendingWrite && patch.$set.agent_run?.phase === 'sending') { controls.failSendingWrite = false; throw new Error('write failed before sending'); }
      if (name === 'QuoteWorkers' && controls.failRelease && patch.$set.busy_token === '') { controls.failRelease = false; throw new Error('release write failed'); }
      let updated = 0;
      for (const row of rows) if (matches(row, query)) { Object.assign(row, clone(patch.$set));updated++; }
      return { updated };
    }
  }]));
  const transport = {
    async createConversation(correlation) { calls.create.push(clone(correlation));return { id: 'conversation-' + calls.create.length }; },
    async sendMessage(payload) { calls.send.push(clone(payload));if (controls.uncertainSend) throw new Error('Uncertain provider acceptance');return { accepted: true }; }
  };
  const lock = noSlot ? null : await db.QuoteWorkers.create({ name: 'Base44 Window Quotes browser', token_hash: 'test-disabled-row', enabled: false, allowed_dealers: ['BFS'], busy_token: '', poll_generation: 0 });
  const execution = createAgentExecution({ transport, ...(fixedSlot && lock ? { browserSlotId: lock.id } : {}), now: () => new Date(timestamp), uuid: () => 'generated-' + (++sequence) });
  const create = async (changes = {}) => db.QuoteRequests.create({ request_id: 'r-' + (++sequence), title: 'Test', requester_email: 'owner@example.test', settings: { dealer: 'BFS', yard: 'BFS-UTAH DESIGN', gross_margin: 29.71 }, lines: [{ qty: 1, width: 36, height: 60, units: 'in', dimension_basis: 'call', style: 'Single Hung' }], conversation: [{ role: 'user', content: 'Build one window', revision: 1, client_message_id: 'initial' }], input_revision: 1, state_version: 0, worker_status: 'draft', sales_status: 'open', ...changes });
  const current = id => clone(records.QuoteRequests.find(q => q.id === id));
  const start = async (changes = {}) => execution.afterInput({ db, q: await create(changes) });
  const body = (q, fields = {}) => ({ quote_id: q.id, input_revision: q.input_revision, operation_id: q.agent_run.operation_id, execution_token: q.agent_run.execution_token, event_id: 'event-' + (++sequence), ...fields });
  const report = (q, fields = {}) => execution.report({ db, body: body(q, fields) });
  const checkpoint = (q, fields = {}) => report(q, { status: 'running', checkpoint: { native_quote_id: NATIVE_ID, native_quote_url: NATIVE_URL, completed_lines: [], ...fields } });
  const result = { verified: true, native_quote_id: NATIVE_ID, native_quote_number: '1234567', native_quote_url: NATIVE_URL, lines: [{ native_line_id: 'line-1', native_line_number: 100, qty: 1, style: 'Single Hung', frame_dimensions: { width: 35.5, height: 59.5, units: 'in' }, unit_prices: { customer: 142.27, dealer: 100, list: 200 }, line_totals: { customer: 142.27, dealer: 100, list: 200 } }], totals: { customer_total: 142.27, dealer_cost: 100, gross_margin: 29.71, currency: 'USD' } };
  const verification = { reopened: true, dealer: 'BFS', yard: 'BFS-UTAH DESIGN', gross_margin: 29.71, checked_at: '2026-09-06T22:00:00Z' };
  return { execution, db, records, controls, calls, lock, create, start, current, body, report, checkpoint, result, verification, advance: ms => timestamp += ms };
}
test('start claims one configured slot and sends exactly one private correlated prompt', async () => {
  const f = await fixture(), q = await f.start();
  assert.equal(q.worker_status, 'running');assert.equal(q.agent_run.phase, 'sent');
  assert.equal(f.calls.create.length, 1);assert.equal(f.calls.send.length, 1);
  assert.equal(f.calls.create[0].operation_id, q.agent_run.operation_id);
  assert.ok(f.calls.send[0].content.includes(q.agent_run.execution_token));
  assert.ok(f.calls.send[0].content.includes('windowQuoteAgentTools'));
  assert.equal(f.records.QuoteWorkers[0].busy_token, q.agent_run.operation_id);
});
test('prompt provides exact HTTP fallback and transport-compatible failed envelope', async () => {
  const f = await fixture(), q = await f.start(), prompt = buildAgentPrompt(q);
  assert.ok(prompt.includes('https://base44.app/api/apps/6a7f0d7a4a5f825c724273e9/functions/windowQuoteAgentTools'));
  assert.ok(prompt.includes('"schema_version":1'));assert.ok(prompt.includes('"outcome":"failed"'));
  assert.ok(!prompt.includes('"status":"failed"'));
});
test('missing or ambiguous browser slots fail closed without creating another mutex', async () => {
  const missing = await fixture({ noSlot: true });
  await assert.rejects(missing.start(), e => e.status === 503);assert.equal(missing.records.QuoteWorkers.length, 0);
  const duplicate = await fixture();
  await duplicate.db.QuoteWorkers.create({ ...duplicate.lock, id: undefined });
  await assert.rejects(duplicate.start(), e => e.status === 503);assert.equal(duplicate.calls.send.length, 0);
  const fixed = await fixture({ fixedSlot: true });
  await fixed.db.QuoteWorkers.create({ ...fixed.lock, id: undefined });
  assert.equal((await fixed.start()).worker_status, 'running');
});
test('concurrent requests cannot own two shared browser runs', async () => {
  const f = await fixture(), one = await f.create(), two = await f.create();
  await Promise.all([f.execution.afterInput({ db: f.db, q: one }), f.execution.afterInput({ db: f.db, q: two })]);
  assert.equal(f.calls.send.length, 1);assert.equal(f.records.QuoteRequests.filter(q => q.worker_status === 'running').length, 1);
  assert.equal(f.records.QuoteRequests.filter(q => q.worker_status === 'queued').length, 1);
});
test('uncertain send retains lock and identity across retries and long elapsed time', async () => {
  const f = await fixture();f.controls.uncertainSend = true;
  const q = await f.start();assert.equal(q.agent_run.phase, 'uncertain');
  const token = q.agent_run.execution_token, operation = q.agent_run.operation_id;
  f.advance(86400000);
  await f.execution.afterInput({ db: f.db, q });
  await f.start();await f.execution.drain(f.db);
  assert.equal(f.calls.create.length, 1);assert.equal(f.calls.send.length, 1);
  assert.equal(f.current(q.id).agent_run.execution_token, token);
  assert.equal(f.records.QuoteWorkers[0].busy_token, operation);
});
test('successful conversation ID survives a failed pre-send state write', async () => {
  const f = await fixture();f.controls.failSendingWrite = true;
  const q = await f.start();
  assert.equal(q.agent_run.phase, 'uncertain');assert.equal(q.agent_run.conversation_id, 'conversation-1');
  assert.equal(f.calls.create.length, 1);assert.equal(f.calls.send.length, 0);
  await f.execution.afterInput({ db: f.db, q });assert.equal(f.calls.create.length, 1);
});
test('capability, operation, provider and revision each fence the agent to one current request', async () => {
  const f = await fixture(), q = await f.start(), base = f.body(q, { action: 'read' });
  for (const change of [{ execution_token: 'wrong' }, { operation_id: 'wrong' }, { input_revision: 2 }]) await assert.rejects(f.execution.tool({ db: f.db, body: { ...base, ...change } }), e => e.status === 403);
  await f.db.QuoteRequests.updateMany({ id: q.id }, { $set: { input_revision: 2 } });
  await assert.rejects(f.execution.tool({ db: f.db, body: base }), e => e.status === 403);
  await f.db.QuoteRequests.updateMany({ id: q.id }, { $set: { input_revision: 1, execution_provider: 'local_codex' } });
  await assert.rejects(f.execution.tool({ db: f.db, body: base }), e => e.status === 403);
});
test('explicit finance cannot change and a source ID alone cannot invent missing choices', async () => {
  const f = await fixture(), q = await f.start();
  await assert.rejects(f.report(q, { status: 'running', settings: { gross_margin: 50 }, settings_source_message_id: 'initial' }), e => e.status === 400);
  const g = await fixture(), missing = await g.start({ settings: {} });
  await assert.rejects(g.report(missing, { status: 'running', settings: { dealer: 'BFS', yard: 'BFS-UTAH DESIGN', gross_margin: 30 }, settings_source_message_id: 'initial' }), e => e.status === 400);
  assert.deepEqual(g.current(missing.id).settings, {});
});
test('explicit written finance and a short answer to a margin clarification are accepted with citation', async () => {
  const f = await fixture(), q = await f.start({ settings: {}, conversation: [{ role: 'user', content: 'Use BFS-UTAH DESIGN with a gross margin of 30%.', client_message_id: 'finance', revision: 1 }] });
  await f.report(q, { status: 'running', settings: { dealer: 'BFS', yard: 'BFS-UTAH DESIGN', gross_margin: 30 }, settings_source_message_id: 'finance' });
  assert.equal(f.current(q.id).settings.gross_margin, 30);assert.equal(f.current(q.id).agent_run.settings_source_message_id, 'finance');
  const g = await fixture(), answer = await g.start({ settings: { dealer: 'BFS', yard: 'BFS-UTAH DESIGN', gross_margin: null }, input_revision: 2, conversation: [{ role: 'assistant', kind: 'clarification', content: 'Which gross margin should I apply?', revision: 1 }, { role: 'user', content: '30%', client_message_id: 'answer', revision: 2 }] });
  await g.report(answer, { status: 'running', settings: { gross_margin: 30 }, settings_source_message_id: 'answer' });
  assert.equal(g.current(answer.id).settings.gross_margin, 30);
});
test('checkpoint identity cannot be cleared, replaced or pointed at another native draft', async () => {
  const f = await fixture(), q = await f.start();await f.checkpoint(q);
  for (const id of ['', null, 'different']) await assert.rejects(f.report(q, { status: 'running', checkpoint: { native_quote_id: id } }), e => e.status === 409);
  await assert.rejects(f.report(q, { status: 'running', checkpoint: { native_quote_url: 'https://amsco.wtsparadigm.com/quotes/different/details' } }), e => e.status === 400);
  assert.equal(f.current(q.id).checkpoint.native_quote_id, NATIVE_ID);
});
test('terminal report releases and drains once; a failed release is repairable by the same event', async () => {
  const f = await fixture(), one = await f.start(), two = await f.start();
  assert.equal(two.worker_status, 'queued');
  const terminal = f.body(one, { status: 'needs_sign_in', message: 'Sign in needed' });f.controls.failRelease = true;
  await assert.rejects(f.execution.report({ db: f.db, body: terminal }));
  assert.equal(f.current(one.id).agent_run.phase, 'completed');assert.equal(f.calls.send.length, 1);
  await f.execution.report({ db: f.db, body: terminal });
  assert.equal(f.current(two.id).worker_status, 'running');assert.equal(f.calls.send.length, 2);
  await f.execution.report({ db: f.db, body: terminal });assert.equal(f.calls.send.length, 2);
});
test('completed sign-in and failure can resume same revision/conversation with a new capability', async () => {
  for (const status of ['needs_sign_in', 'failed']) {
    const f = await fixture(), q = await f.start();await f.checkpoint(q);
    await f.report(q, { status });
    // The app queue action may set queued before calling afterInput.
    await f.db.QuoteRequests.updateMany({ id: q.id }, { $set: { worker_status: 'queued' } });
    const resumed = await f.execution.afterInput({ db: f.db, q: f.current(q.id) });
    assert.equal(f.calls.create.length, 1);assert.equal(f.calls.send.length, 2);
    assert.notEqual(resumed.agent_run.operation_id, q.agent_run.operation_id);
    assert.notEqual(resumed.agent_run.execution_token, q.agent_run.execution_token);
    assert.equal(resumed.checkpoint.native_quote_id, NATIVE_ID);
    await assert.rejects(f.report(q, { status: 'running' }), e => e.status === 403);
  }
});
test('read keeps private checkpoints but public report responses do not disclose them', async () => {
  const f = await fixture(), q = await f.start();const response = await f.checkpoint(q);
  const read = await f.execution.tool({ db: f.db, body: f.body(q, { action: 'read' }) });
  assert.equal(read.checkpoint.native_quote_url, NATIVE_URL);
  assert.ok(!JSON.stringify(response).includes('wtsparadigm.com'));
  assert.ok(!JSON.stringify(response).includes(q.agent_run.execution_token));
});
test('ready requires checkpointed identity, current price shape, quantity and valid reopen evidence', async () => {
  const f = await fixture(), q = await f.start();
  await assert.rejects(f.report(q, { status: 'ready', result: f.result, verification: f.verification }), e => e.status === 400);
  await f.checkpoint(q);
  await assert.rejects(f.report(q, { status: 'ready', result: f.result, verification: { ...f.verification, checked_at: 'invalid' } }), e => e.status === 400);
  await assert.rejects(f.report(q, { status: 'ready', result: { ...f.result, lines: [{ qty: 1, customer_unit: 142.27, customer_extended: 142.27 }] }, verification: f.verification }), e => e.status === 400);
  const done = await f.report(q, { status: 'ready', result: f.result, verification: f.verification });
  assert.equal(done.status, 'ready');assert.equal(f.records.QuoteWorkers[0].busy_token, '');
  assert.equal(f.current(q.id).conversation.at(-1).content, 'Your quote is ready to be viewed.');
});
test('duplicate event preserves state and cannot append another message or apply changed settings', async () => {
  const f = await fixture(), q = await f.start();const body = f.body(q, { status: 'running', message: 'Private progress' });
  await f.execution.report({ db: f.db, body });const snapshot = f.current(q.id);
  await f.execution.report({ db: f.db, body: { ...body, settings: { gross_margin: 99 } } });
  assert.deepEqual(f.current(q.id), snapshot);
});
test('scoped HTTP handler rejects malformed schema and wrong capabilities without user cookies', async () => {
  const f = await fixture(), q = await f.start();
  const handler = createAgentToolHandler({ execution: f.execution, getClient: async () => ({ asServiceRole: { entities: f.db } }) });
  for (const raw of ['{', 'null', '[]']) assert.equal((await handler(new Request('https://example.test', { method: 'POST', body: raw }))).status, 400);
  const valid = f.body(q, { action: 'read' });
  assert.equal((await handler(new Request('https://example.test', { method: 'POST', body: JSON.stringify(valid) }))).status, 200);
  assert.equal((await handler(new Request('https://example.test', { method: 'POST', body: JSON.stringify({ ...valid, execution_token: 'bad' }) }))).status, 403);
});

