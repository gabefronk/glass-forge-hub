// Quote tax: the reader keeps every tax line. No use tax is added anywhere (Oct 24 2026).
import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeVendorQuote } from '../base44/shared/vendorQuoteParse.js';

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

