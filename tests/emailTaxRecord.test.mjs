import test from 'node:test';
import assert from 'node:assert/strict';
import { taxDocName, formatAmount, taxYear, findFolder, receiptAttachments, taxDocHtml, normalizeMoney, centsOf, canonicalFile, taxKey, attachmentKey } from '../base44/shared/emailTaxRecord.js';

test('normalizeMoney: decimal-text half-up rounding, no binary float drift', () => {
  assert.equal(normalizeMoney(1.005), 1.01, 'float 1.005 would round to 1.00');
  assert.equal(normalizeMoney(0.285), 0.29);
  assert.equal(normalizeMoney('1,842.50'), 1842.5);
  assert.equal(normalizeMoney('$12.345'), 12.35);
  assert.equal(normalizeMoney('-$2.675'), -2.68, 'half away from zero');
  assert.equal(normalizeMoney('12.344'), 12.34);
  assert.equal(normalizeMoney(1e21), null, 'beyond safe cents');
  for (const bad of [null, undefined, true, '', 'abc', '1.2.3', NaN, Infinity]) assert.equal(normalizeMoney(bad), null);
  assert.equal(centsOf(normalizeMoney('0.29')), 29);
  assert.equal(formatAmount(normalizeMoney('19.999')), '$20.00');
  assert.equal(formatAmount(-2.68), '-$2.68');
});

test('identity: thread and attachment keys are deterministic and distinct; canonicalFile picks the earliest', async () => {
  assert.equal(await taxKey('gmail', 'gf-gmail', 't1'), await taxKey('gmail', 'gf-gmail', 't1'));
  assert.notEqual(await taxKey('gmail', 'gf-gmail', 't1'), await taxKey('outlook', 'gf-gmail', 't1'));
  assert.notEqual(await taxKey('gmail', 'gf-gmail', 't1'), await taxKey('gmail', 'ya-outlook', 't1'));
  const a = { name: 'r.pdf', mime: 'application/pdf', size: 10, attachment_id: 'x1' };
  assert.equal(await attachmentKey('m1', a), await attachmentKey('m1', { ...a, attachment_id: 'rotated' }), 'not keyed on the unstable provider id');
  assert.notEqual(await attachmentKey('m1', a), await attachmentKey('m2', a));
  assert.equal(canonicalFile([{ id: 'b', createdTime: '2026-01-02' }, { id: 'a', createdTime: '2026-01-02' }, { id: 'c', createdTime: '2026-01-03' }]).id, 'a');
  assert.equal(canonicalFile([]), null);
});


test('taxDocName: "YYYY-MM-DD Vendor - Amount - Ref", only the parts that exist; falls back to Receipt', () => {
  assert.equal(taxDocName({ receipt_date: '2026-10-03', vendor: 'Wasatch Windows LLC', amount_total: 1842.5, reference: 'INV001184' }, ''), '2026-10-03 Wasatch Windows LLC - $1842.50 - INV001184');
  assert.equal(taxDocName({ receipt_date: '2026-10-03', vendor: 'Helcim' }, ''), '2026-10-03 Helcim');
  assert.equal(taxDocName({ vendor: 'Helcim', amount_total: 99 }, '2026-10-03'), '2026-10-03 Helcim - $99.00', 'falls back to the message date when no receipt date');
  assert.equal(taxDocName({}, ''), 'Receipt');
  assert.equal(formatAmount(0), '', 'a $0 amount is not shown in the name');
  assert.equal(formatAmount(null), '');
  assert.equal(formatAmount(1842.5), '$1842.50');
});

test('taxYear: receipt date year, else message date year, else current year', () => {
  assert.equal(taxYear('2026-10-03', ''), '2026');
  assert.equal(taxYear('', '2025-12-31T10:00:00Z'), '2025');
  assert.equal(taxYear('', ''), String(new Date().getFullYear()));
});

test('findFolder: exact-name match returns found, otherwise create; never duplicates', () => {
  assert.deepEqual(findFolder([{ id: 'f1', name: 'Taxes' }, { id: 'f2', name: '2025' }], 'Taxes'), { found: 'f1' });
  assert.deepEqual(findFolder([{ id: 'f1', name: 'Taxes' }], '2026'), { create: '2026' });
  assert.deepEqual(findFolder([], 'Taxes'), { create: 'Taxes' });
  // a near-match name does not count (no "Taxes (1)")
  assert.deepEqual(findFolder([{ id: 'f1', name: 'Taxes (1)' }], 'Taxes'), { create: 'Taxes' });
  assert.deepEqual(findFolder([{ id: 'f1', name: 'taxes' }], 'Taxes'), { create: 'Taxes' }, 'case-sensitive');
});

test('receiptAttachments: only the receipt PDF / real scan images; no logos, inline parts, GIFs, tiny or huge files', () => {
  const atts = [
    { name: 'receipt.pdf', mime: 'application/pdf', size: 40_000 },
    { name: 'receipt2.pdf', mime: 'application/octet-stream', size: 40_000 },
    { name: 'logo.png', mime: 'image/png', size: 60_000 },
    { name: 'scan.jpg', mime: 'image/jpeg', size: 90_000 },
    { name: 'photo.jpg', mime: 'image/jpeg', size: 90_000, inline: true },
    { name: 'tiny.png', mime: 'image/png', size: 900 },
    { name: 'anim.gif', mime: 'image/gif', size: 90_000 },
    { name: 'huge.pdf', mime: 'application/pdf', size: 20 * 1024 * 1024 },
    { name: 'doc.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 9000 },
    { name: 'no-mime.txt' },
  ];
  assert.deepEqual(receiptAttachments(atts).map((a) => a.name), ['receipt.pdf', 'receipt2.pdf', 'scan.jpg']);
  assert.equal(receiptAttachments(Array.from({ length: 8 }, (_, i) => ({ name: `r${i}.pdf`, mime: 'application/pdf' }))).length, 5, 'capped');
  assert.deepEqual(receiptAttachments([]), []);
  assert.deepEqual(receiptAttachments(undefined), []);
});

test('taxDocHtml: header block (from, date, subject, mailbox) then the body, escaped', () => {
  const html = taxDocHtml({ from: 'Helcim <noreply@helcim.com>', date: '2026-10-03T12:00:00Z', subject: 'Invoice INV001184 (PAID)', mailbox: 'Glass Forge (Gmail)', bodyText: 'Your card was charged $1,842.50.\nThanks!' });
  assert.match(html, /<b>From:<\/b> Helcim &lt;noreply@helcim\.com&gt;<\/p>/);
  assert.match(html, /<b>Subject:<\/b> Invoice INV001184 \(PAID\)<\/p>/);
  assert.match(html, /<b>Mailbox:<\/b> Glass Forge \(Gmail\)<\/p>/);
  assert.match(html, /<hr>/);
  assert.match(html, /Your card was charged \$1,842\.50\.<br>Thanks!/);
  // html is escaped so injected markup is inert
  const evil = taxDocHtml({ bodyText: '<script>alert(1)</script>' });
  assert.doesNotMatch(evil, /<script>alert/);
  assert.match(evil, /&lt;script&gt;/);
});