// New Job wizard draft-budget save: reconcile-before-create, lost responses,
// uncertain reads, duplicate clicks, denied owner, unrelated budgets.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createWizardBudgetSaver, wizardRequestKey } from '../src/lib/newJobBudgetDraft.js';
import { isAgentCenterOwner } from '../src/lib/agentCenterAccess.js';

const OWNER = { role: 'admin', email: 'gabefronk@gmail.com' };
const KEY = wizardRequestKey('wiz-1');
const JOB = 'job-1';

function mockApi(seed = []) {
  const rows = seed.map((r) => ({ ...r }));
  const calls = { filter: 0, create: 0 };
  const mode = { loseResponse: false, createFails: false, readFails: false, slowCreate: null };
  let seq = 0;
  const api = {
    filter: async (q) => {
      calls.filter++;
      if (mode.readFails) throw new Error('network');
      return { items: rows.filter((r) => Object.entries(q).every(([k, v]) => r[k] === v)).map((r) => ({ ...r })) };
    },
    create: async (r) => {
      calls.create++;
      if (mode.slowCreate) await mode.slowCreate;
      if (mode.createFails) throw new Error('server 500');
      const row = { ...r, id: `bud-${++seq}` };
      rows.push(row);
      if (mode.loseResponse) throw new Error('response lost');
      return { ...row };
    },
  };
  return { api, rows, calls, mode };
}
const saverFor = (api, user = OWNER) => createWizardBudgetSaver({ api, getUser: async () => user, isOwner: isAgentCenterOwner });
const ours = (rows) => rows.filter((r) => r.job_id === JOB && r.request_key === KEY);
const args = { jobId: JOB, requestKey: KEY, payload: { title: 'T', status: 'draft' } };

test('lost response: server created it, saver adopts it, retry adopts the same record', async () => {
  const m = mockApi(); m.mode.loseResponse = true;
  const save = saverFor(m.api);
  const r1 = await save(args);
  assert.equal(r1.state, 'saved'); assert.equal(r1.adopted, true);
  m.mode.loseResponse = false;
  const r2 = await save(args);
  assert.equal(r2.state, 'saved'); assert.equal(r2.budget.id, r1.budget.id);
  assert.equal(m.calls.create, 1); assert.equal(ours(m.rows).length, 1);
});

test('lost response + unreadable: uncertain, no blind create until a read proves state; job id kept', async () => {
  const m = mockApi(); m.mode.loseResponse = true;
  const save = saverFor(m.api);
  const origFilter = m.api.filter; let n = 0;
  m.api.filter = async (q) => { n++; if (n >= 2) throw new Error('network'); return origFilter(q); };
  assert.equal((await save(args)).state, 'uncertain');
  assert.equal((await save(args)).state, 'uncertain', 'retry while unreadable stays uncertain');
  assert.equal(m.calls.create, 1, 'no second create while uncertain');
  m.api.filter = origFilter; m.mode.loseResponse = false;
  const r = await save(args);
  assert.equal(r.state, 'saved'); assert.equal(r.adopted, true); assert.equal(r.budget.job_id, JOB);
  assert.equal(m.calls.create, 1); assert.equal(ours(m.rows).length, 1);
});

test('duplicate click: concurrent second save is rejected as busy', async () => {
  const m = mockApi(); let release; m.mode.slowCreate = new Promise((r) => { release = r; });
  const save = saverFor(m.api);
  const p1 = save(args); const r2 = await save(args);
  assert.equal(r2.state, 'busy');
  release(); assert.equal((await p1).state, 'saved');
  assert.equal(m.calls.create, 1); assert.equal(ours(m.rows).length, 1);
});

test('denied owner: non-owner admin and plain user make zero API calls', async () => {
  for (const user of [{ role: 'admin', email: 'x@example.com' }, { role: 'user', email: 'gabefronk@gmail.com' }, null]) {
    const m = mockApi();
    assert.equal((await saverFor(m.api, user)(args)).state, 'not_allowed');
    assert.deepEqual(m.calls, { filter: 0, create: 0 });
  }
});

test('real failure: proven absent → failed; retry reconciles then creates exactly one', async () => {
  const m = mockApi(); m.mode.createFails = true;
  const save = saverFor(m.api);
  assert.equal((await save(args)).state, 'failed');
  assert.equal(ours(m.rows).length, 0);
  m.mode.createFails = false;
  assert.equal((await save(args)).state, 'saved');
  assert.equal(ours(m.rows).length, 1);
});

test('unrelated budgets are never adopted (other key, other job, deleted)', async () => {
  const m = mockApi([
    { id: 'other-key', job_id: JOB, request_key: wizardRequestKey('wiz-OLD') },
    { id: 'no-key', job_id: JOB },
    { id: 'other-job', job_id: 'job-2', request_key: KEY },
    { id: 'deleted', job_id: JOB, request_key: KEY, deleted_at: '2026-10-01' },
  ]);
  const r = await saverFor(m.api)(args);
  assert.equal(r.state, 'saved'); assert.ok(!r.adopted);
  assert.ok(!['other-key', 'no-key', 'other-job', 'deleted'].includes(r.budget.id));
  assert.equal(m.calls.create, 1);
});

test('two exact drafts already exist: conflict, no create', async () => {
  const m = mockApi([{ id: 'a', job_id: JOB, request_key: KEY }, { id: 'b', job_id: JOB, request_key: KEY }]);
  const r = await saverFor(m.api)(args);
  assert.equal(r.state, 'conflict'); assert.deepEqual(r.ids, ['a', 'b']); assert.equal(m.calls.create, 0);
});

test('partial job state: missing job id never creates', async () => {
  const m = mockApi();
  assert.equal((await saverFor(m.api)({ ...args, jobId: '' })).state, 'failed');
  assert.equal(m.calls.create, 0);
});