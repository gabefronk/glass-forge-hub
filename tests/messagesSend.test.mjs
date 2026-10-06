import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import {
  createMessagesSendHandler, MockDispatchAdapter, DisabledDispatchAdapter,
  validateText, validateClientId, validateConversationKey, validateName, validateFileUri,
  computeFingerprint, sha256Bytes, TEXT_MAX, ATTACHMENT_MAX,
} from '../base44/shared/messagesDispatch.js';
if (!globalThis.crypto) globalThis.crypto = webcrypto;

const OWNER = { id: 'owner-id-1', role: 'admin', email: 'gabefronk@gmail.com' };
const OTHER = { id: 'other-id-1', role: 'admin', email: 'someone@example.com' };
const CONV_KEY = 'a'.repeat(64);
const CHAT = 'iMessage;+;+18015550100';
const DEVICE = 'mac-send';

function makeClient({ user = OWNER, conversations = [{ conversation_key: CONV_KEY, source_chat_guid: CHAT, device_id: DEVICE }], signedUrl = 'https://media.base44.com/files/abc' } = {}) {
  return {
    auth: { me: async () => user },
    asServiceRole: {
      entities: { MessageConversation: { filter: async (q) => conversations.filter((c) => c.conversation_key === q.conversation_key).slice(0, 1) } },
      integrations: { Core: { CreateFileSignedUrl: async () => ({ signed_url: signedUrl }) } },
    },
  };
}

function makeRegistrationStore() {
  const map = new Map();
  return {
    get: async (oid, ck, cid) => map.get(`${oid}|${ck}|${cid}`) || null,
    create: async (oid, ck, cid, data) => { map.set(`${oid}|${ck}|${cid}`, { ...data }); return { ...data }; },
    _map: map,
  };
}

function makeHandler(opts = {}) {
  const {
    provider, enabled = true, user = OWNER, conversations, configuredDeviceId = DEVICE,
    signedUrl, fetchImpl, registrationStore,
  } = opts;
  const adapter = MockDispatchAdapter({ transport: provider || (async () => ({ ok: true })) });
  const store = registrationStore || makeRegistrationStore();
  const resolveMapping = async (client, key) => {
    const row = (await client.asServiceRole.entities.MessageConversation.filter({ conversation_key: key }))[0];
    if (!row || !row.source_chat_guid) return null;
    return { chatGuid: row.source_chat_guid, device_id: row.device_id, configuredDeviceId };
  };
  const handler = createMessagesSendHandler({
    getClient: async () => makeClient({ user, conversations, signedUrl }),
    adapter, enabled, registrationStore: store, resolveMapping,
    fetchImpl: fetchImpl || globalThis.fetch,
  });
  return { handler, store };
}

async function call(handler, body) {
  return handler(new Request('https://example.com', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }));
}

// ---- validators ----
test('validateText: NUL rejected (not silently stripped), control rejected, exact text returned', () => {
  assert.equal(validateText('  hi  ').ok, true);
  assert.equal(validateText('  hi  ').text, '  hi  '); // exact, not trimmed
  assert.equal(validateText('').ok, false);
  assert.equal(validateText('   ').ok, false);
  assert.equal(validateText('a'.repeat(TEXT_MAX + 1)).ok, false);
  assert.equal(validateText('a'.repeat(TEXT_MAX)).ok, true);
  assert.equal(validateText('line1\nline2\ttab').ok, true);
  assert.equal(validateText('a\u0000b').ok, false); // NUL rejected, not stripped
  assert.equal(validateText('a\u0001b').ok, false);
  assert.equal(validateText('a\u000Bb').ok, false);
  assert.equal(validateText('a\u007Fb').ok, false);
});
test('validateClientId / validateConversationKey / validateName / validateFileUri', () => {
  assert.equal(validateClientId('abc12345-_-').ok, true);
  assert.equal(validateClientId('short').ok, false);
  assert.equal(validateConversationKey(CONV_KEY).ok, true);
  assert.equal(validateConversationKey('xyz').ok, false);
  assert.equal(validateName('photo.jpg').ok, true);
  assert.equal(validateName('').ok, false);
  assert.equal(validateName('x'.repeat(201)).ok, false);
  assert.equal(validateFileUri('private/abc').ok, true);
  assert.equal(validateFileUri('https://media.base44.com/x').ok, false); // public URL rejected
  assert.equal(validateFileUri('').ok, false);
});

// ---- owner rejections before reads ----
test('null user -> 401, non-owner admin -> 403, before any read', async () => {
  const { handler } = makeHandler({ user: null, provider: async () => { throw new Error('should not dispatch'); } });
  let r = await call(handler, { action: 'send_text', conversation_key: CONV_KEY, client_id: 'cid12345', text: 'hi' });
  assert.equal(r.status, 401);
  const { handler: h2 } = makeHandler({ user: OTHER, provider: async () => { throw new Error('should not dispatch'); } });
  r = await call(h2, { action: 'send_text', conversation_key: CONV_KEY, client_id: 'cid12345', text: 'hi' });
  assert.equal(r.status, 403);
});
test('disabled (enabled=false) -> 502 for every action incl register_upload, no dispatch', async () => {
  let dispatched = false;
  const { handler } = makeHandler({ enabled: false, provider: async () => { dispatched = true; return { ok: true }; } });
  for (const body of [
    { action: 'send_text', conversation_key: CONV_KEY, client_id: 'cid12345', text: 'hi' },
    { action: 'register_upload', conversation_key: CONV_KEY, client_id: 'cid12345', file_uri: 'private/x', name: 'a.bin', mime: 'application/octet-stream', size: 1, sha256: 'a'.repeat(64) },
    { action: 'send_attachment', conversation_key: CONV_KEY, client_id: 'cid12345' },
  ]) {
    const r = await call(handler, body);
    assert.equal(r.status, 502);
    assert.equal((await r.json()).code, 'disabled');
  }
  assert.equal(dispatched, false);
});

// ---- mapping / device exact match ----
test('missing source_chat_guid -> 404 not_sendable', async () => {
  const { handler } = makeHandler({ conversations: [{ conversation_key: CONV_KEY, source_chat_guid: '', device_id: DEVICE }] });
  const r = await call(handler, { action: 'send_text', conversation_key: CONV_KEY, client_id: 'cid12345', text: 'hi' });
  assert.equal(r.status, 404);
  assert.equal((await r.json()).code, 'not_sendable');
});
test('device config unset -> 404 (not permissive)', async () => {
  const { handler } = makeHandler({ configuredDeviceId: '' });
  const r = await call(handler, { action: 'send_text', conversation_key: CONV_KEY, client_id: 'cid12345', text: 'hi' });
  assert.equal(r.status, 404);
});
test('device id mismatch -> 404', async () => {
  const { handler } = makeHandler({ conversations: [{ conversation_key: CONV_KEY, source_chat_guid: CHAT, device_id: 'other-device' }] });
  const r = await call(handler, { action: 'send_text', conversation_key: CONV_KEY, client_id: 'cid12345', text: 'hi' });
  assert.equal(r.status, 404);
});

// ---- send_text (field `text`) ----
test('send_text success -> 200 {ok,temp_guid,conversation_key}', async () => {
  const { handler } = makeHandler();
  const r = await call(handler, { action: 'send_text', conversation_key: CONV_KEY, client_id: 'cid12345', text: 'hello' });
  assert.equal(r.status, 200);
  const b = await r.json();
  assert.equal(b.ok, true);
  assert.equal(b.conversation_key, CONV_KEY);
  assert.equal(b.temp_guid, 'cid12345'); // tempGuid === client_id
});

// ---- register_upload + send_attachment (registration-gated) ----
test('send_attachment without registration -> 404 not_registered, no fetch', async () => {
  let fetched = false;
  const { handler } = makeHandler({ fetchImpl: async () => { fetched = true; return new Response(new Uint8Array([1])); } });
  const r = await call(handler, { action: 'send_attachment', conversation_key: CONV_KEY, client_id: 'attach12345' });
  assert.equal(r.status, 404);
  assert.equal((await r.json()).code, 'not_registered');
  assert.equal(fetched, false); // registration validated before any signing/fetch
});
test('register_upload then send_attachment -> 200; signs registered file_uri only', async () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const fetchImpl = async () => new Response(bytes, { status: 200, headers: { 'content-length': String(bytes.length) } });
  const { handler } = makeHandler({ fetchImpl });
  const sha = await sha256Bytes(crypto, bytes);
  let r = await call(handler, { action: 'register_upload', conversation_key: CONV_KEY, client_id: 'attach12345', file_uri: 'private/abc', name: 'photo.jpg', mime: 'image/jpeg', size: 4, sha256: sha });
  assert.equal(r.status, 200);
  r = await call(handler, { action: 'send_attachment', conversation_key: CONV_KEY, client_id: 'attach12345' });
  assert.equal(r.status, 200);
  assert.equal((await r.json()).temp_guid, 'attach12345');
});
test('register_upload rejects public URL file_uri and missing sha256', async () => {
  const { handler } = makeHandler();
  let r = await call(handler, { action: 'register_upload', conversation_key: CONV_KEY, client_id: 'attach12345', file_uri: 'https://media.base44.com/x', name: 'a.bin', mime: 'application/octet-stream', size: 1, sha256: 'a'.repeat(64) });
  assert.equal(r.status, 400);
  r = await call(handler, { action: 'register_upload', conversation_key: CONV_KEY, client_id: 'attach12345', file_uri: 'private/x', name: 'a.bin', mime: 'application/octet-stream', size: 1, sha256: 'nothex' });
  assert.equal(r.status, 400);
});
test('send_attachment bytes hash mismatch -> 400 (not verified)', async () => {
  const bytes = new Uint8Array([1, 2, 3, 4]);
  const fetchImpl = async () => new Response(bytes, { status: 200 });
  const { handler } = makeHandler({ fetchImpl });
  await call(handler, { action: 'register_upload', conversation_key: CONV_KEY, client_id: 'attach12345', file_uri: 'private/abc', name: 'photo.jpg', mime: 'image/jpeg', size: 4, sha256: 'b'.repeat(64) });
  const r = await call(handler, { action: 'send_attachment', conversation_key: CONV_KEY, client_id: 'attach12345' });
  assert.equal(r.status, 400);
});

// ---- same client_id retries incl. unknown outcome ----
test('repeat identical sent -> cached success, no resend', async () => {
  let sends = 0;
  const { handler } = makeHandler({ provider: async () => { sends++; return { ok: true }; } });
  await call(handler, { action: 'send_text', conversation_key: CONV_KEY, client_id: 'same12345', text: 'hi' });
  const r = await call(handler, { action: 'send_text', conversation_key: CONV_KEY, client_id: 'same12345', text: 'hi' });
  assert.equal(r.status, 200);
  assert.equal(sends, 1);
});
test('changed payload same client_id -> 409 rejected', async () => {
  const { handler } = makeHandler();
  await call(handler, { action: 'send_text', conversation_key: CONV_KEY, client_id: 'same12345', text: 'hi' });
  const r = await call(handler, { action: 'send_text', conversation_key: CONV_KEY, client_id: 'same12345', text: 'different' });
  assert.equal(r.status, 409);
});
test('post-dispatch dropped response -> unknown (502); repeat -> 409 (no resend)', async () => {
  let sends = 0;
  const { handler } = makeHandler({ provider: async () => { sends++; throw new Error('connection dropped'); } });
  let r = await call(handler, { action: 'send_text', conversation_key: CONV_KEY, client_id: 'unk12345', text: 'hi' });
  assert.equal(r.status, 502);
  assert.equal((await r.json()).code, 'unknown');
  r = await call(handler, { action: 'send_text', conversation_key: CONV_KEY, client_id: 'unk12345', text: 'hi' });
  assert.equal(r.status, 409);
  assert.equal(sends, 1);
});
test('concurrent pending -> 409', async () => {
  let resolve;
  const { handler } = makeHandler({ provider: async () => { await new Promise((r) => { resolve = r; }); return { ok: true }; } });
  const p1 = call(handler, { action: 'send_text', conversation_key: CONV_KEY, client_id: 'conc12345', text: 'hi' });
  await new Promise((r) => setTimeout(r, 5));
  const r2 = await call(handler, { action: 'send_text', conversation_key: CONV_KEY, client_id: 'conc12345', text: 'hi' });
  assert.equal(r2.status, 409);
  resolve();
  await p1;
});
test('failed_pre_dispatch -> retryable (no pending row left)', async () => {
  let attempt = 0;
  const { handler } = makeHandler({ provider: async () => { attempt++; return attempt === 1 ? { ok: false, beforeDispatch: true, error: 'validate failed' } : { ok: true }; } });
  let r = await call(handler, { action: 'send_text', conversation_key: CONV_KEY, client_id: 'retry1234', text: 'hi' });
  assert.equal(r.status, 502);
  assert.equal((await r.json()).code, 'failed_pre_dispatch');
  r = await call(handler, { action: 'send_text', conversation_key: CONV_KEY, client_id: 'retry1234', text: 'hi' });
  assert.equal(r.status, 200);
  assert.equal(attempt, 2);
});

// ---- fingerprint includes mime + bytes hash ----
test('fingerprint differs by mime and by bytes hash', async () => {
  const fp = (o) => computeFingerprint(crypto, o);
  const a = await fp({ kind: 'send_attachment', chatGuid: 'c', mime: 'image/jpeg', bytesHash: 'h1' });
  const b = await fp({ kind: 'send_attachment', chatGuid: 'c', mime: 'image/jpeg', bytesHash: 'h1' });
  const diffHash = await fp({ kind: 'send_attachment', chatGuid: 'c', mime: 'image/jpeg', bytesHash: 'h2' });
  const diffMime = await fp({ kind: 'send_attachment', chatGuid: 'c', mime: 'image/png', bytesHash: 'h1' });
  assert.equal(a, b);
  assert.notEqual(a, diffHash);
  assert.notEqual(a, diffMime);
});
test('attachment re-send with different bytes (re-registered) -> rejected (fingerprint mismatch)', async () => {
  const bytes1 = new Uint8Array([1, 2, 3]);
  const bytes2 = new Uint8Array([4, 5, 6]);
  let which = 1;
  const fetchImpl = async () => new Response(which === 1 ? bytes1 : bytes2, { status: 200 });
  const { handler, store } = makeHandler({ fetchImpl });
  const sha1 = await sha256Bytes(crypto, bytes1);
  await call(handler, { action: 'register_upload', conversation_key: CONV_KEY, client_id: 'att12345', file_uri: 'private/abc', name: 'p.jpg', mime: 'image/jpeg', size: 3, sha256: sha1 });
  let r = await call(handler, { action: 'send_attachment', conversation_key: CONV_KEY, client_id: 'att12345' });
  assert.equal(r.status, 200);
  // re-register with different bytes, same client_id
  which = 2;
  const sha2 = await sha256Bytes(crypto, bytes2);
  await store.create(OWNER.id, CONV_KEY, 'att12345', { file_uri: 'private/abc', name: 'p.jpg', mime: 'image/jpeg', size: 3, sha256: sha2 });
  r = await call(handler, { action: 'send_attachment', conversation_key: CONV_KEY, client_id: 'att12345' });
  assert.equal(r.status, 409); // different fingerprint for same client_id -> rejected
});

// ---- strict signed-URL validation ----
test('malicious signed URL host -> 502, no fetch', async () => {
  let fetched = false;
  const fetchImpl = async () => { fetched = true; return new Response(new Uint8Array([1])); };
  const { handler } = makeHandler({ signedUrl: 'https://evil.example.com/x', fetchImpl });
  await call(handler, { action: 'register_upload', conversation_key: CONV_KEY, client_id: 'mal12345', file_uri: 'private/x', name: 'x.bin', mime: 'application/octet-stream', size: 1, sha256: 'a'.repeat(64) });
  const r = await call(handler, { action: 'send_attachment', conversation_key: CONV_KEY, client_id: 'mal12345' });
  assert.equal(r.status, 502);
  assert.equal(fetched, false);
});
test('http signed URL -> 502 (no fetch)', async () => {
  let fetched = false;
  const fetchImpl = async () => { fetched = true; return new Response(new Uint8Array([1])); };
  const { handler } = makeHandler({ signedUrl: 'http://media.base44.com/files/x', fetchImpl });
  await call(handler, { action: 'register_upload', conversation_key: CONV_KEY, client_id: 'http12345', file_uri: 'private/x', name: 'x.bin', mime: 'application/octet-stream', size: 1, sha256: 'a'.repeat(64) });
  const r = await call(handler, { action: 'send_attachment', conversation_key: CONV_KEY, client_id: 'http12345' });
  assert.equal(r.status, 502);
  assert.equal(fetched, false);
});
test('credentials in signed URL -> 502', async () => {
  const { handler } = makeHandler({ signedUrl: 'https://user:pass@media.base44.com/files/x' });
  await call(handler, { action: 'register_upload', conversation_key: CONV_KEY, client_id: 'cred12345', file_uri: 'private/x', name: 'x.bin', mime: 'application/octet-stream', size: 1, sha256: 'a'.repeat(64) });
  const r = await call(handler, { action: 'send_attachment', conversation_key: CONV_KEY, client_id: 'cred12345' });
  assert.equal(r.status, 502);
});
test('nondefault port in signed URL -> 502', async () => {
  const { handler } = makeHandler({ signedUrl: 'https://media.base44.com:8443/files/x' });
  await call(handler, { action: 'register_upload', conversation_key: CONV_KEY, client_id: 'port12345', file_uri: 'private/x', name: 'x.bin', mime: 'application/octet-stream', size: 1, sha256: 'a'.repeat(64) });
  const r = await call(handler, { action: 'send_attachment', conversation_key: CONV_KEY, client_id: 'port12345' });
  assert.equal(r.status, 502);
});
test('missing path in signed URL -> 502', async () => {
  const { handler } = makeHandler({ signedUrl: 'https://media.base44.com/' });
  await call(handler, { action: 'register_upload', conversation_key: CONV_KEY, client_id: 'path12345', file_uri: 'private/x', name: 'x.bin', mime: 'application/octet-stream', size: 1, sha256: 'a'.repeat(64) });
  const r = await call(handler, { action: 'send_attachment', conversation_key: CONV_KEY, client_id: 'path12345' });
  assert.equal(r.status, 502);
});
test('redirect rejected (not followed, body not read) -> 502', async () => {
  const fetchImpl = async () => new Response(null, { status: 302, headers: { location: 'https://evil.example.com/steal' } });
  const { handler } = makeHandler({ fetchImpl });
  await call(handler, { action: 'register_upload', conversation_key: CONV_KEY, client_id: 'red12345', file_uri: 'private/x', name: 'x.bin', mime: 'application/octet-stream', size: 1, sha256: 'a'.repeat(64) });
  const r = await call(handler, { action: 'send_attachment', conversation_key: CONV_KEY, client_id: 'red12345' });
  assert.equal(r.status, 502);
});
test('stream over 25 MB -> 400', async () => {
  const total = ATTACHMENT_MAX + 1;
  const chunk = new Uint8Array(1024 * 1024);
  const stream = new ReadableStream({
    pull(c) {
      if (c.desiredSize === null || c.desiredSize <= 0) { /* keep going */ }
      // emit in a loop via pull is tricky; use a simpler approach below
    },
  });
  // Use a simpler manual stream:
  let sent = 0;
  const s = new ReadableStream({
    pull(c) {
      if (sent >= total) { c.close(); return; }
      const n = Math.min(chunk.length, total - sent);
      c.enqueue(chunk.subarray(0, n));
      sent += n;
    },
  });
  const fetchImpl = async () => new Response(s, { status: 200 });
  const { handler } = makeHandler({ fetchImpl });
  await call(handler, { action: 'register_upload', conversation_key: CONV_KEY, client_id: 'big12345', file_uri: 'private/big', name: 'big.bin', mime: 'application/octet-stream', size: total, sha256: 'a'.repeat(64) });
  const r = await call(handler, { action: 'send_attachment', conversation_key: CONV_KEY, client_id: 'big12345' });
  assert.equal(r.status, 400);
});
test('error never includes the signed URL', async () => {
  const { handler } = makeHandler({ signedUrl: 'https://evil.example.com/secret-path' });
  await call(handler, { action: 'register_upload', conversation_key: CONV_KEY, client_id: 'leak12345', file_uri: 'private/x', name: 'x.bin', mime: 'application/octet-stream', size: 1, sha256: 'a'.repeat(64) });
  const r = await call(handler, { action: 'send_attachment', conversation_key: CONV_KEY, client_id: 'leak12345' });
  const body = await r.json();
  assert.equal(JSON.stringify(body).includes('evil.example.com'), false);
  assert.equal(JSON.stringify(body).includes('secret-path'), false);
});

test('DisabledDispatchAdapter is the production default -> disabled', async () => {
  const handler = createMessagesSendHandler({
    getClient: async () => makeClient(),
    adapter: DisabledDispatchAdapter, enabled: true,
    resolveMapping: async () => ({ chatGuid: CHAT, device_id: DEVICE, configuredDeviceId: DEVICE }),
  });
  const r = await handler(new Request('https://x.com', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'send_text', conversation_key: CONV_KEY, client_id: 'cid12345', text: 'hi' }) }));
  assert.equal(r.status, 502);
  assert.equal((await r.json()).code, 'disabled');
});