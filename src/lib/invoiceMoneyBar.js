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
