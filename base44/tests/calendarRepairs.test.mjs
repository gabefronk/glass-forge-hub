import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fetchAllPages } from '../shared/pagination.ts';
import { filterRows } from '../../tests/support/entityFilter.mjs';

// Execute the proposed installer module unchanged except resolving its unchanged
// sanitizer import to the preserved audit dependency tree. No mock sanitizer.
const installerUrl = new URL('../shared/installerCalendar.ts', import.meta.url);
const originalSanitizerUrl = new URL('../shared/sanitize.ts', import.meta.url);
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

test('entity pagination walks ids after the last one and returns rows in the requested order', async () => {
  const queries = [];
  const rows = [{ id: 'a', event_date: '2026-09-01' }, { id: 'b', event_date: '2026-09-03' }, { id: 'c', event_date: '2026-09-02' }];
  const all = await fetchAllPages({ filter: async (q, sort, limit) => { queries.push([q, sort, limit]); return filterRows(rows, q, sort, limit); } }, '-event_date', 2);
  assert.deepEqual(all.map(x => x.id), ['b', 'c', 'a']);
  assert.deepEqual(queries, [[{}, 'id', 2], [{ id: { $gt: 'b' } }, 'id', 2]]);
});

test('entity pagination reads every row exactly once when many rows share a created_date', async () => {
  // 2,500 rows from three bulk creates: skip on -created_date could repeat or miss rows
  // across page boundaries; the id walk cannot.
  const rows = Array.from({ length: 2500 }, (_, i) => ({ id: 'r' + String(i).padStart(5, '0'), created_date: ['2026-08-23T00:31:28.927', '2026-09-01T10:00:00.000', '2026-10-26T12:00:00.000'][i % 3] }));
  const shuffled = [...rows].sort((x, y) => ((x.id.charCodeAt(5) * 7919) % 13) - ((y.id.charCodeAt(5) * 7919) % 13));
  const all = await fetchAllPages({ filter: async (q, sort, limit) => filterRows(shuffled, q, sort, limit) }, '-created_date', 1000);
  assert.equal(all.length, 2500);
  assert.equal(new Set(all.map(x => x.id)).size, 2500);
  // Newest first; ties broken by id, newest id first.
  assert.equal(all[0].created_date, '2026-10-26T12:00:00.000');
  assert.equal(all.at(-1).created_date, '2026-08-23T00:31:28.927');
  for (let i = 1; i < all.length; i++) {
    const [p, c] = [all[i - 1], all[i]];
    assert(p.created_date > c.created_date || (p.created_date === c.created_date && p.id > c.id), `row ${i} out of order`);
  }
});

test('entity pagination sorts numbers numerically and missing values like the database', async () => {
  const rows = [{ id: '1', n: 10 }, { id: '2', n: 9 }, { id: '3' }, { id: '4', n: 100 }];
  const asc = await fetchAllPages({ filter: async (q, sort, limit) => filterRows(rows, q, sort, limit) }, 'n', 10);
  assert.deepEqual(asc.map(x => x.id), ['3', '2', '1', '4']);
  const desc = await fetchAllPages({ filter: async (q, sort, limit) => filterRows(rows, q, sort, limit) }, '-n', 10);
  assert.deepEqual(desc.map(x => x.id), ['4', '1', '2', '3']);
});

test('entity pagination cap throws rather than silently publishing incomplete state', async () => {
  let calls = 0;
  await assert.rejects(fetchAllPages({ filter: async () => [{ id: String(++calls).padStart(3, '0') }] }, '-created_date', 1), /exceeded 50 pages/);
  assert.equal(calls, 50);
});

test('entity pagination accepts an empty final page at the limit', async () => {
  let calls = 0;
  const result = await fetchAllPages({ filter: async () => ++calls === 50 ? [] : [{ id: String(calls).padStart(3, '0') }] }, '-created_date', 1);
  assert.equal(result.length, 49); assert.equal(calls, 50);
});

test('entity provider failure and malformed payloads never return partial rows', async () => {
  let calls = 0;
  await assert.rejects(fetchAllPages({ filter: async () => { if (++calls > 1) throw new Error('provider unavailable'); return [{ id: 'a' }]; } }, '-created_date', 1), /provider unavailable/);
  await assert.rejects(fetchAllPages({ filter: async () => ({ data: [] }) }), /invalid page/);
  // A full page that is not in id order (or repeats the last id) could skip rows: fail closed.
  await assert.rejects(fetchAllPages({ filter: async () => [{ id: 'b' }, { id: 'a' }] }, '-created_date', 2), /out of id order/);
  await assert.rejects(fetchAllPages({ filter: async () => [{ id: 'a' }] }, '-created_date', 1), /out of id order/);
  await assert.rejects(fetchAllPages({ filter: async () => [{ name: 'no id' }] }, '-created_date', 1), /out of id order/);
});
