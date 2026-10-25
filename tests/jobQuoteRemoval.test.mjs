// Removing a duplicate or stale quote that is on a job (reversible, protected).
import test from 'node:test';
import assert from 'node:assert/strict';
import { jobQuoteRemovalBlockers, jobQuoteRemovalPatch } from '../base44/shared/unusedQuoteDeletion.mjs';
import { budgetVersion } from '../base44/shared/procurementCore.js';

const keeper = { id: 'keep', job_id: 'baxter', quote_number: '3517590', vendor: 'AMSCO', updated_date: 'v1' };
const dup = { id: 'dup', job_id: 'baxter', quote_number: '3517590', vendor: 'AMSCO WINDOWS', updated_date: 'v1' };
const po = { id: 'po', job_id: 'baxter', budget_id: 'keep', po_number: 'YA-0002', vendor_quote_ref: '3517590' };
const src = (over = {}) => ({ budgets: [keeper, dup], purchaseOrders: [po], vendorOrders: [], costInputs: [], setupSheets: [], ...over });
const body = (row) => ({ review_confirmed: true, expected_version: budgetVersion(row), request_key: 'k1' });

test('a duplicate copy can go while another copy keeps the quote number the PO uses', () => {
  assert.deepEqual(jobQuoteRemovalBlockers(dup, src()), []);
});

test('the copy a PO was built from is protected', () => {
  assert.match(jobQuoteRemovalBlockers(keeper, src()).join(' '), /purchase order was built from this quote/);
});

test('the last copy of a quote number a PO uses is protected', () => {
  const lone = src({ budgets: [dup], purchaseOrders: [{ ...po, budget_id: 'other' }] });
  assert.match(jobQuoteRemovalBlockers(dup, lone).join(' '), /no other copy of it is on the job/);
});

test('a stale job-money budget with nothing pointing at it can go', () => {
  const money = { id: 'money', job_id: 'baxter', quote_number: null, updated_date: 'v1' };
  assert.deepEqual(jobQuoteRemovalBlockers(money, src({ budgets: [keeper, money] })), []);
});

test('accounting, setup sheets, supplier orders and later revisions protect a quote', () => {
  for (const over of [{ costInputs: [{ id: 'c', budget_id: 'dup' }] }, { setupSheets: [{ id: 's', budget_ids: ['dup'] }] }, { vendorOrders: [{ id: 'o', budget_id: 'dup' }] }, { budgets: [keeper, dup, { id: 'rev', job_id: 'baxter', replaces_budget_id: 'dup' }] }]) {
    assert.ok(jobQuoteRemovalBlockers(dup, src(over)).length > 0, JSON.stringify(Object.keys(over)));
  }
});

test('a quote with no job goes through Delete unused quote instead', () => {
  assert.match(jobQuoteRemovalBlockers({ ...dup, job_id: null }, src()).join(' '), /not on a job/);
});

test('the removal is a reversible soft delete with a recovery note', () => {
  const p = jobQuoteRemovalPatch(dup, src(), body(dup), 'gabe@x.com', '2026-10-24T20:00:00Z');
  assert.equal(p.deleted_at, '2026-10-24T20:00:00Z');
  assert.equal(p.budget_usage, 'reference');
  assert.equal(p.link_history.at(-1).action, 'remove quote from job');
  assert.throws(() => jobQuoteRemovalPatch(dup, src(), { ...body(dup), review_confirmed: false }, 'g', 't'), /Confirm/);
  assert.throws(() => jobQuoteRemovalPatch(dup, src(), { ...body(dup), expected_version: 'stale' }, 'g', 't'), /changed/);
  assert.throws(() => jobQuoteRemovalPatch(keeper, src(), body(keeper), 'g', 't'), /purchase order/);
});
