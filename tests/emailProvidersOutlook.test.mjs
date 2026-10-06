import test from 'node:test';
import assert from 'node:assert/strict';
import { createOutlookClient } from '../base44/shared/emailProviders.js';

function fetchWith(handler) {
  return async (url, init = {}) => {
    const r = handler(url, init.method || 'GET', init.body ? JSON.parse(init.body) : null);
    const status = r.status || 200;
    return { ok: status < 400, status, headers: { get: () => null }, body: { cancel: async () => {} }, text: async () => (r.data === undefined ? '' : JSON.stringify(r.data)) };
  };
}

test('outlook ensureLabels: without MailboxSettings scope the master list is skipped, names are cached as uncoloured, and the categories still apply by name', async () => {
  const calls = [];
  const fetchImpl = fetchWith((url, method) => {
    calls.push(`${method} ${new URL(url).pathname}`);
    if (url.includes('/outlook/masterCategories')) return { status: 403, data: { error: { code: 'ErrorAccessDenied', message: 'Access is denied.' } } };
    if (method === 'PATCH') return { data: {} };
    return { status: 404, data: {} };
  });
  const c = createOutlookClient({ accessToken: 't', fetchImpl, sleep: async () => {} });
  const map = await c.ensureLabels(['Hub', 'Hub/Schedule'], {});
  assert.deepEqual(map, { Hub: 'uncoloured', 'Hub/Schedule': 'uncoloured' });
  // cached: the second call never touches the master list again
  const again = await c.ensureLabels(['Hub', 'Hub/Schedule'], map);
  assert.deepEqual(again, map);
  assert.equal(calls.filter((x) => x.includes('masterCategories')).length, 1);
  await c.setCategories('m1', ['Hub', 'Hub/Schedule']);
  assert.ok(calls.some((x) => x === 'PATCH /v1.0/me/messages/m1'));
});

test('outlook ensureLabels: with the scope, missing categories are created with a colour', async () => {
  const master = [{ id: 'c1', displayName: 'Hub' }];
  const fetchImpl = fetchWith((url, method, body) => {
    if (url.includes('/outlook/masterCategories') && method === 'GET') return { data: { value: master } };
    if (url.includes('/outlook/masterCategories') && method === 'POST') { const made = { id: `c-${master.length + 1}`, displayName: body.displayName }; master.push(made); assert.match(body.color, /^preset\d+$/); return { data: made }; }
    return { status: 404, data: {} };
  });
  const c = createOutlookClient({ accessToken: 't', fetchImpl, sleep: async () => {} });
  const map = await c.ensureLabels(['Hub', 'Hub/Schedule'], {});
  assert.deepEqual(map, { Hub: 'c1', 'Hub/Schedule': 'c-2' });
});
