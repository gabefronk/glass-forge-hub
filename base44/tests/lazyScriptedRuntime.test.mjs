import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createLazyScriptedRuntime } from '../shared/lazyScriptedRuntime.js';
import { loadScriptedRunnerConfig, SCRIPTED_CONFIG_KEY } from '../shared/scriptedRunnerConfig.js';
import { createScriptedRunnerHandler } from '../shared/scriptedRunnerHandler.js';

test('private fixed-key loader does not cache and rejects duplicates or malformed enablement', async () => {
  let rows = [], reads = 0;
  const db = { WindowQuoteRunnerConfig: { async filter(query, sort, limit) { reads++; assert.deepEqual(query, { config_key: SCRIPTED_CONFIG_KEY }); assert.equal(limit, 2); return rows; } } };
  assert.deepEqual(await loadScriptedRunnerConfig({ db }), { enabled: false });
  rows = [{ enabled: false, allow: { quote_id: 'one' }, ignored_private_field: 'not-returned' }];
  const loaded = await loadScriptedRunnerConfig({ db }); assert.deepEqual(loaded, { enabled: false, allow: { quote_id: 'one' } });
  loaded.allow.quote_id = 'changed'; assert.equal(rows[0].allow.quote_id, 'one');
  rows = [{ enabled: false }, { enabled: false }]; await assert.rejects(loadScriptedRunnerConfig({ db }), error => error.status === 503);
  rows = [{ enabled: 'true' }]; await assert.rejects(loadScriptedRunnerConfig({ db }), error => error.status === 503); assert.equal(reads, 4);
  rows = [{ enabled: true, mode: 'quue' }]; await assert.rejects(loadScriptedRunnerConfig({ db }), error => error.status === 503);
});

test('disabled lazy runtime fetches current config independently for each public call', async () => {
  let reads = 0; const runtime = createLazyScriptedRuntime({ loadConfig: async () => { reads++; return { enabled: false }; } });
  const q = { id: 'new-draft' }; assert.equal(await runtime.execution.afterInput({ db: {}, q }), q);
  const status = await runtime.execution.getStatus({ db: {} }); assert.equal(status.configured, false); assert.equal(status.online, false);
  const runner = await runtime.getExecution({ db: {} }); assert.equal(runner.configured, false); assert.equal(reads, 3);
});

test('dynamic runner handler resolves once per HTTP request before authentication and execution', async () => {
  let resolves = 0, authenticates = 0, claims = 0;
  const db = {};
  const handler = createScriptedRunnerHandler({ getClient: async () => ({ asServiceRole: { entities: db } }), getExecution: async args => {
    assert.equal(args.db, db); resolves++; const snapshot = resolves;
    return { authenticate: async () => { authenticates++; return { snapshot }; }, claim: async ({ worker }) => { claims++; assert.equal(worker.snapshot, snapshot); return { ok: true }; } };
  } });
  for (let i = 0; i < 2; i++) { const response = await handler(new Request('https://example.test/runner', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'claim' }) })); assert.equal(response.status, 200); }
  assert.equal(resolves, 2); assert.equal(authenticates, 2); assert.equal(claims, 2);
  assert.throws(() => createScriptedRunnerHandler({ execution: {}, getExecution: async () => ({}) }), /Provide one/);
});

test('configuration schema restricts every operation to administrators and staged record is disabled', () => {
  const schema = JSON.parse(fs.readFileSync(new URL('./assembly/WindowQuoteRunnerConfig.jsonc', import.meta.url), 'utf8'));
  for (const operation of ['create','read','update','delete']) assert.deepEqual(schema.rls[operation], { user_condition: { role: 'admin' } });
  const config = JSON.parse(fs.readFileSync(new URL('./assembly/runner-config.record.disabled.json', import.meta.url), 'utf8'));
  assert.equal(config.enabled, false); assert.equal(config.config_key, SCRIPTED_CONFIG_KEY);
  assert.match(config.worker_key_hash, /^[a-f0-9]{64}$/); assert.match(config.expected_plan_hash, /^[a-f0-9]{64}$/);
  assert.equal(config.worker_id === config.browser_slot_id, false);
  assert.equal('worker_key' in config, false); assert.equal('token' in config, false);
});
