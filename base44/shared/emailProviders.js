// Inbox agent: thin Gmail / Microsoft Graph wrappers over fetch. The access token comes
// from the app's shared connector (base44.asServiceRole.connectors.getConnection). All
// network goes through `fetchImpl` so tests can serve fixtures. Retries 429/5xx like
// syncGoogleCalendarEvents does (3 attempts, 1s then 3s).

export const GMAIL_API = 'https://gmail.googleapis.com/gmail/v1/users/me';
export const GRAPH_API = 'https://graph.microsoft.com/v1.0/me';
const RETRY_DELAYS_MS = [1000, 3000];
const SKIP_GMAIL_LABELS = new Set(['DRAFT', 'SPAM', 'TRASH', 'CHAT']);

export class ProviderError extends Error {
  constructor(message, { status = 0, url = '', body = '' } = {}) {
    super(message);
    this.name = 'ProviderError';
    this.status = status;
    this.url = url;
    this.body = String(body || '').slice(0, 500);
  }
}

const defaultSleep = (ms) => new Promise((r) => setTimeout(r, ms));

export async function fetchWithRetry(fetchImpl, url, init = {}, { sleep = defaultSleep, delays = RETRY_DELAYS_MS } = {}) {
  for (let attempt = 0; ; attempt++) {
    const res = await fetchImpl(url, init);
    const retryable = res.status === 429 || res.status >= 500;
    if (res.ok || !retryable || attempt >= delays.length) return res;
    try { await res.body?.cancel?.(); } catch { /* ignore */ }
    const retryAfter = Number(res.headers?.get?.('retry-after')) * 1000;
    await sleep(Number.isFinite(retryAfter) && retryAfter > 0 ? Math.min(retryAfter, 10000) : delays[attempt]);
  }
}

async function apiJson({ fetchImpl, token, sleep }, url, init = {}) {
  const headers = { Authorization: `Bearer ${token}`, Accept: 'application/json', ...(init.headers || {}) };
  if (init.body && typeof init.body === 'string' && !headers['Content-Type']) headers['Content-Type'] = 'application/json';
  const res = await fetchWithRetry(fetchImpl, url, { ...init, headers }, { sleep });
  const text = await res.text().catch(() => '');
  if (!res.ok) throw new ProviderError(`${init.method || 'GET'} ${url.split('?')[0]} -> ${res.status}: ${text.slice(0, 200)}`, { status: res.status, url, body: text });
  if (!text) return {};
  try { return JSON.parse(text); } catch { return {}; }
}

const daysAgoIso = (days, now = new Date()) => new Date(now.getTime() - days * 86400000).toISOString();

// ---- base64 helpers (portable between Node and Deno) ------------------------------------------

export function utf8ToBase64(str) {
  const bytes = new TextEncoder().encode(String(str));
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
export const toBase64Url = (b64) => String(b64).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const needsEncoding = (s) => /[^\x20-\x7e]/.test(String(s || ''));
const encodeHeaderWord = (s) => (needsEncoding(s) ? `=?UTF-8?B?${utf8ToBase64(s)}?=` : String(s || ''));

// RFC 2822 reply message, base64url-encoded the way Gmail's drafts.create wants `raw`.
export function buildRawReply({ from, to, cc = [], subject, inReplyTo = '', references = '', text }) {
  const lines = [];
  if (from) lines.push(`From: ${from}`);
  lines.push(`To: ${Array.isArray(to) ? to.join(', ') : to}`);
  if (cc && cc.length) lines.push(`Cc: ${cc.join(', ')}`);
  lines.push(`Subject: ${encodeHeaderWord(subject || '')}`);
  if (inReplyTo) lines.push(`In-Reply-To: ${inReplyTo}`);
  const refs = [references, inReplyTo].filter(Boolean).join(' ').trim();
  if (refs) lines.push(`References: ${refs}`);
  lines.push('MIME-Version: 1.0', 'Content-Type: text/plain; charset="UTF-8"', 'Content-Transfer-Encoding: base64', '');
  const body = utf8ToBase64(String(text || '').replace(/\r?\n/g, '\r\n')).replace(/(.{76})/g, '$1\r\n');
  const raw = lines.join('\r\n') + '\r\n' + body;
  return toBase64Url(utf8ToBase64(raw));
}

// ---- Gmail --------------------------------------------------------------------------------------

export function createGmailClient({ accessToken, fetchImpl = globalThis.fetch, sleep = defaultSleep, now = () => new Date() }) {
  const ctx = { fetchImpl, token: accessToken, sleep };
  const get = (path, init) => apiJson(ctx, `${GMAIL_API}${path}`, init);

  async function profile() { return get('/profile'); }

  // New message ids since the stored history cursor. Falls back to a time-based list on the
  // first run or when Gmail says the history id is too old (404).
  async function listNewMessages({ historyId = '', sinceDays = 3, max = 200 } = {}) {
    const ids = [];
    const seen = new Set();
    const push = (m) => { if (m && m.id && !seen.has(m.id)) { seen.add(m.id); ids.push({ id: m.id, threadId: m.threadId || '' }); } };
    if (historyId) {
      let pageToken = '';
      let cursor = historyId;
      let latest = historyId;
      try {
        do {
          const q = new URLSearchParams({ startHistoryId: String(historyId), historyTypes: 'messageAdded', maxResults: '500' });
          if (pageToken) q.set('pageToken', pageToken);
          const data = await get(`/history?${q}`);
          if (data.historyId) latest = String(data.historyId);
          for (const h of data.history || []) {
            for (const added of h.messagesAdded || []) {
              const m = added.message || {};
              if ((m.labelIds || []).some((l) => SKIP_GMAIL_LABELS.has(l))) continue;
              push(m);
            }
            cursor = String(h.id || cursor);
            if (ids.length >= max) return { ids, cursor, exhausted: false, mode: 'history' };
          }
          pageToken = data.nextPageToken || '';
        } while (pageToken);
        return { ids, cursor: latest, exhausted: true, mode: 'history' };
      } catch (e) {
        if (!(e instanceof ProviderError && e.status === 404)) throw e;
        // history expired: fall through to the time-based scan
      }
    }
    const prof = await profile();
    let pageToken = '';
    do {
      const q = new URLSearchParams({ q: `newer_than:${sinceDays}d -in:spam -in:trash -in:drafts -in:chats`, maxResults: String(Math.min(100, max)) });
      if (pageToken) q.set('pageToken', pageToken);
      const data = await get(`/messages?${q}`);
      for (const m of data.messages || []) push(m);
      pageToken = data.nextPageToken || '';
      if (ids.length >= max) break;
    } while (pageToken);
    return { ids: ids.slice(0, max), cursor: String(prof.historyId || ''), exhausted: !pageToken, mode: 'scan' };
  }

  async function getMessage(id) { return get(`/messages/${encodeURIComponent(id)}?format=full`); }

  // Every message of one thread, full payloads, oldest first (Gmail returns them in order).
  // The agent reads a thread from here whenever it needs text it did not keep.
  async function getThreadMessages(threadId) {
    const t = await get(`/threads/${encodeURIComponent(threadId)}?format=full`);
    return (t.messages || []).filter((m) => m && m.id && !(m.labelIds || []).some((l) => SKIP_GMAIL_LABELS.has(l)));
  }

  async function listLabels() { return (await get('/labels')).labels || []; }

  // name -> id for every requested label; creates the missing ones. `cache` is the mailbox.labels map.
  async function ensureLabels(names, cache = {}) {
    const map = { ...(cache || {}) };
    const missing = names.filter((n) => !map[n]);
    if (!missing.length) return map;
    for (const l of await listLabels()) if (l.name && l.id) map[l.name] = l.id;
    for (const name of missing) {
      if (map[name]) continue;
      const made = await get('/labels', { method: 'POST', body: JSON.stringify({ name, labelListVisibility: 'labelShow', messageListVisibility: 'show' }) });
      if (made.id) map[name] = made.id;
    }
    return map;
  }

  async function modifyThread(threadId, { addLabelIds = [], removeLabelIds = [] } = {}) {
    if (!addLabelIds.length && !removeLabelIds.length) return {};
    return get(`/threads/${encodeURIComponent(threadId)}/modify`, { method: 'POST', body: JSON.stringify({ addLabelIds, removeLabelIds }) });
  }
  const archiveThread = (threadId) => modifyThread(threadId, { removeLabelIds: ['INBOX'] });

  async function createDraft({ threadId, raw }) {
    const d = await get('/drafts', { method: 'POST', body: JSON.stringify({ message: { threadId, raw } }) });
    return { draft_id: d.id || '', message_id: d.message?.id || '' };
  }
  const sendDraft = (draftId) => get('/drafts/send', { method: 'POST', body: JSON.stringify({ id: draftId }) });
  const deleteDraft = (draftId) => get(`/drafts/${encodeURIComponent(draftId)}`, { method: 'DELETE' });

  return { provider: 'gmail', profile, listNewMessages, getMessage, getThreadMessages, listLabels, ensureLabels, modifyThread, archiveThread, createDraft, sendDraft, deleteDraft, now };
}

// ---- Microsoft Graph (Outlook) ------------------------------------------------------------------

const GRAPH_MESSAGE_SELECT = 'id,conversationId,internetMessageId,subject,bodyPreview,body,from,sender,toRecipients,ccRecipients,receivedDateTime,sentDateTime,hasAttachments,isDraft,webLink,categories,internetMessageHeaders';

export function createOutlookClient({ accessToken, fetchImpl = globalThis.fetch, sleep = defaultSleep, now = () => new Date() }) {
  const ctx = { fetchImpl, token: accessToken, sleep };
  const get = (pathOrUrl, init) => apiJson(ctx, pathOrUrl.startsWith('http') ? pathOrUrl : `${GRAPH_API}${pathOrUrl}`, init);

  async function me() { return get('?$select=mail,userPrincipalName,displayName'); }

  // Inbox delta. `cursor` is the stored deltaLink (or a resumable nextLink when a previous
  // run stopped at `max`). First run: last `sinceDays` days.
  async function listNewMessages({ deltaLink = '', sinceDays = 3, max = 200 } = {}) {
    const ids = [];
    const seen = new Set();
    let url = deltaLink;
    if (!url) {
      const q = new URLSearchParams({ $select: 'id,conversationId,isDraft,receivedDateTime', $filter: `receivedDateTime ge ${daysAgoIso(sinceDays, now())}` });
      url = `${GRAPH_API}/mailFolders/inbox/messages/delta?${q}`;
    }
    let cursor = url;
    for (let page = 0; page < 50 && url; page++) {
      const data = await get(url, { headers: { Prefer: 'odata.maxpagesize=100' } });
      for (const m of data.value || []) {
        if (!m || !m.id || m['@removed'] || m.isDraft === true) continue;
        if (seen.has(m.id)) continue;
        seen.add(m.id);
        ids.push({ id: m.id, conversationId: m.conversationId || '' });
      }
      const next = data['@odata.nextLink'] || '';
      const delta = data['@odata.deltaLink'] || '';
      if (delta) return { ids, cursor: delta, exhausted: true, mode: 'delta' };
      cursor = next;
      url = next;
      if (ids.length >= max) return { ids, cursor, exhausted: false, mode: 'delta' };
    }
    return { ids, cursor, exhausted: !url, mode: 'delta' };
  }

  async function getMessage(id) {
    const q = `$select=${GRAPH_MESSAGE_SELECT}&$expand=attachments($select=id,name,contentType,size)`;
    return get(`/messages/${encodeURIComponent(id)}?${q}`, { headers: { Prefer: 'outlook.body-content-type="text"' } });
  }

  // Every message of one conversation (any folder), oldest first, full bodies as text.
  async function getThreadMessages(conversationId) {
    const filter = `conversationId eq '${String(conversationId).replace(/'/g, "''")}'`;
    const data = await get(`/messages?$filter=${encodeURIComponent(filter)}&$select=${GRAPH_MESSAGE_SELECT}&$top=50`, { headers: { Prefer: 'outlook.body-content-type="text"' } });
    return (data.value || []).filter((m) => m && m.id && m.isDraft !== true).sort((a, b) => String(a.receivedDateTime || '').localeCompare(String(b.receivedDateTime || '')));
  }

  async function listCategories() { return (await get('/outlook/masterCategories')).value || []; }

  // Outlook categories are applied by display name; the cache keeps the master-category ids.
  async function ensureLabels(names, cache = {}) {
    const map = { ...(cache || {}) };
    const missing = names.filter((n) => !map[n]);
    if (!missing.length) return map;
    let master;
    try { master = await listCategories(); }
    catch (e) {
      // The master list needs MailboxSettings.ReadWrite. Without it the names still apply to
      // messages (uncoloured until someone adds them in Outlook); remember that so the agent
      // stops asking every run.
      if (e?.status === 403) { for (const n of missing) map[n] = 'uncoloured'; return map; }
      throw e;
    }
    for (const c of master) if (c.displayName && c.id) map[c.displayName] = c.id;
    const colors = ['preset0', 'preset4', 'preset7', 'preset8', 'preset9', 'preset10', 'preset11', 'preset12'];
    let i = 0;
    for (const name of missing) {
      if (map[name]) continue;
      const made = await get('/outlook/masterCategories', { method: 'POST', body: JSON.stringify({ displayName: name, color: colors[i++ % colors.length] }) });
      if (made.id) map[name] = made.id;
    }
    return map;
  }

  const setCategories = (messageId, categories) => get(`/messages/${encodeURIComponent(messageId)}`, { method: 'PATCH', body: JSON.stringify({ categories }) });
  const archiveMessage = (messageId) => get(`/messages/${encodeURIComponent(messageId)}/move`, { method: 'POST', body: JSON.stringify({ destinationId: 'archive' }) });

  async function createDraftReply({ messageId, text }) {
    const draft = await get(`/messages/${encodeURIComponent(messageId)}/createReply`, { method: 'POST', body: '{}' });
    if (!draft.id) throw new ProviderError('createReply returned no draft id');
    await get(`/messages/${encodeURIComponent(draft.id)}`, { method: 'PATCH', body: JSON.stringify({ body: { contentType: 'text', content: text } }) });
    return { draft_id: draft.id, message_id: draft.id };
  }
  const sendDraft = (draftId) => get(`/messages/${encodeURIComponent(draftId)}/send`, { method: 'POST', body: '{}' });
  const deleteDraft = (draftId) => get(`/messages/${encodeURIComponent(draftId)}`, { method: 'DELETE' });

  return { provider: 'outlook', me, listNewMessages, getMessage, getThreadMessages, listCategories, ensureLabels, setCategories, archiveMessage, createDraftReply, sendDraft, deleteDraft, now };
}

export function createProviderClient(provider, opts) {
  if (provider === 'gmail') return createGmailClient(opts);
  if (provider === 'outlook') return createOutlookClient(opts);
  throw new ProviderError(`unknown provider ${provider}`);
}
