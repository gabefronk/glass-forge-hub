// Inbox agent: provider message -> normalized record. Pure functions, no I/O.
// Works for Gmail API `users.messages.get?format=full` payloads and Microsoft Graph
// `/me/messages/{id}` objects. Also folds a thread's messages into the EmailThread
// aggregate the Hub stores.

export const TEXT_CAP = 20000;
export const SNIPPET_CAP = 200;

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

export const lowerEmail = (v) => String(v || '').trim().toLowerCase();

// "Gabe Fronk <gabe@example.com>" -> { name: 'Gabe Fronk', email: 'gabe@example.com' }
export function parseAddress(v) {
  const s = String(v || '').trim();
  if (!s) return { name: '', email: '' };
  const m = s.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  if (m) return { name: m[1].trim(), email: lowerEmail(m[2]) };
  const em = s.match(EMAIL_RE);
  if (em) return { name: s.replace(em[0], '').replace(/[<>"]/g, '').trim(), email: lowerEmail(em[0]) };
  return { name: s, email: '' };
}

// Header value with several addresses -> [{name,email}]
export function parseAddressList(v) {
  const s = String(v || '');
  if (!s.trim()) return [];
  const out = [];
  let cur = '', inQuote = false, depth = 0;
  for (const ch of s) {
    if (ch === '"') inQuote = !inQuote;
    if (!inQuote && ch === '<') depth++;
    if (!inQuote && ch === '>') depth = Math.max(0, depth - 1);
    if (ch === ',' && !inQuote && depth === 0) { out.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.map(parseAddress).filter((a) => a.email);
}

export function firstEmailIn(v) {
  const m = String(v || '').match(EMAIL_RE);
  return m ? lowerEmail(m[0]) : '';
}

// Case-insensitive header lookup over [{name,value}] (Gmail and Graph both use this shape).
export function headerValues(headers, name) {
  const want = String(name).toLowerCase();
  return (headers || []).filter((h) => h && String(h.name || '').toLowerCase() === want).map((h) => String(h.value || ''));
}
export const header = (headers, name) => headerValues(headers, name)[0] || '';

// Which address was the mail originally sent to? gabefronk@gmail.com is auto-forwarded
// into the Glass Forge Gmail box by a filter; the forwarded copy carries the original
// recipient in X-Forwarded-For ("orig dest") and a second Delivered-To underneath the
// top one Gmail adds on arrival.
export function accountHint(headers, fallback = '') {
  const fwdFor = firstEmailIn(header(headers, 'X-Forwarded-For'));
  if (fwdFor) return fwdFor;
  const delivered = headerValues(headers, 'Delivered-To').map(firstEmailIn).filter(Boolean);
  if (delivered.length) return delivered[delivered.length - 1];
  const orig = firstEmailIn(header(headers, 'X-Original-To'));
  if (orig) return orig;
  const to = firstEmailIn(header(headers, 'To'));
  return to || lowerEmail(fallback);
}

// ---- text handling ----------------------------------------------------------------

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', '#39': "'" };
export function decodeEntities(s) {
  return String(s || '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, code) => {
    const c = code.toLowerCase();
    if (c[0] === '#') {
      const n = c[1] === 'x' ? parseInt(c.slice(2), 16) : parseInt(c.slice(1), 10);
      return Number.isFinite(n) && n > 0 && n < 0x110000 ? String.fromCodePoint(n) : m;
    }
    return c in ENTITIES ? ENTITIES[c] : m;
  });
}

export function htmlToText(html) {
  let s = String(html || '');
  if (!s) return '';
  s = s.replace(/<!--[\s\S]*?-->/g, '');
  s = s.replace(/<(script|style|head|title)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
  // Quoted replies live in blockquotes / gmail_quote wrappers; drop them here so the
  // plain-text stripper below has less to guess at.
  for (let i = 0; i < 5; i++) s = s.replace(/<blockquote\b[^>]*>[\s\S]*?<\/blockquote>/gi, '');
  s = s.replace(/<div\b[^>]*class="[^"]*\bgmail_quote\b[^"]*"[^>]*>[\s\S]*$/i, '');
  s = s.replace(/<(br|hr)\s*\/?>/gi, '\n');
  s = s.replace(/<\/(p|div|li|tr|h[1-6]|blockquote|table|section|article|header|footer|pre)>/gi, '\n');
  s = s.replace(/<(p|div|li|tr|h[1-6]|table|pre)\b[^>]*>/gi, '\n');
  s = s.replace(/<td\b[^>]*>/gi, ' ');
  s = s.replace(/<[^>]+>/g, '');
  s = decodeEntities(s);
  s = s.replace(/\r\n?/g, '\n').replace(/[ \t ]+/g, ' ').replace(/ *\n */g, '\n').replace(/\n{3,}/g, '\n\n');
  return s.trim();
}

const QUOTE_MARKERS = [
  /^On .{0,200}wrote:\s*$/im,                       // Gmail / Apple Mail (may wrap onto two lines; see below)
  /^-{2,}\s*Original Message\s*-{2,}\s*$/im,        // Outlook
  /^-{2,}\s*Forwarded message\s*-{2,}\s*$/im,
  /^_{5,}\s*$/m,                                     // Outlook divider
  /^From:\s.+\n(?:Sent|Date):\s.+\n(?:To:\s.+\n)?/m, // Outlook header block
  /^Sent from my (iPhone|iPad|Galaxy|Android|Samsung)/im,
  /^Get Outlook for (iOS|Android)/im,
  /^-- \s*$/m,                                      // RFC signature delimiter
];

// Best-effort: cut the message at the first quoted-reply / signature marker, drop
// `>`-prefixed lines, cap the length. Never returns an empty string when the
// original had content (falls back to the un-stripped text).
export function stripQuotedReply(text) {
  const src = String(text || '').replace(/\r\n?/g, '\n');
  if (!src.trim()) return '';
  // Gmail wraps the "On ... wrote:" line; join it so the marker matches.
  const joined = src.replace(/^(On [^\n]{0,160})\n([^\n]{0,120}wrote:)\s*$/gm, '$1 $2');
  let cut = joined.length;
  for (const re of QUOTE_MARKERS) {
    const m = joined.match(re);
    if (m && m.index !== undefined && m.index < cut) cut = m.index;
  }
  let body = joined.slice(0, cut);
  body = body.split('\n').filter((line) => !/^\s*>/.test(line)).join('\n');
  body = body.replace(/[ \t]+$/gm, '').replace(/\n{3,}/g, '\n\n').trim();
  if (!body) body = joined.split('\n').filter((line) => !/^\s*>/.test(line)).join('\n').trim() || joined.trim();
  return body.length > TEXT_CAP ? body.slice(0, TEXT_CAP) : body;
}

export function decodeBase64Url(data) {
  if (!data) return '';
  const b64 = String(data).replace(/-/g, '+').replace(/_/g, '/');
  const padded = b64 + '==='.slice((b64.length + 3) % 4);
  let bin;
  try { bin = atob(padded); } catch { return ''; }
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  try { return new TextDecoder('utf-8').decode(bytes); } catch { return bin; }
}

export const snippetOf = (text) => String(text || '').replace(/\s+/g, ' ').trim().slice(0, SNIPPET_CAP);

// ---- Gmail --------------------------------------------------------------------------

function walkParts(part, acc) {
  if (!part) return;
  const mime = String(part.mimeType || '').toLowerCase();
  const filename = part.filename || '';
  const body = part.body || {};
  if (filename && (body.attachmentId || body.size)) {
    acc.attachments.push({ name: filename, mime: mime || 'application/octet-stream', size: Number(body.size || 0), attachment_id: body.attachmentId || '' });
  } else if (mime === 'text/plain' && body.data && !acc.plain) {
    acc.plain = decodeBase64Url(body.data);
  } else if (mime === 'text/html' && body.data && !acc.html) {
    acc.html = decodeBase64Url(body.data);
  }
  for (const p of part.parts || []) walkParts(p, acc);
}

// Gmail `users.messages.get?format=full` -> normalized record.
export function normalizeGmailMessage(raw, { mailboxAddress = '' } = {}) {
  const payload = raw?.payload || {};
  const headers = payload.headers || [];
  const acc = { plain: '', html: '', attachments: [] };
  walkParts(payload, acc);
  const bodyText = acc.plain ? stripQuotedReply(acc.plain) : stripQuotedReply(htmlToText(acc.html));
  const from = parseAddress(header(headers, 'From'));
  const to = parseAddressList(header(headers, 'To'));
  const cc = parseAddressList(header(headers, 'Cc'));
  const labels = Array.isArray(raw?.labelIds) ? raw.labelIds.slice() : [];
  const me = lowerEmail(mailboxAddress);
  const direction = labels.includes('SENT') || (me && from.email === me) ? 'outgoing' : 'incoming';
  const internal = Number(raw?.internalDate || 0);
  const dateHeader = header(headers, 'Date');
  const sentAt = internal ? new Date(internal).toISOString() : (Date.parse(dateHeader) ? new Date(Date.parse(dateHeader)).toISOString() : new Date(0).toISOString());
  return {
    message_id: String(raw?.id || ''),
    thread_id: String(raw?.threadId || raw?.id || ''),
    internet_message_id: header(headers, 'Message-ID') || header(headers, 'Message-Id'),
    sent_at: sentAt,
    from_name: from.name,
    from_email: from.email,
    to: to.map((a) => a.email),
    cc: cc.map((a) => a.email),
    to_named: to,
    cc_named: cc,
    subject: header(headers, 'Subject'),
    text: bodyText,
    direction,
    attachments: acc.attachments,
    labels,
    account_hint: accountHint(headers, mailboxAddress),
    snippet: snippetOf(bodyText || decodeEntities(raw?.snippet || '')),
    web_link: `https://mail.google.com/mail/u/0/#all/${encodeURIComponent(String(raw?.threadId || raw?.id || ''))}`,
    has_attachments: acc.attachments.length > 0,
    is_draft: labels.includes('DRAFT'),
    references: header(headers, 'References'),
  };
}

// ---- Microsoft Graph -------------------------------------------------------------------

const graphAddr = (r) => ({ name: String(r?.emailAddress?.name || ''), email: lowerEmail(r?.emailAddress?.address) });

// Graph `/me/messages/{id}` (ideally requested with Prefer: outlook.body-content-type="text").
export function normalizeGraphMessage(raw, { mailboxAddress = '' } = {}) {
  const headers = Array.isArray(raw?.internetMessageHeaders) ? raw.internetMessageHeaders : [];
  const body = raw?.body || {};
  const rawText = String(body.contentType || '').toLowerCase() === 'html' ? htmlToText(body.content) : String(body.content || '');
  const bodyText = stripQuotedReply(rawText) || stripQuotedReply(String(raw?.bodyPreview || ''));
  const from = graphAddr(raw?.from || raw?.sender);
  const to = (raw?.toRecipients || []).map(graphAddr).filter((a) => a.email);
  const cc = (raw?.ccRecipients || []).map(graphAddr).filter((a) => a.email);
  const me = lowerEmail(mailboxAddress);
  const direction = me && from.email === me ? 'outgoing' : 'incoming';
  const attachments = (raw?.attachments || []).map((a) => ({ name: String(a.name || ''), mime: String(a.contentType || 'application/octet-stream'), size: Number(a.size || 0), attachment_id: String(a.id || '') }));
  const sentAt = raw?.receivedDateTime || raw?.sentDateTime || '';
  return {
    message_id: String(raw?.id || ''),
    thread_id: String(raw?.conversationId || raw?.id || ''),
    internet_message_id: String(raw?.internetMessageId || header(headers, 'Message-ID') || ''),
    sent_at: Date.parse(sentAt) ? new Date(Date.parse(sentAt)).toISOString() : new Date(0).toISOString(),
    from_name: from.name,
    from_email: from.email,
    to: to.map((a) => a.email),
    cc: cc.map((a) => a.email),
    to_named: to,
    cc_named: cc,
    subject: String(raw?.subject || ''),
    text: bodyText,
    direction,
    attachments,
    labels: Array.isArray(raw?.categories) ? raw.categories.slice() : [],
    account_hint: headers.length ? accountHint(headers, mailboxAddress) : (to[0]?.email || lowerEmail(mailboxAddress)),
    snippet: snippetOf(bodyText || raw?.bodyPreview || ''),
    web_link: String(raw?.webLink || ''),
    has_attachments: raw?.hasAttachments === true || attachments.length > 0,
    is_draft: raw?.isDraft === true,
    references: '',
  };
}

// ---- Thread aggregate -----------------------------------------------------------------

// Fold every stored message of one thread (plus any new ones) into the EmailThread
// fields the Hub keeps. `previous` is the stored thread row (or null for a new thread).
export function aggregateThread(messages, { mailbox, previous = null } = {}) {
  const rows = [...messages].filter((m) => m && !m.is_draft).sort((a, b) => String(a.sent_at || '').localeCompare(String(b.sent_at || '')));
  const me = lowerEmail(mailbox?.address);
  const seen = new Map();
  const addP = (a) => { if (a && a.email && a.email !== me && !seen.has(a.email)) seen.set(a.email, { name: a.name || '', email: a.email }); };
  for (const m of rows) {
    addP({ name: m.from_name, email: m.from_email });
    for (const a of m.to_named || (m.to || []).map((e) => ({ name: '', email: e }))) addP(a);
    for (const a of m.cc_named || (m.cc || []).map((e) => ({ name: '', email: e }))) addP(a);
  }
  const last = rows[rows.length - 1] || null;
  const lastIncoming = [...rows].reverse().find((m) => m.direction === 'incoming') || last;
  const toEmails = [...new Set(rows.flatMap((m) => m.to || []))];
  const hintRow = rows.find((m) => m.direction === 'incoming' && m.account_hint) || rows.find((m) => m.account_hint);
  const subject = (rows.find((m) => m.subject) || {}).subject || previous?.subject || '';
  const webLink = mailbox?.provider === 'outlook' ? (last?.web_link || previous?.web_link || '') : (last?.web_link || previous?.web_link || '');
  return {
    mailbox_key: mailbox?.key || previous?.mailbox_key || '',
    thread_id: last?.thread_id || previous?.thread_id || '',
    account_hint: hintRow?.account_hint || previous?.account_hint || me,
    subject: subject.replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, '').trim() || subject,
    participants: [...seen.values()].slice(0, 30),
    from_name: lastIncoming?.from_name || previous?.from_name || '',
    from_email: lastIncoming?.from_email || previous?.from_email || '',
    to_emails: toEmails.slice(0, 30),
    first_message_at: rows[0]?.sent_at || previous?.first_message_at || null,
    last_message_at: last?.sent_at || previous?.last_message_at || null,
    message_count: rows.length,
    snippet: last ? snippetOf(last.snippet || last.text) : (previous?.snippet || ''),
    has_attachments: rows.some((m) => m.has_attachments) || previous?.has_attachments === true,
    provider_labels: [...new Set((last?.labels || previous?.provider_labels || []))].slice(0, 40),
    web_link: webLink,
  };
}

// Strip normalized-only helper fields before storing an EmailMessage row.
export function toMessageRow(mailboxKey, m) {
  return {
    mailbox_key: mailboxKey,
    thread_id: m.thread_id,
    message_id: m.message_id,
    internet_message_id: m.internet_message_id || '',
    sent_at: m.sent_at,
    from_name: m.from_name || '',
    from_email: m.from_email || '',
    to: m.to || [],
    cc: m.cc || [],
    subject: m.subject || '',
    text: String(m.text || '').slice(0, TEXT_CAP),
    direction: m.direction === 'outgoing' ? 'outgoing' : 'incoming',
    attachments: (m.attachments || []).slice(0, 50),
    labels: (m.labels || []).slice(0, 40),
  };
}
