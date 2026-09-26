import test from 'node:test';
import assert from 'node:assert/strict';
import { readTrackerView } from '../base44/shared/salesTrackerView.js';

const client = (snapshot, calls) => ({
  asServiceRole: {
    entities: {
      SalesTrackerSnapshot: { filter: async () => [snapshot] },
      SalesTrackerAppendBatch: { filter: async () => { calls.batches++; return []; } },
    },
    integrations: { Core: { CreateFileSignedUrl: async () => { calls.signed++; return { signed_url: 'https://example.test/wb.xlsx' }; } } },
  },
});

test('calendar tracker cache: same snapshot and sha reuse the parsed workbook, batches are always re-read', async () => {
  const calls = { signed: 0, batches: 0, fetch: 0 };
  const snap = { id: 'snap1', sha256: 'abc', file_uri: 'f' };
  const base = { rows: [{ builder: 'Pulte', lot: '12' }] };
  const cache = new Map([['snap1|abc', { bytes: new Uint8Array([1]), base }]]);
  const view = await readTrackerView(client(snap, calls), {}, async () => { calls.fetch++; return { ok: false }; }, cache);
  assert.equal(calls.fetch, 0);
  assert.equal(calls.signed, 0);
  assert.equal(calls.batches, 1);
  assert.deepEqual(view.rows, base.rows);
});

test('calendar tracker cache: a new workbook (different sha) is downloaded again', async () => {
  const calls = { signed: 0, batches: 0, fetch: 0 };
  const cache = new Map([['snap1|abc', { bytes: new Uint8Array([1]), base: { rows: [] } }]]);
  await assert.rejects(
    readTrackerView(client({ id: 'snap1', sha256: 'NEW', file_uri: 'f' }, calls), {}, async () => { calls.fetch++; return { ok: false }; }, cache),
    /workbook is unavailable/
  );
  assert.equal(calls.fetch, 1);
});
