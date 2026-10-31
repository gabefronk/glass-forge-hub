// YA customer invoice (Oct 31): numbering, default lines that add up to the customer total,
// the payment schedule, sizes and checks. Jutkins = labor-only typed job; Becky = Pella quote.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  nextInvoiceNumber, defaultLines, invoiceTotals, paymentSchedule, sizeLabel, defaultBillTo,
  invoiceChecks, companyDetails, hasBankDetails, defaultOptions, lineAmount, customerTotal,
} from '../src/lib/yaInvoice.js';

const jutkins = { id: 'j1', canonical_name: 'JUTKINS', builder: 'Cash customer', address: '12084 S 4130 W Riverton, Utah 84096', manual_customer_total: 780 };
const becky = { id: 'j2', canonical_name: 'Becky Retro' };
const beckyBudget = {
  id: 'b1', job_id: 'j2', budget_usage: 'draft', quote_number: '21464768', manufacturer: 'Pella', openings_qty: 20,
  inputs: { material_true_cost: 37580.5, labor_cost_sub_pay: 2000, actual_total_sell: 59318.51 },
  quote: { lines: [
    { qty: 1, width_in: 35, height_in: 71, description: 'Lifestyle, Casement Left', extended: 1033.37 },
    { qty: 6, width_in: 23.75, height_in: 59.75, description: 'Lifestyle, Direct Set', extended: 3081 },
    { qty: 16, width_in: 1, height_in: 1, kind: 'part', description: '1" Frame Exp / Receptor', extended: 1507.2 },
  ] },
};

test('numbers follow YA-YYMMDD-NN and count up within the day', () => {
  assert.equal(nextInvoiceNumber('2026-10-31', []), 'YA-261031-01');
  assert.equal(nextInvoiceNumber('2026-10-31', ['YA-261031-01', 'YA-261031-02', 'YA-260916-01', '1014']), 'YA-261031-03');
  assert.equal(nextInvoiceNumber('', []), '');
});

test('a labor-only typed job gets one Labor line for its customer total', () => {
  const lines = defaultLines({ job: jutkins, budgets: [], sell: 780 });
  assert.deepEqual(lines, [{ kind: 'charge', description: 'Labor', amount: 780 }]);
  // Split by hand the way Jeremy asked: labor $700 + extra material $80.
  const split = [{ kind: 'charge', description: 'Labor: remove old front door, install new door', amount: 700 }, { kind: 'charge', description: 'Extra material: flashing', amount: 80 }];
  assert.equal(invoiceTotals(split).total, 780);
  assert.deepEqual(invoiceChecks({ lines: split, sell: 780, billTo: defaultBillTo(jutkins) }), []);
});

test('a quote job splits the sell by cost and lands exactly on the total', () => {
  const lines = defaultLines({ job: becky, budgets: [beckyBudget], sell: 59318.51 });
  assert.equal(lines[0].kind, 'item');
  assert.match(lines[0].description, /Pella, quote 21464768 · 20 units/);
  assert.equal(lines[1].description, 'Installation labor');
  assert.equal(invoiceTotals(lines).total, 59318.51);
});

test('itemized quote lines keep qty × unit exact and labor absorbs the cents', () => {
  const lines = defaultLines({ job: becky, budgets: [beckyBudget], sell: 59318.51, itemize: true });
  const items = lines.filter((l) => l.kind === 'item');
  assert.equal(items.length, 3);
  for (const l of items) assert.equal(l.amount, lineAmount(l));
  assert.equal(items[0].size, '35 × 71');
  assert.equal(items[1].size, '23¾ × 59¾');
  assert.equal(items[2].size, '');
  assert.equal(invoiceTotals(lines).total, 59318.51);
  assert.equal(invoiceTotals(lines).units, 7);
});

test('customer total: typed wins, else the quote sell', () => {
  assert.equal(customerTotal(jutkins, []), 780);
  assert.equal(customerTotal(becky, [beckyBudget]), 59318.51);
  assert.equal(customerTotal({ id: 'x' }, []), null);
});

test('payment schedule: half down rounds up, final is what is left', () => {
  assert.deepEqual(paymentSchedule('full', 780).due, 780);
  const half = paymentSchedule('half', 165235.77);
  assert.equal(half.due, 82617.89);
  assert.equal(half.rows[1].amount, 82617.88);
  const fin = paymentSchedule('final', 780, 390);
  assert.equal(fin.due, 390);
  assert.deepEqual(fin.rows.map((r) => r.status), ['received', 'due']);
});

test('bill to: the customer, else a real builder, else the job name', () => {
  assert.equal(defaultBillTo(jutkins).name, 'JUTKINS');
  assert.equal(defaultBillTo({ canonical_name: 'X', builder: 'Pride Construction' }).name, 'Pride Construction');
  assert.equal(defaultBillTo({ canonical_name: 'X', customer_name: 'Ann Lee', builder: 'Pride' }).name, 'Ann Lee');
});

test('checks flag a total that misses the customer total', () => {
  const out = invoiceChecks({ lines: [{ kind: 'charge', description: 'Labor', amount: 700 }], sell: 780, billTo: { name: 'J' } });
  assert.match(out[0], /add up to \$700\.00.*\$780\.00/);
});

test('company details fall back to the Arena invoice; bank numbers never default', () => {
  const c = companyDetails({});
  assert.equal(c.invoice_company_address, '1138 S 1300 W, Salt Lake City, UT 84104');
  assert.equal(c.invoice_routing_number, '');
  assert.equal(hasBankDetails(c), false);
  assert.equal(defaultOptions('full', { hasBank: false }).wire, false);
  assert.equal(defaultOptions('half').signature, true);
});
