import { computeFeeAmt, computeLaborAmt, isFutureRow } from './feeMath.js';
import { isReady, isMatchBlocked, isReportBlocked } from './invoicingFilters.js';
import { isCoveredZeroReview } from './invoiceRegister.js';

// One set of buckets for the Invoicing money bar, the filter chips and the line list,
// so their counts always agree. A line is in at most one of: waiting on a report,
// needs a decision (money at stake), $0 to confirm, ready to invoice. Billed lines
// sit on invoices (open or paid).
const round = (n) => Math.round(n * 100) / 100;
const inPlay = (r) => !(r.customer_collection_state && r.customer_collection_state !== 'paid') && r.billable && !r.billed_to_bfs;

export const isZeroToConfirm = (r) => inPlay(r) && isCoveredZeroReview(r);
export const needsDecision = (r) => inPlay(r) && isMatchBlocked(r) && !isCoveredZeroReview(r);
export const waitingOnReport = (r, reports) => inPlay(r) && !isFutureRow(r) && !isMatchBlocked(r) && isReportBlocked(r, reports);

const sum = (rows) => ({ count: rows.length, labor: round(rows.reduce((n, r) => n + (computeLaborAmt(r) || 0), 0)), fee: round(rows.reduce((n, r) => n + (computeFeeAmt(r) || 0), 0)) });

// One status per line in the same words as the Show filter, from the same predicates, so
// the Status column never disagrees with a filter count. Billed lines are Invoiced until
// paid.
export const STATUS_LABELS = {
  ready: 'Ready', needs_review: 'Needs decision', zero_confirm: '$0 to confirm', needs_report: 'Waiting on report',
  invoiced: 'Invoiced', paid: 'Paid', scheduled: 'Scheduled', none: '',
};
export function lineStatus(r, reports, superseded) {
  if (r.billed_to_bfs) return r.paid_to_ya || r.paid_date ? 'paid' : 'invoiced';
  if (isReady(r, reports, superseded)) return 'ready';
  if (needsDecision(r)) return 'needs_review';
  if (isZeroToConfirm(r)) return 'zero_confirm';
  if (waitingOnReport(r, reports)) return 'needs_report';
  if (isFutureRow(r)) return 'scheduled';
  return 'none';
}

// The slim money strip (Oct 24 declutter): Ready to invoice, Needs attention (waiting on
// a report + needs a decision + $0 to confirm, one count) and Invoiced, unpaid (open
// invoices). Built from moneyBarSegments so it always ties to the Show counts.
export function moneyStrip(segments = []) {
  const by = new Map(segments.map((s) => [s.key, s]));
  const pick = (k) => by.get(k) || { count: 0, labor: 0, fee: 0 };
  const attention = ['needs_report', 'needs_review', 'zero_confirm'].map(pick);
  const add = (list, f) => round(list.reduce((n, s) => n + (s[f] || 0), 0));
  return {
    ready: pick('ready'),
    attention: { count: attention.reduce((n, s) => n + s.count, 0), labor: add(attention, 'labor'), fee: add(attention, 'fee') },
    unpaid: pick('invoices_open'),
  };
}

// rows: the month's billing rows (display copies); register: invoiceRegister output.
export function moneyBarSegments(rows, reports, superseded, register = []) {
  const shown = rows.filter((r) => !superseded.has(r.id));
  const open = register.filter((i) => i.status === 'open');
  const paid = register.filter((i) => i.status === 'paid');
  const fromInvoices = (list) => ({ count: list.length, labor: round(list.reduce((n, i) => n + i.labor, 0)), fee: round(list.reduce((n, i) => n + i.fee, 0)) });
  return [
    { key: 'needs_report', label: 'Waiting on report', tone: 'muted', ...sum(shown.filter((r) => waitingOnReport(r, reports))) },
    { key: 'needs_review', label: 'Needs decision', tone: 'amber', ...sum(shown.filter(needsDecision)) },
    { key: 'zero_confirm', label: '$0 to confirm', tone: 'muted', ...sum(shown.filter(isZeroToConfirm)) },
    { key: 'ready', label: 'Ready to invoice', tone: 'teal', primary: true, ...sum(shown.filter((r) => isReady(r, reports, superseded))) },
    { key: 'invoices_open', label: 'Invoiced · open', tone: 'ink', invoices: true, ...fromInvoices(open) },
    { key: 'invoices_paid', label: 'Paid', tone: 'green', invoices: true, ...fromInvoices(paid) },
  ];
}
