// The job page money view (QuickBooks Projects style): the estimate column is the
// Purchasing row, the actual column is what has been recorded against the job.
import './support/register-src-alias.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

const { jobProject, orderedCost } = await import('../src/lib/jobProject.js');
const { jobMoneyHeadline } = await import('../src/lib/jobMoneyPanel.js');

const job = { id: 'j1', canonical_name: 'Perry Res', payment_status: 'half_down' };
const po = { id: 'po1', job_id: 'j1', po_number: 'YA-0010', status: 'ordered', amount_dealer: 1000, budget_id: 'b1' };
// Job money lives on the budget: sale 2000, labor 200, the cost comes from its PO.
const budget = { id: 'b1', job_id: 'j1', budget_usage: 'included', numbers_reviewed_at: '2026-10-24', inputs: { material_true_cost: null, labor_cost_sub_pay: 200, actual_total_sell: 2000 } };
const base = { jobs: [job], budgets: [budget], purchaseOrders: [po], today: '2026-10-24' };
const row = (p, key) => p.rows.find((r) => r.key === key);

test('the estimate column is the job headline, so it matches the Purchasing row', () => {
  const p = jobProject('j1', [], base);
  const h = jobMoneyHeadline('j1', [], base);
  assert.equal(row(p, 'income').estimate, h.sale);
  assert.equal(row(p, 'windows').estimate, h.cost);
  assert.equal(row(p, 'labor').estimate, h.laborMaterial);
  assert.equal(row(p, 'profit').estimate, h.profit);
  assert.equal(row(p, 'cost').estimate, 1200);
  assert.ok(Math.abs(p.margin.estimate - 0.4) < 1e-9);
});

test('supplier cost so far is the PO amount as entered; there are no payables', () => {
  const p = jobProject('j1', [], base);
  assert.equal(row(p, 'windows').actual, 1000);
  assert.ok(!('weOwe' in p), 'suppliers are paid up front');
});

test('a PO with no amount falls back to its supplier orders, and orders with no PO count on their own', () => {
  const c = orderedCost('j1', {
    purchase_orders: [{ id: 'po2', job_id: 'j1', status: 'ordered', amount_dealer: null }],
    vendor_orders: [
      { id: 'o1', job_id: 'j1', purchase_order_id: 'po2', amount: 500, status: 'paid' },
      { id: 'o2', job_id: 'j1', amount: 100, order_number: '09-1', status: 'ordered' },
    ],
  });
  assert.deepEqual(c, { value: 600, partial: false });
});

test('cancelled POs and their orders are left out; an amount-less PO makes the figure partial', () => {
  const c = orderedCost('j1', {
    purchase_orders: [
      { id: 'x', job_id: 'j1', status: 'cancelled', amount_dealer: 900 },
      { id: 'y', job_id: 'j1', status: 'issued', amount_dealer: null },
      { id: 'z', job_id: 'j1', status: 'issued', amount_dealer: 100 },
    ],
    vendor_orders: [{ id: 'o', job_id: 'j1', purchase_order_id: 'x', amount: 900 }],
  });
  assert.deepEqual(c, { value: 100, partial: true });
  assert.deepEqual(orderedCost('j1', { purchase_orders: [], vendor_orders: [] }), { value: null, partial: false });
});

test('no customer invoices: income actual is blank and customer owes follows the payment stage', () => {
  const p = jobProject('j1', [], base);
  assert.equal(row(p, 'income').actual, null);
  assert.equal(p.invoiced, 0);
  assert.equal(p.customerOwes, 1000, 'half down owes half of the sale');
  assert.equal(p.customerOwesFrom, 'stage');
});

test('customer invoices drive income, received and what the customer still owes', () => {
  const invoices = [
    { id: 'i1', job_id: 'j1', kind: 'deposit', invoice_number: '101', invoice_date: '2026-09-01', amount: 1000, paid_date: '2026-09-03' },
    { id: 'i2', job_id: 'dup', kind: 'progress', invoice_number: '102', invoice_date: '2026-10-01', amount: 600 },
    { id: 'i3', job_id: 'j1', kind: 'balance', invoice_number: '103', invoice_date: '2026-10-02', amount: 400, voided_at: '2026-10-03T00:00:00Z' },
    { id: 'lb', kind: 'labor_billing', invoice_number: '104', invoice_date: '2026-10-02', amount: 9999 },
  ];
  const p = jobProject('j1', ['dup'], { ...base, invoices });
  assert.equal(p.invoiced, 1600);
  assert.equal(p.received, 1000);
  assert.equal(p.invoices.length, 2);
  assert.equal(row(p, 'income').actual, 1600);
  assert.equal(row(p, 'income').variance, -400);
  assert.equal(p.customerOwes, 1000, 'sale less what was received');
  assert.equal(p.customerOwesFrom, 'invoices');
});

test('actual labor and material come from job cost inputs; profit actual needs every actual', () => {
  const costInputs = [
    { job_id: 'j1', month: '2026-09', actual_labor_cost: 150 },
    { job_id: 'j1', month: '2026-10', installation_material_cost: 30 },
    { job_id: 'other', month: '2026-10', actual_labor_cost: 999 },
  ];
  const noIncome = jobProject('j1', [], { ...base, costInputs });
  assert.equal(row(noIncome, 'labor').actual, 180);
  assert.equal(row(noIncome, 'labor').variance, -20);
  assert.equal(row(noIncome, 'cost').actual, 1180);
  assert.equal(row(noIncome, 'profit').actual, null, 'no income recorded yet');

  const invoices = [{ id: 'i1', job_id: 'j1', kind: 'balance', invoice_number: '9', invoice_date: '2026-10-01', amount: 2000 }];
  const done = jobProject('j1', [], { ...base, costInputs, invoices });
  assert.equal(row(done, 'profit').actual, 820);
  assert.ok(Math.abs(done.margin.actual - 0.41) < 1e-9);
});

test('a job with no cost figure shows dashes, not zeros', () => {
  const bare = { id: 'j2', canonical_name: 'Bare' };
  const p = jobProject('j2', [], { jobs: [bare], budgets: [{ id: 'b2', job_id: 'j2', budget_usage: 'included', inputs: { actual_total_sell: 5000 } }], today: '2026-10-24' });
  assert.equal(row(p, 'income').estimate, 5000);
  assert.equal(row(p, 'windows').estimate, null);
  assert.equal(row(p, 'cost').estimate, null);
  assert.equal(row(p, 'profit').estimate, null);
  assert.equal(p.margin.estimate, null);
});

test('no job record means no project view', () => {
  assert.equal(jobProject('missing', [], base), null);
});
