// Inbox agent: tax-record save step — pure helpers. No I/O here; emailAgent.js drives the
// Drive calls and the provider attachment downloads. Email content stays untrusted
// evidence (see emailTriage.js); a tax_record flag never carries an instruction.

const clean = (v, cap = 120) => String(v ?? '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, cap);

// "YYYY-MM-DD Vendor - Amount - Ref" — only the parts that are present, so a receipt with
// no parsed amount still gets a readable name. Falls back to "Receipt" when nothing is known.
export function taxDocName({ receipt_date = '', vendor = '', amount_total, reference = '' } = {}, fallbackDate = '') {
  const date = String(receipt_date || fallbackDate || '').slice(0, 10);
  const parts = [];
  if (date) parts.push(date);
  const v = clean(vendor, 80);
  if (v) parts.push(v);
  const a = formatAmount(amount_total);
  if (a) parts.push(a);
  const r = clean(reference, 60);
  if (r) parts.push(r);
  return parts.join(' - ') || 'Receipt';
}

export function formatAmount(n) {
  const v = Number(n);
  if (!Number.isFinite(v) || v === 0) return '';
  return `$${v.toFixed(2)}`;
}

// Receipt year for the subfolder. Uses the receipt date when stated, else the message date,
// else the current year — so a receipt saved today always lands somewhere sensible.
export function taxYear(receiptDate = '', fallbackDate = '') {
  const d = String(receiptDate || fallbackDate || '').slice(0, 4);
  return /^\d{4}$/.test(d) ? d : String(new Date().getFullYear());
}

// Find-or-create: given a parent's existing folder children and a wanted name, return
// {found: id} when an exact-name folder exists, else {create: name}. Matching is by exact
// name so a second run never makes a "Taxes (1)" or a duplicate year folder.
export function findFolder(children, name) {
  const want = String(name || '');
  const hit = (children || []).find((c) => c && c.name === want);
  if (hit) return { found: hit.id };
  return { create: want };
}

// PDF or image attachments — the receipt itself, not inline logos / header images.
export function receiptAttachments(attachments) {
  return (attachments || []).filter((a) => {
    const mime = String(a?.mime || a?.contentType || '').toLowerCase();
    return mime === 'application/pdf' || mime.startsWith('image/');
  });
}

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Google Doc body: a header block (from, date, subject, mailbox) then the email body. The
// body is the already-converted plain text from the normalizer, wrapped so Drive imports
// it as a readable doc.
export function taxDocHtml({ from = '', date = '', subject = '', mailbox = '', bodyText = '', bodyHtml = '' } = {}) {
  const header = [
    `<p><b>From:</b> ${esc(from)}</p>`,
    `<p><b>Date:</b> ${esc(date)}</p>`,
    `<p><b>Subject:</b> ${esc(subject)}</p>`,
    `<p><b>Mailbox:</b> ${esc(mailbox)}</p>`,
    '<hr>',
  ].join('');
  const body = bodyHtml || (bodyText ? `<div>${esc(bodyText).replace(/\n/g, '<br>')}</div>` : '');
  return header + body;
}

// Normalize the LLM's tax fields into the exact shape stored on the EmailRelay row.
// amount_total is rounded to cents; a non-numeric value becomes null (not 0, so $0 stays
// distinct from "not stated").
export function parseTaxRecord(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const amount = Number(r.amount_total);
  return {
    tax_record: r.tax_record === true,
    receipt_date: clean(r.receipt_date, 10),
    vendor: clean(r.vendor, 120),
    amount_total: Number.isFinite(amount) ? Math.round(amount * 100) / 100 : null,
    reference: clean(r.reference, 80),
  };
}