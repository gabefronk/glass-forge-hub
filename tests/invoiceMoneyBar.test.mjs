import './support/register-src-alias.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

const { moneyBarSegments, needsDecision, isZeroToConfirm } = await import('../src/lib/invoiceMoneyBar.js');

const COVERED = 'Work was reported without a separate labor charge. Confirm it is covered by the original install, or record the additional hours/material rate or approved price.';
const line = (id, extra = {}) => {
  const row = { id, invoice_month: '2026-09', job_date: '2026-09-10', billable: true, fee_type: 'labor_pct', labor_amt: 100, fee_pct: 0.1, calendar_event_id: `ev-${id}`, ...extra };
  return { ...row, calendar_labor_amt: row.labor_amt };
};
const reports = new Map([['ev-a', 'ok'], ['ev-b', 'ok'], ['ev-c', 'ok'], ['ev-d', 'pending'], ['ev-e', 'ok']]);

test('each line lands in exactly one bucket and $0 confirmations leave Needs decision', () => {
  const rows = [
    line('a'),                                                         // ready
    line('b', { needs_review: true, pricing_review_reason: 'Hours unclear' }), // needs decision
    line('c', { labor_amt: 0, _billing_review: COVERED }),             // $0 to confirm
    line('d'),                                                         // waiting on report
    line('e', { billed_to_bfs: true }),                                // billed: not in play
  ];
  const segs = Object.fromEntries(moneyBarSegments(rows, reports, new Set(), []).map((s) => [s.key, s]));
  assert.deepEqual([segs.ready.count, segs.needs_review.count, segs.zero_confirm.count, segs.needs_report.count], [1, 1, 1, 1]);
  assert.deepEqual([segs.ready.labor, segs.ready.fee], [100, 10]);
  assert.equal(needsDecision(rows[2]), false);
  assert.equal(isZeroToConfirm(rows[2]), true);
});

test('superseded lines are not counted; invoice segments come from the register', () => {
  const rows = [line('a'), line('x')];
  const register = [{ status: 'open', labor: 500, fee: 50 }, { status: 'open', labor: 100, fee: 10 }, { status: 'paid', labor: 70, fee: 7 }];
  const segs = Object.fromEntries(moneyBarSegments(rows, new Map([['ev-a', 'ok'], ['ev-x', 'ok']]), new Set(['x']), register).map((s) => [s.key, s]));
  assert.equal(segs.ready.count, 1);
  assert.deepEqual([segs.invoices_open.count, segs.invoices_open.labor, segs.invoices_open.fee], [2, 600, 60]);
  assert.deepEqual([segs.invoices_paid.count, segs.invoices_paid.labor], [1, 70]);
});
