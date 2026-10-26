// Purchasing header figures (Sold, Customers owe, Job cost, Est. profit) and the one
// Show dropdown: every figure and count adds only the rows shown. Suppliers are paid up
// front (Gabe, Oct 25), so there is no supplier payables figure or filter.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isSold, isCompleted, byStatus, jobFlags, headerFigures, purchasingFilterCounts, applyPurchasingFilter, customerOwedShare, etaShort, etaRange, sortCards, cardFigures, PURCHASING_FILTERS } from '../src/lib/purchasingSummary.js';
import * as summary from '../src/lib/purchasingSummary.js';

const TODAY = '2026-10-24';
const card = (over = {}) => ({
  job: { id: over.id || 'j1' },
  windows: { display: { value: 'windows' in over ? over.windows : 1074.5 } },
  rough: { display: { value: 400 } },
  sale: { display: { value: 'sale' in over ? over.sale : 3000 } },
  profitDisplay: { value: 'profit' in over ? over.profit : 1525.5 },
  refs: { etaLabel: over.eta ?? null, quoteNumber: over.quote ?? null, yaPo: over.po ?? null, mfrOrder: over.order ?? null },
  paymentStage: over.stage || '',
});

test('no supplier payables anywhere: no export, no figure, no filter', () => {
  assert.equal(summary.supplierPayables, undefined);
  assert.ok(!PURCHASING_FILTERS.some((f) => f.key === 'supplier_unpaid'));
  const flags = jobFlags(card({ po: 'YA-1' }), TODAY);
  assert.ok(!('weOwe' in flags) && !('supplier_unpaid' in flags));
  assert.ok(!('weOwe' in headerFigures([card()], TODAY)));
});

test('customers owe the sale less what the payment stage says was collected', () => {
  assert.deepEqual(['', 'half_down', 'installed', 'waiting_on_payment', 'paid'].map(customerOwedShare), [1, 0.5, 1, 1, 0]);
  // Gabriel, Oct 24: owed from Ordered on; a job only sent to the customer is not sold yet.
  assert.deepEqual(['sent_to_customer', 'ordered', 'delivered', 'billed', 'waiting_on_check'].map(customerOwedShare), [0, 1, 1, 1, 1]);
  assert.equal(jobFlags(card({ stage: 'waiting_on_check' })).waiting_payment, true);
  assert.equal(jobFlags(card({ stage: 'half_down' })).customerOwes, 1500);
  assert.equal(jobFlags(card({ stage: 'paid' })).customerOwes, 0);
  assert.equal(jobFlags(card({ sale: null })).customerOwes, 0);
});

test('flags: open orders, ETA, deposit and missing cost', () => {
  const openNoEta = jobFlags(card({ po: 'YA-1' }), TODAY);
  assert.equal(openNoEta.open_orders, true, 'a PO or supplier order is an open order until delivered');
  assert.equal(openNoEta.needs_eta, true);
  assert.equal(openNoEta.deposit_due, true);
  assert.equal(jobFlags(card(), TODAY).open_orders, false, 'no PO or order yet');
  const delivered = jobFlags(card({ order: 'X-1', eta: 'Delivered', stage: 'half_down' }), TODAY);
  assert.deepEqual([delivered.open_orders, delivered.needs_eta, delivered.deposit_due], [false, false, false]);
  assert.equal(jobFlags(card({ eta: '2026-10-01' }), TODAY).eta_late, true);
  assert.equal(jobFlags(card({ eta: '2026-11-01' }), TODAY).eta_late, false);
  assert.equal(jobFlags(card({ windows: null }), TODAY).missing_cost, true);
  assert.equal(jobFlags(card({ windows: 0 }), TODAY).missing_cost, true, 'a $0 cost reads as free material');
  assert.equal(jobFlags(card(), TODAY).missing_cost, false);
});

test('header figures and filter counts add exactly the rows shown', () => {
  const cards = [
    card({ id: 'a', stage: 'half_down', quote: 'Q1', po: 'YA-1', eta: '2026-10-01' }),
    card({ id: 'b', sale: 2000, profit: -100, stage: 'paid', quote: 'Q2', po: 'YA-2', eta: 'Delivered' }),
    card({ id: 'c', windows: null, profit: null, stage: 'waiting_on_payment', order: 'X-9' }),
  ];
  const all = headerFigures(cards, TODAY);
  assert.deepEqual([all.sold, all.customersOwe, all.cost, all.profit], [8000, 4500, 3349, 1425.5], 'Job cost is the Windows plus labor & material on the rows shown');
  const counts = purchasingFilterCounts(cards, TODAY);
  assert.deepEqual(counts, { all: 3, quoted: 2, po_placed: 2, eta_late: 1, needs_eta: 1, waiting_payment: 1, missing_cost: 1 });
  for (const [key, n] of Object.entries(counts)) assert.equal(applyPurchasingFilter(cards, key, TODAY).length, n, key);
  const late = headerFigures(applyPurchasingFilter(cards, 'eta_late', TODAY), TODAY);
  assert.deepEqual([late.jobs, late.sold, late.cost], [1, 3000, 1474.5]);
  assert.equal(applyPurchasingFilter(cards, 'nonsense', TODAY).length, 3);
  const grid = cards.map(cardFigures);
  assert.equal(grid.reduce((n, f) => n + f.sale, 0), all.sold, 'the Sold figure is the sum of the grid Sale cells');
  assert.equal(grid.reduce((n, f) => n + f.profit, 0), all.profit);
});

test('short ETAs, multi-scope ranges and ETA sort order', () => {
  assert.deepEqual(etaShort('2026-11-09', TODAY), { text: 'Nov 9 · 16d', late: false });
  assert.deepEqual(etaShort('2026-10-13', TODAY), { text: 'Oct 13 · 11d late', late: true });
  assert.deepEqual(etaShort('Delivered', TODAY), { text: 'Delivered', late: false });
  assert.deepEqual(etaShort(null, TODAY), { text: '', late: false });
  assert.deepEqual(etaRange(['2026-08-22', '2026-08-23'], TODAY), { text: '62–63d late', late: true });
  assert.deepEqual(etaRange(['2026-08-22', '2026-08-22'], TODAY), { text: 'Aug 22 · 63d late', late: true });
  const order = sortCards([
    card({ id: 'del', eta: 'Delivered' }), card({ id: 'none' }), card({ id: 'late', eta: '2026-10-01' }), card({ id: 'soon', eta: '2026-11-01' }),
  ]).map((c) => c.job.id);
  assert.deepEqual(order, ['late', 'soon', 'none', 'del']);
  const bySale = sortCards([card({ id: 'x', sale: 100 }), card({ id: 'y', sale: 900 })], { key: 'sale', dir: 'desc' }).map((c) => c.job.id);
  assert.deepEqual(bySale, ['y', 'x']);
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

test('no stage or Sent to customer is not sold yet; any later stage is sold', () => {
  assert.equal(isSold(card()), false);
  assert.equal(isSold(card({ stage: 'sent_to_customer' })), false);
  for (const stage of ['ordered', 'half_down', 'delivered', 'installed', 'billed', 'waiting_on_check', 'waiting_on_payment', 'paid']) assert.equal(isSold(card({ stage })), true, stage);
});

test('Paid jobs are completed: Active leaves them out, Completed and All include them', () => {
  const cards = [card({ id: 'a', stage: 'ordered' }), card({ id: 'p', stage: 'paid' }), card({ id: 'w', stage: 'waiting_on_payment' })];
  assert.deepEqual(cards.filter(isCompleted).map((c) => c.job.id), ['p']);
  assert.deepEqual(byStatus(cards, 'active').map((c) => c.job.id), ['a', 'w']);
  assert.deepEqual(byStatus(cards, 'completed').map((c) => c.job.id), ['p']);
  assert.equal(byStatus(cards, 'all').length, 3);
  const all = headerFigures(cards, TODAY);
  assert.equal(all.sold, 9000, 'a Paid job still counts in Sold');
  assert.equal(all.customersOwe, 6000, 'and owes nothing');
});
