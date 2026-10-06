import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { MockDispatchAdapter, DisabledDispatchAdapter, computeFingerprint } from '../base44/shared/messagesDispatch.js';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const OWNER_ID = 'owner-id-1';
const CONV = 'a'.repeat(64);
const CHAT = 'iMessage;+;+18015550100';

function adapter(transport) {
  return MockDispatchAdapter({ transport });
}

async function dispatchText(a, { client_id = 'cid12345', text = 'hello', chatGuid = CHAT } = {}) {
  const fp = await computeFingerprint(crypto, { kind: 'send_text', chatGuid, text });
  return a.dispatch({ owner_id: OWNER_ID, conversation_key: CONV, client_id, kind: 'send_text', chatGuid, text, fingerprint: fp });
}
async function dispatchAttachment(a, { client_id = 'att12345', bytes = new Uint8Array([1, 2, 3, 4]), name = 'photo.jpg', mime = 'image/jpeg', chatGuid = CHAT } = {}) {
  const bytesHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
  const fp = await computeFingerprint(crypto, { kind: 'send_attachment', chatGuid, mime, bytesHash });
  return a.dispatch({ owner_id: OWNER_ID, conversation_key: CONV, client_id, kind: 'send_attachment', chatGuid, bytes, name, mime, fingerprint: fp });
}

test('send_text transport: POST JSON with text+chatGuid+tempGuid; tempGuid === client_id', async () => {
  const seen = [];
  const a = adapter(async (payload) => { seen.push(payload); return { ok: true }; });
  const r = await dispatchText(a, { client_id: 'cid12345', text: 'hello' });
  assert.equal(r.status, 'sent');
  assert.equal(r.temp_guid, 'cid12345');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].method, 'POST');
  assert.equal(seen[0].url, '/api/v1/message/text');
  assert.equal(seen[0].headers['Content-Type'], 'application/json');
  const body = JSON.parse(seen[0].body);
  assert.equal(body.text, 'hello');
  assert.equal(body.chatGuid, CHAT);
  assert.equal(body.tempGuid, 'cid12345'); // exact persisted GUID = client_id
  assert.equal(seen[0].tempGuid, 'cid12345');
});

test('send_attachment transport: multipart with file bytes; tempGuid === client_id', async () => {
  const seen = [];
  const bytes = new Uint8Array([10, 20, 30, 40]);
  const a = adapter(async (payload) => { seen.push(payload); return { ok: true }; });
  const r = await dispatchAttachment(a, { client_id: 'att12345', bytes, name: 'photo.jpg', mime: 'image/jpeg' });
  assert.equal(r.status, 'sent');
  assert.equal(r.temp_guid, 'att12345');
  assert.equal(seen.length, 1);
  assert.equal(seen[0].method, 'POST');
  assert.equal(seen[0].url, '/api/v1/message/attachment');
  assert.match(seen[0].headers['Content-Type'], /^multipart\/form-data; boundary=/);
  assert.equal(seen[0].tempGuid, 'att12345');
  // the bytes are embedded in the multipart body
  const bodyText = new TextDecoder().decode(seen[0].body);
  assert.ok(bodyText.includes('name="attachment"'));
  assert.ok(bodyText.includes('filename="photo.jpg"'));
  assert.ok(bodyText.includes('Content-Type: image/jpeg'));
  assert.ok(bodyText.includes('name="chatGuid"'));
  assert.ok(bodyText.includes('name="tempGuid"'));
  assert.ok(bodyText.includes(CHAT));
  assert.ok(bodyText.includes('att12345'));
  // raw bytes present in the body
  assert.equal(seen[0].bytes.length, bytes.length);
});

test('beforeDispatch failure -> failed_pre_dispatch; ledger cleared so retry proceeds', async () => {
  let attempt = 0;
  const a = adapter(async () => { attempt++; return attempt === 1 ? { ok: false, beforeDispatch: true, error: 'validate failed' } : { ok: true }; });
  let r = await dispatchText(a, { client_id: 'retry1234' });
  assert.equal(r.status, 'failed_pre_dispatch');
  r = await dispatchText(a, { client_id: 'retry1234' });
  assert.equal(r.status, 'sent');
  assert.equal(attempt, 2);
});

test('transport throw -> unknown; repeat same client_id -> rejected (no resend)', async () => {
  let calls = 0;
  const a = adapter(async () => { calls++; throw new Error('connection dropped'); });
  let r = await dispatchText(a, { client_id: 'unk12345' });
  assert.equal(r.status, 'unknown');
  r = await dispatchText(a, { client_id: 'unk12345' });
  assert.equal(r.status, 'rejected');
  assert.equal(calls, 1);
});

test('repeat identical sent -> cached success, no transport call', async () => {
  let calls = 0;
  const a = adapter(async () => { calls++; return { ok: true }; });
  await dispatchText(a, { client_id: 'same12345', text: 'hi' });
  const r = await dispatchText(a, { client_id: 'same12345', text: 'hi' });
  assert.equal(r.status, 'sent');
  assert.equal(r.cached, true);
  assert.equal(calls, 1);
});

test('changed payload same client_id -> rejected', async () => {
  const a = adapter(async () => ({ ok: true }));
  await dispatchText(a, { client_id: 'same12345', text: 'hi' });
  const r = await dispatchText(a, { client_id: 'same12345', text: 'different' });
  assert.equal(r.status, 'rejected');
});

test('concurrent pending -> rejected', async () => {
  let resolve;
  const a = adapter(async () => { await new Promise((r) => { resolve = r; }); return { ok: true }; });
  const p = dispatchText(a, { client_id: 'conc12345' });
  await new Promise((r) => setTimeout(r, 5));
  const r = await dispatchText(a, { client_id: 'conc12345' });
  assert.equal(r.status, 'rejected');
  resolve();
  await p;
});

test('DisabledDispatchAdapter always returns disabled (no transport)', async () => {
  const r = await DisabledDispatchAdapter.dispatch({ owner_id: OWNER_ID, conversation_key: CONV, client_id: 'x', kind: 'send_text' });
  assert.equal(r.status, 'disabled');
});