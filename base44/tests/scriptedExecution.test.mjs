import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { webcrypto } from 'node:crypto';
import { createScriptedExecution } from '../shared/scriptedExecution.js';
import { createScriptedRunnerHandler } from '../shared/scriptedRunnerHandler.js';
import { sha256, publicQuote, publicMessages } from '../shared/windowQuotesCore.js';
import { buildQuotePlan, verifyObservedQuote } from '../shared/amscoQuotePlan.js';

globalThis.crypto ??= webcrypto;
const clone = value => structuredClone(value);
const canonicalJson = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const KEY = 'synthetic-unit-test-key-never-used-live';
const NATIVE_ID = '12345678-1234-1234-1234-123456789abc';
const NATIVE_URL = 'https://amsco.wtsparadigm.com/quotes/' + NATIVE_ID + '/line-items';
const matches = (row, query) => Object.entries(query).every(([key, value]) => row[key] === value);

async function fixture({ config: changes = {}, normalizeRequest = buildQuotePlan, validateReady = verifyObservedQuote } = {}) {
  let sequence = 0, time = Date.parse('2026-09-06T23:00:00Z');
  const input = JSON.parse(fs.readFileSync(new URL('./fixtures/amsco-scripted-benchmark.json', import.meta.url), 'utf8'));
  const q = { ...input, id: 'scripted-pilot-test', request_id: 'new-request-test', requester_email: 'pilot@example.test', input_revision: 1, state_version: 0, worker_status: 'draft', sales_status: 'open', history: [], conversation: [{ role: 'user', content: 'Use the explicit checked schedule.', client_message_id: 'initial', revision: 1 }] };
  const config = { enabled: true, allow: { quote_id: q.id, request_id: q.request_id, input_revision: 1, requester_email: q.requester_email, dealer: 'BFS', yard: q.settings.yard }, worker_id: 'new-scripted-worker', worker_key_hash: await sha256(KEY), expected_plan_hash: await sha256(canonicalJson(buildQuotePlan(q).plan)), browser_slot_id: 'shared-browser-slot', ...changes };
  const rows = { QuoteRequests: [q], QuoteWorkers: [{ id: config.worker_id, enabled: true, token_hash: config.worker_key_hash, allowed_dealers: ['BFS'] }, { id: config.browser_slot_id, name: 'Base44 Window Quotes browser', busy_token: '', active_quote_id: '', poll_generation: 0 }] };
  const control = { writes: 0, failRelease: false, loseClaimReply: false, beforeClaimWrite: null };
  const db = Object.fromEntries(Object.entries(rows).map(([name, records]) => [name, {
    async filter(query, _sort, limit = 1000) { return clone(records.filter(row => matches(row, query)).slice(0, limit)); },
    async updateMany(query, patch) {
      if (name === 'QuoteWorkers' && control.failRelease && patch.$set.busy_token === '') { control.failRelease = false; throw Error('Synthetic release failure'); }
      if (name === 'QuoteRequests' && patch.$set.agent_run?.claim_id && control.beforeClaimWrite) { const fn = control.beforeClaimWrite; control.beforeClaimWrite = null; fn(); }
      let updated = 0; for (const row of records) if (matches(row, query)) { Object.assign(row, clone(patch.$set)); updated++; control.writes++; }
      if (updated && name === 'QuoteRequests' && patch.$set.agent_run?.claim_id && control.loseClaimReply) { control.loseClaimReply = false; throw Error('Synthetic lost committed claim response'); }
      return { updated };
    }
  }]));
  const execution = createScriptedExecution({ config, normalizeRequest, validateReady, now: () => new Date(time), uuid: () => 'nonce-' + ++sequence });
  const user = { role: 'admin', email: q.requester_email }, worker = rows.QuoteWorkers[0];
  const current = () => clone(rows.QuoteRequests[0]);
  const prepare = () => execution.afterInput({ db, q: current(), user });
  const claimBody = { quote_id: q.id, input_revision: 1, claim_id: 'claim-once' };
  const claim = (body = claimBody) => execution.claim({ db, worker, body });
  const start = async () => { await prepare(); return claim(); };
  const body = (extra = {}) => { const live = current(), run = live.agent_run; return { quote_id: live.id, input_revision: live.input_revision, operation_id: run.operation_id, execution_token: run.execution_token, plan_hash: run.plan_hash, event_id: 'event-' + ++sequence, ...extra }; };
  const savedLines = () => current().agent_run.plan.lines.map((_line, source_index) => ({ source_index, native_line_id: 'saved-line-' + source_index, native_line_number: String((source_index + 1) * 100) }));
  const checkpointValue = (saved = []) => ({ native_quote_id: NATIVE_ID, native_quote_number: 'TEST-NEW', native_quote_url: NATIVE_URL, input_revision: 1, saved_lines: saved });
  const checkpoint = (value = checkpointValue()) => execution.checkpoint({ db, worker, body: body({ action: 'checkpoint', checkpoint: value }) });
  const report = payload => execution.report({ db, worker, body: payload });
  const observe = () => {
    const plan = current().agent_run.plan;
    // Synthetic verification fixture only. These prices never enter native browser work.
    const lines = plan.lines.map((line, index) => ({ ...clone(line), ...savedLines()[index], gross_margin: plan.settings.gross_margin, unit_prices: { list: 200, dealer: 100, customer: 142.27 }, line_totals: { list: 200 * line.qty, dealer: 100 * line.qty, customer: Math.round(14227 * line.qty) / 100 } }));
    const total = kind => lines.reduce((sum, line) => sum + Math.round(line.line_totals[kind] * 100), 0) / 100;
    return { quote_id: q.id, input_revision: 1, native_quote_id: NATIVE_ID, native_quote_number: 'TEST-NEW', native_quote_url: NATIVE_URL, reopened: true, checked_at: new Date(time).toISOString(), dealer: 'BFS', yard: q.settings.yard, gross_margin: q.settings.gross_margin, lines, totals: { list_total: total('list'), dealer_cost: total('dealer'), customer_total: total('customer'), currency: 'USD', tax: 0, freight: 0, labor: 0 } };
  };
  const handler = createScriptedRunnerHandler({ getClient: async () => ({ asServiceRole: { entities: db } }), execution });
  const http = (payload, key = KEY, method = 'POST') => handler(new Request('https://example.test/runner', { method, headers: { 'Content-Type': 'application/json', ...(key ? { 'X-Quote-Worker-Key': key } : {}) }, ...(method === 'POST' ? { body: typeof payload === 'string' ? payload : JSON.stringify(payload) } : {}) }));
  return { execution, db, rows, config, worker, user, current, control, prepare, claim, claimBody, start, body, savedLines, checkpointValue, checkpoint, report, observe, http, advance: ms => time += ms };
}

test('disabled default performs no dispatch; enabled configuration needs both strict injected functions', async () => {
  const execution = createScriptedExecution(), q = { id: 'anything' };
  assert.equal(execution.configured, false); assert.equal(await execution.afterInput({ q }), q);
  await assert.rejects(execution.authenticate({ db: {}, key: KEY }), error => error.status === 503);
  assert.throws(() => createScriptedExecution({ config: { enabled: true } }), /Invalid/);
  const f = await fixture({ config: { enabled: false } }); assert.equal((await f.http({ action: 'claim', ...f.claimBody })).status, 503); assert.equal(f.control.writes, 0);
});

test('runner endpoint requires new paired key and only four bounded POST actions', async () => {
  const f = await fixture();
  for (const key of [null, 'short', 'a-wrong-key-with-sufficient-length']) assert.equal((await f.http({ action: 'claim', ...f.claimBody }, key)).status, 401);
  assert.equal((await f.http({ action: 'worker_poll' })).status, 400);
  assert.equal((await f.http(null)).status, 400); assert.equal((await f.http('{')).status, 400);
  assert.equal((await f.http({}, KEY, 'GET')).status, 405);
  assert.equal((await f.http(' '.repeat(600001))).status, 413);
  f.worker.enabled = false; assert.equal((await f.http({ action: 'claim', ...f.claimBody })).status, 401);
  assert.equal(f.control.writes, 0);
});

test('preflight preserves original inputs, queues a private complete plan and dedupes preparation', async () => {
  const f = await fixture(), before = f.current(); const q = await f.prepare();
  assert.equal(q.worker_status, 'queued'); assert.equal(q.execution_provider, 'deterministic'); assert.deepEqual(q.lines, before.lines); assert.deepEqual(q.settings, before.settings);
  assert.equal(q.agent_run.plan.quote_id, q.id); assert.ok(q.agent_run.plan_hash); assert.ok(q.agent_run.input_hash);
  const writes = f.control.writes; await f.prepare(); assert.equal(f.control.writes, writes);
  const safe = publicQuote(q); assert.equal(safe.agent_run, undefined); assert.equal(safe.checkpoint, undefined);
});

test('unsupported or missing choices ask complete questions without claiming the browser', async () => {
  const f = await fixture(); delete f.rows.QuoteRequests[0].lines[0].options.glass;
  const q = await f.prepare(); assert.equal(q.worker_status, 'needs_details'); assert.ok(q.missing_details[0].length > 20); assert.equal(q.agent_run, undefined);
  assert.equal(f.rows.QuoteWorkers[1].busy_token, ''); const messages = publicMessages(q); assert.ok(messages.some(m => m.kind === 'clarification'));
  const writes = f.control.writes; await f.prepare(); assert.equal(f.control.writes, writes);
  await assert.rejects(f.claim(), error => error.status === 409);
});

test('scope rejects other identity/revision/owner/dealer/yard and prior native or failed executions', async () => {
  for (const change of [
    q => q.request_id = 'another-request', q => q.id = '6a9dadff1e196279b733762e', q => q.input_revision = 2, q => q.requester_email = 'other@example.test',
    q => q.settings.dealer = 'BTB', q => q.settings.yard = 'ANOTHER YARD', q => q.worker_status = 'failed', q => q.worker_status = 'running',
    q => q.checkpoint = { native_quote_id: NATIVE_ID }, q => q.history = [{ checkpoint: { native_quote_number: '3516421' } }],
    q => q.agent_run = { phase: 'completed' }, q => q.execution_provider = 'superagent', q => q.result = { verified: true }, q => q.job_id = 'accepted-job'
  ]) { const f = await fixture(); change(f.rows.QuoteRequests[0]); await assert.rejects(f.prepare(), error => [403,409].includes(error.status)); assert.equal(f.rows.QuoteWorkers[1].busy_token, ''); }
  const f = await fixture(); await assert.rejects(f.execution.afterInput({ db: f.db, q: f.current(), user: { role: 'admin', email: 'other@example.test' } }), error => error.status === 403);
});

test('normalizer cannot change explicit finance or dimensions; post-queue input drift blocks claim', async () => {
  const f = await fixture({ normalizeRequest: q => { const normalized = buildQuotePlan(q); normalized.plan.settings.gross_margin = 10; return normalized; } });
  await assert.rejects(f.prepare(), error => error.status === 400);
  const g = await fixture(); await g.prepare(); g.rows.QuoteRequests[0].lines[0].width = 38; await assert.rejects(g.claim(), error => error.status === 409); assert.equal(g.rows.QuoteWorkers[1].busy_token, '');
});

test('concurrent claims cannot start two operations and same claim retry recovers its one handoff', async () => {
  const f = await fixture(); await f.prepare();
  const outcomes = await Promise.allSettled([f.claim(), f.claim({ ...f.claimBody, claim_id: 'different-launch' })]);
  assert.equal(outcomes.filter(item => item.status === 'fulfilled').length, 1);
  const operation = f.current().agent_run.operation_id; const retry = await f.claim(); assert.equal(retry.quote.operation_id, operation); assert.equal(retry.replayed, true);
  assert.equal(retry.quote.plan.quote_id, f.current().id); assert.equal(retry.quote.messages, undefined);
  await assert.rejects(f.claim({ ...f.claimBody, input_revision: 2 }), error => error.status === 403);
});

test('lost committed claim response is reconciled and competing input change releases only owned lock', async () => {
  const f = await fixture(); await f.prepare(); f.control.loseClaimReply = true;
  const claim = await f.claim(); assert.equal(claim.quote.operation_id, f.current().agent_run.operation_id); assert.ok(f.rows.QuoteWorkers[1].busy_token);
  const g = await fixture(); await g.prepare(); g.control.beforeClaimWrite = () => g.rows.QuoteRequests[0].state_version++;
  await assert.rejects(g.claim(), error => error.status === 409); assert.equal(g.rows.QuoteWorkers[1].busy_token, '');
});

test('busy or expired shared browser locks are never taken over', async () => {
  const f = await fixture(); await f.prepare(); Object.assign(f.rows.QuoteWorkers[1], { busy_token: 'another-operation', busy_until: '2000-01-01T00:00:00Z' });
  await assert.rejects(f.claim(), error => error.status === 409); assert.equal(f.rows.QuoteWorkers[1].busy_token, 'another-operation');
});

test('heartbeat returns real server expiry; expired or changed operation cannot continue or reclaim', async () => {
  const f = await fixture(); await f.start(); const before = f.current().agent_run.lease_expires_at; f.advance(30000);
  const beat = await f.execution.heartbeat({ db: f.db, worker: f.worker, body: f.body({ action: 'heartbeat' }) }); assert.ok(beat.lease_expires_at > before);
  await assert.rejects(f.execution.heartbeat({ db: f.db, worker: f.worker, body: f.body({ operation_id: 'old-operation' }) }), error => error.status === 403);
  f.advance(600001); await assert.rejects(f.checkpoint(), error => error.status === 409); await assert.rejects(f.claim(), error => error.status === 409); assert.ok(f.rows.QuoteWorkers[1].busy_token);
});

test('checkpoint identity is immutable, rejects old native quote and retains each saved line', async () => {
  const f = await fixture(); await f.start();
  await assert.rejects(f.checkpoint({ ...f.checkpointValue(), native_quote_id: 'not-a-guid', native_quote_url: 'https://amsco.wtsparadigm.com/quotes/not-a-guid/line-items' }), error => error.status === 400);
  assert.equal(f.current().checkpoint, undefined);
  await assert.rejects(f.checkpoint({ ...f.checkpointValue(), native_quote_number: '3516421' }), error => error.status === 400);
  await assert.rejects(f.checkpoint({ ...f.checkpointValue(), native_quote_url: NATIVE_URL + '?token=not-real' }), error => error.status === 400);
  await f.checkpoint(); await f.checkpoint(f.checkpointValue(f.savedLines().slice(0,1)));
  await assert.rejects(f.checkpoint(f.checkpointValue()), error => error.status === 409);
  await assert.rejects(f.checkpoint({ ...f.checkpointValue(f.savedLines()), native_quote_number: 'different-quote' }), error => error.status === 409);
  await f.checkpoint(f.checkpointValue(f.savedLines())); assert.equal(f.current().checkpoint.saved_lines.length, f.savedLines().length);
});

test('checkpoint retry is idempotent but changed payload, stale plan and old callback are rejected', async () => {
  const f = await fixture(); await f.start(); const body = f.body({ action: 'checkpoint', checkpoint: f.checkpointValue() });
  await f.execution.checkpoint({ db: f.db, worker: f.worker, body }); const version = f.current().state_version;
  assert.equal((await f.execution.checkpoint({ db: f.db, worker: f.worker, body })).replayed, true); assert.equal(f.current().state_version, version);
  await assert.rejects(f.execution.checkpoint({ db: f.db, worker: f.worker, body: { ...body, message: 'different payload' } }), error => error.status === 409);
  await assert.rejects(f.report(f.body({ action: 'report', status: 'failed', plan_hash: 'wrong' })), error => error.status === 403);
  assert.equal((await f.http({ ...body, quote_id: '6a9dadff1e196279b733762e' })).status, 403);
});

test('Ready requires checkpointed saved lines, actual reopened identity and successful strict verifier', async () => {
  const f = await fixture(); await f.start();
  await assert.rejects(f.report(f.body({ action: 'report', status: 'ready', observed: f.observe() })), error => error.status === 400);
  await assert.rejects(f.report(f.body({ action: 'report', status: 'ready', observed: f.observe(), checkpoint: f.checkpointValue(f.savedLines()) })), error => error.status === 400);
  await f.checkpoint(f.checkpointValue(f.savedLines()));
  for (const mutate of [
    o => o.reopened = false, o => o.checked_at = '2020-01-01T00:00:00Z', o => o.native_quote_id = 'different-native', o => o.lines[0].width = 50,
    o => o.lines[0].options.color = 'White', o => o.lines[0].unit_prices.customer = 999, o => o.totals.customer_total = 123, o => o.lines[0].native_line_id = 'uncheckpointed-line'
  ]) { const observed = f.observe(); mutate(observed); await assert.rejects(f.report(f.body({ action: 'report', status: 'ready', observed })), error => error.status === 400); assert.equal(f.current().worker_status, 'running'); }
  await assert.rejects(f.report(f.body({ action: 'report', status: 'ready', observed: f.observe(), result: { verified: true } })), error => error.status === 400);
  const accepted = await f.report(f.body({ action: 'report', status: 'ready', observed: f.observe() }));
  assert.equal(accepted.status, 'ready'); assert.equal(accepted.quote.agent_run, undefined); assert.equal(accepted.quote.checkpoint, undefined); assert.equal(accepted.quote.result.native_quote_url, undefined);
  assert.equal(f.current().result.lines[0].unit_prices.customer, 142.27); assert.equal(f.rows.QuoteWorkers[1].busy_token, ''); assert.equal(publicMessages(f.current()).at(-1).content, 'Your quote is ready to be viewed.');
});

test('terminal replay repairs lost release, cannot change payload or start another operation', async () => {
  const f = await fixture(); await f.start(); await f.checkpoint(); const payload = f.body({ action: 'report', status: 'failed', message: 'Saved window needs review.' });
  f.control.failRelease = true; await assert.rejects(f.report(payload)); assert.equal(f.current().worker_status, 'failed'); assert.ok(f.rows.QuoteWorkers[1].busy_token);
  const retry = await f.report(payload); assert.equal(retry.replayed, true); assert.equal(f.rows.QuoteWorkers[1].busy_token, ''); assert.equal(f.current().result, undefined);
  await assert.rejects(f.report({ ...payload, event_id: 'new-terminal-event' }), error => error.status === 409);
  await assert.rejects(f.claim(), error => error.status === 409); await assert.rejects(f.prepare(), error => error.status === 409);
});

test('Ready replay remains idempotent after completion and never releases another browser owner', async () => {
  const f = await fixture(); await f.start(); await f.checkpoint(f.checkpointValue(f.savedLines())); const payload = f.body({ action: 'report', status: 'ready', observed: f.observe() });
  await f.report(payload); Object.assign(f.rows.QuoteWorkers[1], { busy_token: 'new-unrelated-operation', active_quote_id: 'other-request' });
  assert.equal((await f.report(payload)).replayed, true); assert.equal(f.rows.QuoteWorkers[1].busy_token, 'new-unrelated-operation');
});

test('a malformed stored lease never produces a reusable claim handoff', async () => {
  const f = await fixture(); await f.start(); delete f.rows.QuoteRequests[0].agent_run.lease_expires_at;
  await assert.rejects(f.claim(), error => error.status === 409);
  assert.ok(f.rows.QuoteWorkers[1].busy_token);
});

test('identical Ready replay repairs its lock after a lost release and later Won conversion', async () => {
  const f = await fixture(); await f.start(); await f.checkpoint(f.checkpointValue(f.savedLines()));
  const payload = f.body({ action: 'report', status: 'ready', observed: f.observe() });
  f.control.failRelease = true; await assert.rejects(f.report(payload));
  assert.equal(f.current().worker_status, 'ready'); assert.ok(f.rows.QuoteWorkers[1].busy_token);
  Object.assign(f.rows.QuoteRequests[0], { sales_status: 'won', job_id: 'accepted-job', accepted_revision: 1 });
  const accepted = f.current();
  assert.equal((await f.report(payload)).replayed, true); assert.equal(f.rows.QuoteWorkers[1].busy_token, '');
  assert.deepEqual(f.current(), accepted);
  await assert.rejects(f.report({ ...payload, event_id: 'new-ready-event' }), error => error.status === 409);
  await assert.rejects(f.report({ ...payload, message: 'different completed payload' }), error => error.status === 409);
  await assert.rejects(f.report({ ...payload, execution_token: 'wrong-operation-token' }), error => error.status === 403);
  await assert.rejects(f.claim(), error => error.status === 409);
});

test('enabled pilot requires an exact approved plan hash and rejects different supported input', async () => {
  await assert.rejects(fixture({ config: { expected_plan_hash: undefined } }), error => error.status === 503);
  const f = await fixture({ config: { expected_plan_hash: '0'.repeat(64) } });
  await assert.rejects(f.prepare(), error => error.status === 403); assert.equal(f.current().worker_status, 'draft');
  const g = await fixture(); g.rows.QuoteRequests[0].lines[0].width += 1;
  await assert.rejects(g.prepare(), error => error.status === 403); assert.equal(g.rows.QuoteWorkers[1].busy_token, '');
});

test('claim and claim retry recheck the configured exact plan hash', async () => {
  const f = await fixture(); await f.prepare(); f.rows.QuoteRequests[0].agent_run.plan.title = 'Changed after preparation';
  f.rows.QuoteRequests[0].agent_run.plan_hash = await sha256(canonicalJson(f.rows.QuoteRequests[0].agent_run.plan));
  await assert.rejects(f.claim(), error => error.status === 409); assert.equal(f.rows.QuoteWorkers[1].busy_token, '');
  const g = await fixture(); await g.start(); g.rows.QuoteRequests[0].agent_run.plan.title = 'Changed while running';
  await assert.rejects(g.claim(), error => error.status === 409); assert.ok(g.rows.QuoteWorkers[1].busy_token);
});
