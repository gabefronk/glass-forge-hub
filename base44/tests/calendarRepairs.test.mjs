import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fetchAllPages } from './repairs/base44/shared/pagination.ts';

// Execute the proposed installer module unchanged except resolving its unchanged
// sanitizer import to the preserved audit dependency tree. No mock sanitizer.
const installerUrl = new URL('./repairs/base44/shared/installerCalendar.ts', import.meta.url);
const originalSanitizerUrl = new URL('../source-audit/base44/shared/sanitize.ts', import.meta.url);
const installerSource = (await readFile(installerUrl, 'utf8')).replace("'./sanitize.ts'", JSON.stringify(originalSanitizerUrl.href));
const { fetchInstallerEventMap, buildInstallerEvent, upsertInstallerEvent } = await import('data:text/javascript;base64,' + Buffer.from(installerSource).toString('base64'));
const page = (items = [], nextPageToken) => Response.json({ items, ...(nextPageToken ? { nextPageToken } : {}) });
const mapped = (source, id) => ({ id, extendedProperties: { private: { sourceGoogleEventId: source } } });

test('installer lookup returns identities from later pages before caller can create', async t => {
  const requests = [];
  t.mock.method(globalThis, 'fetch', async (url, options) => {
    requests.push({ url: new URL(url), options });
    return requests.length === 1 ? page([mapped('source-1', 'installer-1')], 'a b/+') : page([mapped('source-2', 'installer-2')]);
  });
  const result = await fetchInstallerEventMap({ Authorization: 'test-only' });
  assert.deepEqual([...result], [['source-1', 'installer-1'], ['source-2', 'installer-2']]);
  assert.equal(requests[1].url.searchParams.get('pageToken'), 'a b/+');
  assert.ok(requests.every(x => !x.options.method));
});

test('provider rejection never becomes an empty successful identity map', async t => {
  t.mock.method(globalThis, 'fetch', async () => new Response('private provider detail', { status: 403 }));
  await assert.rejects(fetchInstallerEventMap({}), error => error.message.includes('HTTP 403') && !error.message.includes('private provider detail'));
});

test('second-page error rejects rather than returning partial lookup', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => ++calls === 1 ? page([mapped('source-1', 'installer-1')], 'next') : new Response('', { status: 503 }));
  await assert.rejects(fetchInstallerEventMap({}), /HTTP 503/);
  assert.equal(calls, 2);
});
test('a provider error payload cannot masquerade as an empty page', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: { message: 'private provider detail' } }));
  await assert.rejects(fetchInstallerEventMap({}), /invalid page/);
});

test('repeated provider pagination token rejects promptly', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return page([], 'same'); });
  await assert.rejects(fetchInstallerEventMap({}), /repeated page token/);
  assert.equal(calls, 2);
});

test('installer lookup signals overflow after its bounded work budget', async t => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => page([], 'page-' + (++calls)));
  await assert.rejects(fetchInstallerEventMap({}), /exceeded 50 pages/);
  assert.equal(calls, 50);
});

test('completed empty calendar remains a successful empty Map', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({}));
  const result = await fetchInstallerEventMap({});
  assert.ok(result instanceof Map); assert.equal(result.size, 0);
});

test('malformed page and missing mapped event identity fail closed', async t => {
  t.mock.method(globalThis, 'fetch', async () => Response.json({ items: 'not a collection' }));
  await assert.rejects(fetchInstallerEventMap({}), /invalid page/);
  t.mock.method(globalThis, 'fetch', async () => page([mapped('source-1', undefined)]));
  await assert.rejects(fetchInstallerEventMap({}), /invalid event identity/);
});

test('23:30 default duration ends next day and preserves existing body fields', () => {
  const result = buildInstallerEvent({ event_date: '2026-12-31', start_time: '23:30', job_name: 'Test job', google_event_id: 'test-source', scope_notes: 'Please bring a ladder.\nLabor $100' });
  assert.equal(result.start.dateTime, '2026-12-31T23:30:00');
  assert.equal(result.end.dateTime, '2027-01-01T00:30:00');
  assert.equal(result.end.timeZone, 'America/Denver');
  assert.equal(result.extendedProperties.private.sourceGoogleEventId, 'test-source');
  assert.ok(!result.description.includes('$100'));
  assert.deepEqual(result.attendees, []);
});

test('provided overnight end clock belongs to following date', () => {
  const result = buildInstallerEvent({ event_date: '2026-09-13', start_time: '22:00', end_time: '02:15', job_name: 'Test job' });
  assert.equal(result.end.dateTime, '2026-09-14T02:15:00');
});

test('same-day and all-day source ends remain unchanged', () => {
  const timed = buildInstallerEvent({ event_date: '2026-09-13', start_time: '09:00', end_time: '11:30', job_name: 'Test job' });
  assert.equal(timed.end.dateTime, '2026-09-13T11:30:00');
  const allDay = buildInstallerEvent({ event_date: '2026-09-13', end_date: '2026-09-16', job_name: 'Test job' });
  assert.deepEqual(allDay.start, { date: '2026-09-13' });
  assert.deepEqual(allDay.end, { date: '2026-09-16' });
});

test('existing installer update preserves success shape and no-notification option', async t => {
  let request;
  t.mock.method(globalThis, 'fetch', async (url, options) => { request = { url: new URL(url), options }; return Response.json({ id: 'existing' }); });
  assert.deepEqual(await upsertInstallerEvent('existing', { summary: 'Test' }, {}), { id: 'existing' });
  assert.equal(request.options.method, 'PUT');
  assert.equal(request.url.searchParams.get('sendUpdates'), 'none');
});

test('entity pagination returns all rows and offsets on proven completion', async () => {
  const offsets = [];
  const all = await fetchAllPages({ list: async (sort, limit, skip) => { offsets.push([sort, limit, skip]); return skip === 0 ? [{ id: 'a' }, { id: 'b' }] : [{ id: 'c' }]; } }, '-event_date', 2);
  assert.deepEqual(all.map(x => x.id), ['a', 'b', 'c']);
  assert.deepEqual(offsets, [['-event_date', 2, 0], ['-event_date', 2, 2]]);
});

test('entity pagination cap throws rather than silently publishing incomplete state', async () => {
  let calls = 0;
  await assert.rejects(fetchAllPages({ list: async () => { calls++; return [{ id: 'x' }]; } }, '-created_date', 1), /exceeded 50 pages/);
  assert.equal(calls, 50);
});

test('entity pagination accepts an empty final page at the limit', async () => {
  let calls = 0;
  const result = await fetchAllPages({ list: async () => ++calls === 50 ? [] : [{ id: String(calls) }] }, '-created_date', 1);
  assert.equal(result.length, 49); assert.equal(calls, 50);
});

test('entity provider failure and malformed payloads never return partial rows', async () => {
  let calls = 0;
  await assert.rejects(fetchAllPages({ list: async () => { if (++calls > 1) throw new Error('provider unavailable'); return [{ id: 'a' }]; } }, '-created_date', 1), /provider unavailable/);
  await assert.rejects(fetchAllPages({ list: async () => ({ data: [] }) }), /invalid page/);
});
