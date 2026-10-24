import test from 'node:test';
import assert from 'node:assert/strict';
import {
  invoiceInputError, laborInvoicePlan, linePatches, reopenPatch, paymentLinePatches, priorState,
  invoiceRegister, openInvoiceTotals, jobInvoiceSummary, isCoveredZeroReview, findInvoice, kindLabel,
} from '../src/lib/invoiceRegister.js';

// Labor comes from the calendar amount, as computeLaborAmt reads it for unadjusted lines.
const line = (id, extra = {}) => {
  const row = { id, invoice_month: '2026-09', job_date: '2026-09-10', billable: true, fee_type: 'labor_pct', labor_amt: 100, fee_pct: 0.1, ...extra };
  return { ...row, calendar_labor_amt: row.labor_amt };
};

test('an invoice needs a QuickBooks number, a real date, and an amount when asked', () => {
  assert.match(invoiceInputError({ number: ' ', date: '2026-10-01' }), /invoice number/);
  assert.match(invoiceInputError({ number: '1042', date: '2026-13-40' }), /invoice date/);
  assert.match(invoiceInputError({ number: 'x'.repeat(41), date: '2026-10-01' }), /too long/);
  assert.match(invoiceInputError({ number: '1042', date: '2026-10-01', amount: 0, requireAmount: true }), /amount/);
  assert.equal(invoiceInputError({ number: ' 1042 ', date: '2026-10-01' }), '');
});

test('labor billing creates a new invoice with the line totals', () => {
  const plan = laborInvoicePlan([line('a', { labor_amt: 300 }), line('b', { labor_amt: 200 })], { number: ' 1042 ', date: '2026-10-01' }, []);
  assert.deepEqual(plan.create, { invoice_number: '1042', invoice_date: '2026-10-01', kind: 'labor_billing', customer_name: 'BFS', amount: 500, fee_amount: 50, line_count: 2 });
});

test('billing more lines on an existing number grows that invoice instead of duplicating it', () => {
  const invoices = [{ id: 'i1', invoice_number: '1042', kind: 'labor_billing', amount: 500, fee_amount: 50, line_count: 2 }];
  const plan = laborInvoicePlan([line('c', { labor_amt: 75 })], { number: '1042', date: '2026-10-05' }, invoices);
  assert.equal(plan.existing.id, 'i1');
  assert.deepEqual(plan.update, { amount: 575, fee_amount: 57.5, line_count: 3 });
});

test('a customer invoice number cannot be reused for labor billing; voided numbers are free', () => {
  const invoices = [{ id: 'd1', invoice_number: '2001', kind: 'deposit' }, { id: 'v1', invoice_number: '2002', kind: 'labor_billing', voided_at: '2026-10-02T00:00:00Z' }];
  assert.match(laborInvoicePlan([line('a')], { number: '2001', date: '2026-10-01' }, invoices).error, /deposit invoice/);
  assert.ok(laborInvoicePlan([line('a')], { number: '2002', date: '2026-10-01' }, invoices).create);
  assert.equal(findInvoice(invoices, '2002'), null);
});

test('lines link to the invoice and inherit its payment', () => {
  const inv = { id: 'i1', invoice_number: '1042', invoice_date: '2026-10-01', paid_date: null };
  assert.deepEqual(linePatches([line('a')], inv), [{ id: 'a', billed_to_bfs: true, manually_adjusted: true, invoice_id: 'i1', invoice_number: '1042', invoice_date: '2026-10-01', paid_to_ya: false, paid_date: null }]);
  assert.equal(linePatches([line('a')], { ...inv, paid_date: '2026-10-20' })[0].paid_to_ya, true);
});

test('reopening clears the invoice link and any payment', () => {
  assert.deepEqual(reopenPatch(), { billed_to_bfs: false, invoice_id: null, invoice_number: null, invoice_date: null, paid_to_ya: false, paid_date: null });
});

test('a payment reaches only the billed lines on that invoice, and can be undone', () => {
  const rows = [line('a', { billed_to_bfs: true, invoice_id: 'i1' }), line('b', { billed_to_bfs: true, invoice_id: 'i2' }), line('c', { invoice_id: 'i1' })];
  assert.deepEqual(paymentLinePatches(rows, 'i1', '2026-10-20'), [{ id: 'a', paid_to_ya: true, paid_date: '2026-10-20' }]);
  assert.deepEqual(paymentLinePatches(rows, 'i1', null), [{ id: 'a', paid_to_ya: false, paid_date: null }]);
});

test('prior state captures missing fields as null so undo clears them', () => {
  assert.deepEqual(priorState([line('a')], ['billed_to_bfs', 'invoice_id']), [{ id: 'a', billed_to_bfs: null, invoice_id: null }]);
});

test('the register lists labor billing invoices with live line totals, open first', () => {
  const invoices = [
    { id: 'i1', invoice_number: '1042', invoice_date: '2026-10-01', kind: 'labor_billing', amount: 999 },
    { id: 'i2', invoice_number: '1050', invoice_date: '2026-11-01', kind: 'labor_billing', paid_date: '2026-11-15', amount: 100, fee_amount: 10, line_count: 1 },
    { id: 'i3', invoice_number: '1051', invoice_date: '2026-11-02', kind: 'labor_billing', voided_at: '2026-11-03T00:00:00Z' },
    { id: 'd1', invoice_number: '2001', invoice_date: '2026-10-03', kind: 'deposit', job_id: 'j1', amount: 5000 },
  ];
  const lines = [
    line('a', { billed_to_bfs: true, invoice_id: 'i1', labor_amt: 300 }),
    line('b', { billed_to_bfs: true, invoice_id: 'i1', invoice_month: '2026-10', labor_amt: 200 }),
  ];
  const register = invoiceRegister(invoices, lines);
  assert.deepEqual(register.map((i) => [i.number, i.status]), [['1042', 'open'], ['1050', 'paid']]);
  assert.deepEqual(register[0].months, ['2026-09', '2026-10']);
  assert.equal(register[0].labor, 500, 'live lines win over the stored total');
  assert.equal(register[1].lineCount, 0, 'an invoice whose lines were reopened shows 0 lines');
  assert.deepEqual(openInvoiceTotals(register), { count: 1, labor: 500 });
  assert.equal(invoiceRegister(invoices).find((i) => i.number === '1050').labor, 100, 'stored totals stand in when lines are not loaded');
});

test('a job shows its customer invoices and what is still owed', () => {
  const invoices = [
    { id: 'd1', invoice_number: '2001', invoice_date: '2026-10-03', kind: 'deposit', job_id: 'j1', amount: 5000, paid_date: '2026-10-05' },
    { id: 'b1', invoice_number: '2010', invoice_date: '2026-11-01', kind: 'balance', job_id: 'j1', amount: 5250.5 },
    { id: 'x1', invoice_number: '2011', invoice_date: '2026-11-01', kind: 'balance', job_id: 'j2', amount: 100 },
    { id: 'v1', invoice_number: '2012', invoice_date: '2026-11-01', kind: 'other', job_id: 'j1', amount: 999, voided_at: '2026-11-02T00:00:00Z' },
  ];
  const s = jobInvoiceSummary(invoices, 'j1');
  assert.deepEqual(s.list.map((i) => i.id), ['d1', 'b1']);
  assert.deepEqual([s.invoiced, s.paid, s.owed], [10250.5, 5000, 5250.5]);
  assert.equal(kindLabel('deposit'), 'Deposit');
  assert.equal(kindLabel('labor_billing'), 'Labor billing');
});

test('only $0 covered-work audit holds qualify for the bulk "covered, no charge" action', () => {
  const covered = 'Work was reported without a separate labor charge. Confirm it is covered by the original install, or record the additional hours/material rate or approved price.';
  assert.equal(isCoveredZeroReview(line('a', { labor_amt: 0, _billing_review: covered })), true);
  assert.equal(isCoveredZeroReview(line('b', { labor_amt: 150, _billing_review: covered })), false, 'priced lines need a real decision');
  assert.equal(isCoveredZeroReview(line('c', { labor_amt: 0, _billing_review: 'Service work has no labor amount or explicit no-charge decision.' })), false, 'service work may be billable');
  assert.equal(isCoveredZeroReview(line('d', { labor_amt: 0, fee_type: 'profit_split', _billing_review: covered })), false);
  assert.equal(isCoveredZeroReview(line('e', { labor_amt: 0, billed_to_bfs: true, _billing_review: covered })), false);
});
