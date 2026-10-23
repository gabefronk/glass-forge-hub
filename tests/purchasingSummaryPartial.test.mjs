// The totals bar must admit when multi-scope money is withheld: summarizeCards
// counts cards carrying a suppressed roll-up figure so the bar can label
// itself partial instead of reading as a complete job total.
import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeCards } from '../src/lib/purchasingSummary.js';

test('partialScopes counts only cards with suppressed roll-up figures', () => {
  const totals = summarizeCards([
    { windows: { display: { value: 100 } }, rough: { display: { value: 10 } }, sale: { display: { value: 200 } }, profitDisplay: { value: 90 }, refs: {} },
    { windows: { display: { value: null, suppressed: true } }, rough: { display: { value: 0 } }, sale: { display: { value: 24341.56 } }, profitDisplay: { value: null, suppressed: true }, refs: {} },
  ]);
  assert.equal(totals.partialScopes, 1);
  assert.equal(totals.windows, 100);
  assert.equal(totals.sale, 24541.56);
  assert.equal(summarizeCards([]).partialScopes, 0);
  assert.equal(summarizeCards([{ windows: { display: { value: 5 } }, refs: {} }]).partialScopes, 0);
});
