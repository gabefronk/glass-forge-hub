// Mocked endpoint behavior tests for the purchasingMoney handler. No SDK, no
// live money writes — the injectable adapter records every call so we prove:
//  - auth by id BEFORE any entity read (non-owner/crew/null → 403, no reads)
//  - fail-closed reads (unknown shape, cursor truncated, duplicates withhold)
//  - merged/sample/missing job rejected before any money write
//  - exact writes: only present keys are written; omitted keys preserve
//  - readback: the returned input is the stored row, never fabricated
import test from 'node:test';
import assert from 'node:assert/strict';
import { handle } from '../base44/shared/purchasingMoneyHandle.js';

const OWNER = { id: '6a7f0d834a5f825c724273ea', role: 'admin' };
const OTHER_ADMIN = { id: 'other-admin', role: 'admin' };
const CREW = { id: 'crew', role: 'user' };

const req = (body) => ({ json: async () => body });

// Build a mock adapter that records calls. Each method is a stub returning a
// preset value or throwing; tests inspect `calls` to prove ordering/no-read.
const mockAdapter = (stubs = {}) => {
  const calls = { authMe: [], jobsGet: [], moneyList: [], moneyFilter: [], moneyGet: [], moneyUpdate: [], moneyCreate: [] };
  return {
    calls,
    authMe: (...a) => { calls.authMe.push(a); return stubs.authMe ? stubs.authMe(...a) : Promise.resolve(OWNER); },
    jobsGet: (id) => { calls.jobsGet.push([id]); return stubs.jobsGet ? stubs.jobsGet(id) : Promise.resolve({ id, canonical_name: 'J' }); },
    moneyList: (opts) => { calls.moneyList.push([opts]); return stubs.moneyList ? stubs.moneyList(opts) : Promise.resolve({ items: [], has_more: false }); },
    moneyFilter: (q, opts) => { calls.moneyFilter.push([q, opts]); return stubs.moneyFilter ? stubs.moneyFilter(q, opts) : Promise.resolve({ items: [], has_more: false }); },
    moneyGet: (id) => { calls.moneyGet.push([id]); return stubs.moneyGet ? stubs.moneyGet(id) : Promise.resolve({ id, job_id: 'j1', rough_labor_material: 5, sale_price: 10 }); },
    moneyUpdate: (id, patch) => { calls.moneyUpdate.push([id, patch]); return stubs.moneyUpdate ? stubs.moneyUpdate(id, patch) : Promise.resolve({ id }); },
    moneyCreate: (data) => { calls.moneyCreate.push([data]); return stubs.moneyCreate ? stubs.moneyCreate(data) : Promise.resolve({ id: 'm-new' }); },
  };
};

test('list: auth before any read — owner gets 200', async () => {
  const a = mockAdapter();
  const { status, body } = await handle(req({ action: 'list' }), a);
  assert.equal(status, 200);
  assert.deepEqual(a.calls.authMe.length, 1);
  assert.deepEqual(a.calls.moneyList.length, 1);
  assert.ok(Array.isArray(body.inputs));
});

test('list: other admin (wrong id) → 403, no entity reads', async () => {
  const a = mockAdapter({ authMe: () => Promise.resolve(OTHER_ADMIN) });
  const { status, body } = await handle(req({ action: 'list' }), a);
  assert.equal(status, 403);
  assert.equal(body.error, 'forbidden');
  assert.equal(a.calls.moneyList.length, 0);
});

test('list: crew → 403, no entity reads', async () => {
  const a = mockAdapter({ authMe: () => Promise.resolve(CREW) });
  const { status } = await handle(req({ action: 'list' }), a);
  assert.equal(status, 403);
  assert.equal(a.calls.moneyList.length, 0);
});

test('list: null user → 403, no entity reads', async () => {
  const a = mockAdapter({ authMe: () => Promise.resolve(null) });
  const { status } = await handle(req({ action: 'list' }), a);
  assert.equal(status, 403);
  assert.equal(a.calls.moneyList.length, 0);
});

test('list: authMe throws → 403, no entity reads', async () => {
  const a = mockAdapter({ authMe: () => Promise.reject(new Error('boom')) });
  const { status } = await handle(req({ action: 'list' }), a);
  assert.equal(status, 403);
  assert.equal(a.calls.moneyList.length, 0);
});

test('list: paginates until has_more false, collects all rows', async () => {
  let page = 0;
  const a = mockAdapter({ moneyList: () => {
    page++;
    if (page === 1) return Promise.resolve({ items: [{ id: 'm1', job_id: 'j1', rough_labor_material: 1 }], next_cursor: 'c1', has_more: true });
    if (page === 2) return Promise.resolve({ items: [{ id: 'm2', job_id: 'j2', rough_labor_material: 2 }], next_cursor: 'c2', has_more: true });
    return Promise.resolve({ items: [{ id: 'm3', job_id: 'j3', rough_labor_material: 3 }], has_more: false });
  } });
  const { status, body } = await handle(req({ action: 'list' }), a);
  assert.equal(status, 200);
  assert.equal(body.inputs.length, 3);
  assert.equal(a.calls.moneyList.length, 3);
});

test('list: cursor truncated (has_more, no next_cursor) → 500 fail closed', async () => {
  const a = mockAdapter({ moneyList: () => Promise.resolve({ items: [{ id: 'm1', job_id: 'j1' }], has_more: true }) });
  const { status, body } = await handle(req({ action: 'list' }), a);
  assert.equal(status, 500);
  assert.equal(body.error, 'cursor_truncated');
});

test('list: unknown response shape → 500 fail closed', async () => {
  const a = mockAdapter({ moneyList: () => Promise.resolve({ weird: true }) });
  const { status, body } = await handle(req({ action: 'list' }), a);
  assert.equal(status, 500);
  assert.equal(body.error, 'invalid_list_response');
});

test('list: duplicate job_id rows withheld (nulled) and flagged', async () => {
  const a = mockAdapter({ moneyList: () => Promise.resolve({ items: [
    { id: 'm1', job_id: 'j1', rough_labor_material: 5, sale_price: 10 },
    { id: 'm2', job_id: 'j1', rough_labor_material: 9, sale_price: 20 },
  ], has_more: false }) });
  const { status, body } = await handle(req({ action: 'list' }), a);
  assert.equal(status, 200);
  assert.equal(body.inputs.length, 1);
  assert.equal(body.inputs[0].job_id, 'j1');
  assert.equal(body.inputs[0].duplicate, true);
  assert.equal(body.inputs[0].rough_labor_material, null);
  assert.equal(body.inputs[0].sale_price, null);
  assert.deepEqual(body.duplicates, ['j1']);
});

test('list: extra key in body → 400 (strict list keys)', async () => {
  const a = mockAdapter();
  const { status, body } = await handle(req({ action: 'list', extra: 1 }), a);
  assert.equal(status, 400);
  assert.equal(body.error, 'unexpected_field');
  assert.equal(a.calls.moneyList.length, 0);
});

test('save: valid create — exact patch written, readback returned (not fabricated)', async () => {
  const a = mockAdapter({
    moneyFilter: () => Promise.resolve({ items: [], has_more: false }),
    moneyCreate: (data) => Promise.resolve({ id: 'm-new' }),
    moneyGet: (id) => Promise.resolve({ id, job_id: 'j1', rough_labor_material: 5, sale_price: 10 }),
  });
  const { status, body } = await handle(req({ action: 'save', job_id: 'j1', rough_labor_material: 5, sale_price: 10 }), a);
  assert.equal(status, 200);
  assert.deepEqual(body.input, { id: 'm-new', job_id: 'j1', rough_labor_material: 5, sale_price: 10 });
  assert.equal(a.calls.moneyCreate.length, 1);
  assert.equal(a.calls.moneyGet.length, 1); // readback happened
  assert.equal(a.calls.moneyGet[0][0], 'm-new');
});

test('save: update — only present keys written, omitted key preserved', async () => {
  const a = mockAdapter({
    moneyFilter: () => Promise.resolve({ items: [{ id: 'm1', job_id: 'j1', rough_labor_material: 5, sale_price: 10 }], has_more: false }),
    moneyUpdate: (id, patch) => Promise.resolve({ id }),
    moneyGet: (id) => Promise.resolve({ id, job_id: 'j1', rough_labor_material: 7, sale_price: 10 }),
  });
  const { status, body } = await handle(req({ action: 'save', job_id: 'j1', rough_labor_material: 7 }), a);
  assert.equal(status, 200);
  assert.equal(a.calls.moneyUpdate.length, 1);
  assert.deepEqual(a.calls.moneyUpdate[0][1], { rough_labor_material: 7 }); // sale_price NOT in patch
  assert.equal(body.input.rough_labor_material, 7); // readback, not fabricated
});

test('save: duplicate existing rows → withhold write (no first/last pick)', async () => {
  const a = mockAdapter({
    moneyFilter: () => Promise.resolve({ items: [{ id: 'm1', job_id: 'j1' }, { id: 'm2', job_id: 'j1' }], has_more: false }),
  });
  const { status, body } = await handle(req({ action: 'save', job_id: 'j1', rough_labor_material: 5 }), a);
  assert.equal(status, 400);
  assert.equal(body.error, 'duplicate_money');
  assert.equal(a.calls.moneyUpdate.length, 0);
  assert.equal(a.calls.moneyCreate.length, 0);
});

test('save: truncated filter page (has_more) → withhold write', async () => {
  const a = mockAdapter({ moneyFilter: () => Promise.resolve({ items: [{ id: 'm1', job_id: 'j1' }], has_more: true }) });
  const { status, body } = await handle(req({ action: 'save', job_id: 'j1', rough_labor_material: 5 }), a);
  assert.equal(status, 400);
  assert.equal(body.error, 'duplicate_money');
  assert.equal(a.calls.moneyUpdate.length, 0);
});

test('save: filter throws → fail closed, no write', async () => {
  const a = mockAdapter({ moneyFilter: () => Promise.reject(new Error('boom')) });
  const { status, body } = await handle(req({ action: 'save', job_id: 'j1', rough_labor_material: 5 }), a);
  assert.equal(status, 400);
  assert.equal(body.error, 'money_lookup_failed');
  assert.equal(a.calls.moneyUpdate.length, 0);
});

test('save: merged job → rejected before any money write', async () => {
  const a = mockAdapter({ jobsGet: () => Promise.resolve({ id: 'j1', merged_into: 'j2' }) });
  const { status, body } = await handle(req({ action: 'save', job_id: 'j1', rough_labor_material: 5 }), a);
  assert.equal(status, 400);
  assert.equal(body.error, 'job_merged');
  assert.equal(a.calls.moneyFilter.length, 0);
});

test('save: sample job → rejected before any money write', async () => {
  const a = mockAdapter({ jobsGet: () => Promise.resolve({ id: 'j1', is_sample: true }) });
  const { status, body } = await handle(req({ action: 'save', job_id: 'j1', rough_labor_material: 5 }), a);
  assert.equal(status, 400);
  assert.equal(body.error, 'sample_job');
  assert.equal(a.calls.moneyFilter.length, 0);
});

test('save: missing job → rejected before any money write', async () => {
  const a = mockAdapter({ jobsGet: () => Promise.resolve(null) });
  const { status, body } = await handle(req({ action: 'save', job_id: 'j1', rough_labor_material: 5 }), a);
  assert.equal(status, 400);
  assert.equal(body.error, 'job_not_found');
  assert.equal(a.calls.moneyFilter.length, 0);
});

test('save: readback missing → readback_failed, no fabricated input', async () => {
  const a = mockAdapter({
    moneyFilter: () => Promise.resolve({ items: [], has_more: false }),
    moneyCreate: () => Promise.resolve({ id: 'm-new' }),
    moneyGet: () => Promise.resolve(null),
  });
  const { status, body } = await handle(req({ action: 'save', job_id: 'j1', rough_labor_material: 5 }), a);
  assert.equal(status, 400);
  assert.equal(body.error, 'readback_failed');
  assert.equal(body.input, undefined);
});

test('save: non-owner → 403 before any read (jobsGet/moneyFilter never called)', async () => {
  const a = mockAdapter({ authMe: () => Promise.resolve(OTHER_ADMIN) });
  const { status } = await handle(req({ action: 'save', job_id: 'j1', rough_labor_material: 5 }), a);
  assert.equal(status, 403);
  assert.equal(a.calls.jobsGet.length, 0);
  assert.equal(a.calls.moneyFilter.length, 0);
});

test('unknown action → 400', async () => {
  const a = mockAdapter();
  const { status, body } = await handle(req({ action: 'delete' }), a);
  assert.equal(status, 400);
  assert.equal(body.error, 'unknown_action');
});

test('save: invalid amount → 400 before any read', async () => {
  const a = mockAdapter();
  const { status, body } = await handle(req({ action: 'save', job_id: 'j1', rough_labor_material: -5 }), a);
  assert.equal(status, 400);
  assert.equal(body.error, 'invalid_rough_labor_material');
  assert.equal(a.calls.jobsGet.length, 0);
});