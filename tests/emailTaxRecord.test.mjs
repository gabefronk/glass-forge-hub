import test from 'node:test';
import assert from 'node:assert/strict';
import { taxDocName, formatAmount, taxYear, findFolder, receiptAttachments, taxDocHtml, parseTaxRecord } from '../base44/shared/emailTaxRecord.js';

test('parseTaxRecord: only true is true; amount rounded to cents; missing amount is null not 0', () => {
  assert.deepEqual(parseTaxRecord({ tax_record: true, receipt_date: '2026-10-03', vendor: 'Wasatch Windows LLC', amount_total: '1842.5', reference: 'INV001184' }), { tax_record: true, receipt_date: '2026-10-03', vendor: 'Wasatch Windows LLC', amount_total: 1842.5, reference: 'INV001184' });
  assert.deepEqual(parseTaxRecord({ tax_record: false }), { tax_record: false, receipt_date: '', vendor: '', amount_total: null, reference: '' });
  assert.deepEqual(parseTaxRecord({ tax_record: 'yes' }), { tax_record: false, receipt_date: '', vendor: '', amount_total: null, reference: '' });
  assert.equal(parseTaxRecord({ tax_record: true, amount_total: 12.345 }).amount_total, 12.35);
  assert.equal(parseTaxRecord({ amount_total: 0 }).amount_total, 0, 'an explicit $0 is kept');
  assert.equal(parseTaxRecord({}).amount_total, null, 'a missing amount is null, not 0');
  // filesystem-unsafe characters in a vendor are stripped
  assert.equal(parseTaxRecord({ tax_record: true, vendor: 'A/B:C*?' }).vendor, 'A B C');
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

test('receiptAttachments: only PDF and image attachments, not inline logos', () => {
  const atts = [
    { name: 'receipt.pdf', mime: 'application/pdf' },
    { name: 'logo.png', mime: 'image/png' },
    { name: 'scan.jpg', mime: 'image/jpeg' },
    { name: 'inline.gif', mime: 'image/gif' },
    { name: 'doc.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' },
    { name: 'no-mime.txt' },
  ];
  assert.deepEqual(receiptAttachments(atts).map((a) => a.name), ['receipt.pdf', 'logo.png', 'scan.jpg', 'inline.gif']);
  assert.deepEqual(receiptAttachments([]), []);
  assert.deepEqual(receiptAttachments(undefined), []);
});

test('taxDocHtml: header block (from, date, subject, mailbox) then the body, escaped', () => {
  const html = taxDocHtml({ from: 'Helcim <noreply@helcim.com>', date: '2026-10-03T12:00:00Z', subject: 'Invoice INV001184 (PAID)', mailbox: 'Glass Forge (Gmail)', bodyText: 'Your card was charged $1,842.50.\nThanks!' });
  assert.match(html, /<b>From:<\/b> Helcim &lt;noreply@helcim\.com<\/p>/);
  assert.match(html, /<b>Subject:<\/b> Invoice INV001184 \(PAID\)<\/p>/);
  assert.match(html, /<b>Mailbox:<\/b> Glass Forge \(Gmail\)<\/p>/);
  assert.match(html, /<hr>/);
  assert.match(html, /Your card was charged \$1,842\.50\.<br>Thanks!/);
  // html is escaped so injected markup is inert
  const evil = taxDocHtml({ bodyText: '<script>alert(1)</script>' });
  assert.doesNotMatch(evil, /<script>alert/);
  assert.match(evil, /&lt;script&gt;/);
});