// Purchasing jobs (sold outside BFS): their Invoicing lines are held until the job is Paid,
// then one 50/50 profit-split line is written from the Purchasing row.
import './support/register-src-alias.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

const { planSplitLines, isHeldForPurchasing, splitFigures, purchasingJobIds } = await import('../src/lib/purchasingSplit.js');

const job = (over = {}) => ({ id: 'j1', canonical_name: 'Hidden Hallow Lot 509', manual_customer_total: 369.05, ...over });
const po = { id: 'p1', job_id: 'j1', po_number: 'YA-0016', status: 'ordered', amount_dealer: 72.02 };
const data = (over = {}) => ({ jobs: [job(over)], budgets: [], purchase_orders: [po], vendor_orders: [] });

test('a Purchasing job is a job with a PO, budget or supplier order', () => {
  assert.deepEqual([...purchasingJobIds(data())], ['j1']);
  assert.equal(purchasingJobIds({ jobs: [job()] }).size, 0);
});

test('its own Invoicing lines are held; billed lines and the split line are not', () => {
  const ids = new Set(['j1']);
  assert.equal(isHeldForPurchasing({ job_id: 'j1', labor_amt: 0 }, ids), true);
  assert.equal(isHeldForPurchasing({ job_id: 'j1', billed_to_bfs: true }, ids), false);
  assert.equal(isHeldForPurchasing({ job_id: 'j1', purchasing_split_job_id: 'j1' }, ids), false);
  assert.equal(isHeldForPurchasing({ job_id: 'other' }, ids), false);
});

test('no split line until the job is Paid', () => {
  for (const stage of [null, 'sent_to_customer', 'ordered', 'installed', 'waiting_on_payment']) {
    const plan = planSplitLines(data({ payment_status: stage }), []);
    assert.equal(plan.creates.length, 0, String(stage));
  }
});

test('once Paid, one line: half of sale less windows less labor & material, dated the paid day', () => {
  const d = data({ payment_status: 'paid', payment_status_at: '2026-10-25T18:16:02.089Z' });
  const f = splitFigures('j1', d);
  assert.ok(f, 'the Purchasing row has sale and cost');
  const plan = planSplitLines(d, [], { today: '2026-10-26' });
  assert.equal(plan.creates.length, 1);
  const line = plan.creates[0];
  assert.equal(line.fee_type, 'profit_split');
  assert.equal(line.split_pct, 0.5);
  assert.equal(line.purchasing_split_job_id, 'j1');
  assert.equal(line.job_date, '2026-10-25');
  assert.equal(line.invoice_month, '2026-10');
  assert.equal(line.fee_amt, Math.round((line.sale_price - line.cost) * 50) / 100);
  assert.equal(line.billable, true);
  assert.equal(line.needs_review, false);
});

test('a closed paid month moves the new line to the current month', () => {
  const d = data({ payment_status: 'paid', payment_status_at: '2026-09-30T18:00:00Z' });
  const [line] = planSplitLines(d, [], { today: '2026-10-26', closedMonths: ['2026-09'] }).creates;
  assert.equal(line.invoice_month, '2026-10');
});

test('the line follows the Purchasing row until billed; duplicates and un-paid jobs are cleaned up', () => {
  const d = data({ payment_status: 'paid', payment_status_at: '2026-10-25T18:00:00Z' });
  const [fresh] = planSplitLines(d, []).creates;
  const stale = { ...fresh, id: 's1', created_date: '2026-10-25', fee_amt: 1 };
  const dup = { ...fresh, id: 's2', created_date: '2026-10-26' };
  const plan = planSplitLines(d, [stale, dup]);
  assert.equal(plan.creates.length, 0);
  assert.deepEqual(plan.updates.map((u) => [u.id, u.fee_amt]), [['s1', fresh.fee_amt]]);
  assert.deepEqual(plan.deletes, ['s2']);

  const billed = { ...stale, billed_to_bfs: true };
  assert.deepEqual(planSplitLines(d, [billed]).updates, [], 'a billed line is never changed');

  const unpaid = planSplitLines(data({ payment_status: 'installed' }), [stale]);
  assert.deepEqual(unpaid.deletes, ['s1'], 'an unbilled split goes away if the job is no longer Paid');
  assert.deepEqual(planSplitLines(data({ payment_status: 'installed' }), [billed]).deletes, []);
});

test('a Paid job with no cost or sale yet gets a $0 line held for review', () => {
  const d = { jobs: [{ id: 'j2', canonical_name: 'Bare', payment_status: 'paid', payment_status_at: '2026-10-25T18:00:00Z' }], budgets: [], purchase_orders: [{ id: 'p2', job_id: 'j2', po_number: 'YA-9', status: 'ordered', amount_dealer: null }], vendor_orders: [] };
  const [line] = planSplitLines(d, []).creates;
  assert.equal(line.fee_amt, 0);
  assert.equal(line.needs_review, true);
});
