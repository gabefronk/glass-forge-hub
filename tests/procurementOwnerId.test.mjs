// The procurement / issue_purchase_order entries must reject callers by auth
// user id BEFORE any entity read. Admin role + owner email is not enough.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createProcurementHandler } from '../base44/shared/procurementService.mjs';

function client(user) {
  const state = { touched: false };
  return {
    state,
    getClient: () => ({
      auth: { me: async () => user },
      get asServiceRole() { state.touched = true; throw new Error('entity read'); },
    }),
  };
}
const post = () => new Request('https://unit.test', { method: 'POST', body: '{}' });

test('owner email + admin role but wrong id → 403, no entity read', async () => {
  const c = client({ id: 'ffffffffffffffffffffffff', role: 'admin', email: 'gabefronk@gmail.com' });
  const res = await createProcurementHandler(c.getClient)(post());
  assert.equal(res.status, 403);
  assert.equal(c.state.touched, false);
});

test('unauthenticated → 401, no entity read', async () => {
  const c = client(null);
  const res = await createProcurementHandler(c.getClient)(post());
  assert.equal(res.status, 401);
  assert.equal(c.state.touched, false);
});

test('owner id but non-owner email → existing email/admin guard still rejects, no entity read', async () => {
  const c = client({ id: '6a7f0d834a5f825c724273ea', role: 'admin', email: 'someone@example.com' });
  const res = await createProcurementHandler(c.getClient)(post());
  assert.equal(res.status, 403);
  assert.equal(c.state.touched, false);
});

test('owner id + owner email + admin passes the guard (reaches entity access)', async () => {
  const c = client({ id: '6a7f0d834a5f825c724273ea', role: 'admin', email: 'gabefronk@gmail.com' });
  await createProcurementHandler(c.getClient)(post());
  assert.equal(c.state.touched, true);
});