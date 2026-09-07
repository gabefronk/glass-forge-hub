import test from 'node:test';
import assert from 'node:assert/strict';
import { createQuoteIntakeRouter } from '../shared/windowQuoteIntakeRouter.js';

function fixture({ enabled = true, paired = true } = {}) {
  const config = { worker_id: 'new-worker', worker_key_hash: 'hash-for-test-only', expected_plan_hash: 'exact-test-plan', allow: { quote_id: 'new-request', request_id: 'external-id', input_revision: 1, requester_email: 'pilot@example.test' } };
  const worker = { id: config.worker_id, token_hash: config.worker_key_hash, enabled: paired, allowed_dealers: ['BFS'] };
  const q = { id: 'new-request', request_id: 'external-id', requester_email: 'pilot@example.test', input_revision: 1, execution_provider: 'deterministic', worker_status: 'running', agent_run: { worker_id: 'new-worker', plan_hash: 'exact-test-plan', phase: 'running', started_at: '2026-09-07T00:00:00Z', last_seen_at: '2026-09-07T00:00:30Z', lease_expires_at: '2026-09-07T00:10:30Z' } };
  const calls = [];
  const db = Object.fromEntries(Object.entries({ QuoteWorkers: [worker], QuoteRequests: [q] }).map(([name, rows]) => [name, { async filter(query) { calls.push(name); return rows.filter(row => Object.entries(query).every(([key, value]) => row[key] === value)); } }]));
  const delegated = [];
  const router = createQuoteIntakeRouter({ config, scripted: { configured: enabled, afterInput: args => { delegated.push(args); return args.q; } }, now: () => new Date('2026-09-07T00:01:00Z') });
  return { router, config, db, q, worker, calls, delegated };
}

test('disabled provider exposes no invented connection and performs no status database reads', async () => {
  const f = fixture({ enabled: false }), status = await f.router.getStatus({ db: f.db });
  assert.equal(status.configured, false); assert.equal(status.online, false); assert.equal(status.browser_authenticated, null); assert.deepEqual(f.calls, []);
});

test('intake only delegates to the deterministic adapter with no fallback', async () => {
  const f = fixture(); const args = { q: { id: 'new-request' }, db: f.db, user: { role: 'admin' }, action: 'queue' };
  assert.equal(await f.router.afterInput(args), args.q); assert.deepEqual(f.delegated, [args]); assert.equal(f.router.provider, 'deterministic');
});

test('paired configuration and a fresh authenticated active heartbeat are distinct', async () => {
  const f = fixture(); let status = await f.router.getStatus({ db: f.db });
  assert.equal(status.configured, true); assert.equal(status.online, true); assert.equal(status.last_seen_at, f.q.agent_run.last_seen_at); assert.equal(status.browser_authenticated, null);
  delete f.q.agent_run.last_seen_at; status = await f.router.getStatus({ db: f.db }); assert.equal(status.configured, true); assert.equal(status.online, false); assert.equal(status.last_seen_at, null);
  f.worker.enabled = false; status = await f.router.getStatus({ db: f.db }); assert.equal(status.configured, false); assert.equal(status.online, false);
});

test('wrong provider, stale heartbeat, expired lease, completed run or different plan cannot appear online', async () => {
  for (const mutate of [
    f => f.q.execution_provider = 'superagent', f => f.q.agent_run.plan_hash = 'other-plan', f => f.q.input_revision = 2,
    f => f.q.agent_run.last_seen_at = '2026-09-06T23:58:00Z', f => f.q.agent_run.last_seen_at = '2026-09-07T00:02:00Z',
    f => f.q.agent_run.lease_expires_at = '2026-09-07T00:00:59Z', f => f.q.worker_status = 'ready', f => f.q.agent_run.phase = 'completed'
  ]) { const f = fixture(); mutate(f); assert.equal((await f.router.getStatus({ db: f.db })).online, false); }
});
