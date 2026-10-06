import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFieldReportsCore, paginateFieldReports } from '../src/lib/jobFieldReportsLoader.js';

// Mock reader over an in-memory table. Returns an ARRAY (matching the
// documented positional SDK form). Paginates by skip; ignoreSkip simulates a
// reader that ignores skip (returns the first page every time). failOn(query)
// -> throw simulates a read failure for a specific query shape.
function makeReader(rows, { failOn, ignoreSkip = false } = {}) {
  return async (query, opts = {}) => {
    if (failOn && failOn(query)) throw new Error('read failed');
    const limit = opts.limit || 2000;
    const skip = ignoreSkip ? 0 : (opts.skip || 0);
    const matches = (r) => Object.entries(query).every(([k, v]) => {
      if (v === null) return r[k] == null;
      if (v && typeof v === 'object' && '$in' in v) return v.$in.includes(r[k]);
      return r[k] === v;
    });
    const all = rows.filter(matches).sort((a, b) => String(b.created_date || '').localeCompare(String(a.created_date || '')));
    return all.slice(skip, skip + limit); // ARRAY
  };
}

const memberIds = ['j1'];
const postIds = ['post-A'];

test('reader contract: paginateFieldReports calls reader(query, { sort, limit, skip }) and expects an array', async () => {
  const calls = [];
  const reader = async (query, opts) => { calls.push({ query, opts }); return [{ id: 'r1', job_id: 'j1', post_id: 'pX', job_name: '', photo_urls: [] }]; };
  const out = await paginateFieldReports(reader, { job_id: 'j1' }, { limit: 10 });
  assert.equal(out.length, 1);
  assert.deepEqual(calls[0].query, { job_id: 'j1' });
  assert.deepEqual(calls[0].opts, { sort: '-created_date', limit: 10, skip: 0 }, 'positional contract: sort/limit/skip passed in the opts bag the adapter forwards positionally');
});

test('direct: reports linked to a member job_id are returned', async () => {
  const rows = [
    { id: 'r1', job_id: 'j1', post_id: 'pX', job_name: 'Other', photo_urls: ['u1'] },
    { id: 'r2', job_id: 'jX', post_id: 'pY', job_name: 'Foreign', photo_urls: [] },
  ];
  const out = await loadFieldReportsCore(makeReader(rows), { memberIds, postIds: [], preloadedAllReports: null, legacyNames: [] });
  assert.deepEqual(out.map((r) => r.id), ['r1']);
  assert.deepEqual(out[0].photo_urls, ['u1'], 'photo association retained');
});

test('post: unlinked report matching a FeeLine post_id is recovered via the fresh scoped query', async () => {
  const rows = [
    { id: 'r1', job_id: 'j1', post_id: 'pX', job_name: '', photo_urls: [] },
    { id: 'r2', job_id: null, post_id: 'post-A', job_name: 'Unlinked', photo_urls: ['u2'] },
  ];
  const out = await loadFieldReportsCore(makeReader(rows), { memberIds, postIds, preloadedAllReports: null, legacyNames: [] });
  assert.deepEqual(out.map((r) => r.id).sort(), ['r1', 'r2']);
  assert.equal(out.find((r) => r.id === 'r2').photo_urls[0], 'u2');
});

test('legacy: unlinked report matching a unique legacy name is recovered from preloaded (no fresh full scan)', async () => {
  const rows = [{ id: 'r1', job_id: 'j1', post_id: 'pX', job_name: '', photo_urls: [] }];
  const preloaded = [{ id: 'r2', job_id: null, post_id: 'pY', job_name: 'Legacy Job ', photo_urls: [] }];
  const out = await loadFieldReportsCore(makeReader(rows), { memberIds, postIds: [], preloadedAllReports: preloaded, legacyNames: ['legacy job'] });
  assert.deepEqual(out.map((r) => r.id).sort(), ['r1', 'r2'], 'trim+lowercase normalization matches reportsForJob');
});

test('legacy fallback: when preload is ABSENT and legacy names exist, unlinked matches are recovered via a bounded complete read', async () => {
  const rows = [
    { id: 'r1', job_id: 'j1', post_id: 'pX', job_name: '', photo_urls: [] },
    { id: 'r2', job_id: null, post_id: 'pY', job_name: 'Legacy Job', photo_urls: ['u2'] },
    { id: 'r3', job_id: null, post_id: 'pZ', job_name: 'Other Unlinked', photo_urls: [] },
  ];
  const out = await loadFieldReportsCore(makeReader(rows), { memberIds, postIds: [], preloadedAllReports: null, legacyNames: ['legacy job'] });
  assert.deepEqual(out.map((r) => r.id).sort(), ['r1', 'r2'], 'legacy match recovered from fresh unlinked read; non-matching unlinked excluded');
});

test('legacy: when preload IS present, no fresh complete unlinked read happens', async () => {
  const rows = [
    { id: 'r1', job_id: 'j1', post_id: 'pX', job_name: '', photo_urls: [] },
    { id: 'r2', job_id: null, post_id: 'pY', job_name: 'Legacy Job', photo_urls: [] },
  ];
  // A reader that throws if a job_id:null query is attempted proves the fallback
  // is NOT run when preloaded is supplied.
  const reader = makeReader(rows, { failOn: (q) => 'job_id' in q && q.job_id === null });
  const preloaded = [{ id: 'r2', job_id: null, post_id: 'pY', job_name: 'Legacy Job', photo_urls: [] }];
  const out = await loadFieldReportsCore(reader, { memberIds, postIds: [], preloadedAllReports: preloaded, legacyNames: ['legacy job'] });
  assert.deepEqual(out.map((r) => r.id).sort(), ['r1', 'r2'], 'uses preloaded, does not query unlinked');
});

test('wrong-job: a report with an explicit foreign job_id is never included, even if its post_id matches', async () => {
  const rows = [
    { id: 'r1', job_id: 'j1', post_id: 'pX', job_name: '', photo_urls: [] },
    { id: 'r2', job_id: 'jForeign', post_id: 'post-A', job_name: 'Legacy Job', photo_urls: [] },
  ];
  const preloaded = [{ id: 'r3', job_id: 'jForeign', post_id: 'pY', job_name: 'Legacy Job', photo_urls: [] }];
  const out = await loadFieldReportsCore(makeReader(rows), { memberIds, postIds, preloadedAllReports: preloaded, legacyNames: ['legacy job'] });
  assert.deepEqual(out.map((r) => r.id), ['r1'], 'foreign job_id excluded from both post-id and legacy edges');
});

test('dedupe: a report appearing in both the direct and post-id queries is counted once', async () => {
  const rows = [
    { id: 'r1', job_id: 'j1', post_id: 'post-A', job_name: '', photo_urls: ['u'] },
    { id: 'r2', job_id: null, post_id: 'post-A', job_name: '', photo_urls: [] },
  ];
  const out = await loadFieldReportsCore(makeReader(rows), { memberIds, postIds, preloadedAllReports: null, legacyNames: [] });
  const ids = out.map((r) => r.id);
  assert.equal(ids.filter((x) => x === 'r1').length, 1, 'no duplicate tile for r1');
  assert.deepEqual(ids.sort(), ['r1', 'r2']);
});

test('multi-page: more than one page of direct rows is paginated fully (skip-based)', async () => {
  const rows = Array.from({ length: 25 }, (_, i) => ({ id: `r${i}`, job_id: 'j1', post_id: `p${i}`, job_name: '', photo_urls: [] }));
  const out = await loadFieldReportsCore(makeReader(rows), { memberIds, postIds: [], preloadedAllReports: null, legacyNames: [], limit: 10 });
  assert.equal(out.length, 25, 'all rows recovered across pages');
  assert.equal(new Set(out.map((r) => r.id)).size, 25, 'no dupes across pages');
});

test('read-failure: a reader error surfaces (not silently swallowed)', async () => {
  const rows = [{ id: 'r1', job_id: 'j1', post_id: 'pX', job_name: '', photo_urls: [] }];
  const reader = makeReader(rows, { failOn: (q) => q.job_id === 'j1' });
  await assert.rejects(() => loadFieldReportsCore(reader, { memberIds, postIds: [], preloadedAllReports: null, legacyNames: [] }), /read failed/);
});

test('malformed: a non-array response throws (does not authorize an options/cursor object)', async () => {
  const reader = async () => ({ items: [{ id: 'r1', job_id: 'j1', post_id: 'pX', job_name: '', photo_urls: [] }], next_cursor: null, has_more: false });
  await assert.rejects(() => paginateFieldReports(reader, { job_id: 'j1' }, { limit: 10 }), /non-array response/);
});

test('ignored-skip: a reader that ignores skip (returns the same page) throws a stall error', async () => {
  const rows = Array.from({ length: 5 }, (_, i) => ({ id: `r${i}`, job_id: 'j1', post_id: `p${i}`, job_name: '', photo_urls: [] }));
  const reader = makeReader(rows, { ignoreSkip: true });
  await assert.rejects(() => paginateFieldReports(reader, { job_id: 'j1' }, { limit: 2, maxPages: 5 }), /skip ignored/);
});

test('cap: exceeding the page cap throws a completeness error rather than returning a silent partial []', async () => {
  const rows = Array.from({ length: 60 }, (_, i) => ({ id: `r${i}`, job_id: 'j1', post_id: `p${i}`, job_name: '', photo_urls: [] }));
  const reader = makeReader(rows);
  await assert.rejects(
    () => paginateFieldReports(reader, { job_id: 'j1' }, { limit: 1, maxPages: 5 }),
    /exceeded 5 pages; completeness is not verified/
  );
});

test('no edge rows: with no postIds and no preloaded, only direct rows are returned', async () => {
  const rows = [
    { id: 'r1', job_id: 'j1', post_id: 'pX', job_name: '', photo_urls: [] },
    { id: 'r2', job_id: null, post_id: 'pY', job_name: 'Orphan', photo_urls: [] },
  ];
  const out = await loadFieldReportsCore(makeReader(rows), { memberIds, postIds: [], preloadedAllReports: null, legacyNames: [] });
  assert.deepEqual(out.map((r) => r.id), ['r1'], 'unlinked orphan with no edge evidence is not included');
});