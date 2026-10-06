// Tax filing scope: ONLY Wasatch Windows ACH payment confirmations in the owner-only mailbox.
// Pure, deterministic, fail-closed; the LLM plays no part in deciding what gets filed.
//
// Grounded on the ledger (2026-10-06): every Wasatch payment email comes from Helcim's
// no-reply sender, and the paid confirmation's subject is "Invoice - INVnnnnnn (PAID)".
// "You have an upcoming payment", "Confirmation of ACH Payment Agreement" and "New Payment
// Request" from the same sender are NOT payments and never match. The From display name is
// never trusted; the merchant must be named in the message body. ACH evidence must appear in
// the body and any card wording disqualifies it.

import { normalizeMoney } from './emailTaxRecord.js';

export const WASATCH_SENDER = 'donotreply@app.helcim.com';
export const WASATCH_VENDOR = 'Wasatch Windows LLC';
const MERCHANT_RE = /\bwasatch\s+windows\b/i;
const PAID_SUBJECT_RE = /^\s*invoice\s*-\s*(INV\d{4,})\s*\(paid\)\s*$/i;
const ACH_RE = /\b(ACH|bank\s+(?:account|withdrawal|transfer|debit|payment)|e-?check|electronic\s+(?:check|funds\s+transfer)|EFT)\b/i;
const CARD_RE = /\b(visa|master\s*card|amex|american\s+express|discover|credit\s+card|debit\s+card|card\s+(?:ending|number))\b/i;
const NOT_PAID_RE = /\b(upcoming|scheduled|pending|will\s+be\s+(?:processed|withdrawn|charged|debited)|failed|declined|returned|reversed|past\s+due|unpaid|overdue|payment\s+request)\b/i;
const AMOUNT_RE = /\b(?:amount\s+paid|total\s+paid|payment\s+amount|amount|total)\s*:?\s*(-?\$\s*[\d,]+\.\d{2})/i;
// Real template (work Gmail, INV001186): "BANK Withdrawal APPROVED", "Amount Due $0". A balance
// still due means it is not a full payment confirmation.
const AMOUNT_DUE_RE = /\bamount\s+due\s*:?\s*\$\s*([\d,]+(?:\.\d+)?)/i;

// Filing confirmed (2026-10-06): the Helcim merchant "Wasatch windows llc" is an accepted alias
// for Wasatch Windows LLC. Wasatch ACH paid confirmations in the owner mailbox are filed to
// Drive automatically. An explicit taxFilingEnabled=false override (used in tests) holds filing
// and only reports the match in run warnings; it never writes or deletes anything.
export const WASATCH_FILING_CONFIRMED = true;

const denverYmd = (iso) => {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver' }).format(new Date(t)) : '';
};

// message: a normalized message (emailParse.js). Returns the tax fields for the ledger row, or null.
// Which mailbox a message belongs to comes from the connection it was read through
// (mailbox.visibility), never from its To / Delivered-To headers.
export function matchWasatchAchPaid(mailbox, message) {
  if (mailbox?.visibility !== 'owner' || !message || message.direction !== 'incoming' || message.is_draft) return null;
  if (String(message.from_email || '').trim().toLowerCase() !== WASATCH_SENDER) return null;
  const subject = String(message.subject || '').replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, '');
  const m = subject.match(PAID_SUBJECT_RE);
  if (!m) return null;
  const text = String(message.text || '');
  if (!MERCHANT_RE.test(text) || !ACH_RE.test(text) || CARD_RE.test(text) || NOT_PAID_RE.test(text)) return null;
  const due = text.match(AMOUNT_DUE_RE);
  if (due && normalizeMoney(due[1]) !== 0) return null;
  const amt = text.match(AMOUNT_RE);
  return { tax_record: true, vendor: WASATCH_VENDOR, reference: m[1].toUpperCase(), amount_total: amt ? normalizeMoney(amt[1]) : null, receipt_date: denverYmd(message.sent_at) || null };
}

// The newest message in a thread that is a Wasatch ACH paid confirmation, with its fields.
export function findWasatchAchPaid(mailbox, messages) {
  for (const msg of [...(messages || [])].reverse()) {
    const fields = matchWasatchAchPaid(mailbox, msg);
    if (fields) return { message: msg, fields };
  }
  return null;
}