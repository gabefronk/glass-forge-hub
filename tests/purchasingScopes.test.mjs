// Per-scope rows for the Purchasing board. Every expected figure below is
// derived BY HAND from the scope's own printed fields (comments show the math):
// a quote scope prices its own verified supplier total, a PO/order row only ever
// shows that record's own amount, and a reorder never repeats the shared
// budget's labor/material or sale price.
import test from 'node:test';
import assert from 'node:assert/strict';
import { scopesForJob } from '../src/lib/purchasingScopes.js';

// Supplier's printed single-price quote: 1000.00 + 74.50 tax = 1074.50 total,
// issued by AMSCO and billed to us, one window line = the subtotal.
const quote = {
  price_levels: 'single', vendor: 'AMSCO', quoted_by: 'Nu Vista Sales', bill_to: 'YA Windows and Doors',
  lines: [{ kind: 'window', qty: 12, extended: 1000 }], net_total: 1000, customer_tax: 74.5, customer_total: 1074.5,
};
const budget = (over = {}) => ({
  id: 'b1', job_id: 'j1', budget_usage: 'included', numbers_reviewed_at: '2026-10-01',
  vendor: 'AMSCO', manufacturer: 'AMSCO Windows', title: 'AMSCO 09-3900', quote_number: 'Q1',
  openings_qty: 12, glass_eta_date: '2026-10-22', quote,
  inputs: { material_true_cost: 10000, labor_cost_sub_pay: 2000, additional_install_material: 500, actual_total_sell: 18000 },
  ...over,
});

test('two quote budgets → one row each, each with its own quote and supplier total', () => {
  const scopes = scopesForJob('j1', { budgets: [budget(), budget({ id: 'b2', title: 'Add-on scope', quote_number: 'Q2' })], purchase_orders: [], vendor_orders: [] });
  assert.equal(scopes.length, 2);
  assert.deepEqual(scopes.map((s) => s.key), ['budget:b1', 'budget:b2']);
  assert.equal(scopes[0].windows.value, 1074.5);
  assert.equal(scopes[1].windows.value, 1074.5);
  assert.equal(scopes[1].quoteCard.quoteRawNumber, 'Q2');
  assert.equal(scopes[1].quoteCard.brand, 'AMSCO');
  assert.match(scopes[1].label, /Add-on scope/);
  // The scope's own reviewed inputs: 2000 labor + 500 install material = 2500,
  // sale 18000, so profit = 18000 − 1074.50 − 2500 = 14425.50.
  assert.equal(scopes[0].rough.value, 2500);
  assert.equal(scopes[0].sale.value, 18000);
  assert.equal(scopes[0].profit.value, 14425.5);
});

test('a reorder (two POs on one budget) → one row per PO, its own payable and ETA', () => {
  const scopes = scopesForJob('j1', {
    budgets: [budget()],
    purchase_orders: [
      { id: 'p1', job_id: 'j1', budget_id: 'b1', po_number: 'YA-0002', vendor: 'AMSCO', status: 'ordered', amount_dealer: 500 },
      { id: 'p2', job_id: 'j1', budget_id: 'b1', po_number: 'YA-0007', vendor: 'AMSCO', status: 'ordered', amount_dealer: 300 },
    ],
    vendor_orders: [
      { id: 'v1', job_id: 'j1', purchase_order_id: 'p1', order_number: '09-3900', amount: 500, status: 'ordered', eta_date: '2026-10-22' },
      { id: 'v2', job_id: 'j1', purchase_order_id: 'p2', order_number: '09-4100', amount: 300, status: 'ordered', eta_date: '2026-10-27' },
    ],
  });
  assert.equal(scopes.length, 2);
  assert.deepEqual(scopes.map((s) => s.poNumber), ['YA-0002', 'YA-0007']);
  assert.deepEqual(scopes.map((s) => s.windows.value), [500, 300]);
  // Each row edits ITS pending order, so the two ETAs never overwrite each other.
  assert.deepEqual(scopes.map((s) => s.etaTarget.order.id), ['v1', 'v2']);
  assert.deepEqual(scopes.map((s) => s.etaTarget.date), ['2026-10-22', '2026-10-27']);
  // The shared budget's labor/material and sale belong to the whole quote, so
  // they never appear on a single PO's row.
  assert.equal(scopes[0].rough.value, null);
  assert.equal(scopes[0].sale.value, null);
  assert.equal(scopes[0].quoteCard.quoteRawNumber, 'Q1');
});

test('a supplier order with no PO and no budget → its own row', () => {
  const scopes = scopesForJob('j1', {
    budgets: [budget()],
    vendor_orders: [{ id: 'v9', job_id: 'j1', order_number: '09-9', vendor: 'AMSCO', amount: 200, status: 'ordered', eta_date: '2026-11-01' }],
  });
  assert.equal(scopes.length, 2);
  assert.equal(scopes[1].key, 'order:v9');
  assert.equal(scopes[1].label, 'Order 09-9 · AMSCO');
  assert.equal(scopes[1].windows.value, 200);
  assert.equal(scopes[1].etaTarget.order.id, 'v9');
  assert.equal(scopes[1].poNumber, null);
});

test('one budget with one PO → a single scope (the board adds nothing)', () => {
  const scopes = scopesForJob('j1', {
    budgets: [budget()],
    purchase_orders: [{ id: 'p1', job_id: 'j1', budget_id: 'b1', po_number: 'YA-0002', vendor: 'AMSCO', status: 'ordered', amount_dealer: 500 }],
    vendor_orders: [{ id: 'v1', job_id: 'j1', purchase_order_id: 'p1', order_number: '09-3900', amount: 500, status: 'ordered', eta_date: '2026-10-22' }],
  });
  assert.equal(scopes.length, 1);
  assert.equal(scopes[0].key, 'budget:b1');
  assert.equal(scopes[0].poNumber, 'YA-0002');
  assert.equal(scopes[0].windows.value, 1074.5); // the budget's verified supplier total
  assert.equal(scopes[0].etaTarget.order.id, 'v1');
});

test('cancelled POs and their orders are excluded; supplier payment is per scope', () => {
  const scopes = scopesForJob('j1', {
    budgets: [budget()],
    purchase_orders: [
      { id: 'p1', job_id: 'j1', budget_id: 'b1', po_number: 'YA-0002', vendor: 'AMSCO', status: 'ordered', amount_dealer: 500 },
      { id: 'p2', job_id: 'j1', budget_id: 'b1', po_number: 'YA-0007', vendor: 'AMSCO', status: 'cancelled', amount_dealer: 300 },
    ],
    vendor_orders: [
      { id: 'v1', job_id: 'j1', purchase_order_id: 'p1', order_number: '09-3900', amount: 500, status: 'paid', paid_at: '2026-10-20' },
      { id: 'v2', job_id: 'j1', purchase_order_id: 'p2', order_number: '09-4100', amount: 300, status: 'ordered' },
    ],
  });
  assert.equal(scopes.length, 1);
  assert.deepEqual(scopes.map((s) => s.poNumber), ['YA-0002']);
  assert.deepEqual(scopes[0].payment, { label: 'Paid', tone: 'green' });
  // Paid is not received: the ETA still sits on that order and stays editable.
  assert.equal(scopes[0].etaTarget.order.id, 'v1');
  assert.equal(scopes[0].etaLabel, null);
});

test('a reference-only budget is not a scope; a draft one is', () => {
  const scopes = scopesForJob('j1', {
    budgets: [budget(), budget({ id: 'b2', title: 'History', budget_usage: 'reference' }), budget({ id: 'b3', title: 'New draft', budget_usage: 'draft', numbers_reviewed_at: null })],
  });
  assert.deepEqual(scopes.map((s) => s.key), ['budget:b1', 'budget:b3']);
  assert.equal(scopes[1].quoteCard.refs.quoteStatus, 'amber');
});