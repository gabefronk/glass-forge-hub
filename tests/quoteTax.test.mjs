// Quote tax: the reader keeps every tax line; the owner's toggle decides use tax.
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeVendorQuote } from '../base44/shared/vendorQuoteParse.js';
import { quoteChargesTax, supplierTaxIncluded, costWithUseTax } from '../src/lib/useTax.js';

test('tax lines are kept and summed when the reader gives no single tax total', () => {
  const q = normalizeVendorQuote({ customer_tax: null, tax_lines: [{ label: 'UT State Tax', rate_pct: '4.85%', amount: '$60.96' }, { label: 'County', rate_pct: 2.6, amount: 32.69 }] });
  assert.equal(q.customer_tax, 93.65);
  assert.deepEqual(q.tax_lines[0], { label: 'UT State Tax', rate_pct: 4.85, amount: 60.96 });
});

test('a printed tax total wins over the line sum; no tax line stays null', () => {
  assert.equal(normalizeVendorQuote({ customer_tax: 90, tax_lines: [{ amount: 93.65 }] }).customer_tax, 90);
  const none = normalizeVendorQuote({});
  assert.equal(none.customer_tax, null);
  assert.deepEqual(none.tax_lines, []);
});

test('quoteChargesTax: toggle first, then the quote\'s tax line', () => {
  assert.equal(quoteChargesTax({ supplier_tax_included: true, quote: { customer_tax: 0 } }), true);
  assert.equal(quoteChargesTax({ supplier_tax_included: false, quote: { customer_tax: 50 } }), false);
  assert.equal(quoteChargesTax({ quote: { customer_tax: 50 } }), true);
  assert.equal(quoteChargesTax({ quote: { customer_tax: 0 } }), false);
  assert.equal(quoteChargesTax({ quote: {} }), null);
});

test('a PO amount gets the use tax unless the supplier charged tax on it', () => {
  const budget = { quote: { customer_total: 1074.5, customer_tax: 74.5 } };
  assert.equal(costWithUseTax(1074.5, budget), 1074.5);
  assert.equal(costWithUseTax(1074.5, { ...budget, supplier_tax_included: false }), 1154.55);
  assert.equal(supplierTaxIncluded(1256.98, { supplier_tax_included: true, quote: { customer_total: 1256.98, customer_tax: 0 } }), true);
  assert.equal(costWithUseTax(1256.98, { quote: { customer_total: 1256.98, customer_tax: 0 } }), 1350.63);
});
