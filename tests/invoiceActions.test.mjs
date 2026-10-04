import test from 'node:test';
import assert from 'node:assert/strict';
import { selectedReadyInvoiceRows, selectedLaborFeeRows, deleteInvoiceRows } from '../src/lib/invoiceActions.js';
const base = { invoice_month: '2026-09', job_id: 'job', job_date: '2026-09-01', billable: true, labor_amt: 100 };
test('selected billing respects readiness, annotations, job and month; returns raw rows', () => {
  const rows = [
    { ...base, id: 'ok' }, { ...base, id: 'held', needs_review: true },
    { ...base, id: 'report', calendar_event_id: 'missing' },
    { ...base, id: 'future', job_date: '2099-01-01' },
    { ...base, id: 'billed', billed_to_bfs: true },
    { ...base, id: 'off', billable: false }, { ...base, id: 'duplicate' },
    { ...base, id: 'companion' }, { ...base, id: 'otherjob', job_id: 'other' },
    { ...base, id: 'othermonth', invoice_month: '2026-08' },
  ];
  const displayed = rows.map(row => row.id === 'companion' ? { ...row, _companion_review: 'Possible duplicate' } : row);
  const result = selectedReadyInvoiceRows(rows, displayed, new Set(rows.map(r => r.id)), '2026-09', 'job', new Map([['missing', 'missing']]), new Set(['duplicate']));
  assert.deepEqual(result.map(row => row.id), ['ok']);
  assert.equal(result[0], rows[0]);
});
test('labor percentage editing excludes profit splits and other job scopes', () => {
  const rows = [{ ...base, id: 'labor' }, { ...base, id: 'split', fee_type: 'profit_split' }, { ...base, id: 'other', job_id: 'other' }];
  assert.deepEqual(selectedLaborFeeRows(rows, new Set(rows.map(r => r.id)), '2026-09', 'job').map(r => r.id), ['labor']);
});
test('partial deletion reports only successful deletes and retains failed rows', async () => {
  const rows = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
  const result = await deleteInvoiceRows(rows, id => { if (id === 'b') throw new Error('failed'); return Promise.resolve(); });
  assert.deepEqual(result.deleted.map(r => r.id), ['a', 'c']);
  assert.deepEqual(result.failed.map(r => r.id), ['b']);
});
