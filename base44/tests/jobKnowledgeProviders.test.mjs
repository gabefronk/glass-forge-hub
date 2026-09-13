import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../shared/jobKnowledgeProviders.ts', import.meta.url), 'utf8');
const billing = new URL('../shared/billingCore.js', import.meta.url);
// Replace only the platform import boundary; every provider read is injected.
const testSource = source.replace("import { getProbuildIdToken, fetchProbuildProjects, fetchProbuildPostsForProject } from './probuildApi.ts';", 'const getProbuildIdToken = () => { throw Error("Production auth unexpectedly invoked"); }; const fetchProbuildProjects = getProbuildIdToken; const fetchProbuildPostsForProject = getProbuildIdToken;').replace("'./billingCore.js'", JSON.stringify(billing.href));
const { readJobKnowledgeProviders } = await import('data:text/javascript;base64,' + Buffer.from(testSource).toString('base64'));
const now = '2026-09-13T08:00:00.000Z';
const client = { asServiceRole: { connectors: { getConnection: async () => ({ accessToken: 'GOOGLE-TEST-CREDENTIAL' }) } } };
const defaults = () => ({ now, clock: () => new Date(now), fetchImpl: async () => Response.json({ items: [] }), probuildApi: {
  getProbuildIdToken: async () => 'PROBUILD-TEST-CREDENTIAL', fetchProbuildProjects: async () => [], fetchProbuildPostsForProject: async () => []
} });
const event = (id = 'g1') => ({ id, summary: 'Test job', start: { dateTime: '2026-09-13T16:00:00Z' }, end: { dateTime: '2026-09-13T18:00:00Z' }, updated: now });
const project = id => ({ id, name: 'Test job ' + id, lastModifiedAt: now });
const post = (projectId = 'p1', postId = 'post1', extra = {}) => ({ projectId, postId, post: { createdAt: now, message: 'Work recorded', ...extra } });

test('complete paginated calendar source has genuine watermark, Denver clocks and no credentials', async () => {
  const options = defaults(), urls = [];
  options.fetchImpl = async url => { urls.push(new URL(url)); return Response.json({ items: [event('g' + urls.length)], ...(urls.length === 1 ? { nextPageToken: 'encoded /+' } : {}) }); };
  const result = await readJobKnowledgeProviders(client, options);
  assert.equal(result.calendar.complete, true); assert.equal(result.calendar.checked_at, now);
  assert.equal(result.calendar.items.length, 2); assert.equal(result.calendar.items[0].start_time, '10:00');
  assert.equal(urls[1].searchParams.get('pageToken'), 'encoded /+');
  assert.equal(result.calendar.range_start, '2026-06-15'); assert.equal(result.calendar.range_end, '2026-12-12');
  assert.ok(!JSON.stringify(result).includes('TEST-CREDENTIAL'));
});

test('calendar failure is independent from complete empty ProBuild read', async () => {
  const options = defaults(); options.fetchImpl = async () => new Response('credential in provider failure body', { status: 403 });
  const result = await readJobKnowledgeProviders(client, options);
  assert.equal(result.calendar.complete, false); assert.equal(result.calendar.checked_at, null);
  assert.equal(result.calendar.error, 'calendar_http_403'); assert.equal(result.probuild.complete, true);
  assert.ok(!JSON.stringify(result).includes('provider failure body'));
});

test('partial calendar pages remain explicit and never gain a watermark', async () => {
  const options = defaults(); let calls = 0;
  options.fetchImpl = async () => ++calls === 1 ? Response.json({ items: [event()], nextPageToken: 'next' }) : new Response('', { status: 503 });
  const result = await readJobKnowledgeProviders(client, options);
  assert.equal(result.calendar.items.length, 1); assert.equal(result.calendar.complete, false); assert.equal(result.calendar.checked_at, null);
});

test('calendar page cap and repeated token are incomplete', async () => {
  const options = defaults(); options.maxCalendarPages = 1;
  options.fetchImpl = async () => Response.json({ items: [event()], nextPageToken: 'same' });
  assert.equal((await readJobKnowledgeProviders(client, options)).calendar.error, 'calendar_page_limit');
  options.maxCalendarPages = 3;
  assert.equal((await readJobKnowledgeProviders(client, options)).calendar.error, 'calendar_repeated_page_token');
});

test('calendar cancellation tombstone survives without a start date', async () => {
  const options = defaults(); options.fetchImpl = async () => Response.json({ items: [{ id: 'gone', status: 'cancelled', updated: now }] });
  const result = await readJobKnowledgeProviders(client, options);
  assert.equal(result.calendar.complete, true); assert.equal(result.calendar.items[0].deleted, true);
  assert.equal(result.calendar.items[0].google_event_id, 'gone'); assert.equal(result.calendar.items[0].event_date, null);
});

test('post identities, dates, edited old posts and deletion flags survive normalization', async () => {
  const options = defaults(); options.probuildApi.fetchProbuildProjects = async () => [project('p1')];
  options.probuildApi.fetchProbuildPostsForProject = async () => [
    post('p1', 'new', { createdAt: '2026-09-13T01:00:00Z' }),
    post('p1', 'old-edited', { createdAt: '2026-01-01T00:00:00Z', lastModifiedAt: now }),
    post('p1', 'deleted', { createdAt: '2026-01-01T00:00:00Z', deletedAt: now }),
    post('p1', 'too-old', { createdAt: '2026-01-01T00:00:00Z' })
  ];
  const result = await readJobKnowledgeProviders(client, options), p = result.probuild;
  assert.equal(p.complete, true); assert.equal(p.range_start, '2026-08-14'); assert.equal(p.range_end, '2026-09-13');
  assert.equal(p.items.length, 3); assert.equal(p.items.find(x => x.post_id === 'new').job_date, '2026-09-12');
  assert.equal(p.items.find(x => x.post_id === 'deleted').deleted, true); assert.equal(p.checked_at, now);
});

test('deleted project metadata is returned without fetching that project', async () => {
  const options = defaults(); options.probuildApi.fetchProbuildProjects = async () => [{ ...project('gone'), deletedAt: now }];
  options.probuildApi.fetchProbuildPostsForProject = async () => { throw Error('must not fetch deleted project'); };
  const result = await readJobKnowledgeProviders(client, options);
  assert.equal(result.probuild.complete, true); assert.equal(result.probuild.deleted_projects[0].project_id, 'gone');
});

test('project cap returns newest selected source evidence marked incomplete', async () => {
  const options = defaults(); options.maxProjects = 1;
  options.probuildApi.fetchProbuildProjects = async () => [{ ...project('old'), lastModifiedAt: '2026-09-01T00:00:00Z' }, project('new')];
  options.probuildApi.fetchProbuildPostsForProject = async (_, pid) => [post(pid)];
  const result = await readJobKnowledgeProviders(client, options);
  assert.equal(result.probuild.items[0].project_id, 'new'); assert.equal(result.probuild.complete, false);
  assert.equal(result.probuild.checked_at, null); assert.match(result.probuild.error, /project_limit/);
});

test('incremental selection excludes known old projects and includes recent activity from all supported fields', async () => {
  const options = defaults(), fetched = [];
  options.probuildApi.fetchProbuildProjects = async () => [
    { id: 'known-old', name: 'Old job', lastModifiedAt: '2026-07-01T00:00:00Z', createdAt: '2025-01-01T00:00:00Z' },
    project('modified'),
    { id: 'updated', name: 'Updated job', lastModifiedAt: '2025-01-01T00:00:00Z', updatedAt: now },
    { id: 'created', name: 'Created job', createdAt: now }
  ];
  options.probuildApi.fetchProbuildPostsForProject = async (_, pid) => { fetched.push(pid); return [post(pid)]; };
  const p = (await readJobKnowledgeProviders(client, options)).probuild;
  assert.equal(p.complete, true); assert.equal(p.history_complete, false);
  assert.equal(p.project_selection, 'recently_modified_or_unknown');
  assert.equal(p.known_unchanged_excluded_count, 1); assert.equal(p.active_project_count, 4); assert.equal(p.project_count, 3);
  assert.deepEqual(fetched.sort(), ['created', 'modified', 'updated']);
});

test('missing, invalid and future-only project dates are included with explicit uncertainty', async () => {
  const options = defaults(), fetched = [];
  options.probuildApi.fetchProbuildProjects = async () => [
    { id: 'missing' }, { id: 'invalid', lastModifiedAt: 'not a date' }, { id: 'future', updatedAt: '2027-01-01T00:00:00Z' }
  ];
  options.probuildApi.fetchProbuildPostsForProject = async (_, pid) => { fetched.push(pid); return []; };
  const p = (await readJobKnowledgeProviders(client, options)).probuild;
  assert.equal(p.complete, true); assert.equal(p.history_complete, false); assert.equal(p.unknown_project_date_count, 3);
  assert.equal(p.known_unchanged_excluded_count, 0); assert.equal(fetched.length, 3);
  assert.ok(p.selection_uncertainties.some(x => x.includes('without a reliable activity timestamp')));
});

test('project activity boundary uses Denver midnight and preserves all deleted project tombstones', async () => {
  const options = defaults(), fetched = [];
  options.probuildApi.fetchProbuildProjects = async () => [
    { id: 'before-window', lastModifiedAt: '2026-08-14T05:59:59Z' },
    { id: 'at-window', lastModifiedAt: '2026-08-14T06:00:00Z' },
    { id: 'deleted-old', lastModifiedAt: '2020-01-01T00:00:00Z', deletedAt: '2021-01-01T00:00:00Z' }
  ];
  options.probuildApi.fetchProbuildPostsForProject = async (_, pid) => { fetched.push(pid); return []; };
  const p = (await readJobKnowledgeProviders(client, options)).probuild;
  assert.deepEqual(fetched, ['at-window']); assert.equal(p.known_unchanged_excluded_count, 1);
  assert.equal(p.deleted_projects[0].project_id, 'deleted-old'); assert.equal(p.complete, true);
});

test('one unavailable project cannot freshen a partial provider snapshot', async () => {
  const options = defaults(); options.probuildApi.fetchProbuildProjects = async () => [project('p1'), project('p2')];
  options.probuildApi.fetchProbuildPostsForProject = async (_, pid) => { if (pid === 'p2') throw Error('sensitive auth=private in URL'); return [post(pid)]; };
  const p = (await readJobKnowledgeProviders(client, options)).probuild;
  assert.equal(p.items.length, 1); assert.equal(p.complete, false); assert.deepEqual(p.failed_project_ids, ['p2']);
  assert.equal(p.checked_at, null); assert.ok(!JSON.stringify(p).includes('private'));
});

test('unknown post dates and cross-project identities are incomplete', async () => {
  const options = defaults(); options.probuildApi.fetchProbuildProjects = async () => [project('p1')];
  options.probuildApi.fetchProbuildPostsForProject = async () => [post('p1', 'bad', { createdAt: null })];
  assert.equal((await readJobKnowledgeProviders(client, options)).probuild.undated_post_count, 1);
  options.probuildApi.fetchProbuildPostsForProject = async () => [post('different-project')];
  assert.equal((await readJobKnowledgeProviders(client, options)).probuild.complete, false);
});

test('post cap never declares partial data fresh and source URLs are omitted', async () => {
  const options = defaults(); options.maxPosts = 1;
  options.probuildApi.fetchProbuildProjects = async () => [project('p1')];
  options.probuildApi.fetchProbuildPostsForProject = async () => [post('p1', 'one', { message: 'Report https://private.example/file?auth=SECRET', attachments: [{ url: 'https://private.example/file' }] }), post('p1', 'two')];
  const p = (await readJobKnowledgeProviders(client, options)).probuild;
  assert.equal(p.complete, false); assert.match(p.error, /post_limit/); assert.equal(p.items[0].attachment_count, 1);
  assert.ok(!JSON.stringify(p).includes('https://')); assert.ok(!JSON.stringify(p).includes('SECRET'));
});

test('provider deadline returns explicit failure rather than waiting forever', async () => {
  const options = defaults(); options.deadlineMs = 5; options.fetchImpl = async () => new Promise(() => {});
  const result = await readJobKnowledgeProviders(client, options);
  assert.equal(result.calendar.error, 'provider_deadline'); assert.equal(result.calendar.checked_at, null); assert.equal(result.probuild.complete, true);
});
