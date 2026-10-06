// Staged Messages send: a dispatch-adapter contract + pure validators + a fail-closed handler.
//
// PRODUCTION DEFAULT IS DISABLED. Base44 entity ops offer no atomic unique-claim primitive
// (create is unconditional; upsert updates-on-collision rather than rejecting; no transactions,
// no unique index, no conditional insert). Without a proven atomic claim, exactly-once dispatch
// cannot be guaranteed, so we ship disabled rather than fake it with list-then-create, a
// process-local Map, or a presumed-unique entity field. The production adapter
// (DisabledDispatchAdapter) makes no provider call, reads no secret, fetches no file, and the
// handler returns 502 'disabled' for EVERY action (including register_upload) when enabled=false.
//
// Attachments NEVER use a public URL and NEVER sign a client-supplied file_uri. The client stages
// with Core.UploadPrivateFile (owner context) -> file_uri, then registers that upload with
// (owner, conversation_key, client_id, file_uri, name, mime, size, sha256). On send_attachment the
// server looks up the registration FIRST (before any signing/fetch); only the registered file_uri
// is signed, and the fetched bytes are hashed and compared to the registered sha256. If no
// registration matches, fail closed (404 not_registered). The client never supplies the chatGuid.
//
// The signed URL is strictly validated: HTTPS only, exact allowlisted host, no credentials, no
// nondefault port, a path must be present. Redirects are rejected (never followed, body never
// read). The stream is capped at 25 MB; exceeding it returns 400. Errors never include the URL
// or any secret. The fingerprint is immutable and includes mime + the actual bytes hash.
//
// Outcomes: sent (repeat identical -> cached, no resend) | unknown (dispatched, outcome unknown;
// no resend, reconcile) | failed_pre_dispatch (definite pre-dispatch failure; retry allowed) |
// rejected (duplicate/concurrent/changed payload for the same client_id; no resend, 409) |
// disabled (502). The mock adapter's tempGuid is EXACTLY the client_id (the persisted GUID).

const OWNER_EMAILS = new Set(['gabefronk@gmail.com', 'gabriel.fronk.wd@gmail.com']);
export const isSendOwner = (user) => !!user && user.role === 'admin' && OWNER_EMAILS.has(String(user.email || '').trim().toLowerCase());

export const TEXT_MAX = 4000;
export const ATTACHMENT_MAX = 25 * 1024 * 1024;
const ALLOWED_HOSTS = new Set(['media.base44.com', 'static.wixstatic.com']);

const reply = (body, status = 200) => Response.json(body, {
  status,
  headers: { 'Cache-Control': 'private, no-store, max-age=0', 'Pragma': 'no-cache' },
});

// ---- Pure validators ---------------------------------------------------------

// Reject NUL and control chars (except tab/newline); do NOT silently change the user's words.
// Returns the exact text (not trimmed) on success.
export function validateText(text) {
  if (typeof text !== 'string') return { ok: false, error: 'Message text is required.', status: 400 };
  if (text.includes('\u0000') || /[\u0001-\u0008\u000B-\u001F\u007F]/.test(text)) {
    return { ok: false, error: 'Message contains unsupported characters.', status: 400 };
  }
  if (!text.trim()) return { ok: false, error: 'Message is empty.', status: 400 };
  if (text.length > TEXT_MAX) return { ok: false, error: 'Message is too long.', status: 400 };
  return { ok: true, text };
}

export function validateClientId(id) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{8,128}$/.test(id)) {
    return { ok: false, error: 'Invalid client id.', status: 400 };
  }
  return { ok: true };
}

export function validateConversationKey(key) {
  if (typeof key !== 'string' || !/^[a-f0-9]{64}$/.test(key)) {
    return { ok: false, error: 'Invalid conversation.', status: 400 };
  }
  return { ok: true };
}

export function validateName(name) {
  if (typeof name !== 'string' || !name.trim() || name.length > 200) {
    return { ok: false, error: 'Invalid attachment name.', status: 400 };
  }
  return { ok: true, name: name.trim() };
}

// A private URI from UploadPrivateFile — not an http(s) URL. Public URLs are rejected.
export function validateFileUri(uri) {
  if (typeof uri !== 'string' || !uri || uri.length > 512) return { ok: false, error: 'Invalid attachment reference.', status: 400 };
  if (/^https?:\/\//i.test(uri)) return { ok: false, error: 'Attachment must be a private upload.', status: 400 };
  return { ok: true };
}

export async function sha256Bytes(crypto, bytes) {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), (b) => b.toString(16).padStart(2, '0')).join('');
}

// Immutable fingerprint. For text: kind + chatGuid + text. For attachments: kind + chatGuid +
// mime + bytesHash (the actual content hash, not the file_uri).
export async function computeFingerprint(crypto, payload) {
  const stable = JSON.stringify({
    kind: payload.kind || '',
    chatGuid: payload.chatGuid || '',
    text: payload.text || '',
    mime: payload.mime || '',
    bytesHash: payload.bytesHash || '',
  });
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stable))), (b) => b.toString(16).padStart(2, '0')).join('');
}

// ---- Strict signed-URL validation + capped stream ---------------------------

function assertSafeSignedUrl(url) {
  let u;
  try { u = new URL(url); } catch { throw Object.assign(new Error('Attachment is not available.'), { status: 502 }); }
  if (u.protocol !== 'https:') throw Object.assign(new Error('Attachment is not available.'), { status: 502 });
  if (!ALLOWED_HOSTS.has(u.hostname)) throw Object.assign(new Error('Attachment is not available.'), { status: 502 });
  if (u.username || u.password) throw Object.assign(new Error('Attachment is not available.'), { status: 502 });
  if (u.port && u.port !== '443') throw Object.assign(new Error('Attachment is not available.'), { status: 502 });
  if (!u.pathname || u.pathname === '/') throw Object.assign(new Error('Attachment is not available.'), { status: 502 });
  return u;
}

async function readCapped(response) {
  if (!response.body || typeof response.body.getReader !== 'function') {
    throw Object.assign(new Error('Attachment is not available.'), { status: 502 });
  }
  const reader = response.body.getReader();
  const parts = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!(value instanceof Uint8Array) || !value.length) continue;
    size += value.length;
    if (size > ATTACHMENT_MAX) { await reader.cancel(); throw Object.assign(new Error('Attachment exceeds the size limit.'), { status: 400 }); }
    parts.push(value);
  }
  if (!size) throw Object.assign(new Error('Attachment is empty.'), { status: 400 });
  const bytes = new Uint8Array(size);
  let off = 0;
  for (const p of parts) { bytes.set(p, off); off += p.length; }
  return bytes;
}

export async function fetchAttachmentBytes({ core, fetchImpl, file_uri }) {
  const { signed_url } = await core.CreateFileSignedUrl({ file_uri, expires_in: 60 });
  if (typeof signed_url !== 'string' || !signed_url) throw Object.assign(new Error('Attachment is not available.'), { status: 502 });
  assertSafeSignedUrl(signed_url);
  const r = await fetchImpl(signed_url, { method: 'GET', redirect: 'manual', signal: AbortSignal.timeout(60000), cache: 'no-store' });
  // Reject redirects: never follow, never read the body.
  if (r.status >= 300 && r.status < 400) throw Object.assign(new Error('Attachment is not available.'), { status: 502 });
  if (!r.ok) throw Object.assign(new Error('Attachment is not available.'), { status: 502 });
  return await readCapped(r);
}

// ---- Adapters ----------------------------------------------------------------

export const DisabledDispatchAdapter = {
  async dispatch() { return { status: 'disabled', error: 'Messages sending is not enabled.' }; },
};

// Build the transport payload the provider would send. tempGuid is EXACTLY the client_id.
function buildTransportPayload(input, tempGuid) {
  if (input.kind === 'send_text') {
    return {
      method: 'POST', url: '/api/v1/message/text',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: input.text, chatGuid: input.chatGuid, tempGuid }),
      tempGuid,
    };
  }
  const boundary = `----bb-${tempGuid}`;
  const enc = new TextEncoder();
  const header =
    `--${boundary}\r\nContent-Disposition: form-data; name="chatGuid"\r\n\r\n${input.chatGuid}\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="tempGuid"\r\n\r\n${tempGuid}\r\n` +
    `--${boundary}\r\nContent-Disposition: form-data; name="attachment"; filename="${input.name}"\r\nContent-Type: ${input.mime}\r\n\r\n`;
  const footer = `\r\n--${boundary}--\r\n`;
  const bytes = input.bytes || new Uint8Array();
  const body = new Uint8Array([...enc.encode(header), ...bytes, ...enc.encode(footer)]);
  return {
    method: 'POST', url: '/api/v1/message/attachment',
    headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
    body, tempGuid, bytes,
  };
}

// TEST-ONLY mock. Simulates the dispatch contract in memory with a genuine transport call.
// Single-threaded test execution only. NOT production safety. tempGuid === client_id exactly.
export function MockDispatchAdapter({ transport } = {}) {
  const ledger = new Map();
  const keyOf = (owner_id, conversation_key, client_id) => `${owner_id}|${conversation_key}|${client_id}`;
  return {
    async dispatch(input) {
      const { owner_id, conversation_key, client_id, fingerprint: fp } = input;
      const k = keyOf(owner_id, conversation_key, client_id);
      const existing = ledger.get(k);
      if (existing) {
        if (existing.status === 'sent') {
          if (existing.fingerprint === fp) return { status: 'sent', temp_guid: client_id, conversation_key, cached: true };
          return { status: 'rejected', error: 'A different send was already completed for this batch.' };
        }
        if (existing.status === 'unknown') return { status: 'rejected', error: 'A previous send for this batch has an unknown outcome. Reconcile on the Mac.' };
        if (existing.status === 'pending') return { status: 'rejected', error: 'A send for this batch is already in flight.' };
      }
      const tempGuid = client_id;
      ledger.set(k, { fingerprint: fp, status: 'pending', tempGuid });
      let transportResult;
      try {
        transportResult = await transport(buildTransportPayload(input, tempGuid));
      } catch (e) {
        ledger.set(k, { fingerprint: fp, status: 'unknown', tempGuid });
        return { status: 'unknown', temp_guid: tempGuid, conversation_key, error: 'Send outcome is unknown.' };
      }
      if (transportResult && transportResult.beforeDispatch) {
        ledger.delete(k);
        return { status: 'failed_pre_dispatch', error: transportResult.error || 'Send failed before dispatch.' };
      }
      if (transportResult && transportResult.ok) {
        ledger.set(k, { fingerprint: fp, status: 'sent', tempGuid });
        return { status: 'sent', temp_guid: tempGuid, conversation_key };
      }
      ledger.set(k, { fingerprint: fp, status: 'unknown', tempGuid });
      return { status: 'unknown', temp_guid: tempGuid, conversation_key, error: 'Send outcome is unknown.' };
    },
    _ledger: ledger,
  };
}

// ---- Handler -----------------------------------------------------------------

// registrationStore (required when enabled): {
//   async get(ownerId, conversationKey, clientId) -> registration | null,
//   async create(ownerId, conversationKey, clientId, { file_uri, name, mime, size, sha256 }) -> reg,
// }
export function createMessagesSendHandler({
  getClient,
  adapter = DisabledDispatchAdapter,
  enabled = false,
  registrationStore,
  resolveMapping,
  fetchImpl = globalThis.fetch,
  crypto = globalThis.crypto,
} = {}) {
  return async (req) => {
    if (req.method !== 'POST') return reply({ error: 'Use POST.', code: 'method' }, 405);
    let client, user = null;
    try { client = await getClient(req); user = await client.auth.me().catch(() => null); }
    catch { return reply({ error: 'Sign in required.', code: 'auth' }, 401); }
    if (!isSendOwner(user)) return reply({ error: 'Owner access required.', code: 'auth' }, 403);
    if (!enabled) return reply({ error: 'Messages sending is not enabled.', code: 'disabled' }, 502);
    let input;
    try { input = await req.json(); } catch { return reply({ error: 'Invalid request body.', code: 'invalid' }, 400); }
    const action = input.action;
    if (action !== 'send_text' && action !== 'send_attachment' && action !== 'register_upload') {
      return reply({ error: 'Unsupported action.', code: 'invalid' }, 400);
    }
    const vKey = validateConversationKey(input.conversation_key);
    if (!vKey.ok) return reply({ error: vKey.error, code: 'invalid' }, vKey.status);
    const vClient = validateClientId(input.client_id);
    if (!vClient.ok) return reply({ error: vClient.error, code: 'invalid' }, vClient.status);
    const owner_id = user.id;
    const conversation_key = input.conversation_key;
    const client_id = input.client_id;

    if (action === 'register_upload') {
      const vName = validateName(input.name);
      if (!vName.ok) return reply({ error: vName.error, code: 'invalid' }, vName.status);
      const vUri = validateFileUri(input.file_uri);
      if (!vUri.ok) return reply({ error: vUri.error, code: 'invalid' }, vUri.status);
      const mime = typeof input.mime === 'string' && input.mime ? input.mime.slice(0, 100) : 'application/octet-stream';
      const size = Number.isFinite(input.size) ? Number(input.size) : 0;
      const sha256 = typeof input.sha256 === 'string' && /^[a-f0-9]{64}$/.test(input.sha256) ? input.sha256 : '';
      if (!sha256) return reply({ error: 'Attachment integrity hash is required.', code: 'invalid' }, 400);
      try { await registrationStore.create(owner_id, conversation_key, client_id, { file_uri: input.file_uri, name: vName.name, mime, size, sha256 }); }
      catch { return reply({ error: 'Upload could not be registered.', code: 'invalid' }, 500); }
      return reply({ ok: true }, 200);
    }

    // send_text / send_attachment: resolve the persisted chatGuid, device exact match.
    let mapped;
    try { mapped = await resolveMapping(client, conversation_key); }
    catch { mapped = null; }
    if (!mapped || !mapped.chatGuid) return reply({ error: "This conversation can't be sent to from here.", code: 'not_sendable' }, 404);
    if (!mapped.configuredDeviceId || !mapped.device_id || mapped.device_id !== mapped.configuredDeviceId) {
      return reply({ error: "This conversation can't be sent to from here.", code: 'not_sendable' }, 404);
    }
    const chatGuid = mapped.chatGuid;

    if (action === 'send_text') {
      const v = validateText(input.text);
      if (!v.ok) return reply({ error: v.error, code: 'invalid' }, v.status);
      const fp = await computeFingerprint(crypto, { kind: 'send_text', chatGuid, text: v.text });
      let result;
      try { result = await adapter.dispatch({ owner_id, conversation_key, client_id, kind: 'send_text', chatGuid, text: v.text, fingerprint: fp }); }
      catch { return reply({ error: 'Send could not be completed.', code: 'unknown' }, 502); }
      return mapResult(result);
    }

    // send_attachment: registration-gated. Look up the registration BEFORE any signing/fetch.
    let reg;
    try { reg = await registrationStore.get(owner_id, conversation_key, client_id); }
    catch { reg = null; }
    if (!reg) return reply({ error: 'Attachment was not registered for this send.', code: 'not_registered' }, 404);
    let bytes;
    try { bytes = await fetchAttachmentBytes({ core: client.asServiceRole.integrations.Core, fetchImpl, file_uri: reg.file_uri }); }
    catch (e) { return reply({ error: e.message || 'Attachment is not available.', code: 'attachment' }, Number.isInteger(e.status) ? e.status : 502); }
    const bytesHash = await sha256Bytes(crypto, bytes);
    if (reg.sha256 && reg.sha256 !== bytesHash) return reply({ error: 'Attachment could not be verified.', code: 'attachment' }, 400);
    const fp = await computeFingerprint(crypto, { kind: 'send_attachment', chatGuid, mime: reg.mime, bytesHash });
    let result;
    try { result = await adapter.dispatch({ owner_id, conversation_key, client_id, kind: 'send_attachment', chatGuid, bytes, name: reg.name, mime: reg.mime, fingerprint: fp }); }
    catch { return reply({ error: 'Send could not be completed.', code: 'unknown' }, 502); }
    return mapResult(result);
  };
}

function mapResult(result) {
  if (result.status === 'sent') return reply({ ok: true, temp_guid: result.temp_guid, conversation_key: result.conversation_key }, 200);
  if (result.status === 'rejected') return reply({ error: result.error, code: 'rejected' }, 409);
  if (result.status === 'unknown') return reply({ error: result.error, code: 'unknown' }, 502);
  if (result.status === 'failed_pre_dispatch') return reply({ error: result.error, code: 'failed_pre_dispatch' }, 502);
  return reply({ error: result.error || 'Messages sending is not enabled.', code: 'disabled' }, 502);
}