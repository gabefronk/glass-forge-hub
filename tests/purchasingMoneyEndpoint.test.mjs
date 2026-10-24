// Mocked endpoint behavior tests for the purchasingMoney handler. No SDK, no
// live money writes. The mock returns the EntityPage shape documented by the
// installed SDK (items, next_cursor: string|null, has_more: boolean). These
// prove the handler's contract checks; they do not prove the live SDK paginates.
import test from 'node:test';
import assert from 'node:assert/strict';
import { handle, MAX_PAGES } from '../base44/shared/purchasingMoneyHandle.js';

const OWNER = { id: '6a7f0d834a5f825c724273ea', role: 'admin', email: 'gabefronk@gmail.com' };
const JOB = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const JOB2 = 'dddddddddddddddddddddddd';
const M1 = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const M2 = 'eeeeeeeeeeeeeeeeeeeeeeee';
const NEW = 'cccccccccccccccccccccccc';
const req = (body) => ({ json: async () => body });
const page = (items, next = null) => ({ items, next_cursor: next, has_more: next !== null });

function mock(stubs = {}) {
  const calls = { jobsGet: [], moneyList: [], moneyFilter: [], moneyGet: [], moneyUpdate: [], moneyCreate: [] };
  const rec = (k, fn) => (...a) => { calls[k].push(a); return fn(...a); };
  return {
    calls,
    authMe: () => (stubs.authMe ? stubs.authMe() : Promise.resolve(OWNER)),
    jobsGet: rec('jobsGet', stubs.jobsGet || ((id) => Promise.resolve({ id }))),
    moneyList: rec('moneyList', stubs.moneyList || (() => Promise.resolve(page([])))),
    moneyFilter: rec('moneyFilter', stubs.moneyFilter || (() => Promise.resolve(page([])))),
    moneyGet: rec('moneyGet', stubs.moneyGet || ((id) => Promise.resolve({ id, job_id: JOB, rough_labor_material: 5, sale_price: 10 }))),
    moneyUpdate: rec('moneyUpdate', stubs.moneyUpdate || ((id) => Promise.resolve({ id }))),
    moneyCreate: rec('moneyCreate', stubs.moneyCreate || ((d) => Promise.resolve({ id: NEW, ...d }))),
  };
}
const noReads = (a) => Object.values(a.calls).every((c) => c.length === 0);

for (const [name, user] of [['other admin (owner email, wrong id)', { id: 'ffffffffffffffffffffffff', role: 'admin', email: 'gabefronk@gmail.com' }], ['crew', { id: 'ffffffffffffffffffffffff', role: 'user' }], ['null user', null]]) {
  test(`auth: ${name} → 403 before any read (list and save)`, async () => {
    for (const body of [{ action: 'list' }, { action: 'save', job_id: JOB, sale_price: 1 }]) {
      const a = mock({ authMe: () => Promise.resolve(user) });
      const r = await handle(req(body), a);
      assert.equal(r.status, 403);
      assert.ok(noReads(a));
    }
  });
}

test('auth: authMe throws → 403, no reads', async () => {
  const a = mock({ authMe: () => Promise.reject(new Error('boom')) });
  assert.equal((await handle(req({ action: 'list' }), a)).status, 403);
  assert.ok(noReads(a));
});

test('list: owner 200, first page requests sort+limit', async () => {
  const a = mock({ moneyList: () => Promise.resolve(page([{ id: M1, job_id: JOB, rough_labor_material: 5, sale_price: 10 }])) });
  const r = await handle(req({ action: 'list' }), a);
  assert.equal(r.status, 200);
  assert.deepEqual(a.calls.moneyList[0][0], { sort: '-updated_date', limit: 500 });
  assert.deepEqual(r.body.inputs, [{ id: M1, job_id: JOB, rough_labor_material: 5, sale_price: 10 }]);
});

test('list: follows cursor; later pages pass only cursor+limit', async () => {
  let n = 0;
  const a = mock({ moneyList: () => Promise.resolve(n++ === 0 ? page([{ id: M1, job_id: JOB }], 'c1') : page([{ id: M2, job_id: JOB2 }])) });
  const r = await handle(req({ action: 'list' }), a);
  assert.equal(r.status, 200);
  assert.deepEqual(a.calls.moneyList[1][0], { limit: 500, cursor: 'c1' });
  assert.equal(r.body.inputs.length, 2);
});

const listFails = [
  ['plain array (unverifiable completeness)', () => Promise.resolve([]), 'invalid_page'],
  ['unknown shape', () => Promise.resolve({ rows: [] }), 'invalid_page'],
  ['has_more without boolean', () => Promise.resolve({ items: [], next_cursor: null }), 'invalid_page'],
  ['has_more true, no cursor', () => Promise.resolve({ items: [], next_cursor: null, has_more: true }), 'cursor_truncated'],
  ['has_more false, cursor present', () => Promise.resolve({ items: [], next_cursor: 'x', has_more: false }), 'cursor_inconsistent'],
  ['truncated flag', () => Promise.resolve({ ...page([]), truncated: true }), 'page_truncated'],
  ['more items than limit', () => Promise.resolve(page(Array.from({ length: 501 }, () => ({ id: M1, job_id: JOB })))), 'invalid_page'],
  ['repeated cursor', () => Promise.resolve(page([], 'same')), 'cursor_repeated'],
  ['invalid row identity', () => Promise.resolve(page([{ id: 'm1', job_id: 'j1' }])), 'invalid_row'],
  ['raw SDK error text is not returned', () => Promise.reject(new Error('internal sdk detail')), 'list_failed'],
];
for (const [name, stub, code] of listFails) {
  test(`list fails closed: ${name}`, async () => {
    const r = await handle(req({ action: 'list' }), mock({ moneyList: stub }));
    assert.equal(r.status, 500);
    assert.equal(r.body.error, code);
  });
}

test('list: unbounded pagination stops at MAX_PAGES', async () => {
  let n = 0;
  const a = mock({ moneyList: () => Promise.resolve(page([], `c${n++}`)) });
  const r = await handle(req({ action: 'list' }), a);
  assert.equal(r.body.error, 'list_unbounded');
  assert.equal(a.calls.moneyList.length, MAX_PAGES);
});

test('list: duplicate job rows withheld and flagged', async () => {
  const a = mock({ moneyList: () => Promise.resolve(page([{ id: M1, job_id: JOB, sale_price: 1 }, { id: M2, job_id: JOB, sale_price: 2 }])) });
  const r = await handle(req({ action: 'list' }), a);
  assert.deepEqual(r.body.duplicates, [JOB]);
  assert.equal(r.body.inputs[0].sale_price, null);
  assert.equal(r.body.inputs[0].duplicate, true);
});

test('list: malformed stored amount (string / overflow) withholds that job', async () => {
  const a = mock({ moneyList: () => Promise.resolve(page([{ id: M1, job_id: JOB, sale_price: '5' }, { id: M2, job_id: JOB2, rough_labor_material: 1e15 }])) });
  const r = await handle(req({ action: 'list' }), a);
  assert.deepEqual(r.body.invalid.sort(), [JOB, JOB2].sort());
  assert.ok(r.body.inputs.every((i) => i.invalid && i.sale_price === null && i.rough_labor_material === null));
});

test('save: retired (Oct 24) - the old Edit money write is refused with no reads or writes', async () => {
  const a = mock();
  const r = await handle(req({ action: 'save', job_id: JOB, rough_labor_material: 5, sale_price: 10 }), a.adapter);
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'unknown_action');
  assert.equal(a.calls.moneyCreate.length + a.calls.moneyUpdate.length + a.calls.moneyFilter.length, 0);
});

test('unknown action → 400, no reads', async () => {
  const a = mock();
  assert.equal((await handle(req({ action: 'nope' }), a)).status, 400);
  assert.ok(noReads(a));
});