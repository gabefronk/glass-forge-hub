import test from 'node:test';
import assert from 'node:assert/strict';
import { moneyStatesForJob, hasMoneyStates } from '../src/lib/purchasingMoneyStates.js';
import * as states from '../src/lib/purchasingMoneyStates.js';

const JOB = 'job-1';

const readyBudget = (over = {}) => ({
  id: 'b1', job_id: JOB, budget_usage: 'active', numbers_reviewed_at: '2026-10-01',
  inputs: { material_true_cost: 1000, labor_cost_sub_pay: 500, additional_install_material: 0, additional_equipment: 0, actual_total_sell: 2500, labor_sell_price: 800 },
  ...over,
});
const po = (over = {}) => ({ id: 'po1', job_id: JOB, status: 'ordered', amount_dealer: 1100, amount_customer: 2200, ...over });
const vo = (over = {}) => ({ id: 'vo1', job_id: JOB, status: 'ordered', amount: 1150, ...over });

test('estimated is the reviewed budget cost rollup; withheld when unreviewed', () => {
  const ready = moneyStatesForJob(JOB, { budgets: [readyBudget()] });
  assert.equal(ready.estimated.status, 'ready');
  assert.ok(typeof ready.estimated.value === 'number' && ready.estimated.value > 0);

  const unreviewed = moneyStatesForJob(JOB, { budgets: [readyBudget({ numbers_reviewed_at: null })] });
  assert.equal(unreviewed.estimated.value, null);
  assert.notEqual(unreviewed.estimated.status, 'ready');
});

test('committed sums open PO dealer amounts and excludes cancelled POs', () => {
  const s = moneyStatesForJob(JOB, {
    purchaseOrders: [po(), po({ id: 'po2', amount_dealer: 200 }), po({ id: 'po3', status: 'cancelled', amount_dealer: 9999 })],
  });
  assert.equal(s.committed.value, 1300);
  assert.equal(s.committed.records, 2);
});

test('incurred actual is never inferred from status - it stays unknown; orders are their own state', () => {
  const s = moneyStatesForJob(JOB, {
    vendorOrders: [vo({ status: 'eta_set', amount: 500 }), vo({ id: 'vo2', status: 'ordered', amount: 700 })],
  });
  assert.equal(s.incurred.value, null);
  assert.equal(s.incurred.tracked, false);
  assert.equal(s.ordered.value, 1200);
});

test('suppliers are paid up front: no paid, payment-requested or reconcile state', () => {
  const s = moneyStatesForJob(JOB, { vendorOrders: [vo({ status: 'paid', amount: 300, paid_at: '2026-10-20' })] });
  assert.ok(!('paid' in s) && !('paymentRequested' in s));
  assert.equal(states.isOrderPaid, undefined);
  assert.equal(states.isPaymentRequested, undefined);
  assert.equal(states.paymentEvidence, undefined);
});

test('vendor orders of a cancelled PO are excluded everywhere', () => {
  const s = moneyStatesForJob(JOB, {
    purchaseOrders: [po({ id: 'po9', status: 'cancelled' })],
    vendorOrders: [vo({ purchase_order_id: 'po9', status: 'ordered', amount: 400 })],
  });
  assert.equal(s.ordered.value, null);
  assert.equal(hasMoneyStates(s), false);
});

test('missing amounts never fabricate a zero total; partial coverage is flagged', () => {
  const s = moneyStatesForJob(JOB, {
    purchaseOrders: [po({ amount_dealer: null }), po({ id: 'po2', amount_dealer: 100 })],
    vendorOrders: [vo({ status: 'ordered', amount: null })],
  });
  assert.equal(s.committed.value, 100);
  assert.equal(s.committed.partial, true);
  assert.equal(s.ordered.value, null);
  assert.equal(s.ordered.records, 1);
  assert.equal(s.incurred.value, null);
});

test('a real 0 amount stays 0, not a dash', () => {
  const s = moneyStatesForJob(JOB, { purchaseOrders: [po({ amount_dealer: 0 })] });
  assert.equal(s.committed.value, 0);
});

test('records from other jobs never leak in', () => {
  const s = moneyStatesForJob(JOB, {
    budgets: [readyBudget({ id: 'b2', job_id: 'job-2' })],
    purchaseOrders: [po({ job_id: 'job-2' })],
    vendorOrders: [vo({ job_id: 'job-2', status: 'paid', amount: 5, paid_at: '2026-10-20' })],
  });
  assert.equal(hasMoneyStates(s), false);
});
