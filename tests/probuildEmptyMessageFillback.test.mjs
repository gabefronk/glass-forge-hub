// Regressions for the ProBuild -> Hub empty-message fill-back: a field report
// created empty because photos arrived before the message is later filled from
// the same source post once it has text. Runs the ACTUAL fetchProbuildPosts
// handler with the ProBuild client + Base44 SDK stubbed (same harness as
// financeGapIngest). No live sync, no record writes, no provider calls.
//
// Concurrency: the SDK update/bulkUpdate are unconditional (no CAS/revision),
// so a message fill is isolated from the photo/job-link bulk patch and guarded
// by a freshest exact FieldReports.get right before its single-field update.
// The tests below inject a concurrent owner edit (via onGet) AFTER the list
// snapshot and prove the owner note is preserved, and that a failed/changed
// fresh read skips the write. A residual read-then-write race remains (no
// atomic CAS exists); the LIMITATION test documents it against the real SDK.
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

// memoryDb with spies on FieldReports.bulkUpdate (photo/job-link patch) and
// FieldReports.update (isolated message write), and an optional onGet hook that
// mutates the live record (or throws) when FieldReports.get is called — used to
// simulate a concurrent owner edit landing between the list snapshot and the
// fresh read-before-write.
function memoryDb(seed = {}, opts = {}) {
  const tables = new Map();
  let seq = 0;
  const frBulkUpdateCalls = [];
  const frUpdateCalls = [];
  const frGetCalls = [];
  const table = (name) => {
    if (!tables.has(name)) tables.set(name, (seed[name] || []).map((r) => structuredClone(r)));
    return tables.get(name);
  };
  const entity = (name) => ({
    list: async (_sort, limit = 1000, skip = 0) => table(name).slice(skip, skip + limit).map((r) => structuredClone(r)),
    filter: async (q = {}) => table(name).filter((r) => Object.entries(q).every(([k, v]) => r[k] === v)).map((r) => structuredClone(r)),
    get: async (id) => {
      if (name === 'FieldReports') frGetCalls.push(id);
      const rec = table(name).find((x) => x.id === id);
      if (!rec) return undefined;
      if (opts.onGet) opts.onGet(name, id, rec); // may mutate rec or throw
      return structuredClone(rec);
    },
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
    update: async (id, data) => {
      if (name === 'FieldReports') frUpdateCalls.push({ id, data: structuredClone(data) });
      if (opts.onUpdate) opts.onUpdate(name, id, data); // may throw before mutate
      Object.assign(table(name).find((x) => x.id === id), structuredClone(data));
      return structuredClone(data);
    },
  });
  const entities = new Proxy({}, { get: (_, name) => entity(String(name)) });
  const client = { entities, auth: { me: async () => ({ id: 'owner', role: 'admin' }) }, asServiceRole: { entities, integrations: { Core: { UploadFile: async () => ({ file_url: 'https://files.test/x' }) } } } };
  return { table, client, frBulkUpdateCalls, frUpdateCalls, frGetCalls };
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
  assert.equal(db.frUpdateCalls.filter((c) => 'message' in c.data).length, 1, 'message written exactly once via isolated update');
});

test('nonempty existing message (incl. owner/manual text) is preserved; no fill', async () => {
  const db = memoryDb(baseSeed({ FieldReports: [mkFr('fr-1', 'post-1', 'Owner typed this.')] }));
  const res = await run(probuildHandler, db, { ...RANGE, __probuild: probuild([mkPost('post-1', '2026-09-15T20:00:00Z', 'Crew note differs.')]) });
  assert.equal(res.fr_messages_filled, 0);
  assert.equal(db.table('FieldReports')[0].message, 'Owner typed this.');
  assert.equal(db.frBulkUpdateCalls.length, 0, 'no FR bulkUpdate at all');
  assert.equal(db.frUpdateCalls.length, 0, 'no isolated update');
  assert.equal(db.frGetCalls.length, 0, 'no fresh get (not eligible)');
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

test('message-only fill is an isolated single-field update; original_text/edit metadata/photos/job/fee unchanged', async () => {
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
  assert.equal(db.frBulkUpdateCalls.length, 0, 'message not bundled into a bulkUpdate');
  assert.equal(db.frUpdateCalls.length, 1, 'one isolated update call');
  assert.deepEqual(db.frUpdateCalls[0].data, { message: LATE_TEXT }, 'update data is exactly {message}');
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
  assert.equal(res.fr_messages_filled, 1, 'planned-fill counter in dry-run');
  assert.equal(db.table('FieldReports')[0].message, '', 'no write in dry-run');
  assert.equal(db.frBulkUpdateCalls.length, 0, 'no bulkUpdate in dry-run');
  assert.equal(db.frUpdateCalls.length, 0, 'no isolated update in dry-run');
  assert.equal(db.frGetCalls.length, 0, 'no fresh get in dry-run');
});

// ---- concurrency: fresh read-before-write preserves a concurrent owner edit ----

test('concurrent owner edit after list snapshot is preserved (fresh get sees edit, skips write)', async () => {
  // The list snapshot at the start of the run sees an empty message. Between that
  // snapshot and the fresh FieldReports.get, an owner edits the report (sets a
  // note + edited_at/edited_by/original_text). The fresh get must see it and skip.
  const db = memoryDb(baseSeed({ FieldReports: [mkFr('fr-1', 'post-1', '', { original_text: null, edited_at: null, edited_by: null })] }), {
    onGet: (name, id, rec) => {
      if (name === 'FieldReports' && id === 'fr-1') {
        rec.message = 'Owner note typed mid-run';
        rec.edited_at = '2026-09-16T01:00:00Z';
        rec.edited_by = 'owner@test';
        rec.original_text = '';
      }
    },
  });
  const res = await run(probuildHandler, db, { ...RANGE, __probuild: probuild([mkPost('post-1', '2026-09-15T20:00:00Z', LATE_TEXT, att(PHOTO))]) });
  assert.equal(res.fr_messages_filled, 0, 'no write: owner edit detected');
  assert.equal(res.fr_messages_skipped_fresh, 1, 'counted as a fresh-check skip');
  assert.equal(res.fr_messages_skipped_duplicate, 0);
  const fr = db.table('FieldReports')[0];
  assert.equal(fr.message, 'Owner note typed mid-run', 'owner note preserved verbatim');
  assert.equal(fr.edited_by, 'owner@test', 'owner edit metadata preserved');
  assert.equal(db.frUpdateCalls.length, 0, 'no isolated update issued');
  assert.equal(db.frGetCalls.length, 1, 'one fresh get for the planned fill');
});

test('fresh get shows non-empty message (concurrent fill, no edit metadata) -> skip', async () => {
  // A concurrent process (or owner) set a real message but no edit metadata. The
  // fresh read sees non-empty text and skips; the existing text is preserved.
  const db = memoryDb(baseSeed({ FieldReports: [mkFr('fr-1', 'post-1', '')] }), {
    onGet: (name, id, rec) => {
      if (name === 'FieldReports' && id === 'fr-1') rec.message = 'Filled by another run';
    },
  });
  const res = await run(probuildHandler, db, { ...RANGE, __probuild: probuild([mkPost('post-1', '2026-09-15T20:00:00Z', LATE_TEXT, att(PHOTO))]) });
  assert.equal(res.fr_messages_filled, 0);
  assert.equal(res.fr_messages_skipped_fresh, 1);
  assert.equal(db.table('FieldReports')[0].message, 'Filled by another run');
  assert.equal(db.frUpdateCalls.length, 0);
});

test('fresh get post_id mismatch -> skip (identity not confirmed)', async () => {
  const db = memoryDb(baseSeed({ FieldReports: [mkFr('fr-1', 'post-1', '')] }), {
    onGet: (name, id, rec) => {
      if (name === 'FieldReports' && id === 'fr-1') rec.post_id = 'post-other';
    },
  });
  const res = await run(probuildHandler, db, { ...RANGE, __probuild: probuild([mkPost('post-1', '2026-09-15T20:00:00Z', LATE_TEXT, att(PHOTO))]) });
  assert.equal(res.fr_messages_filled, 0);
  assert.equal(res.fr_messages_skipped_fresh, 1);
  assert.equal(db.table('FieldReports')[0].message, '', 'not filled: identity mismatch');
  assert.equal(db.frUpdateCalls.length, 0);
});

test('failed fresh get -> skip, no throw out of the handler', async () => {
  const db = memoryDb(baseSeed({ FieldReports: [mkFr('fr-1', 'post-1', '')] }), {
    onGet: (_name, id) => {
      if (id === 'fr-1') throw new Error('transient read failure');
    },
  });
  const res = await run(probuildHandler, db, { ...RANGE, __probuild: probuild([mkPost('post-1', '2026-09-15T20:00:00Z', LATE_TEXT, att(PHOTO))]) });
  assert.equal(res.fr_messages_filled, 0, 'no write on fresh-read failure');
  assert.equal(res.fr_messages_skipped_fresh, 1);
  assert.equal(db.table('FieldReports')[0].message, '', 'record unchanged');
  assert.equal(db.frUpdateCalls.length, 0);
});

test('failed isolated update -> counted as skip, handler still succeeds', async () => {
  const db = memoryDb(baseSeed({ FieldReports: [mkFr('fr-1', 'post-1', '')] }), {
    onUpdate: (name, id) => { if (name === 'FieldReports' && id === 'fr-1') throw new Error('write rejected'); },
  });
  const res = await run(probuildHandler, db, { ...RANGE, __probuild: probuild([mkPost('post-1', '2026-09-15T20:00:00Z', LATE_TEXT, att(PHOTO))]) });
  assert.equal(res.fr_messages_filled, 0, 'failed write not counted as filled');
  assert.equal(res.fr_messages_skipped_fresh, 1, 'counted as a skip');
  assert.equal(db.table('FieldReports')[0].message, '', 'record unchanged after failed write');
});

test('LIMITATION: no atomic CAS in the SDK; message write is an isolated update with a residual read-then-write race', async () => {
  // The Base44 entity update is an unconditional PUT (verified against
  // @base44/sdk/dist/modules/entities.js); bulkUpdate is an unconditional PUT
  // /bulk; updateMany is a query-conditional PATCH with a MongoDB operator and no
  // schema validation. None is an atomic compare-and-set on a record revision, so
  // the fresh get + isolated update cannot fully close the race: a concurrent owner
  // edit landing BETWEEN the fresh FieldReports.get and the FieldReports.update
  // would still be overwritten. This test documents that the write path carries no
  // revision/conditional token and that the isolated update data is exactly
  // {message} (the fresh get is the only guard, not a server-side CAS).
  const db = memoryDb(baseSeed({ FieldReports: [mkFr('fr-1', 'post-1', '')] }));
  await run(probuildHandler, db, { ...RANGE, __probuild: probuild([mkPost('post-1', '2026-09-15T20:00:00Z', LATE_TEXT, att(PHOTO))]) });
  assert.equal(db.frUpdateCalls.length, 1, 'message written via isolated update');
  const data = db.frUpdateCalls[0].data;
  assert.ok(!('revision' in data) && !('if_not_exists' in data) && !('condition' in data) && !('if_match' in data), 'no CAS/conditional token in the update');
  assert.deepEqual(data, { message: LATE_TEXT }, 'update is a single-field {message} write');
  assert.equal(db.frBulkUpdateCalls.length, 0, 'message not bundled into the photo/job bulk patch');
});