import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeGmailMessage, normalizeGraphMessage, accountHint, htmlToText, stripQuotedReply, parseAddressList, aggregateThread, toMessageRow, TEXT_CAP } from '../base44/shared/emailParse.js';
import { gmailMessage, graphMessage, REPLY_TEXT, HTML_BODY } from './fixtures/emailFixtures.mjs';

const GF = { key: 'gf-gmail', address: 'gabriel.fronk.wd@gmail.com', provider: 'gmail', display_name: 'Glass Forge (Gmail)' };
const YA = { key: 'ya-outlook', address: 'yawindowinstall@outlook.com', provider: 'outlook', display_name: 'YA Install (Outlook)' };

test('gmail: multipart text/plain wins, headers extracted, forwarded account_hint is the original recipient', () => {
  const raw = gmailMessage({ text: REPLY_TEXT, html: '<p>ignored html</p>', cc: 'Trevor <trevor@example.com>', attachments: [{ name: 'lot412-plans.pdf', size: 20000 }] });
  const m = normalizeGmailMessage(raw, { mailboxAddress: GF.address });
  assert.equal(m.message_id, 'm1');
  assert.equal(m.thread_id, 't1');
  assert.equal(m.subject, 'Lot 412 Oquirrh West - window install date');
  assert.equal(m.from_name, 'Kyle Super');
  assert.equal(m.from_email, 'kyle@ivoryhomes.com');
  assert.deepEqual(m.to, ['gabefronk@gmail.com']);
  assert.deepEqual(m.cc, ['trevor@example.com']);
  assert.equal(m.internet_message_id, '<abc123@ivoryhomes.com>');
  assert.equal(m.account_hint, 'gabefronk@gmail.com', 'X-Forwarded-For names the address the mail was really sent to');
  assert.equal(m.direction, 'incoming');
  assert.equal(m.sent_at, new Date(1758900000000).toISOString());
  assert.equal(m.has_attachments, true);
  assert.deepEqual(m.attachments, [{ name: 'lot412-plans.pdf', mime: 'application/pdf', size: 20000, attachment_id: 'att0' }]);
  assert.equal(m.web_link, 'https://mail.google.com/mail/u/0/#all/t1');
  assert.match(m.text, /confirm the install for lot 412/);
  assert.doesNotMatch(m.text, /wrote:/, 'quoted reply stripped');
  assert.doesNotMatch(m.text, /tentatively/, 'quoted lines stripped');
  assert.doesNotMatch(m.text, /ignored html/);
});

test('gmail: non-forwarded mail hints the mailbox itself; SENT label marks outgoing', () => {
  const direct = normalizeGmailMessage(gmailMessage({ forwarded: false, to: 'gabriel.fronk.wd@gmail.com', text: 'hello' }), { mailboxAddress: GF.address });
  assert.equal(direct.account_hint, 'gabriel.fronk.wd@gmail.com');
  const sent = normalizeGmailMessage(gmailMessage({ id: 'm2', from: 'Gabe Fronk <gabriel.fronk.wd@gmail.com>', to: 'kyle@ivoryhomes.com', labelIds: ['SENT'], text: 'On it.', forwarded: false }), { mailboxAddress: GF.address });
  assert.equal(sent.direction, 'outgoing');
  assert.equal(sent.is_draft, false);
});

test('gmail: html-only body converts to text, drops the quoted block and decodes entities', () => {
  const m = normalizeGmailMessage(gmailMessage({ id: 'm3', threadId: 't3', text: '', html: HTML_BODY, subject: 'RE: PO 7104345 ETA' }), { mailboxAddress: GF.address });
  assert.match(m.text, /PO 7104345 shipped & should land Monday\./);
  assert.match(m.text, /Vendor Desk/);
  assert.doesNotMatch(m.text, /Any ETA on PO/, 'gmail_quote block removed');
  assert.doesNotMatch(m.text, /margin:0/, 'style stripped');
  assert.equal(m.snippet.startsWith('Hi Gabe, PO 7104345 shipped'), true);
});

test('accountHint header precedence: X-Forwarded-For, then deepest Delivered-To, then X-Original-To, then To', () => {
  assert.equal(accountHint([{ name: 'Delivered-To', value: 'a@x.com' }, { name: 'Delivered-To', value: 'orig@x.com' }]), 'orig@x.com');
  assert.equal(accountHint([{ name: 'X-Original-To', value: 'o@x.com' }, { name: 'To', value: 'Someone <t@x.com>' }]), 'o@x.com');
  assert.equal(accountHint([{ name: 'To', value: 'Someone <t@x.com>, other@x.com' }]), 't@x.com');
  assert.equal(accountHint([], 'fallback@x.com'), 'fallback@x.com');
});

test('stripQuotedReply handles Outlook header blocks, dividers and mobile signatures; never returns empty', () => {
  const outlook = 'Sounds good, see you Tuesday.\n\n________________________________\nFrom: Gabe Fronk <g@x.com>\nSent: Monday\nTo: Maria\nSubject: Re: install\n\nold text';
  assert.equal(stripQuotedReply(outlook), 'Sounds good, see you Tuesday.');
  const mobile = 'Yes please.\n\nSent from my iPhone\n\n> quoted';
  assert.equal(stripQuotedReply(mobile), 'Yes please.');
  const onlyQuote = '> just a quote\n> more';
  assert.equal(stripQuotedReply(onlyQuote), '> just a quote\n> more');
  assert.equal(stripQuotedReply('x'.repeat(TEXT_CAP + 500)).length, TEXT_CAP);
});

test('htmlToText and address list parsing', () => {
  assert.equal(htmlToText('<div>Line 1<br>Line 2</div><p>Para &lt;tag&gt; &#8217;</p>'), 'Line 1\nLine 2\n\nPara <tag> ’');
  assert.deepEqual(parseAddressList('"Ortiz, Maria" <maria@x.com>, bob@y.com'), [{ name: 'Ortiz, Maria', email: 'maria@x.com' }, { name: 'bob@y.com'.replace('bob@y.com', ''), email: 'bob@y.com' }]);
});

test('graph: text body, recipients, attachments and webLink normalize; sender = mailbox is outgoing', () => {
  const raw = graphMessage({ bodyText: 'The bottom sash on the master bedroom window cracked.\n\nMaria\n\nGet Outlook for iOS', hasAttachments: true, attachments: [{ name: 'IMG_0042.jpg', size: 900000 }], categories: ['Hub'] });
  const m = normalizeGraphMessage(raw, { mailboxAddress: YA.address });
  assert.equal(m.message_id, 'AAMk1');
  assert.equal(m.thread_id, 'AAQk1');
  assert.equal(m.from_email, 'maria@summitcreek.com');
  assert.deepEqual(m.to, ['yawindowinstall@outlook.com']);
  assert.equal(m.account_hint, 'yawindowinstall@outlook.com');
  assert.equal(m.text, 'The bottom sash on the master bedroom window cracked.\n\nMaria');
  assert.equal(m.has_attachments, true);
  assert.equal(m.attachments[0].name, 'IMG_0042.jpg');
  assert.equal(m.web_link, 'https://outlook.live.com/mail/0/inbox/id/AAMk1');
  assert.deepEqual(m.labels, ['Hub']);
  assert.equal(m.sent_at, '2026-09-26T15:20:00.000Z');
  const out = normalizeGraphMessage(graphMessage({ id: 'AAMk2', from: { name: 'YA Install', address: 'YAWindowInstall@outlook.com' }, bodyText: 'On our way.' }), { mailboxAddress: YA.address });
  assert.equal(out.direction, 'outgoing');
  const html = normalizeGraphMessage(graphMessage({ id: 'AAMk3', bodyHtml: '<p>Hi</p><blockquote>old</blockquote>' }), { mailboxAddress: YA.address });
  assert.equal(html.text, 'Hi');
});

test('aggregateThread folds messages into the thread row and keeps the latest incoming sender', () => {
  const m1 = normalizeGmailMessage(gmailMessage({ id: 'm1', text: 'first', internalDate: '1758800000000' }), { mailboxAddress: GF.address });
  const m2 = normalizeGmailMessage(gmailMessage({ id: 'm2', from: 'Gabe Fronk <gabriel.fronk.wd@gmail.com>', to: 'kyle@ivoryhomes.com', labelIds: ['SENT'], text: 'reply', forwarded: false, internalDate: '1758850000000' }), { mailboxAddress: GF.address });
  const m3 = normalizeGmailMessage(gmailMessage({ id: 'm3', subject: 'Re: Lot 412 Oquirrh West - window install date', text: 'third, latest', internalDate: '1758900000000', attachments: [{ name: 'a.pdf' }] }), { mailboxAddress: GF.address });
  const agg = aggregateThread([m3, m1, m2], { mailbox: GF });
  assert.equal(agg.mailbox_key, 'gf-gmail');
  assert.equal(agg.thread_id, 't1');
  assert.equal(agg.subject, 'Lot 412 Oquirrh West - window install date', 'Re: prefix stripped');
  assert.equal(agg.message_count, 3);
  assert.equal(agg.first_message_at, m1.sent_at);
  assert.equal(agg.last_message_at, m3.sent_at);
  assert.equal(agg.from_email, 'kyle@ivoryhomes.com');
  assert.equal(agg.account_hint, 'gabefronk@gmail.com');
  assert.equal(agg.has_attachments, true);
  assert.equal(agg.snippet, 'third, latest');
  assert.deepEqual(agg.participants.map((p) => p.email), ['kyle@ivoryhomes.com', 'gabefronk@gmail.com']);
  assert.equal(agg.web_link, 'https://mail.google.com/mail/u/0/#all/t1');
  const row = toMessageRow('gf-gmail', m3);
  assert.deepEqual(Object.keys(row).sort(), ['attachments', 'cc', 'direction', 'from_email', 'from_name', 'internet_message_id', 'labels', 'mailbox_key', 'message_id', 'sent_at', 'subject', 'text', 'thread_id', 'to']);
  // Stored rows (no helper fields) aggregate the same way on the next run.
  const again = aggregateThread([toMessageRow('gf-gmail', m1), toMessageRow('gf-gmail', m2), m3], { mailbox: GF, previous: { ...agg, id: 'thr1' } });
  assert.equal(again.has_attachments, true);
  assert.equal(again.from_email, 'kyle@ivoryhomes.com');
});
