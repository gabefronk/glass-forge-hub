// Use tax only when the supplier didn't charge sales tax (Gabe, Oct 24 2026).
import './support/register-src-alias.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

const { supplierTaxIncluded, costWithUseTax } = await import('../src/lib/useTax.js');
const { bestWindowsFromBudget } = await import('../src/lib/purchasingViewModel.js');
const { orderedCost } = await import('../src/lib/jobProject.js');

// Taira Res: the AMSCO order equals the quote's taxed total ($5,989.04 tax included).
const taira = { id: 'b1', vendor: 'AMSCO Windows', quote: { customer_sub_total: 126085.15, customer_tax: 5989.04, customer_total: 132074.19 } };

test('an amount equal to the supplier quote taxed total already includes tax', () => {
  assert.equal(supplierTaxIncluded(132074.19, taira), true);
  assert.equal(costWithUseTax(132074.19, taira), 132074.19);
});

test('other amounts, untaxed quotes and missing budgets get the use tax', () => {
  assert.equal(supplierTaxIncluded(126085.15, taira), false);
  assert.equal(costWithUseTax(1000, taira), 1074.5);
  assert.equal(costWithUseTax(1000, { quote: { customer_tax: 0, customer_total: 1000 } }), 1074.5);
  assert.equal(costWithUseTax(1000, null), 1074.5);
  assert.equal(costWithUseTax(null, taira), null);
});

test('Purchasing windows figure skips use tax on a taxed supplier order', () => {
  const c = bestWindowsFromBudget(taira, [], [{ id: 'o1', amount: 132074.19, order_number: '10-858.26' }]);
  assert.equal(c.value, 132074.19);
  assert.equal(c.label, 'Order 10-858.26 (supplier tax incl.)');
  const u = bestWindowsFromBudget(taira, [{ id: 'p1', amount_dealer: 1000, po_number: 'YA-1' }], []);
  assert.equal(u.value, 1074.5);
  assert.equal(u.label, 'PO YA-1 + 7.45% use tax');
});

test('job actual supplier cost follows the same rule per record', () => {
  const c = orderedCost('j1', {
    budgets: [taira],
    purchase_orders: [{ id: 'p1', job_id: 'j1', budget_id: 'b1', status: 'ordered', amount_dealer: null }],
    vendor_orders: [
      { id: 'o1', job_id: 'j1', purchase_order_id: 'p1', amount: 132074.19 },
      { id: 'o2', job_id: 'j1', amount: 1000, order_number: 'X-2' },
    ],
  });
  assert.deepEqual(c, { value: 133148.69, partial: false });
});
