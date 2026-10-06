import test from 'node:test';
import assert from 'node:assert/strict';
import { purchasingSearchIndex, matchesPurchasingSearch } from '../src/lib/purchasingSearch.js';
import { procurementPath } from '../src/lib/procurementRoutes.js';
import { buildSetupDraft, contractTermsReady, contractReviewIssues } from '../src/lib/jobSetup.js';

const ready = () => ({
  customer: { name: 'Test customer', job_site_address: 'Test site' },
  pricing: { sell_price: 1000, tax: 50, contract_total: 1050 },
  scope_lines: [{ qty: 1, product: 'Window', customer_price: 1000 }],
  terms: { deposit_pct: 0, quote_valid_days: 14, payment_schedule: 'On completion', estimated_lead_time: 'Six weeks', warranty_text: 'Manufacturer warranty attached' },
});
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
  assert.equal(procurementPath('job/one', 'invoicing', '2026-09'), '/jobs/job%2Fone/budget-orders?section=invoicing&month=2026-09');
  assert.equal(procurementPath('', 'orders', '2026-13'), '/purchasing?section=orders');
});
test('missing deposit and scope price cannot pass review through null-to-zero conversion', () => {
  assert.equal(contractTermsReady(ready()), true);
  for (const value of [null, undefined, '', '   ', -1]) {
    const deposit = ready(); deposit.terms.deposit_pct = value;
    assert.equal(contractTermsReady(deposit), false);
    const line = ready(); line.scope_lines[0].customer_price = value;
    assert.equal(contractTermsReady(line), false);
  }
});
test('explicit zero amounts are allowed but inconsistent contract totals are blocked', () => {
  const sheet = ready();
  sheet.pricing = { sell_price: 0, tax: 0, contract_total: 0 };
  sheet.scope_lines[0].customer_price = 0;
  assert.equal(contractTermsReady(sheet), true);
  sheet.pricing.contract_total = 20;
  assert.equal(contractTermsReady(sheet), false);
  assert.ok(contractReviewIssues(sheet).some(issue => issue.includes('subtotal plus customer tax')));
});
test('blank tax and subtotal cannot become zero just because they contain spaces', () => {
  for (const key of ['sell_price', 'tax', 'contract_total']) {
    const sheet = ready(); sheet.pricing[key] = '  ';
    assert.equal(contractTermsReady(sheet), false);
  }
});
test('structured quote dimensions become readable setup sizes', () => {
  const sheet = buildSetupDraft({ job: { accepted_quote_snapshot: { lines: [{ size: { width: 36, height: 48 }, qty: 1, product: 'Window' }] } } });
  assert.equal(sheet.scope_lines[0].size, '36 × 48');
});
