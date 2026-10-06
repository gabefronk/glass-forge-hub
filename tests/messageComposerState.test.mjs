import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_FILE_SIZE, TEXT_MAX, stageFile, canSend, freezeBatch, planSteps, isRetryable, isUncertain, revokePreviews,
} from '../src/lib/messageComposerState.js';

const fakeFile = (name, size, type = 'image/jpeg') => {
  const f = { name, size, type };
  Object.defineProperty(f, 'size', { value: size });
  return f;
};

test('stageFile: 25 MB cap, empty rejected, image preview is null in node (no objectURL)', () => {
  assert.equal(stageFile(fakeFile('a.jpg', 1)).ok, true);
  assert.equal(stageFile(fakeFile('a.jpg', 1)).item.status, 'staged');
  assert.equal(stageFile(fakeFile('a.jpg', 0)).ok, false);
  assert.equal(stageFile(fakeFile('a.jpg', MAX_FILE_SIZE)).ok, true);
  assert.equal(stageFile(fakeFile('a.jpg', MAX_FILE_SIZE + 1)).ok, false);
  assert.equal(stageFile(fakeFile('a.jpg', 100)).item.previewUrl, null); // no URL.createObjectURL in node
  assert.equal(stageFile(fakeFile('a.bin', 100, 'application/octet-stream')).item.isImage, false);
});

test('canSend: empty/busy/locked disabled; text or staged files enabled', () => {
  assert.equal(canSend({ text: '', files: [], sending: false, locked: false }), false);
  assert.equal(canSend({ text: 'hi', files: [], sending: false, locked: false }), true);
  assert.equal(canSend({ text: '', files: [{ status: 'staged' }], sending: false, locked: false }), true);
  assert.equal(canSend({ text: 'hi', files: [], sending: true, locked: false }), false);
  assert.equal(canSend({ text: 'hi', files: [], sending: false, locked: true }), false);
  assert.equal(canSend({ text: '', files: [{ status: 'uploading' }], sending: false, locked: false }), false);
});

test('freezeBatch: snapshot is isolated from later edits; staged file id preserved', () => {
  const files = [{ id: 'f1', status: 'staged', file: {}, name: 'a.jpg', size: 10, mime: 'image/jpeg', isImage: true, previewUrl: null }];
  const batch = freezeBatch({ conversationKey: 'k1', text: 'hello', files });
  assert.equal(batch.conversationKey, 'k1');
  assert.equal(batch.text, 'hello');
  assert.equal(batch.files.length, 1);
  assert.equal(batch.files[0].id, 'f1');
  files.push({ id: 'f2', status: 'staged', file: {}, name: 'b.jpg', size: 10, mime: 'image/jpeg' });
  assert.equal(batch.files.length, 1); // frozen, not affected by later staging
});

test('planSteps: files first then text; staged file id reused as stable client_id', () => {
  const batch = freezeBatch({ conversationKey: 'k1', text: 'hi', files: [
    { id: 'f1', status: 'staged', file: {}, name: 'a.jpg', size: 10, mime: 'image/jpeg' },
    { id: 'f2', status: 'staged', file: {}, name: 'b.jpg', size: 10, mime: 'image/png' },
  ] });
  const steps = planSteps(batch);
  assert.equal(steps.length, 3);
  assert.equal(steps[0].kind, 'send_attachment');
  assert.equal(steps[0].client_id, 'f1'); // staged file id IS the step client_id (stable)
  assert.equal(steps[1].kind, 'send_attachment');
  assert.equal(steps[1].client_id, 'f2');
  assert.equal(steps[2].kind, 'send_text');
  assert.equal(typeof steps[2].client_id, 'string');
  assert.equal(steps[2].payload.text, 'hi');
  // exact payload preserved
  assert.equal(steps[0].payload.name, 'a.jpg');
  assert.equal(steps[2].payload.text, 'hi');
});

test('isRetryable / isUncertain', () => {
  assert.equal(isRetryable('failed_pre_dispatch'), true);
  assert.equal(isRetryable('unknown'), false);
  assert.equal(isRetryable('rejected'), false);
  assert.equal(isRetryable('disabled'), false);
  assert.equal(isUncertain('unknown'), true);
  assert.equal(isUncertain('rejected'), true);
  assert.equal(isUncertain('disabled'), true);
  assert.equal(isUncertain('failed_pre_dispatch'), false);
  assert.equal(isUncertain('sent'), false);
});

test('revokePreviews is a no-op without URL.revokeObjectURL (node)', () => {
  assert.doesNotThrow(() => revokePreviews([{ previewUrl: 'blob:x' }]));
});