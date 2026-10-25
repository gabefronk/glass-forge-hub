// The job page headline is the Purchasing row for the job: same cost basis, same
// budget-sourced sale and labor, duplicate job records folded into the primary job.
import './support/register-src-alias.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

const { jobMoneyHeadline } = await import('../src/lib/jobMoneyPanel.js');
const { buildPurchasingCards } = await import('../src/lib/purchasingViewModel.js');

const job = { id: 'j1', canonical_name: 'Perry Res' };
const po = { id: 'po1', job_id: 'j1', po_number: 'YA-0010', status: 'ordered', amount_dealer: 1000, budget_id: 'b1' };
// A job-money budget (no vendor quote): sale and labor only, the cost comes from its PO.
const budget = { id: 'b1', job_id: 'j1', budget_usage: 'included', numbers_reviewed_at: '2026-10-24', inputs: { material_true_cost: null, labor_cost_sub_pay: 200, actual_total_sell: 2000 } };

test('the headline matches the Purchasing row for the same job', () => {
  const inputs = { jobs: [job], budgets: [budget], purchaseOrders: [po], today: '2026-10-24' };
  const h = jobMoneyHeadline('j1', [], inputs);
  const [card] = buildPurchasingCards({ jobs: [job], budgets: [budget], purchase_orders: [po], today: '2026-10-24' });
  assert.equal(h.cost, card.windows.display.value);
  assert.equal(h.cost, 1000, 'PO amount as entered');
  assert.equal(h.laborMaterial, 200);
  assert.equal(h.sale, 2000);
  assert.equal(h.profit, 725.5);
  assert.equal(h.partial, false);
});

test('records filed under a duplicate job record count toward the primary job', () => {
  const h = jobMoneyHeadline('j1', ['dup'], { jobs: [job], purchaseOrders: [{ ...po, job_id: 'dup', budget_id: null }], today: '2026-10-24' });
  assert.equal(h.cost, 1000);
});

test('no job record means no headline', () => {
  assert.equal(jobMoneyHeadline('missing', [], { jobs: [job] }), null);
});
