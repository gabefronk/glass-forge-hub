// New Job wizard draft-budget save: reconcile-before-create, unknown outcomes
// stay read-only (even when the follow-up read is empty), duplicate clicks,
// denied owner, verified rejections, unrelated budgets.
import './support/register-src-alias.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
const { createWizardBudgetSaver, wizardRequestKey } = await import('../src/lib/newJobBudgetDraft.js');
const { isAgentCenterOwner } = await import('../src/lib/agentCenterAccess.js');

const OWNER = { role: 'admin', email: 'gabefronk@gmail.com' };
const KEY = wizardRequestKey('wiz-1');
const JOB = 'job-1';
const rejected = (status) => Object.assign(new Error('rejected'), { response: { status, data: { error: 'invalid' } } });

function mockApi(seed = []) {
  const rows = seed.map((r) => ({ ...r }));
  const calls = { filter: 0, create: 0 };
  const mode = { loseResponse: false, createError: null, hideRows: false, slowCreate: null };
  let seq = 0;
  const api = {
    filter: async (q) => {
      calls.filter++;
      if (mode.readError) throw mode.readError;
      if (mode.hideRows) return { items: [] }; // read lag: written row not visible yet
      return { items: rows.filter((r) => Object.entries(q).every(([k, v]) => r[k] === v)).map((r) => ({ ...r })) };
    },
    create: async (r) => {
      calls.create++;
      if (mode.slowCreate) await mode.slowCreate;
      if (mode.createError) throw mode.createError;
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

test('lost response, record visible: adopted, retry adopts same record', async () => {
  const m = mockApi(); m.mode.loseResponse = true;
  const save = saverFor(m.api);
  const r1 = await save(args);
  assert.equal(r1.state, 'saved'); assert.equal(r1.adopted, true);
  m.mode.loseResponse = false;
  assert.equal((await save(args)).budget.id, r1.budget.id);
  assert.equal(m.calls.create, 1);
});

test('UNCERTAIN-EMPTY-READ (budget): lost response + lagging empty reads → zero second creates', async () => {
  const m = mockApi(); m.mode.loseResponse = true; m.mode.hideRows = true;
  const save = saverFor(m.api);
  assert.equal((await save(args)).state, 'uncertain');
  m.mode.loseResponse = false;
  for (let i = 0; i < 3; i++) assert.equal((await save(args)).state, 'uncertain', 'Check again stays read-only');
  assert.equal(m.calls.create, 1, 'no second create');
  m.mode.hideRows = false; // read catches up
  const r = await save(args);
  assert.equal(r.state, 'saved'); assert.equal(r.adopted, true);
  assert.equal(m.calls.create, 1); assert.equal(ours(m.rows).length, 1);
});

test('5xx / network error with nothing written still locks to read-only', async () => {
  const m = mockApi(); m.mode.createError = Object.assign(new Error('server 500'), { response: { status: 500 } });
  const save = saverFor(m.api);
  assert.equal((await save(args)).state, 'uncertain');
  m.mode.createError = null;
  assert.equal((await save(args)).state, 'uncertain');
  assert.equal(m.calls.create, 1);
});

test('verified pre-write rejection (422) → failed, retry may create exactly one', async () => {
  const m = mockApi(); m.mode.createError = rejected(422);
  const save = saverFor(m.api);
  assert.equal((await save(args)).state, 'failed');
  m.mode.createError = null;
  assert.equal((await save(args)).state, 'saved');
  assert.equal(m.calls.create, 2); assert.equal(ours(m.rows).length, 1);
});

test('read failure before any create → failed (nothing sent), retry creates once', async () => {
  const m = mockApi(); m.mode.readError = new Error('network');
  const save = saverFor(m.api);
  assert.equal((await save(args)).state, 'failed'); assert.equal(m.calls.create, 0);
  m.mode.readError = null;
  assert.equal((await save(args)).state, 'saved'); assert.equal(m.calls.create, 1);
});

test('duplicate click: concurrent second save is busy', async () => {
  const m = mockApi(); let release; m.mode.slowCreate = new Promise((r) => { release = r; });
  const save = saverFor(m.api);
  const p1 = save(args);
  assert.equal((await save(args)).state, 'busy');
  release(); assert.equal((await p1).state, 'saved');
  assert.equal(m.calls.create, 1);
});

test('denied owner: zero API calls', async () => {
  for (const user of [{ role: 'admin', email: 'x@example.com' }, { role: 'user', email: 'gabefronk@gmail.com' }, null]) {
    const m = mockApi();
    assert.equal((await saverFor(m.api, user)(args)).state, 'not_allowed');
    assert.deepEqual(m.calls, { filter: 0, create: 0 });
  }
});

test('unrelated budgets are never adopted', async () => {
  const m = mockApi([
    { id: 'other-key', job_id: JOB, request_key: wizardRequestKey('wiz-OLD') },
    { id: 'no-key', job_id: JOB },
    { id: 'other-job', job_id: 'job-2', request_key: KEY },
    { id: 'deleted', job_id: JOB, request_key: KEY, deleted_at: '2026-10-01' },
  ]);
  const r = await saverFor(m.api)(args);
  assert.equal(r.state, 'saved'); assert.ok(!r.adopted);
  assert.equal(m.calls.create, 1);
});

test('two exact drafts: conflict, no create', async () => {
  const m = mockApi([{ id: 'a', job_id: JOB, request_key: KEY }, { id: 'b', job_id: JOB, request_key: KEY }]);
  const r = await saverFor(m.api)(args);
  assert.equal(r.state, 'conflict'); assert.equal(m.calls.create, 0);
});

test('partial job state: missing job id never creates', async () => {
  const m = mockApi();
  assert.equal((await saverFor(m.api)({ ...args, jobId: '' })).state, 'failed');
  assert.equal(m.calls.create, 0);
});