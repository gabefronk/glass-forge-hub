// QuickBooks figures for the Company overview (Gabe, Oct 26): the Hub has no QuickBooks
// connection, so these are read by hand from YA Windows & Doors' QuickBooks Online, READ ONLY,
// and kept here as a dated snapshot. Nothing is posted or changed in QuickBooks. Refresh by
// re-reading the same reports and replacing the numbers (and the readAt stamps).

// Profit and Loss, Jan 1 – Oct 26, 2026, both accounting methods, same report and period.
export const BOOKS_PL = {
  source: 'QuickBooks Online · Profit and Loss report',
  period: { from: '2026-01-01', to: '2026-10-26' },
  readAt: { accrual: 'Oct 26, 2026 6:33 AM MT', cash: 'Oct 26, 2026 6:34 AM MT' },
  // [label, accrual, cash, kind]: kind 'income' | 'expense' | 'total' | 'net'
  rows: [
    ['Sales of Product Income', 1825.78, 1825.78, 'income'],
    ['Services', 123925.52, 106742.99, 'income'],
    ['Total income', 125751.30, 108568.77, 'total'],
    ['Contract labor', 1.00, 1.00, 'expense'],
    ['Insurance', 1800.29, 1800.29, 'expense'],
    ['Bank and credit card fees', 47.72, 47.72, 'expense'],
    ['QuickBooks Payments fees', 639.45, 639.45, 'expense'],
    ['Taxes and licenses', 59.00, 59.00, 'expense'],
    ['Payroll taxes', 13584.00, 13584.00, 'expense'],
    ['Total expenses', 16131.46, 16131.46, 'total'],
    ['Net income', 109619.84, 92437.31, 'net'],
  ],
  // Why the books view is incomplete (seen in QuickBooks the same day, read only).
  coverage: [
    'Of 596 Mountain America bank-feed lines, 591 (Jan 1 – Oct 23) are still pending: crew pay, suppliers, Amex, loans and most deposits are not in the books.',
    'Israel\'s payroll ("DD Israel Yedra`" entries) is booked to the Cash account, a balance-sheet account, so no payroll cost appears in this P&L.',
    'The books are not reconciled to Mountain America statements, and $47,558.21 of receipts sit in Undeposited funds.',
  ],
};

// QuickBooks sales (invoices and sales receipts) that belong to a signed Purchasing job, as read
// on Oct 26. jobId is set only where the evidence ties the sale to the job (evidence says how).
// inBank: the payment's deposit is inside the Hub's bank lines (Jan 1 – Oct 23);
// linked: that bank line is already matched to the job in the Hub.
export const QBO_SALES = [
  { ref: 'Sales receipt Aug 12', date: '2026-08-12', customer: 'Jeff Thomas', jobId: '6a86d4ada97c9db1585b615e', amount: 31894.37, open: 0,
    evidence: 'half of the Thomas sale ($63,788.74)', deposit: { inBank: true, linked: true } },
  { ref: 'Invoice 1002', date: '2026-09-25', customer: 'Justin Hutchins', jobId: '6ab65a0af4c7aab207863abb', amount: 1474.71, open: 0,
    evidence: 'Justin Hutchins is the AV24 customer', deposit: { inBank: true, linked: true } },
  { ref: 'Invoice 1004', date: '2026-10-13', customer: 'Newco', jobId: '6acf4cd0773e4f5931961a1c', amount: 12170.78, open: 0,
    evidence: 'half of the Forte sale ($24,341.56)', deposit: { inBank: true, linked: true } },
  { ref: 'Invoice 1010', date: '2026-10-22', customer: 'Newco', jobId: '6ac68d24023169bbb1c62451', amount: 870.93, open: 0,
    evidence: 'half of the Phil Chadwick sale ($1,741.86)', deposit: { inBank: true, linked: false, note: 'inside the Oct 23 $1,313.87 Intuit deposit (with Agren $442.94)' } },
  { ref: 'Invoice 1011', date: '2026-10-23', customer: 'Becky Clyde and Randy Clyde', jobId: '6a99348066c3ce994b416850', amount: 29659.26, open: 0,
    evidence: 'half of the Becky Retro sale ($59,318.51)', deposit: { inBank: false, note: 'paid Oct 23; QuickBooks deposit Oct 25, after the bank lines end (Oct 23)' } },
  { ref: 'Invoice 1013', date: '2026-10-25', customer: 'Justin Hutchins', jobId: '6ab65a0af4c7aab207863abb', amount: 931.89, open: 931.89,
    evidence: 'memo "AV24 – Aria-Belle … final payment"', deposit: null },
];

// Open QuickBooks invoices not tied to any Hub job (shown so nothing owed is hidden).
export const QBO_UNASSIGNED_OPEN = [
  { ref: 'Invoice 1005', date: '2026-10-14', customer: 'Nisha Harper', amount: 16250.64, open: 16250.64, note: 'overdue; no Hub job found for this customer' },
];
