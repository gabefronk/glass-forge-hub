import { computeFeeAmt, computeLaborAmt } from './feeMath.js';

// Billing mirrors QuickBooks: lines are billed on a numbered invoice with a date, and the
// invoice is later paid. invoice_number/invoice_date record the QuickBooks invoice;
// paid_to_ya/paid_date record the payment received from BFS.
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
export const NO_INVOICE = '';

export function invoiceInputError({ number, date }) {
  const n = String(number || '').trim();
  if (!n) return 'Enter the QuickBooks invoice number.';
  if (n.length > 40) return 'Invoice number is too long.';
  if (!ISO_DAY.test(String(date || '')) || Number.isNaN(Date.parse(date))) return 'Enter the invoice date.';
  return '';
}

export function invoicePatch(rows, { number, date }) {
  const invoice_number = String(number).trim();
  return rows.map((r) => ({ id: r.id, billed_to_bfs: true, manually_adjusted: true, invoice_number, invoice_date: date }));
}

// Reopening a line takes it off its invoice and clears any payment recorded against it.
export function reopenPatch(row) {
  return { billed_to_bfs: false, invoice_number: null, invoice_date: null, paid_to_ya: false, paid_date: null };
}

export function paymentPatch(rows, number, date) {
  return rows
    .filter((r) => r.billed_to_bfs && (r.invoice_number || NO_INVOICE) === number)
    .map((r) => ({ id: r.id, paid_to_ya: !!date, paid_date: date || null }));
}

export function priorState(rows, keys) {
  return rows.map((r) => Object.fromEntries([['id', r.id], ...keys.map((k) => [k, r[k] ?? null])]));
}

// One entry per invoice across every month: open invoices first, newest first.
export function invoiceRegister(rows) {
  const groups = new Map();
  for (const r of rows) {
    if (!r.billed_to_bfs) continue;
    const number = r.invoice_number || NO_INVOICE;
    if (!groups.has(number)) groups.set(number, { number, date: null, months: new Set(), lines: [], labor: 0, fee: 0, paidLines: 0, paidDate: null });
    const g = groups.get(number);
    g.lines.push(r);
    if (r.invoice_month) g.months.add(r.invoice_month);
    if (r.invoice_date && (!g.date || r.invoice_date > g.date)) g.date = r.invoice_date;
    g.labor += computeLaborAmt(r) || 0;
    g.fee += computeFeeAmt(r) || 0;
    if (r.paid_to_ya) { g.paidLines += 1; if (r.paid_date && (!g.paidDate || r.paid_date > g.paidDate)) g.paidDate = r.paid_date; }
  }
  const round = (n) => Math.round(n * 100) / 100;
  return [...groups.values()]
    .map((g) => ({
      number: g.number,
      date: g.date,
      months: [...g.months].sort(),
      lineCount: g.lines.length,
      labor: round(g.labor),
      fee: round(g.fee),
      status: g.paidLines === 0 ? 'open' : g.paidLines === g.lines.length ? 'paid' : 'partial',
      paidDate: g.paidDate,
    }))
    .sort((a, b) => (a.status === 'paid') - (b.status === 'paid') || String(b.date || '').localeCompare(String(a.date || '')) || a.number.localeCompare(b.number));
}

export function openInvoiceTotals(register) {
  const open = register.filter((i) => i.status !== 'paid');
  return { count: open.length, labor: Math.round(open.reduce((n, i) => n + i.labor, 0) * 100) / 100 };
}

// $0 lines the billing audit holds only to confirm the work was covered by the original
// install. Confirming one is an owner decision (manually_adjusted), which the audit preserves.
export function isCoveredZeroReview(row) {
  return !row.billed_to_bfs && row.fee_type !== 'profit_split' && !(computeLaborAmt(row) > 0)
    && /^Work was reported without a separate labor charge\./.test(String(row._billing_review || ''));
}
