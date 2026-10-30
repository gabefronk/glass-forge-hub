import test from 'node:test';
import assert from 'node:assert/strict';
import { bodyHtml, createOrderEmailHandler, emailProblem, graphMessage, jobLabel, orderEmailDraft, parseRecipients, quoteFileName } from '../base44/shared/orderEmail.mjs';

// Campbell Addition, PO YA-0022 (Oct 30): the email Gabriel sends from YAWindowInstall@outlook.com.
const OWNER = { id: '6a7f0d834a5f825c724273ea', email: 'gabefronk@gmail.com', role: 'admin' };
const PO_ID = '6ae48081c25e62f618a4f919', BUDGET_ID = '6ae47df8135eea9540d0a7dc', JOB_ID = '6ae36c2ec74dcdbc0904f302';
const po = { id: PO_ID, po_number: 'YA-0022', job_id: JOB_ID, job_name: 'CAMPBELL ADDITION', budget_id: BUDGET_ID, vendor: 'AMSCO', vendor_quote_ref: '3608034', amount_dealer: 1291.13, status: 'issued', status_history: [{ status: 'issued', at: '2026-10-30T11:33:21Z', by: 'gabefronk@gmail.com', note: 'Reviewed and issued in Hub. Not sent to supplier.' }] };
const job = { id: JOB_ID, canonical_name: 'CAMPBELL ADDITION' };
const budget = { id: BUDGET_ID, title: 'CAMPBELL RES (AMSCO 3608034)', source_pdf_name: 'CAMPBELL ADDITION - WHITE - AMSCO STUDIO.pdf', source_sha256: 'a'.repeat(64) };
const EXPECTED_BODY = 'Hey Steve,\n\nCan you get the attached quote that includes tax on order.\n\nTotal: $1,291.13\n\nThanks so much \u{1F642}';

test('the Campbell order email reads exactly like the one Gabriel sends', () => {
  const draft = orderEmailDraft({ po, job });
  assert.deepEqual(draft.to, ['stevec@amscowindows.com', 'brianbeitzelremodel@gmail.com']);
  assert.equal(draft.subject, 'Campbell addition - Order - YA-0022');
  assert.equal(draft.body, EXPECTED_BODY);
  assert.equal(quoteFileName(budget), 'CAMPBELL ADDITION - WHITE - AMSCO STUDIO.pdf');
  assert.equal(quoteFileName({ title: 'Q 1' }), 'Q 1.pdf');
});

test('a later order to the same supplier starts from the last list sent; unknown suppliers start empty', () => {
  const earlier = [{ id: 'old', vendor: 'AMSCO Windows', order_email_status: 'sent', order_email_to: ['stevec@amscowindows.com'], order_email_body: 'Hey Steve C,\n\n…' }];
  const next = orderEmailDraft({ po: { ...po, id: 'new', po_number: 'YA-0023' }, job, earlierPOs: earlier });
  assert.deepEqual(next.to, ['stevec@amscowindows.com']);
  assert.match(next.body, /^Hey Steve C,/);
  const pella = orderEmailDraft({ po: { ...po, vendor: 'Pella' }, job, earlierPOs: earlier });
  assert.deepEqual(pella.to, []);
  assert.match(pella.body, /^Hey,\n/);
  assert.equal(jobLabel('Taira Res'), 'Taira Res');
  assert.equal(jobLabel('HIDDEN HALLOW LOT 509'), 'Hidden hallow lot 509');
});

test('recipients, subject and message are checked before anything is created', () => {
  assert.deepEqual(parseRecipients('stevec@amscowindows.com, brianbeitzelremodel@gmail.com; STEVEC@amscowindows.com'), { list: ['stevec@amscowindows.com', 'brianbeitzelremodel@gmail.com'], bad: [] });
  assert.deepEqual(parseRecipients('steve, x@y.com').bad, ['steve']);
  assert.equal(emailProblem({ to: ['x@y.com'], bad: [], subject: 'S', body: 'B' }), '');
  assert.match(emailProblem({ to: [], bad: [], subject: 'S', body: 'B' }), /goes to/);
  assert.match(emailProblem({ to: ['x@y.com'], bad: ['nope'], subject: 'S', body: 'B' }), /nope/);
  assert.match(emailProblem({ to: ['x@y.com'], bad: [], subject: ' ', body: 'B' }), /subject/);
});

test('the HTML body keeps his paragraphs in Calibri 12pt and escapes what he types', () => {
  const html = bodyHtml(EXPECTED_BODY);
  assert.match(html, /font-family:Calibri/);
  assert.match(html, /font-size:12pt/);
  assert.equal((html.match(/<p /g) || []).length, 4);
  assert.match(bodyHtml('a <b> & c'), /a &lt;b&gt; &amp; c/);
  const msg = graphMessage({ subject: 'S', body: 'B', to: ['x@y.com'], attachment: { name: 'q.pdf', base64: 'QQ==' } });
  assert.deepEqual(msg.toRecipients, [{ emailAddress: { address: 'x@y.com' } }]);
  assert.equal(msg.attachments[0]['@odata.type'], '#microsoft.graph.fileAttachment');
  assert.equal(graphMessage({ subject: 'S', body: 'B', to: ['x@y.com'] }).attachments, undefined);
});

function setup({ user = OWNER, canSend = true, record = po, receipts = [{ id: 'r1', budget_id: BUDGET_ID, sha256: 'a'.repeat(64), file_uri: 'private/quote.pdf' }] } = {}) {
  const calls = [], updates = [];
  const row = structuredClone(record);
  const client = {
    auth: { me: async () => user },
    asServiceRole: {
      entities: {
        PurchaseOrders: { get: async (id) => (id === row.id ? row : null), filter: async () => ({ items: [], has_more: false, next_cursor: null }), update: async (id, p) => { updates.push(p); Object.assign(row, p); return row; } },
        Jobs: { get: async () => job },
        JobBudgets: { get: async () => budget },
        QuoteSourceReceipt: { filter: async () => receipts },
      },
      connectors: { getConnection: async (kind) => ({ accessToken: kind === 'outlook' ? 'outlook-token' : 'drive-token' }) },
      integrations: { Core: { CreateFileSignedUrl: async () => ({ signed_url: 'https://storage.example/signed?sig=1' }) } },
    },
  };
  const request = async (url, init = {}) => {
    calls.push({ url, method: init.method || 'GET', body: init.body, headers: init.headers || {} });
    if (url.startsWith('https://storage.example/')) return new Response(new Uint8Array([37, 80, 68, 70]));
    if (url.includes('/me?')) return Response.json({ mail: 'gabefronk@gmail.com', displayName: 'YA Window Install' });
    if (url.includes('/me/mailFolders/sentitems/messages')) return Response.json({ value: [{ from: { emailAddress: { address: 'YAWindowInstall@outlook.com' } } }] });
    if (url.endsWith('/me/messages') && init.method === 'POST') return Response.json({ id: 'msg1', webLink: 'https://outlook.live.com/owa/?ItemID=msg1' }, { status: 201 });
    if (url.endsWith('/me/messages/msg1/send')) return canSend ? new Response(null, { status: 202 }) : Response.json({ error: { code: 'ErrorAccessDenied' } }, { status: 403 });
    return new Response('missing', { status: 404 });
  };
  const handler = createOrderEmailHandler({ getClient: async () => client, request, now: () => '2026-10-30T12:30:00Z' });
  const call = async (body) => { const r = await handler(new Request('https://app.invalid', { method: 'POST', body: JSON.stringify(body) })); return { status: r.status, data: await r.json() }; };
  return { call, calls, updates, row };
}
const sendBody = (over = {}) => ({ action: 'send', po_id: PO_ID, request_key: 'key-00000001', to: 'stevec@amscowindows.com, brianbeitzelremodel@gmail.com', subject: 'Campbell addition - Order - YA-0022', body: EXPECTED_BODY, ...over });

test('prepare returns the draft, the mailbox it comes from and the quote to attach', async () => {
  const s = setup();
  const r = await s.call({ action: 'prepare', po_id: PO_ID });
  assert.equal(r.status, 200);
  assert.equal(r.data.from, 'YAWindowInstall@outlook.com');
  assert.equal(r.data.draft.subject, 'Campbell addition - Order - YA-0022');
  assert.equal(r.data.attachment.name, 'CAMPBELL ADDITION - WHITE - AMSCO STUDIO.pdf');
  assert.equal(s.updates.length, 0);
  assert.equal((await setup({ user: { id: 'someone-else', email: 'crew@x.com' } }).call({ action: 'prepare', po_id: PO_ID })).status, 403);
});

test('send creates the message with the quote attached, sends it, and marks the PO emailed', async () => {
  const s = setup();
  const r = await s.call(sendBody());
  assert.equal(r.status, 200);
  assert.equal(r.data.status, 'sent');
  assert.equal(r.data.attached, true);
  const created = JSON.parse(s.calls.find((c) => c.url.endsWith('/me/messages')).body);
  assert.equal(created.subject, 'Campbell addition - Order - YA-0022');
  assert.equal(created.attachments[0].name, 'CAMPBELL ADDITION - WHITE - AMSCO STUDIO.pdf');
  assert.equal(created.attachments[0].contentBytes, 'JVBERg==');
  assert.ok(s.calls.some((c) => c.url.endsWith('/me/messages/msg1/send')));
  assert.equal(s.row.status, 'emailed');
  assert.deepEqual(s.row.order_email_to, ['stevec@amscowindows.com', 'brianbeitzelremodel@gmail.com']);
  assert.match(s.row.status_history.at(-1).note, /sent to stevec@amscowindows.com/);
  // The same click again replays; a new click needs resend.
  const again = await s.call(sendBody());
  assert.equal(again.data.replay, true);
  assert.equal(s.calls.filter((c) => c.url.endsWith('/send')).length, 1);
  assert.equal((await s.call(sendBody({ request_key: 'key-00000002' }))).status, 409);
});

test('without send permission the email is kept as an Outlook draft and the PO stays issued', async () => {
  const s = setup({ canSend: false });
  const r = await s.call(sendBody());
  assert.equal(r.data.status, 'drafted');
  assert.equal(r.data.reason, 'no_send_permission');
  assert.equal(r.data.link, 'https://outlook.live.com/owa/?ItemID=msg1');
  assert.equal(s.row.status, 'issued');
  assert.equal(s.row.order_email_status, 'drafted');
});

test('draft never sends, and an order with no quote PDF is never sent', async () => {
  const d = setup();
  assert.equal((await d.call(sendBody({ action: 'draft' }))).data.status, 'drafted');
  assert.equal(d.calls.some((c) => c.url.endsWith('/send')), false);
  const none = setup({ receipts: [] });
  const r = await none.call(sendBody());
  assert.equal(r.data.status, 'drafted');
  assert.equal(r.data.reason, 'no_attachment');
  assert.equal(none.calls.some((c) => c.url.endsWith('/send')), false);
  assert.equal((await setup().call(sendBody({ to: 'steve' }))).status, 400);
  assert.equal((await setup({ record: { ...po, status: 'cancelled' } }).call(sendBody())).status, 409);
});
