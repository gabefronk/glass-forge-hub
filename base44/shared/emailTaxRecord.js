// Inbox agent: tax-record save step — pure helpers. No I/O here; emailTaxDrive.js drives the
// Drive calls and the provider attachment downloads. Email content stays untrusted
// evidence (see emailTriage.js); a tax_record flag never carries an instruction.

const clean = (v, cap = 120) => String(v ?? '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, cap);

// ---- money -------------------------------------------------------------------------------------
// Receipt amounts are kept as the exact two-decimal money the email prints. The value is
// normalized from its decimal text (never by multiplying a binary float), so 1.005 -> 1.01 and
// 0.285 -> 0.29 rather than the float-drifted 1.00 / 0.28. Excess precision rounds half-up on
// the magnitude (half away from zero). Returns the nearest JS number to that exact cents value,
// or null when no amount is stated / it is not a plain decimal.
export function normalizeMoney(v) {
  if (v === null || v === undefined || typeof v === 'boolean') return null;
  let s;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null;
    s = /e/i.test(String(v)) ? v.toFixed(20) : String(v); // String() is the shortest exact repr
  } else {
    s = String(v).trim().replace(/^(-?)\s*\$/, '$1').replace(/,/g, '');
  }
  const m = s.match(/^(-?)(\d*)(?:\.(\d*))?$/);
  if (!m || (!m[2] && !m[3])) return null;
  const frac = m[3] || '';
  let cents = BigInt(m[2] || '0') * 100n + BigInt((frac + '00').slice(0, 2));
  if (frac.length > 2 && frac[2] >= '5') cents += 1n;
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  const c = Number(cents);
  return (m[1] && c ? -c : c) / 100;
}

// Integer cents of a value produced by normalizeMoney (exact for any two-decimal amount).
export const centsOf = (n) => Math.round(Number(n) * 100);

export function formatAmount(n) {
  if (n === null || n === undefined || n === '') return '';
  const c = centsOf(n);
  if (!Number.isFinite(c) || c === 0) return '';
  const a = Math.abs(c);
  return `${c < 0 ? '-' : ''}$${Math.floor(a / 100)}.${String(a % 100).padStart(2, '0')}`;
}

// "YYYY-MM-DD Vendor - Amount - Ref" — only the parts that are present, so a receipt with
// no parsed amount still gets a readable name. Falls back to "Receipt" when nothing is known.
export function taxDocName({ receipt_date = '', vendor = '', amount_total, reference = '' } = {}, fallbackDate = '') {
  const date = String(receipt_date || fallbackDate || '').slice(0, 10);
  const rest = [clean(vendor, 80), formatAmount(amount_total), clean(reference, 60)].filter(Boolean).join(' - ');
  return [date, rest].filter(Boolean).join(' ') || 'Receipt';
}

// Receipt year for the subfolder. Uses the receipt date when stated, else the message date,
// else the current year — so a receipt saved today always lands somewhere sensible.
export function taxYear(receiptDate = '', fallbackDate = '') {
  const d = String(receiptDate || fallbackDate || '').slice(0, 4);
  return /^\d{4}$/.test(d) ? d : String(new Date().getFullYear());
}

// Find-or-create: given a parent's existing folder children and a wanted name, return
// {found: id} when an exact-name folder exists, else {create: name}. With several exact
// matches the earliest-created wins, so concurrent runs converge on the same folder.
export function findFolder(children, name) {
  const want = String(name || '');
  const hit = canonicalFile((children || []).filter((c) => c && c.name === want));
  if (hit) return { found: hit.id };
  return { create: want };
}

// Deterministic pick among Drive files carrying the same identity: earliest createdTime, then id.
export function canonicalFile(files) {
  const list = (files || []).filter((f) => f && f.id);
  if (!list.length) return null;
  return [...list].sort((a, b) => String(a.createdTime || '').localeCompare(String(b.createdTime || '')) || String(a.id).localeCompare(String(b.id)))[0];
}

// ---- attachments ---------------------------------------------------------------------------
// Only what is plausibly the receipt itself: a PDF, or a real photo/scan image. Inline parts,
// GIFs, small images and logo/banner/social images are left in the mailbox, so unrelated
// attachments are never copied to Drive.
export const MAX_RECEIPT_ATTACHMENTS = 5;
export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024;
export const MIN_IMAGE_BYTES = 20 * 1024;
const UNRELATED_NAME = /(logo|icon|banner|header|footer|spacer|pixel|signature|social|facebook|twitter|linkedin|instagram|youtube)/i;
const RECEIPT_IMAGE = /^image\/(png|jpe?g|heic|heif|webp|tiff?)$/;

export function receiptAttachments(attachments) {
  return (attachments || []).filter((a) => {
    if (!a || a.inline === true) return false;
    const mime = String(a.mime || a.contentType || '').toLowerCase();
    const name = String(a.name || '');
    const size = Number(a.size || 0);
    if (size > MAX_ATTACHMENT_BYTES) return false;
    if (mime === 'application/pdf' || (mime === 'application/octet-stream' && /\.pdf$/i.test(name))) return true;
    return RECEIPT_IMAGE.test(mime) && size >= MIN_IMAGE_BYTES && !UNRELATED_NAME.test(name);
  }).slice(0, MAX_RECEIPT_ATTACHMENTS);
}

// ---- identity -----------------------------------------------------------------------------
export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(text)));
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}
// One key per provider + mailbox account + thread. Written to Drive appProperties so a later
// run can find what an earlier (or concurrent, or lost-response) run already created.
export const taxKey = async (provider, mailboxKey, threadId) => (await sha256Hex(`tax|${provider}|${mailboxKey}|${threadId}`)).slice(0, 40);
// Gmail attachment ids are not stable across fetches, so an attachment is keyed by its message
// and what it is, not by the provider's attachment id.
export const attachmentKey = async (messageId, att) => (await sha256Hex(`att|${messageId}|${att?.name || ''}|${att?.mime || ''}|${Number(att?.size || 0)}`)).slice(0, 40);

const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Google Doc body: a header block (from, date, subject, mailbox) then the email body. The
// body is the already-converted plain text from the normalizer, escaped so any markup in the
// email is inert.
export function taxDocHtml({ from = '', date = '', subject = '', mailbox = '', bodyText = '' } = {}) {
  const header = [
    `<p><b>From:</b> ${esc(from)}</p>`,
    `<p><b>Date:</b> ${esc(date)}</p>`,
    `<p><b>Subject:</b> ${esc(subject)}</p>`,
    `<p><b>Mailbox:</b> ${esc(mailbox)}</p>`,
    '<hr>',
  ].join('');
  const body = bodyText ? `<div>${esc(bodyText).replace(/\n/g, '<br>')}</div>` : '';
  return header + body;
}

// Normalize the LLM's tax fields into the exact shape stored on the EmailRelay row.
export function parseTaxRecord(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  return {
    tax_record: r.tax_record === true,
    receipt_date: clean(r.receipt_date, 10),
    vendor: clean(r.vendor, 120),
    amount_total: normalizeMoney(r.amount_total),
    reference: clean(r.reference, 80),
  };
}