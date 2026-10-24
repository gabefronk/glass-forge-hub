// The totals bar ties to the rows below: a multi-scope job row withholds its money
// (applyScopeRollup) and the bar adds the figures its scope rows show instead. It
// labels itself partial only when a scope row has no figure for a column.
import test from 'node:test';
import assert from 'node:assert/strict';
import { summarizeCards } from '../src/lib/purchasingSummary.js';

const single = { windows: { display: { value: 100 } }, rough: { display: { value: 10 } }, sale: { display: { value: 200 } }, profitDisplay: { value: 90 }, refs: {} };

test('multi-scope jobs add their scope rows instead of dropping out of the totals', () => {
  const multi = {
    windows: { display: { value: null, suppressed: true } }, rough: { display: { value: null, suppressed: true } },
    sale: { display: { value: null, suppressed: true } }, profitDisplay: { value: null, suppressed: true }, refs: {},
    scopes: [
      { windows: { value: 1000 }, rough: { value: 200 }, sale: { value: 1500 }, profit: { value: 300 } },
      { windows: { value: 500 }, rough: { value: 100 }, sale: { value: 800 }, profit: { value: 200 } },
    ],
  };
  const totals = summarizeCards([single, multi]);
  assert.deepEqual([totals.windows, totals.rough, totals.sale, totals.profit], [1600, 310, 2500, 590]);
  assert.equal(totals.partialScopes, 0);
});

test('a scope row without a figure keeps the bar labelled partial', () => {
  const reorder = {
    windows: { display: { value: null, suppressed: true } }, rough: { display: { value: 0 } },
    sale: { display: { value: 24341.56 } }, profitDisplay: { value: null, suppressed: true }, refs: {},
    scopes: [{ windows: { value: 708.31 }, profit: { value: null } }, { windows: { value: 19841.95 }, profit: { value: null } }],
  };
  const totals = summarizeCards([single, reorder]);
  assert.equal(totals.windows, 20650.26);
  assert.equal(totals.sale, 24541.56, 'an owner-entered job-level sale is never replaced by scopes');
  assert.equal(totals.profit, 90);
  assert.equal(totals.partialScopes, 1);
});

test('no cards, or only single-scope cards, are never partial', () => {
  assert.equal(summarizeCards([]).partialScopes, 0);
  assert.equal(summarizeCards([{ windows: { display: { value: 5 } }, refs: {} }]).partialScopes, 0);
});
