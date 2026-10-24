// Purchasing header figures (Sold, Customers owe, We owe suppliers, Est. profit)
// and the one Show dropdown: every figure and count adds only the rows shown.
import test from 'node:test';
import assert from 'node:assert/strict';
import { supplierPayables, jobFlags, headerFigures, purchasingFilterCounts, applyPurchasingFilter, customerOwedShare } from '../src/lib/purchasingSummary.js';

const TODAY = '2026-10-24';
const card = (over = {}) => ({
  job: { id: over.id || 'j1' },
  windows: { display: { value: 'windows' in over ? over.windows : 1074.5 } },
  rough: { display: { value: 400 } },
  sale: { display: { value: 'sale' in over ? over.sale : 3000 } },
  profitDisplay: { value: 'profit' in over ? over.profit : 1525.5 },
  refs: { etaLabel: over.eta ?? null },
  payables: over.payables || { owed: 0, items: 0, unpaid: 0, missing: 0 },
  paymentStage: over.stage || '',
});

test('supplier payables stay at the raw PO amount and drop once every order is paid', () => {
  const data = {
    purchase_orders: [
      { id: 'p1', job_id: 'j1', status: 'ordered', amount_dealer: 1000 },
      { id: 'p2', job_id: 'j1', status: 'issued', amount_dealer: 250 },
      { id: 'p3', job_id: 'j1', status: 'cancelled', amount_dealer: 9999 },
      { id: 'p4', job_id: 'j2', status: 'ordered', amount_dealer: 5000 },
    ],
    vendor_orders: [
      { id: 'o1', job_id: 'j1', purchase_order_id: 'p1', status: 'paid', amount: 1074.5 },
      { id: 'o2', job_id: 'j1', purchase_order_id: 'p2', status: 'eta_set', amount: 268.63 },
      { id: 'o3', job_id: 'j1', purchase_order_id: 'p3', status: 'ordered', amount: 50 },
      { id: 'o4', job_id: 'j1', status: 'ordered', amount: 80, order_number: 'X-1' },
      { id: 'o5', job_id: 'j1', status: 'ordered' },
    ],
  };
  const ap = supplierPayables('j1', data);
  assert.equal(ap.owed, 330, 'p2 at its PO amount (no tax) + the unlinked order; p1 is paid; p3 is cancelled');
  assert.deepEqual([ap.items, ap.unpaid, ap.missing, ap.label], [3, 2, 0, 'Partial']);
  assert.equal(supplierPayables('j3', data).label, null);
  assert.equal(supplierPayables('j1', { purchase_orders: [{ id: 'p', job_id: 'j1', status: 'ordered' }] }).missing, 1);
  const noPoAmount = supplierPayables('j1', {
    purchase_orders: [{ id: 'p', job_id: 'j1', status: 'ordered', amount_dealer: null }],
    vendor_orders: [{ id: 'o', job_id: 'j1', purchase_order_id: 'p', status: 'eta_set', amount: 132074.19 }],
  });
  assert.deepEqual([noPoAmount.owed, noPoAmount.missing], [132074.19, 0], 'a PO with no amount falls back to its supplier order');
});

test('customers owe the sale less what the payment stage says was collected', () => {
  assert.deepEqual(['', 'half_down', 'installed', 'waiting_on_payment', 'paid'].map(customerOwedShare), [1, 0.5, 1, 1, 0]);
  assert.equal(jobFlags(card({ stage: 'half_down' })).customerOwes, 1500);
  assert.equal(jobFlags(card({ stage: 'paid' })).customerOwes, 0);
  assert.equal(jobFlags(card({ sale: null })).customerOwes, 0);
});

test('flags: open orders, ETA, deposit, supplier and missing cost', () => {
  const openNoEta = jobFlags(card({ payables: { owed: 1, items: 1, unpaid: 1 } }), TODAY);
  assert.equal(openNoEta.open_orders, true);
  assert.equal(openNoEta.needs_eta, true);
  assert.equal(openNoEta.supplier_unpaid, true);
  assert.equal(openNoEta.deposit_due, true);
  const delivered = jobFlags(card({ eta: 'Delivered', stage: 'half_down', payables: { owed: 0, items: 1, unpaid: 0 } }), TODAY);
  assert.deepEqual([delivered.open_orders, delivered.needs_eta, delivered.supplier_unpaid, delivered.deposit_due], [false, false, false, false]);
  assert.equal(jobFlags(card({ eta: '2026-10-01' }), TODAY).eta_late, true);
  assert.equal(jobFlags(card({ eta: '2026-11-01' }), TODAY).eta_late, false);
  assert.equal(jobFlags(card({ windows: null }), TODAY).missing_cost, true);
  assert.equal(jobFlags(card({ windows: 0 }), TODAY).missing_cost, true, 'a $0 cost reads as free material');
  assert.equal(jobFlags(card(), TODAY).missing_cost, false);
});

test('header figures and filter counts add exactly the rows shown', () => {
  const cards = [
    card({ id: 'a', stage: 'half_down', payables: { owed: 1000, items: 1, unpaid: 1, missing: 0 }, eta: '2026-10-01' }),
    card({ id: 'b', sale: 2000, profit: -100, stage: 'paid', eta: 'Delivered', payables: { owed: 0, items: 1, unpaid: 0, missing: 0 } }),
    card({ id: 'c', windows: null, profit: null, payables: { owed: 0, items: 1, unpaid: 1, missing: 1 } }),
  ];
  const all = headerFigures(cards, TODAY);
  assert.deepEqual([all.sold, all.customersOwe, all.weOwe, all.profit, all.apMissing], [8000, 4500, 1000, 1425.5, 1]);
  const counts = purchasingFilterCounts(cards, TODAY);
  assert.deepEqual(counts, { all: 3, open_orders: 2, needs_eta: 1, eta_late: 1, deposit_due: 1, supplier_unpaid: 2, missing_cost: 1 });
  for (const [key, n] of Object.entries(counts)) assert.equal(applyPurchasingFilter(cards, key, TODAY).length, n, key);
  const unpaid = headerFigures(applyPurchasingFilter(cards, 'supplier_unpaid', TODAY), TODAY);
  assert.deepEqual([unpaid.jobs, unpaid.sold, unpaid.weOwe], [2, 6000, 1000]);
  assert.equal(applyPurchasingFilter(cards, 'nonsense', TODAY).length, 3);
});

test('multi-scope jobs add their scope rows to Sold and Est. profit', () => {
  const multi = {
    ...card({ id: 'm' }),
    sale: { display: { value: null, suppressed: true } }, profitDisplay: { value: null, suppressed: true },
    windows: { display: { value: null, suppressed: true } },
    scopes: [{ windows: { value: 100 }, sale: { value: 500 }, profit: { value: 300 } }, { windows: { value: 50 }, sale: { value: 250 }, profit: { value: 150 } }],
  };
  const f = headerFigures([multi], TODAY);
  assert.deepEqual([f.sold, f.profit, f.customersOwe], [750, 450, 750]);
  assert.equal(jobFlags(multi, TODAY).missing_cost, false);
  const zeroScope = { ...multi, scopes: [{ windows: { value: 0 }, sale: { value: 458.78 } }, multi.scopes[1]] };
  assert.equal(jobFlags(zeroScope, TODAY).missing_cost, true, 'a $0 scope cost counts as missing');
});
