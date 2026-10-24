import { computeFeeAmt, computeLaborAmt } from './feeMath.js';

// Billing mirrors QuickBooks: work is billed on a numbered invoice with a date, and the
// invoice is later paid. Each invoice is an Invoices record. Labor billing invoices carry
// FeeLines (invoice_id on the line); customer invoices (deposit, balance, ...) sit on a job.
// Payment lives on the invoice and is copied to its lines (paid_to_ya / paid_date).
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const round = (n) => Math.round(n * 100) / 100;
export const CUSTOMER_KINDS = [
  { key: 'deposit', label: 'Deposit' },
  { key: 'progress', label: 'Progress' },
  { key: 'balance', label: 'Balance' },
  { key: 'other', label: 'Other' },
];
export const kindLabel = (kind) => (kind === 'labor_billing' ? 'Labor billing' : CUSTOMER_KINDS.find((k) => k.key === kind)?.label || 'Invoice');

const validDay = (d) => ISO_DAY.test(String(d || '')) && !Number.isNaN(Date.parse(d));

export function invoiceInputError({ number, date, amount, requireAmount = false }) {
  const n = String(number || '').trim();
  if (!n) return 'Enter the QuickBooks invoice number.';
  if (n.length > 40) return 'Invoice number is too long.';
  if (!validDay(date)) return 'Enter the invoice date.';
  if (requireAmount && !(Number(amount) > 0)) return 'Enter the invoice amount.';
  return '';
}

export const liveInvoices = (invoices) => invoices.filter((i) => !i.voided_at);
export const findInvoice = (invoices, number) => liveInvoices(invoices).find((i) => i.invoice_number === String(number).trim()) || null;

export const lineTotals = (rows) => ({
  labor: round(rows.reduce((n, r) => n + (computeLaborAmt(r) || 0), 0)),
  fee: round(rows.reduce((n, r) => n + (computeFeeAmt(r) || 0), 0)),
  count: rows.length,
});

// A labor billing invoice: new, or the existing invoice with this number grown by these lines.
export function laborInvoicePlan(rows, { number, date, customer = 'BFS' }, invoices = []) {
  const existing = findInvoice(invoices, number);
  if (existing && existing.kind !== 'labor_billing') return { error: `Invoice #${existing.invoice_number} is a ${kindLabel(existing.kind).toLowerCase()} invoice on a job. Use a different number.` };
  const t = lineTotals(rows);
  if (existing) {
    return { existing, update: { amount: round((existing.amount || 0) + t.labor), fee_amount: round((existing.fee_amount || 0) + t.fee), line_count: (existing.line_count || 0) + t.count } };
  }
  return { create: { invoice_number: String(number).trim(), invoice_date: date, kind: 'labor_billing', customer_name: customer, amount: t.labor, fee_amount: t.fee, line_count: t.count } };
}

export function linePatches(rows, invoice) {
  return rows.map((r) => ({
    id: r.id, billed_to_bfs: true, manually_adjusted: true,
    invoice_id: invoice.id, invoice_number: invoice.invoice_number, invoice_date: invoice.invoice_date,
    paid_to_ya: !!invoice.paid_date, paid_date: invoice.paid_date || null,
  }));
}

// Reopening a line takes it off its invoice and clears any payment recorded against it.
export function reopenPatch() {
  return { billed_to_bfs: false, invoice_id: null, invoice_number: null, invoice_date: null, paid_to_ya: false, paid_date: null };
}

export function paymentLinePatches(lines, invoiceId, date) {
  return lines.filter((r) => r.billed_to_bfs && r.invoice_id === invoiceId).map((r) => ({ id: r.id, paid_to_ya: !!date, paid_date: date || null }));
}

export function priorState(rows, keys) {
  return rows.map((r) => Object.fromEntries([['id', r.id], ...keys.map((k) => [k, r[k] ?? null])]));
}

export const invoiceStatus = (inv) => (inv.voided_at ? 'void' : inv.paid_date ? 'paid' : 'open');

// Labor billing invoices, open first, newest first. With the lines loaded, totals are live
// (an invoice whose lines were all reopened shows 0 lines and can be voided); without them
// (lines = null) the totals stored when the invoice was recorded stand in.
export function invoiceRegister(invoices, lines = null) {
  const byInvoice = new Map();
  for (const r of lines || []) if (r.billed_to_bfs && r.invoice_id) (byInvoice.get(r.invoice_id) || byInvoice.set(r.invoice_id, []).get(r.invoice_id)).push(r);
  return liveInvoices(invoices)
    .filter((i) => i.kind === 'labor_billing')
    .map((i) => {
      const rows = byInvoice.get(i.id) || [];
      const t = lines ? lineTotals(rows) : { labor: i.amount || 0, fee: i.fee_amount || 0, count: i.line_count || 0 };
      return {
        id: i.id, number: i.invoice_number, date: i.invoice_date, customer: i.customer_name || '',
        months: [...new Set(rows.map((r) => r.invoice_month).filter(Boolean))].sort(),
        lineCount: t.count, labor: t.labor, fee: t.fee, status: invoiceStatus(i), paidDate: i.paid_date || null,
      };
    })
    .sort((a, b) => (a.status === 'paid') - (b.status === 'paid') || String(b.date || '').localeCompare(String(a.date || '')) || a.number.localeCompare(b.number));
}

export function openInvoiceTotals(register) {
  const open = register.filter((i) => i.status === 'open');
  return { count: open.length, labor: round(open.reduce((n, i) => n + i.labor, 0)) };
}

// Customer invoices on one job (deposit, progress, balance, other) and what is still owed.
export function jobInvoiceSummary(invoices, jobId) {
  const list = liveInvoices(invoices).filter((i) => i.job_id === jobId && i.kind !== 'labor_billing')
    .sort((a, b) => String(a.invoice_date).localeCompare(String(b.invoice_date)));
  const invoiced = round(list.reduce((n, i) => n + (Number(i.amount) || 0), 0));
  const paid = round(list.filter((i) => i.paid_date).reduce((n, i) => n + (Number(i.amount) || 0), 0));
  return { list, invoiced, paid, owed: round(invoiced - paid) };
}

// $0 lines the billing audit holds only to confirm the work was covered by the original
// install. Confirming one is an owner decision (manually_adjusted), which the audit preserves.
export function isCoveredZeroReview(row) {
  return !row.billed_to_bfs && row.fee_type !== 'profit_split' && !(computeLaborAmt(row) > 0)
    && /^Work was reported without a separate labor charge\./.test(String(row._billing_review || ''));
}
