import test from 'node:test';
import assert from 'node:assert/strict';
import { runSendBatch } from '../src/lib/messageComposerOrchestration.js';

const fakeFile = (name, size, type = 'image/jpeg') => {
  const f = { name, size, type };
  Object.defineProperty(f, 'size', { value: size });
  return f;
};

function makeDeps(overrides = {}) {
  const calls = [];
  return {
    calls,
    deps: {
      uploadFile: overrides.uploadFile || (async (file) => { calls.push(['upload', file.name]); return { file_uri: 'private/' + file.name }; }),
      sha256File: overrides.sha256File || (async (file) => { calls.push(['sha256', file.name]); return 'a'.repeat(64); }),
      registerUpload: overrides.registerUpload || (async (r) => { calls.push(['register', r.client_id, r.file_uri]); }),
      sendText: overrides.sendText || (async (r) => { calls.push(['sendText', r.client_id, r.text]); return { status: 'sent' }; }),
      sendAttachment: overrides.sendAttachment || (async (r) => { calls.push(['sendAttachment', r.client_id]); return { status: 'sent' }; }),
    },
  };
}

test('sequential order: upload -> sha256 -> register -> sendAttachment per file, then sendText', async () => {
  const { deps, calls } = makeDeps();
  const batch = { conversationKey: 'k1', text: 'hi', files: [
    { id: 'f1', file: fakeFile('a.jpg', 10), name: 'a.jpg', size: 10, mime: 'image/jpeg' },
    { id: 'f2', file: fakeFile('b.jpg', 10), name: 'b.jpg', size: 10, mime: 'image/png' },
  ] };
  const out = await runSendBatch(batch, deps);
  assert.equal(out.allSent, true);
  assert.equal(out.locked, false);
  assert.equal(out.stoppedAt, null);
  assert.equal(out.steps.length, 3);
  // order: file1 upload/sha256/register/send, file2 upload/sha256/register/send, text
  assert.deepEqual(calls.map((c) => c[0]), [
    'upload', 'sha256', 'register', 'sendAttachment',
    'upload', 'sha256', 'register', 'sendAttachment',
    'sendText',
  ]);
});

test('stop on uncertain (unknown): text NOT sent after uncertain attachment; locked', async () => {
  const sendAttachment = async () => ({ status: 'unknown', error: 'dropped' });
  const { deps, calls } = makeDeps({ sendAttachment });
  const batch = { conversationKey: 'k1', text: 'hi', files: [{ id: 'f1', file: fakeFile('a.jpg', 10), name: 'a.jpg', size: 10, mime: 'image/jpeg' }] };
  const out = await runSendBatch(batch, deps);
  assert.equal(out.allSent, false);
  assert.equal(out.locked, true);
  assert.equal(out.stoppedAt, 0);
  assert.equal(calls.some((c) => c[0] === 'sendText'), false); // text never sent
});

test('stop on rejected: text NOT sent; locked', async () => {
  const sendAttachment = async () => ({ status: 'rejected', error: 'dup' });
  const { deps, calls } = makeDeps({ sendAttachment });
  const out = await runSendBatch({ conversationKey: 'k1', text: 'hi', files: [{ id: 'f1', file: fakeFile('a.jpg', 10), name: 'a.jpg', size: 10, mime: 'image/jpeg' }] }, deps);
  assert.equal(out.locked, true);
  assert.equal(calls.some((c) => c[0] === 'sendText'), false);
});

test('stop on failed_pre_dispatch: text NOT sent; NOT locked (retryable)', async () => {
  const sendAttachment = async () => ({ status: 'failed_pre_dispatch', error: 'validate failed' });
  const { deps, calls } = makeDeps({ sendAttachment });
  const out = await runSendBatch({ conversationKey: 'k1', text: 'hi', files: [{ id: 'f1', file: fakeFile('a.jpg', 10), name: 'a.jpg', size: 10, mime: 'image/jpeg' }] }, deps);
  assert.equal(out.locked, false);
  assert.equal(out.stoppedAt, 0);
  assert.equal(calls.some((c) => c[0] === 'sendText'), false);
});

test('second attachment uncertain stops before text and before later files', async () => {
  const order = ['sent', 'unknown'];
  let i = 0;
  const sendAttachment = async () => ({ status: order[i++], error: 'x' });
  const { deps, calls } = makeDeps({ sendAttachment });
  const out = await runSendBatch({ conversationKey: 'k1', text: 'hi', files: [
    { id: 'f1', file: fakeFile('a.jpg', 10), name: 'a.jpg', size: 10, mime: 'image/jpeg' },
    { id: 'f2', file: fakeFile('b.jpg', 10), name: 'b.jpg', size: 10, mime: 'image/png' },
  ] }, deps);
  assert.equal(out.locked, true);
  assert.equal(out.stoppedAt, 1);
  assert.equal(calls.some((c) => c[0] === 'sendText'), false);
});

test('exact payload + client_id preserved per step; retry reuses same client_id (not fresh)', async () => {
  const seen = [];
  const sendAttachment = async (r) => { seen.push(r.client_id); return { status: 'sent' }; };
  const { deps } = makeDeps({ sendAttachment });
  const batch = { conversationKey: 'k1', text: 'exact words', files: [{ id: 'stable-id-1', file: fakeFile('a.jpg', 10), name: 'a.jpg', size: 10, mime: 'image/jpeg' }] };
  const out = await runSendBatch(batch, deps);
  assert.equal(out.steps[0].client_id, 'stable-id-1'); // staged file id reused
  assert.equal(out.steps[0].payload.name, 'a.jpg');
  assert.equal(out.steps[1].payload.text, 'exact words'); // exact text preserved
  assert.equal(seen[0], 'stable-id-1');
});

test('upload returning no file_uri -> failed_pre_dispatch, stops, not locked', async () => {
  const { deps, calls } = makeDeps({ uploadFile: async () => ({}) });
  const out = await runSendBatch({ conversationKey: 'k1', text: 'hi', files: [{ id: 'f1', file: fakeFile('a.jpg', 10), name: 'a.jpg', size: 10, mime: 'image/jpeg' }] }, deps);
  assert.equal(out.steps[0].result.status, 'failed_pre_dispatch');
  assert.equal(out.locked, false);
  assert.equal(calls.some((c) => c[0] === 'sendAttachment'), false);
});

test('thrown dep -> unknown, stops, locked', async () => {
  const { deps } = makeDeps({ sendText: async () => { throw new Error('boom'); } });
  const out = await runSendBatch({ conversationKey: 'k1', text: 'hi', files: [] }, deps);
  assert.equal(out.steps[0].result.status, 'unknown');
  assert.equal(out.locked, true);
});

test('empty batch -> allSent false, no calls', async () => {
  const { deps, calls } = makeDeps();
  const out = await runSendBatch({ conversationKey: 'k1', text: '', files: [] }, deps);
  assert.equal(out.allSent, false);
  assert.equal(out.steps.length, 0);
  assert.equal(calls.length, 0);
});

test('onProgress receives per-step results in order', async () => {
  const progress = [];
  const { deps } = makeDeps();
  await runSendBatch({ conversationKey: 'k1', text: 'hi', files: [{ id: 'f1', file: fakeFile('a.jpg', 10), name: 'a.jpg', size: 10, mime: 'image/jpeg' }] }, deps, (i, r) => progress.push([i, r.status]));
  assert.deepEqual(progress, [[0, 'sent'], [1, 'sent']]);
});