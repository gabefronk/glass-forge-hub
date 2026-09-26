// Fixture builders for the inbox agent tests (Gmail users.messages.get?format=full and
// Microsoft Graph /me/messages/{id} shapes).

const b64url = (s) => Buffer.from(String(s), 'utf8').toString('base64url');

export function gmailMessage({
  id = 'm1', threadId = 't1', from = 'Kyle Super <kyle@ivoryhomes.com>', to = 'gabefronk@gmail.com', cc = '',
  subject = 'Lot 412 Oquirrh West - window install date', text = '', html = '', labelIds = ['INBOX', 'UNREAD'],
  internalDate = '1758900000000', forwarded = true, attachments = [], messageIdHeader = '<abc123@ivoryhomes.com>', extraHeaders = [],
} = {}) {
  const headers = [];
  // Gmail adds its own Delivered-To on arrival; a filter-forwarded copy keeps the original
  // recipient in X-Forwarded-For and a second Delivered-To underneath.
  if (forwarded) {
    headers.push({ name: 'Delivered-To', value: 'gabriel.fronk.wd@gmail.com' });
    headers.push({ name: 'X-Forwarded-To', value: 'gabriel.fronk.wd@gmail.com' });
    headers.push({ name: 'X-Forwarded-For', value: 'gabefronk@gmail.com gabriel.fronk.wd@gmail.com' });
    headers.push({ name: 'Delivered-To', value: 'gabefronk@gmail.com' });
  } else {
    headers.push({ name: 'Delivered-To', value: 'gabriel.fronk.wd@gmail.com' });
  }
  headers.push({ name: 'From', value: from }, { name: 'To', value: to }, { name: 'Subject', value: subject }, { name: 'Message-ID', value: messageIdHeader }, { name: 'Date', value: 'Fri, 26 Sep 2026 10:00:00 -0600' });
  if (cc) headers.push({ name: 'Cc', value: cc });
  headers.push(...extraHeaders);
  const alt = { mimeType: 'multipart/alternative', parts: [] };
  if (text) alt.parts.push({ mimeType: 'text/plain', body: { size: text.length, data: b64url(text) } });
  if (html) alt.parts.push({ mimeType: 'text/html', body: { size: html.length, data: b64url(html) } });
  let payload;
  if (attachments.length) {
    payload = { mimeType: 'multipart/mixed', headers, parts: [alt, ...attachments.map((a, i) => ({ mimeType: a.mime || 'application/pdf', filename: a.name, body: { size: a.size || 1234, attachmentId: a.attachment_id || `att${i}` } }))] };
  } else if (alt.parts.length === 1) {
    payload = { ...alt.parts[0], headers };
  } else {
    payload = { ...alt, headers };
  }
  return { id, threadId, labelIds, snippet: String(text || html).slice(0, 80), historyId: '100', internalDate, payload };
}

export function graphMessage({
  id = 'AAMk1', conversationId = 'AAQk1', from = { name: 'Maria Ortiz', address: 'maria@summitcreek.com' }, to = [{ name: 'YA Install', address: 'yawindowinstall@outlook.com' }],
  subject = 'Summit Creek 14 - broken sash', bodyText = '', bodyHtml = '', receivedDateTime = '2026-09-26T15:20:00Z', hasAttachments = false, attachments = [], categories = [], headers = null,
} = {}) {
  return {
    id, conversationId, internetMessageId: `<${id}@outlook.com>`, subject, bodyPreview: String(bodyText || bodyHtml).slice(0, 80),
    body: bodyHtml ? { contentType: 'html', content: bodyHtml } : { contentType: 'text', content: bodyText },
    from: { emailAddress: from }, sender: { emailAddress: from },
    toRecipients: to.map((r) => ({ emailAddress: r })), ccRecipients: [],
    receivedDateTime, sentDateTime: receivedDateTime, hasAttachments, isDraft: false,
    webLink: `https://outlook.live.com/mail/0/inbox/id/${id}`, categories,
    internetMessageHeaders: headers || [{ name: 'Message-ID', value: `<${id}@outlook.com>` }, { name: 'To', value: to.map((r) => r.address).join(', ') }],
    attachments: attachments.map((a, i) => ({ id: `gatt${i}`, name: a.name, contentType: a.mime || 'image/jpeg', size: a.size || 5000 })),
  };
}

export const REPLY_TEXT = `Hey Gabe,

Can you confirm the install for lot 412 is still Tuesday the 6th? The framers finished Friday and drywall wants to start. Also need the COI sent to Ivory before crews show up.

Thanks,
Kyle
801-555-0142

On Thu, Sep 24, 2026 at 3:10 PM Gabe Fronk <gabefronk@gmail.com> wrote:
> We're tentatively set for the 6th.
> Gabe`;

export const HTML_BODY = `<html><head><style>p{margin:0}</style></head><body><div dir="ltr"><p>Hi Gabe,</p><p>PO&nbsp;7104345 shipped &amp; should land Monday.</p><br><p>Thanks!<br>Vendor Desk</p></div><div class="gmail_quote">On Wed, Sep 23, 2026 Gabe wrote:<blockquote>Any ETA on PO 7104345?</blockquote></div></body></html>`;
