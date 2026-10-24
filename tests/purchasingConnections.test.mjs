import test from 'node:test';
import assert from 'node:assert/strict';
import { purchasingSearchIndex, matchesPurchasingSearch } from '../src/lib/purchasingSearch.js';
import { procurementPath } from '../src/lib/procurementRoutes.js';

test('search finds stale titles through the linked job and explicit PO and budget IDs', () => {
  const jobs = [{ id: 'j', canonical_name: 'Sandy Eagle Mountain', address: 'Example address' }];
  const budget = { id: 'b', job_id: 'j', title: 'Supplier quotation', quote_number: '3526241' };
  const po = { id: 'p', job_id: 'j', budget_id: 'b', po_number: 'YA-0007' };
  const order = { id: 'o', job_id: 'j', purchase_order_id: 'p', order_number: '09-1234' };
  const data = { jobs, budgets: [budget], purchase_orders: [po], vendor_orders: [order] };
  const before = structuredClone(data);
  const index = purchasingSearchIndex(data);
  assert.equal(matchesPurchasingSearch(index.get(budget), 'EAGLE sandy'), true);
  assert.equal(matchesPurchasingSearch(index.get(po), 'Sandy 3526241'), true);
  assert.equal(matchesPurchasingSearch(index.get(order), 'YA-0007 example'), true);
  assert.deepEqual(data, before);
});
test('search never borrows job context through broken or cross-job IDs', () => {
  const po = { id: 'p', job_id: 'other', po_number: 'YA-0003' };
  const unlinked = { id: 'o', purchase_order_id: 'p' };
  const wrongJob = { id: 'o2', job_id: 'j', purchase_order_id: 'p' };
  const index = purchasingSearchIndex({ purchase_orders: [po], vendor_orders: [unlinked, wrongJob] });
  assert.equal(matchesPurchasingSearch(index.get(unlinked), 'YA-0003'), false);
  assert.equal(matchesPurchasingSearch(index.get(wrongJob), 'YA-0003'), false);
  assert.equal(matchesPurchasingSearch(index.get(wrongJob), ''), true);
});
test('purchasing navigation keeps a valid accounting month and rejects invalid months', () => {
  assert.equal(procurementPath('job/one', 'invoicing', '2026-09'), '/jobs/job%2Fone/budget-orders?section=budgets&month=2026-09'); // retired section falls back
  assert.equal(procurementPath('', 'orders', '2026-13'), '/purchasing?section=orders');
});