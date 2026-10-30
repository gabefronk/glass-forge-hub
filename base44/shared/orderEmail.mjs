// One-click supplier order email (Gabriel, Oct 30). From a PO on Budget & Orders, the Hub
// writes the order email exactly the way he sends it from the YA Install Outlook mailbox:
//   To: the supplier's order contacts (AMSCO: Steve + Brian)
//   Subject: "Campbell addition - Order - YA-0022"
//   Body: "Hey Steve, / Can you get the attached quote that includes tax on order. /
//          Total: $1,291.13 / Thanks so much 🙂", with the vendor quote PDF attached.
// prepare returns that draft for the owner to check and edit; send creates the message in
// Outlook (Microsoft Graph, the app's Outlook connector) and sends it; draft only saves it.
// While the connector has no Mail.Send permission, send keeps the message as an Outlook
// draft and says so - nothing is ever sent without the owner's click. The PO records what
// went out (order_email_*), and a sent email moves an issued PO to "emailed".
import { isPurchasingMoneyOwner, isEntityId } from './purchasingMoneyPure.js';
import { amount, sameVendor } from './procurementCore.js';

export const GRAPH = 'https://graph.microsoft.com/v1.0';
const DRIVE = 'https://www.googleapis.com/drive/v3';
// Graph takes an attachment inside the message request only up to 3 MB.
export const MAX_ATTACHMENT_BYTES = 3 * 1024 * 1024;
const MAX_QUOTE_BYTES = 5 * 1024 * 1024;

// Who gets a supplier's order email until one of its POs records its own list.
export const SUPPLIER_ORDER_CONTACTS = [
  { vendor: 'AMSCO', greeting: 'Steve', to: ['stevec@amscowindows.com', 'brianbeitzelremodel@gmail.com'] },
];

const text = (v) => String(v ?? '').trim();
const reply = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const fail = (status, error) => Object.assign(new Error(error), { status });
const money = (v) => (amount(v) == null ? '' : amount(v).toLocaleString('en-US', { style: 'currency', currency: 'USD' }));
const EMAIL = /^[^\s@<>(),;:"[\]]+@[^\s@<>(),;:"[\]]+\.[a-z]{2,}$/i;

// "a@x.com, b@y.com; c@z.com" -> { list: [...unique], bad: [...] }
export function parseRecipients(value) {
  const parts = (Array.isArray(value) ? value : String(value || '').split(/[,;\s]+/)).map(text).filter(Boolean);
  const list = [], bad = [];
  for (const p of parts) {
    if (!EMAIL.test(p)) bad.push(p);
    else if (!list.some((x) => x.toLowerCase() === p.toLowerCase())) list.push(p);
  }
  return { list, bad };
}

// "CAMPBELL ADDITION" -> "Campbell addition", the way Gabriel types it; a mixed-case name stays.
export function jobLabel(name) {
  const s = text(name).replace(/\s+/g, ' ');
  if (!s || s !== s.toUpperCase()) return s;
  const lower = s.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

// The greeting name from an earlier order email body ("Hey Steve," -> "Steve").
const greetingOf = (body) => (text(body).match(/^(?:hey|hi|hello)\s+([^,\n]{1,40}),/i) || [])[1] || '';

// The draft for one PO. earlierPOs: other POs, newest first; the latest one sent to the same
// supplier gives the recipients and greeting, else SUPPLIER_ORDER_CONTACTS.
export function orderEmailDraft({ po, job, earlierPOs = [] }) {
  const last = earlierPOs.find((p) => p.id !== po.id && p.order_email_status === 'sent' && Array.isArray(p.order_email_to) && p.order_email_to.length && sameVendor(p, po));
  const known = SUPPLIER_ORDER_CONTACTS.find((c) => sameVendor({ vendor: c.vendor }, po));
  const to = last ? last.order_email_to : known ? known.to : [];
  const greeting = (last && greetingOf(last.order_email_body)) || known?.greeting || '';
  const total = money(po.amount_dealer);
  return {
    to,
    subject: `${jobLabel(job?.canonical_name || po.job_name) || 'Order'} - Order - ${text(po.po_number)}`,
    body: [`Hey${greeting ? ` ${greeting}` : ''},`, 'Can you get the attached quote that includes tax on order.', ...(total ? [`Total: ${total}`] : []), 'Thanks so much \u{1F642}'].join('\n\n'),
  };
}

const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// Plain text -> the HTML Outlook shows: Calibri 12pt, one paragraph per blank-line block.
export function bodyHtml(body) {
  const paras = String(body || '').replace(/\r\n/g, '\n').split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  return `<div style="font-family:Calibri,Arial,Helvetica,sans-serif;font-size:12pt;color:#000000">${paras.map((p) => `<p style="margin:0 0 12pt 0">${escapeHtml(p).replace(/\n/g, '<br>')}</p>`).join('')}</div>`;
}

export function graphMessage({ subject, body, to, attachment }) {
  return {
    subject,
    body: { contentType: 'HTML', content: bodyHtml(body) },
    toRecipients: to.map((address) => ({ emailAddress: { address } })),
    ...(attachment ? { attachments: [{ '@odata.type': '#microsoft.graph.fileAttachment', name: attachment.name, contentType: 'application/pdf', contentBytes: attachment.base64 }] } : {}),
  };
}

export const quoteFileName = (budget) => {
  const name = text(budget?.source_pdf_name) || `${text(budget?.title) || 'Quote'}.pdf`;
  return /\.pdf$/i.test(name) ? name : `${name}.pdf`;
};

// Problems with an edited email before anything is created, else ''.
export function emailProblem({ to, bad, subject, body }) {
  if (bad.length) return `Check these addresses: ${bad.join(', ')}`;
  if (!to.length) return 'Add who the order goes to.';
  if (to.length > 10) return 'Send to 10 people or fewer.';
  if (!text(subject) || text(subject).length > 200) return 'The subject needs 1 to 200 characters.';
  if (!text(body) || String(body).length > 5000) return 'The message needs 1 to 5,000 characters.';
  return '';
}

const pageItems = (page) => (Array.isArray(page) ? page : Array.isArray(page?.items) ? page.items : []);
const toBase64 = (bytes) => { let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000)); return btoa(bin); };
const storedRef = (v) => typeof v === 'string' && v.length > 0 && v.length <= 1500 && !/\s|\?|#|\\/.test(v) && !v.includes('..') && !/^[a-z][a-z0-9+.-]*:\/\//i.test(v);

async function readBytes(request, url, init = {}) {
  const r = await request(url, { ...init, redirect: 'follow' }).catch(() => null);
  if (!r || !r.ok) return null;
  const bytes = new Uint8Array(await r.arrayBuffer());
  return bytes.length && bytes.length <= MAX_QUOTE_BYTES ? bytes : null;
}

// The budget's vendor quote PDF: its private receipt (the same binding Budget & Orders opens),
// else a public source link, else its Drive copy. null when there is none to attach.
export async function quoteBytes({ client, request, budget }) {
  if (!budget?.id) return null;
  if (/^[a-f0-9]{64}$/.test(budget.source_sha256 || '')) {
    const bound = pageItems(await client.asServiceRole.entities.QuoteSourceReceipt.filter({ budget_id: budget.id }, { sort: '-created_date', limit: 2 }).catch(() => []));
    const r = bound.length === 1 ? bound[0] : null;
    if (r && r.sha256 === budget.source_sha256 && storedRef(r.file_uri)) {
      const signed = await client.asServiceRole.integrations.Core.CreateFileSignedUrl({ file_uri: r.file_uri, expires_in: 60 }).catch(() => null);
      if (/^https:\/\//.test(signed?.signed_url || '')) return readBytes(request, signed.signed_url);
    }
  }
  if (/^https:\/\//.test(text(budget.source_pdf_url))) return readBytes(request, text(budget.source_pdf_url));
  if (/^[\w-]{10,100}$/.test(text(budget.drive_quote_file_id))) {
    const { accessToken } = await client.asServiceRole.connectors.getConnection('googledrive').catch(() => ({}));
    if (accessToken) return readBytes(request, `${DRIVE}/files/${encodeURIComponent(budget.drive_quote_file_id)}?alt=media`, { headers: { Authorization: `Bearer ${accessToken}` } });
  }
  return null;
}

const hasQuoteFile = (budget) => Boolean(budget && (/^[a-f0-9]{64}$/.test(budget.source_sha256 || '') || /^https:\/\//.test(text(budget.source_pdf_url)) || text(budget.drive_quote_file_id)));

export function createOrderEmailHandler({ getClient, request = fetch, now = () => new Date().toISOString() } = {}) {
  return async (req) => {
    try {
      const client = await getClient(req);
      const user = await client.auth.me().catch(() => null);
      if (!isPurchasingMoneyOwner(user)) return reply({ error: 'Order email is owner-only.' }, user ? 403 : 401);
      const input = await req.json().catch(() => ({}));
      if (!['prepare', 'send', 'draft'].includes(input.action)) return reply({ error: 'Unsupported action.' }, 400);
      const db = client.asServiceRole.entities;
      const po = isEntityId(input.po_id) ? await db.PurchaseOrders.get(input.po_id).catch(() => null) : null;
      if (!po) return reply({ error: 'PO not found.' }, 404);
      if (po.status === 'cancelled') return reply({ error: 'This PO is cancelled.' }, 409);
      const [job, budget] = await Promise.all([
        po.job_id ? db.Jobs.get(po.job_id).catch(() => null) : null,
        po.budget_id ? db.JobBudgets.get(po.budget_id).catch(() => null) : null,
      ]);
      const { accessToken } = await client.asServiceRole.connectors.getConnection('outlook').catch(() => ({}));
      if (!accessToken) return reply({ error: 'Outlook is not connected to the Hub.' }, 503);
      const graph = (path, init = {}) => request(GRAPH + path, { ...init, headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json', ...init.headers } });
      const me = await graph('/me?$select=mail,userPrincipalName,displayName').then((r) => (r.ok ? r.json() : null)).catch(() => null);
      const from = text(me?.mail || me?.userPrincipalName);

      if (input.action === 'prepare') {
        const earlier = pageItems(await db.PurchaseOrders.filter({ order_email_status: 'sent' }, { sort: '-order_email_at', limit: 50 }).catch(() => []));
        return reply({
          ok: true, from, from_name: text(me?.displayName), draft: orderEmailDraft({ po, job, earlierPOs: earlier }),
          attachment: hasQuoteFile(budget) ? { name: quoteFileName(budget) } : null,
          last: po.order_email_status ? { status: po.order_email_status, at: po.order_email_at || '', to: po.order_email_to || [], link: po.order_email_ref || '' } : null,
        });
      }

      const key = text(input.request_key);
      if (!/^[\w-]{8,100}$/.test(key)) return reply({ error: 'Missing request key.' }, 400);
      // A retry of the same click answers with what happened the first time.
      if (po.order_email_request_key === key) return reply({ ok: true, status: po.order_email_status, link: po.order_email_ref || '', to: po.order_email_to || [], replay: true });
      if (input.action === 'send' && po.order_email_status === 'sent' && input.resend !== true) return reply({ error: `This order was already emailed (${po.order_email_at || 'earlier'}). Confirm to send it again.`, code: 'already_sent' }, 409);
      const { list: to, bad } = parseRecipients(input.to);
      const problem = emailProblem({ to, bad, subject: input.subject, body: input.body });
      if (problem) return reply({ error: problem }, 400);

      const bytes = await quoteBytes({ client, request, budget });
      const attachment = bytes && bytes.length <= MAX_ATTACHMENT_BYTES ? { name: quoteFileName(budget), base64: toBase64(bytes) } : null;
      const created = await graph('/me/messages', { method: 'POST', body: JSON.stringify(graphMessage({ subject: text(input.subject), body: input.body, to, attachment })) });
      if (!created.ok) return reply({ error: `Outlook would not create the email (${created.status}). Check the Outlook connection.` }, 502);
      const message = await created.json();
      let status = 'drafted', reason = '';
      if (input.action === 'send') {
        // Never send an order without its quote: it stays a draft to attach by hand.
        if (!attachment) reason = bytes ? 'attachment_too_large' : 'no_attachment';
        else {
          const sent = await graph(`/me/messages/${encodeURIComponent(message.id)}/send`, { method: 'POST' });
          if (sent.ok) status = 'sent';
          else reason = sent.status === 403 || sent.status === 401 ? 'no_send_permission' : `send_failed_${sent.status}`;
        }
      }
      const at = now();
      const toIssued = status === 'sent' && po.status === 'issued';
      const note = status === 'sent' ? `Order email sent to ${to.join(', ')} from ${from || 'Outlook'} (Hub).` : `Order email saved as an Outlook draft${reason ? ` (${reason.replace(/_/g, ' ')})` : ''} for ${to.join(', ')}.`;
      await db.PurchaseOrders.update(po.id, {
        order_email_status: status, order_email_at: at, order_email_to: to, order_email_subject: text(input.subject), order_email_body: String(input.body),
        order_email_mailbox: from, order_email_ref: message.webLink || message.id || '', order_email_request_key: key,
        ...(toIssued ? { status: 'emailed' } : {}),
        status_history: [...(po.status_history || []), { status: toIssued ? 'emailed' : po.status, at, by: user.email, note }],
      });
      return reply({ ok: true, status, reason, link: message.webLink || '', to, from, attached: Boolean(attachment) });
    } catch (error) {
      console.error('order email', error?.name || 'Error');
      return reply({ error: error?.status ? error.message : 'The order email could not be prepared. Check the Outlook connection.' }, error?.status || 502);
    }
  };
}
