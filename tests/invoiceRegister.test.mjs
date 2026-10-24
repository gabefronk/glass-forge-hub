import test from 'node:test';
import assert from 'node:assert/strict';
import { invoiceInputError, invoicePatch, reopenPatch, paymentPatch, priorState, invoiceRegister, openInvoiceTotals, isCoveredZeroReview } from '../src/lib/invoiceRegister.js';

const line = (id, extra = {}) => ({ id, invoice_month: '2026-09', job_date: '2026-09-10', billable: true, fee_type: 'labor_pct', labor_amt: 100, fee_pct: 0.1, ...extra });

test('an invoice needs a QuickBooks number and a real date', () => {
  assert.match(invoiceInputError({ number: ' ', date: '2026-10-01' }), /invoice number/);
  assert.match(invoiceInputError({ number: '1042', date: '' }), /invoice date/);
  assert.match(invoiceInputError({ number: '1042', date: '2026-13-40' }), /invoice date/);
  assert.match(invoiceInputError({ number: 'x'.repeat(41), date: '2026-10-01' }), /too long/);
  assert.equal(invoiceInputError({ number: ' 1042 ', date: '2026-10-01' }), '');
});

test('billing writes the trimmed invoice number and date on every line', () => {
  assert.deepEqual(invoicePatch([line('a'), line('b')], { number: ' 1042 ', date: '2026-10-01' }), [
    { id: 'a', billed_to_bfs: true, manually_adjusted: true, invoice_number: '1042', invoice_date: '2026-10-01' },
    { id: 'b', billed_to_bfs: true, manually_adjusted: true, invoice_number: '1042', invoice_date: '2026-10-01' },
  ]);
});

test('reopening clears the invoice and any recorded payment', () => {
  assert.deepEqual(reopenPatch(), { billed_to_bfs: false, invoice_number: null, invoice_date: null, paid_to_ya: false, paid_date: null });
});

test('a payment touches only the billed lines on that invoice, and can be undone', () => {
  const rows = [line('a', { billed_to_bfs: true, invoice_number: '1042' }), line('b', { billed_to_bfs: true, invoice_number: '1043' }), line('c', { invoice_number: '1042' })];
  assert.deepEqual(paymentPatch(rows, '1042', '2026-10-20'), [{ id: 'a', paid_to_ya: true, paid_date: '2026-10-20' }]);
  assert.deepEqual(paymentPatch(rows, '1042', null), [{ id: 'a', paid_to_ya: false, paid_date: null }]);
  // Lines billed before invoice numbers existed group under the empty number.
  assert.deepEqual(paymentPatch([line('d', { billed_to_bfs: true })], '', '2026-10-20'), [{ id: 'd', paid_to_ya: true, paid_date: '2026-10-20' }]);
});

test('prior state captures missing fields as null so undo clears them', () => {
  assert.deepEqual(priorState([line('a')], ['billed_to_bfs', 'invoice_number']), [{ id: 'a', billed_to_bfs: null, invoice_number: null }]);
});

test('the register groups billed lines by invoice across months, open invoices first', () => {
  const rows = [
    line('a', { billed_to_bfs: true, invoice_number: '1042', invoice_date: '2026-10-01', labor_amt: 300 }),
    line('b', { billed_to_bfs: true, invoice_number: '1042', invoice_date: '2026-10-01', invoice_month: '2026-10', labor_amt: 200 }),
    line('c', { billed_to_bfs: true, invoice_number: '1050', invoice_date: '2026-11-01', paid_to_ya: true, paid_date: '2026-11-15' }),
    line('d', { billed_to_bfs: true, invoice_number: '1051', invoice_date: '2026-11-02', paid_to_ya: true, paid_date: '2026-11-20' }),
    line('e', { billed_to_bfs: true, invoice_number: '1051', invoice_date: '2026-11-02' }),
    line('f'),
  ];
  const register = invoiceRegister(rows);
  assert.deepEqual(register.map((i) => [i.number, i.status]), [['1051', 'partial'], ['1042', 'open'], ['1050', 'paid']]);
  const inv = register.find((i) => i.number === '1042');
  assert.deepEqual(inv.months, ['2026-09', '2026-10']);
  assert.equal(inv.lineCount, 2);
  assert.equal(inv.labor, 500);
  assert.equal(inv.fee, 50);
  assert.equal(register.find((i) => i.number === '1050').paidDate, '2026-11-15');
  assert.deepEqual(openInvoiceTotals(register), { count: 2, labor: 700 });
});

test('only $0 covered-work audit holds qualify for the bulk "covered, no charge" action', () => {
  const covered = '[audit] '.slice(0, 0) + 'Work was reported without a separate labor charge. Confirm it is covered by the original install, or record the additional hours/material rate or approved price.';
  assert.equal(isCoveredZeroReview(line('a', { labor_amt: 0, _billing_review: covered })), true);
  assert.equal(isCoveredZeroReview(line('b', { labor_amt: 150, _billing_review: covered })), false, 'priced lines need a real decision');
  assert.equal(isCoveredZeroReview(line('c', { labor_amt: 0, _billing_review: 'Service work has no labor amount or explicit no-charge decision.' })), false, 'service work may be billable');
  assert.equal(isCoveredZeroReview(line('d', { labor_amt: 0, fee_type: 'profit_split', _billing_review: covered })), false);
  assert.equal(isCoveredZeroReview(line('e', { labor_amt: 0, billed_to_bfs: true, _billing_review: covered })), false);
});
