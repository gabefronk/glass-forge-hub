// Budget & Orders summary boxes: typed numbers win, margins follow, colours by margin.
import test from 'node:test';
import assert from 'node:assert/strict';
import { budgetSummary, parseDollars, marginTone } from '../src/lib/budgetSummary.js';

const rollup = { cost: 258.87, sell: 575, margin_dollars: 316.13, margin_pct: 0.5498, count: 1, status: 'ready' };

test('parseDollars: dollars and commas in, cents out; blank clears; junk is refused', () => {
  assert.equal(parseDollars('$12,480.50'), 12480.5);
  assert.equal(parseDollars(' 900 '), 900);
  assert.equal(parseDollars(''), null);
  assert.equal(parseDollars('12.345'), undefined);
  assert.equal(parseDollars('abc'), undefined);
  assert.equal(parseDollars('-5'), undefined);
});

test('nothing typed: the boxes read exactly as the quote roll-up did', () => {
  const s = budgetSummary({}, rollup);
  assert.deepEqual([s.cost, s.sell, s.marginDollars, s.marginPct, s.anyManual, s.reviewWarning], [258.87, 575, 316.13, 0.5498, false, false]);
  assert.equal(budgetSummary({}, { ...rollup, status: 'review', margin_dollars: null }).reviewWarning, true);
});

test('typed numbers win over the quotes; margin follows from the two; quote totals stay for "From quotes"', () => {
  const s = budgetSummary({ manual_budget_cost: 400, manual_customer_total: 500 }, rollup);
  assert.equal(s.cost, 400);
  assert.equal(s.sell, 500);
  assert.equal(s.marginDollars, 100);
  assert.equal(s.marginPct, 0.2);
  assert.equal(s.tone, 'amber');
  assert.equal(s.quoteCost, 258.87);
  assert.equal(s.reviewWarning, false);
});

test('one typed box mixes with the quote figure for the other', () => {
  const s = budgetSummary({ manual_customer_total: 1000 }, rollup);
  assert.equal(s.marginDollars, 741.13);
  assert.equal(s.tone, 'green');
});

test('no vendor quote at all: typed numbers alone fill the summary', () => {
  const s = budgetSummary({ manual_budget_cost: 900, manual_customer_total: 1000 }, { count: 0, status: 'empty' });
  assert.equal(s.marginDollars, 100);
  assert.equal(s.tone, 'red');
  assert.equal(s.reviewWarning, false);
});

test('margin colours: green 25%+, amber 15–25%, red under 15%', () => {
  assert.deepEqual([0.25, 0.2499, 0.15, 0.1499, -0.1].map(marginTone), ['green', 'amber', 'amber', 'red', 'red']);
  assert.equal(marginTone(null), null);
});
