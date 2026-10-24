// The job page headline is the Purchasing row for the job: same cost basis, same
// owner-first precedence, duplicate job records folded into the primary job.
import './support/register-src-alias.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

const { jobMoneyHeadline } = await import('../src/lib/jobMoneyPanel.js');
const { buildPurchasingCards } = await import('../src/lib/purchasingViewModel.js');

const job = { id: 'j1', canonical_name: 'Perry Res' };
const po = { id: 'po1', job_id: 'j1', po_number: 'YA-0010', status: 'ordered', amount_dealer: 1000 };

test('the headline matches the Purchasing row for the same job', () => {
  const inputs = { jobs: [job], purchaseOrders: [po], moneyInputs: [{ job_id: 'j1', rough_labor_material: 200, sale_price: 2000 }], today: '2026-10-24' };
  const h = jobMoneyHeadline('j1', [], inputs);
  const [card] = buildPurchasingCards({ jobs: [job], purchase_orders: [po], moneyInputs: inputs.moneyInputs, today: '2026-10-24' });
  assert.equal(h.cost, card.windows.display.value);
  assert.equal(h.cost, 1074.5, 'PO amount plus 7.45% use tax');
  assert.equal(h.laborMaterial, 200);
  assert.equal(h.sale, 2000);
  assert.equal(h.profit, 725.5);
  assert.equal(h.partial, false);
});

test('records filed under a duplicate job record count toward the primary job', () => {
  const h = jobMoneyHeadline('j1', ['dup'], { jobs: [job], purchaseOrders: [{ ...po, job_id: 'dup' }], moneyInputs: [], today: '2026-10-24' });
  assert.equal(h.cost, 1074.5);
});

test('no job record means no headline', () => {
  assert.equal(jobMoneyHeadline('missing', [], { jobs: [job] }), null);
});
