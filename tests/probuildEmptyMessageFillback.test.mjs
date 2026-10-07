// Regressions for the ProBuild -> Hub empty-message fill-back: a field report
// created empty because photos arrived before the message is later filled from
// the same source post once it has text. Runs the ACTUAL fetchProbuildPosts
// handler with the ProBuild client + Base44 SDK stubbed (same harness as
// financeGapIngest). No live sync, no record writes, no provider calls.
import assert from 'node:assert/strict';
// Dual-mode test runner: vitest when executed under vitest (this sandbox blocks
// `node --test`), node:test otherwise (the project's convention for every other
// test). Same file, same assertions, both runners.
let test;
try {
  ({ test } = await import('vitest'));
} catch {
  test = (await import('node:test')).default;
}
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const STUBS = {
  sdk: 'export const createClientFromRequest = () => globalThis.__testBase44;',
  probuild: `export const toMs = (v) => (v ? Date.parse(v) : null);
    export const getProbuildIdToken = async () => 'token';
    export const fetchProbuildProjects = async () => globalThis.__testProbuild.projects;
    export const fetchProbuildPostsForProject = async (_t, id) => globalThis.__testProbuild.posts.filter((p) => p.projectId === id);
    export const filterProjectsByWindow = (projects) => ({ qualifying: projects, stats: { total: projects.length } });`,
};
const stubPlugin = {
  name: 'test-stubs',
  setup(b) {
    b.onResolve({ filter: /^npm:@base44\/sdk/ }, () => ({ path: 'sdk', namespace: 'stub' }));
    b.onResolve({ filter: /probuildApi\.ts$/ }, () => ({ path: 'probuild', namespace: 'stub' }));
    b.onLoad({ filter: /.*/, namespace: 'stub' }, (a) => ({ contents: STUBS[a.path], loader: 'js' }));
  },
};
async function loadHandler(path) {
  const out = await build({ entryPoints: [here(path)], bundle: true, platform: 'neutral', format: 'esm', write: false, logLevel: 'silent', plugins: [stubPlugin] });
  return (await import('data:text/javascript;base64,' + Buffer.from(out.outputFiles[0].text).toString('base64'))).default;
}
const probuildHandler = await loadHandler('../base44/functions/fetchProbuildPosts/entry.ts');

// memoryDb with a spy on FieldReports.bulkUpdate to capture exact patches.
function memoryDb(seed = {}) {
  const tables = new Map();
  let seq = 0;
  const frBulkUpdateCalls = [];
  const table = (name) => {
    if (!tables.has(name)) tables.set(name, (seed[name] || []).map((r) => structuredClone(r)));
    return tables.get(name);
  };
  const entity = (name) => ({
    list: async (_sort, limit = 1000, skip = 0) => table(name).slice(skip, skip + limit).map((r) => structuredClone(r)),
    filter: async (q = {}) => table(name).filter((r) => Object.entries(q).every(([k, v]) => r[k] === v)).map((r) => structuredClone(r)),
    bulkCreate: async (rows) => rows.map((r) => {
      const row = { ...structuredClone(r), id: r.id || `${name.toLowerCase()}-new-${++seq}` };
      table(name).push(row);
      return structuredClone(row);
    }),
    bulkUpdate: async (rows) => {
      if (name === 'FieldReports') frBulkUpdateCalls.push(rows.map((r) => structuredClone(r)));
      for (const p of rows) Object.assign(table(name).find((x) => x.id === p.id), structuredClone(p));
      return rows;
    },
  });
  const entities = new Proxy({}, { get: (_, name) => entity(String(name)) });
  const client = { entities, auth: { me: async () => ({ id: 'owner', role: 'admin' }) }, asServiceRole: { entities, integrations: { Core: { UploadFile: async () => ({ file_url: 'https://files.test/x' }) } } } };
  return { table, client, frBulkUpdateCalls };
}
async function run(handler, db, body) {
  globalThis.__testBase44 = db.client;
  globalThis.__testProbuild = body.__probuild;
  const { __probuild, ...rest } = body;
  const json = await (await handler(new Request('http://test.local/fn', { method: 'POST', body: JSON.stringify(rest) }))).json();
  assert.equal(json.error, undefined, `handler error: ${json.error}`);
  return json;
}

const JOB = { id: 'job-toll', canonical_name: 'Toll Brothers - 72 Jordanelle Ridge', builder: 'Toll Brothers', aliases: [], created_date: '2026-01-01T00:00:00Z' };
const PROJECTS = [{ id: 'proj-toll', name: 'YA - Toll Brothers - 72 Jordanelle Ridge' }];
const LINK = [{ id: 'link-1', project_id: 'proj-toll', job_id: 'job-toll' }];
const RANGE = { start_date: '2026-09-01', end_date: '2026-09-30' };
const PHOTO = 'https://files.test/p.jpg';
const att = (url) => ({ a1: { type: 'photo', downloadURL: url } });
const mkPost = (postId, createdAt, message, attachments) => ({ projectId: 'proj-toll', postId, post: { createdAt, message, attachments } });
const mkFr = (id, postId, message, extra = {}) => ({ id, post_id: postId, job_id: 'job-toll', job_date: '2026-09-15', job_name: 'Toll Brothers - 72 Jordanelle Ridge', message, photo_urls: [PHOTO], project_id: 'proj-toll', created_at: '2026-09-15T20:00:00Z', ...extra });
const frNoMsg = (id, postId, extra = {}) => ({ id, post_id: postId, job_id: 'job-toll', job_date: '2026-09-15', job_name: 'Toll Brothers - 72 Jordanelle Ridge', photo_urls: [PHOTO], project_id: 'proj-toll', created_at: '2026-09-15T20:00:00Z', ...extra });
const baseSeed = (extra = {}) => ({ Jobs: [JOB], ProbuildProjectLink: LINK, ...extra });
const probuild = (posts) => ({ projects: PROJECTS, posts });
const LATE_TEXT = 'Installed 3 windows.\nTrim ok.';

test('photos-only create -> late text fills message verbatim once; rerun is a no-op', async () => {
  const db = memoryDb(baseSeed());
  let res = await run(probuildHandler, db, { ...RANGE, __probuild: probuild([mkPost('post-1', '2026-09-15T20:00:00Z', '', att(PHOTO))]) });
  assert.equal(db.table('FieldReports').length, 1, 'FR created on first run');
  assert.equal(db.table('FieldReports')[0].message, '', 'created with empty message');
  assert.equal(res.fr_messages_filled, 0, 'no fill on create run');
  res = await run(probuildHandler, db, { ...RANGE, __probuild: probuild([mkPost('post-1', '2026-09-15T20:00:00Z', LATE_TEXT, att(PHOTO))]) });
  assert.equal(res.fr_messages_filled, 1, 'filled on second run');
  assert.equal(db.table('FieldReports').length, 1, 'no duplicate FR');
  assert.equal(db.table('FieldReports')[0].message, LATE_TEXT, 'verbatim incl newline');
  const before = structuredClone(db.table('FieldReports'));
  res = await run(probuildHandler, db, { ...RANGE, __probuild: probuild([mkPost('post-1', '2026-09-15T20:00:00Z', LATE_TEXT, att(PHOTO))]) });
  assert.equal(res.fr_messages_filled, 0, 'no fill on rerun');
  assert.deepEqual(db.table('FieldReports'), before, 'FR unchanged on rerun');
  assert.equal(db.frBulkUpdateCalls.filter((c) => c.some((p) => 'message' in p)).length, 1, 'message patch written exactly once');
});

test('nonempty existing message (incl. owner/manual text) is preserved; no fill', async () => {
  const db = memoryDb(baseSeed({ FieldReports: [mkFr('fr-1', 'post-1', 'Owner typed this.')] }));
  const res = await run(probuildHandler, db, { ...RANGE, __probuild: probuild([mkPost('post-1', '2026-09-15T20:00:00Z', 'Crew note differs.')]) });
  assert.equal(res.fr_messages_filled, 0);
  assert.equal(db.table('FieldReports')[0].message, 'Owner typed this.');
  assert.equal(db.frBulkUpdateCalls.length, 0, 'no FR update at all');
});

test('whitespace-only / undefined / null existing message -> filled from source', async () => {
  const db = memoryDb(baseSeed({
    FieldReports: [
      mkFr('fr-ws', 'post-ws', '   '),
      frNoMsg('fr-undef', 'post-undef'),
      mkFr('fr-null', 'post-null', null),
    ],
  }));
  const res = await run(probuildHandler, db, { ...RANGE, __probuild: probuild([
    mkPost('post-ws', '2026-09-15T20:00:00Z', 'A'),
    mkPost('post-undef', '2026-09-15T20:00:00Z', 'B'),
    mkPost('post-null', '2026-09-15T20:00:00Z', 'C'),
  ]) });
  assert.equal(res.fr_messages_filled, 3);
  const byId = Object.fromEntries(db.table('FieldReports').map((r) => [r.id, r]));
  assert.equal(byId['fr-ws'].message, 'A');
  assert.equal(byId['fr-undef'].message, 'B');
  assert.equal(byId['fr-null'].message, 'C');
});

test('empty source message -> no fill', async () => {
  const db = memoryDb(baseSeed({ FieldReports: [mkFr('fr-1', 'post-1', '')] }));
  const res = await run(probuildHandler, db, { ...RANGE, __probuild: probuild([mkPost('post-1', '2026-09-15T20:00:00Z', '')]) });
  assert.equal(res.fr_messages_filled, 0);
  assert.equal(db.table('FieldReports')[0].message, '');
});

test('non-string existing message is not coerced to empty (skip)', async () => {
  const db = memoryDb(baseSeed({ FieldReports: [mkFr('fr-1', 'post-1', 123)] }));
  const res = await run(probuildHandler, db, { ...RANGE, __probuild: probuild([mkPost('post-1', '2026-09-15T20:00:00Z', 'real text')]) });
  assert.equal(res.fr_messages_filled, 0, 'number is not treated as empty');
  assert.equal(db.table('FieldReports')[0].message, 123, 'non-string preserved, not overwritten');
});

test('exact post_id identity isolation: each post fills only its own FR', async () => {
  const db = memoryDb(baseSeed({ FieldReports: [mkFr('fr-a', 'post-a', ''), mkFr('fr-b', 'post-b', '')] }));
  const res = await run(probuildHandler, db, { ...RANGE, __probuild: probuild([
    mkPost('post-a', '2026-09-15T20:00:00Z', 'A text'),
    mkPost('post-b', '2026-09-15T20:00:00Z', 'B text'),
  ]) });
  assert.equal(res.fr_messages_filled, 2);
  const byId = Object.fromEntries(db.table('FieldReports').map((r) => [r.id, r]));
  assert.equal(byId['fr-a'].message, 'A text');
  assert.equal(byId['fr-b'].message, 'B text');
});

test('message-only fill leaves original_text/edit metadata/photos/job/fee unchanged; patch is {id,message} only', async () => {
  const fee = { id: 'fl-1', source: 'probuild', written_by: 'probuild', probuild_post_id: 'post-1', probuild_project_id: 'proj-toll', job_id: 'job-toll', job_date: '2026-09-15', invoice_month: '2026-09', job_name_raw: 'Toll Brothers - 72 Jordanelle Ridge', note_text: '', probuild_note_text: '', labor_amt: 0, fee_amt: 0, fee_pct: 0.1, billable: true, needs_review: true, match_confidence: 'high', photo_urls: [PHOTO] };
  const db = memoryDb(baseSeed({ FieldReports: [mkFr('fr-1', 'post-1', '', { original_text: null, edited_at: null, edited_by: null })], FeeLines: [fee] }));
  const res = await run(probuildHandler, db, { ...RANGE, __probuild: probuild([mkPost('post-1', '2026-09-15T20:00:00Z', LATE_TEXT, att(PHOTO))]) });
  assert.equal(res.fr_messages_filled, 1);
  const fr = db.table('FieldReports')[0];
  assert.equal(fr.message, LATE_TEXT, 'message filled');
  assert.equal(fr.original_text, null, 'original_text untouched');
  assert.equal(fr.edited_at, null, 'edited_at untouched');
  assert.equal(fr.edited_by, null, 'edited_by untouched');
  assert.deepEqual(fr.photo_urls, [PHOTO], 'photo_urls untouched');
  assert.equal(fr.job_id, 'job-toll', 'job_id untouched');
  const feeAfter = db.table('FeeLines')[0];
  assert.equal(feeAfter.note_text, '', 'fee note_text not changed by message fill');
  assert.equal(feeAfter.labor_amt, 0, 'fee labor not changed');
  assert.equal(db.frBulkUpdateCalls.length, 1, 'one FR bulkUpdate call');
  const patch = db.frBulkUpdateCalls[0][0];
  assert.deepEqual(Object.keys(patch).sort(), ['id', 'message'], 'only id + message in the patch');
  assert.equal(patch.message, LATE_TEXT);
});

test('duplicate existing reports for same post_id -> ambiguous skip, no arbitrary overwrite', async () => {
  const db = memoryDb(baseSeed({ FieldReports: [mkFr('fr-d1', 'post-1', ''), mkFr('fr-d2', 'post-1', '')] }));
  const res = await run(probuildHandler, db, { ...RANGE, __probuild: probuild([mkPost('post-1', '2026-09-15T20:00:00Z', LATE_TEXT, att(PHOTO))]) });
  assert.equal(res.fr_messages_filled, 0, 'no fill when duplicate reports exist');
  assert.equal(res.fr_messages_skipped_duplicate, 1, 'flagged as ambiguous skip');
  const byId = Object.fromEntries(db.table('FieldReports').map((r) => [r.id, r]));
  assert.equal(byId['fr-d1'].message, '', 'first duplicate not overwritten');
  assert.equal(byId['fr-d2'].message, '', 'second duplicate not overwritten');
});

test('dry_run: counters computed, no FieldReports writes', async () => {
  const db = memoryDb(baseSeed({ FieldReports: [mkFr('fr-1', 'post-1', '')] }));
  const res = await run(probuildHandler, db, { ...RANGE, dry_run: true, __probuild: probuild([mkPost('post-1', '2026-09-15T20:00:00Z', LATE_TEXT, att(PHOTO))]) });
  assert.equal(res.fr_messages_filled, 1, 'counter computed in dry-run');
  assert.equal(db.table('FieldReports')[0].message, '', 'no write in dry-run');
  assert.equal(db.frBulkUpdateCalls.length, 0, 'no bulkUpdate in dry-run');
});

test('LIMITATION: no conditional revision (CAS) available; fill-back is last-write-wins like the existing photo/job fills', async () => {
  // The Base44 entity bulkUpdate used here is unconditional: it accepts no
  // revision/conditional guard, so a concurrent owner edit to message between
  // the existingReports read and the bulkUpdate write would be overwritten. This
  // matches the existing photo/job-link fill-back behavior (also last-write-wins).
  // The implementation does NOT pretend to do CAS; the empty-message guard is
  // evaluated at READ time only. This test documents that limitation by asserting
  // the patch carries no revision/conditional token.
  const db = memoryDb(baseSeed({ FieldReports: [mkFr('fr-1', 'post-1', '')] }));
  await run(probuildHandler, db, { ...RANGE, __probuild: probuild([mkPost('post-1', '2026-09-15T20:00:00Z', LATE_TEXT, att(PHOTO))]) });
  const patch = db.frBulkUpdateCalls[0][0];
  assert.ok(!('revision' in patch) && !('if_not_exists' in patch) && !('condition' in patch), 'no CAS/conditional token in the patch');
  assert.deepEqual(Object.keys(patch).sort(), ['id', 'message']);
});