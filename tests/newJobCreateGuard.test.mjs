// New Job wizard Jobs.create guard: an unknown create outcome locks the session
// even when the follow-up read is empty; only a verified rejection allows retry.
import './support/register-src-alias.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
const { createJobGuard } = await import('../src/lib/newJobCreateGuard.js');

function mockJobs() {
  const calls = { create: 0, filter: 0 };
  const mode = { error: null, writeThenLose: false, hideRows: false };
  const rows = [];
  const api = {
    create: async (p) => {
      calls.create++;
      if (mode.error && !mode.writeThenLose) throw mode.error;
      const row = { ...p, id: `job-${calls.create}` }; rows.push(row);
      if (mode.writeThenLose) throw new Error('response lost');
      return row;
    },
    filter: async (q) => { calls.filter++; return { items: mode.hideRows ? [] : rows.filter((r) => r.canonical_name === q.canonical_name) }; },
  };
  return { api, calls, mode, rows };
}
const payload = { canonical_name: 'Shelby Homes - 215 Skyridge', address: '215 Skyridge' };

test('UNCERTAIN-EMPTY-READ (job): lost response + empty read → locked, zero second creates', async () => {
  const m = mockJobs(); m.mode.writeThenLose = true; m.mode.hideRows = true;
  const create = createJobGuard({ api: m.api });
  const r = await create(payload);
  assert.equal(r.state, 'uncertain'); assert.deepEqual(r.matches, []);
  m.mode.writeThenLose = false;
  for (let i = 0; i < 3; i++) assert.equal((await create(payload)).state, 'locked');
  assert.equal(m.calls.create, 1);
});

test('lost response with visible record: matches shown read-only, still no recreate', async () => {
  const m = mockJobs(); m.mode.writeThenLose = true;
  const create = createJobGuard({ api: m.api });
  const r = await create(payload);
  assert.equal(r.state, 'uncertain'); assert.equal(r.matches.length, 1);
  assert.equal((await create(payload)).state, 'locked'); assert.equal(m.calls.create, 1);
});

test('network/5xx without status → uncertain lock', async () => {
  const m = mockJobs(); m.mode.error = new Error('Failed to fetch');
  const create = createJobGuard({ api: m.api });
  assert.equal((await create(payload)).state, 'uncertain');
  m.mode.error = null;
  assert.equal((await create(payload)).state, 'locked'); assert.equal(m.calls.create, 1);
});

test('verified rejection (400) → rejected, retry allowed once fixed', async () => {
  const m = mockJobs(); m.mode.error = Object.assign(new Error('bad'), { response: { status: 400 } });
  const create = createJobGuard({ api: m.api });
  assert.equal((await create(payload)).state, 'rejected');
  m.mode.error = null;
  assert.equal((await create(payload)).state, 'created');
  assert.equal((await create(payload)).state, 'locked'); assert.equal(m.calls.create, 2);
});