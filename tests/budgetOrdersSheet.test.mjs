// The Budget & Orders sheet: PO lines with a total row, reorder reasons, and the typed
// figures shown when a job has no vendor quote (Scott Neighbor, Oct 31).
import './support/register-src-alias.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

const { orderLines, sheetTotal, typedBudget, reorderTag } = await import('../src/lib/budgetOrdersSheet.js');

// Scott Neighbor as recorded: YA-0004 and its remake YA-0012, both $238.73 pre-tax.
const scott = {
  pos: [
    { id: 'p12', job_id: 'j', po_number: 'YA-0012', vendor: 'AMSCO', amount_dealer: 238.73, status: 'paid', vendor_quote_ref: '3602079',
      additional_order_reason: 'Reorder: eyebrow unit resized to 69.5 x 34 even (was 69.5 x 34 3/16 on YA-0004).' },
    { id: 'p4', job_id: 'j', po_number: 'YA-0004', vendor: 'AMSCO', amount_dealer: 238.73, status: 'ordered', vendor_quote_ref: '3520813' },
  ],
  orders: [
    { id: 'o12', job_id: 'j', purchase_order_id: 'p12', order_number: '10-2716.26', amount: 256.52, eta_date: '2026-10-22' },
    { id: 'o4', job_id: 'j', purchase_order_id: 'p4', order_number: '09-4538', amount: 238.73, eta_date: '2026-10-01' },
  ],
  budgets: [],
};

test('PO lines run oldest number first with their quote, order and ETA', () => {
  const lines = orderLines(scott);
  assert.deepEqual(lines.map((l) => l.poNumber), ['YA-0004', 'YA-0012']);
  assert.deepEqual(lines.map((l) => [l.quote, l.orderNumbers[0], l.eta]), [['3520813', '09-4538', '2026-10-01'], ['3602079', '10-2716.26', '2026-10-22']]);
  // The PO amount as entered, not the supplier order's with-tax figure.
  assert.deepEqual(lines.map((l) => l.amount), [238.73, 238.73]);
});

test('the total row matches the job page rule', () => {
  assert.deepEqual(sheetTotal('j', scott), { value: 477.46, partial: false });
});

test('a second PO names its reason', () => {
  const [first, second] = orderLines(scott);
  assert.equal(first.tag, null);
  assert.equal(second.tag.label, 'Reorder');
  assert.match(second.tag.reason, /eyebrow unit resized/);
  assert.equal(reorderTag({ additional_order_reason: 'Remake - glass arrived cracked' }).label, 'Remake');
  assert.equal(reorderTag({ additional_order_reason: 'Added a window to the kitchen' }).label, 'Added');
  assert.equal(reorderTag({ additional_order_reason: 'Customer changed the grid pattern' }).label, 'Extra PO');
  assert.equal(reorderTag({ additional_order_reason: '  ' }), null);
});

test('supplier orders with no PO follow the POs, and a PO with no amount uses its orders', () => {
  const lines = orderLines({
    pos: [{ id: 'p1', po_number: 'YA-0001', vendor: 'Pella' }],
    orders: [{ id: 'a', purchase_order_id: 'p1', amount: 100 }, { id: 'b', purchase_order_id: 'p1', amount: 50.5 }, { id: 'c', vendor: 'AMSCO', order_number: 'X-1', amount: 20 }],
  });
  assert.deepEqual(lines.map((l) => [l.kind, l.amount]), [['po', 150.5], ['order', 20]]);
});

test('typed figures: supplier orders, other costs, margin', () => {
  const t = typedBudget({ manual_budget_cost: 627.46, manual_customer_total: 675 }, 477.46);
  assert.equal(t.any, true);
  assert.equal(t.other, 150);
  assert.equal(t.overBy, null);
  assert.equal(t.margin, 47.54);
  assert.equal(t.marginPct.toFixed(3), '0.070');
});

test('orders above the typed cost are flagged, not shown as a negative other cost', () => {
  const t = typedBudget({ manual_budget_cost: 400, manual_customer_total: 675 }, 477.46);
  assert.equal(t.other, null);
  assert.equal(t.overBy, 77.46);
});

test('nothing typed', () => {
  const t = typedBudget({}, 477.46);
  assert.equal(t.any, false);
  assert.equal(t.margin, null);
  assert.equal(typedBudget({ manual_customer_total: 675 }, null).marginPct, null);
});
