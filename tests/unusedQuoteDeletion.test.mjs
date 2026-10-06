import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { unusedQuoteBlockers, unusedQuoteDeletionPatch } from '../base44/shared/unusedQuoteDeletion.mjs';
import { activeBudgets, budgetVersion, isLiveBudget, prepareBudgetPO } from '../base44/shared/procurementCore.js';
import { assertBudgetVersion } from '../base44/shared/budgetMutationPolicy.mjs';
import { procurementAction } from '../base44/shared/procurementService.mjs';

const owner = { role: 'admin', email: 'gabriel.fronk.wd@gmail.com' };
const old = { id: 'old-attempt', title: 'QUOTATION 3526703', quote_number: '3526703', job_id: null, updated_date: 'v1', quote: { customer_po: 'YA-0007' }, inputs: { material_true_cost: 108.24, actual_total_sell: 453.7 }, drive_quote_file_id: 'source-file' };
const correct = { id: 'correct-budget', quote_number: '3526241', job_id: 'sandy', inputs: { material_true_cost: 108.24, actual_total_sell: 600 }, updated_date: 'v1' };
const po = { id: 'correct-po', budget_id: correct.id, job_id: 'sandy', vendor_quote_ref: '3526241', po_number: 'YA-0007', status: 'ordered' };
const stamp = '2026-10-03T18:00:00.000Z';
const payload = (row = old) => ({ action: 'delete_unused_quote', budget_id: row.id, expected_version: budgetVersion(row), request_key: 'unused-quote-delete-test', review_confirmed: true });
const sources = overrides => ({ budgets: [old, correct], purchaseOrders: [po], vendorOrders: [], costInputs: [], setupSheets: [], ...overrides });

function store(overrides = {}) {
  const data = structuredClone({ JobBudgets: [old, correct], PurchaseOrders: [po], VendorOrders: [], JobCostInputs: [], JobSetupSheets: [], Jobs: [{ id: 'sandy', po_numbers: ['YA-0007'], name: 'Keep Sandy' }], ProcurementControl: [{ id: 'control', key: 'global', revision: 0, last_number: 7, lock_token: '' }], ...overrides });
  const writes = [];
  let seq = 1;
  const api = Object.fromEntries(Object.keys(data).map(name => [name, {
    list: async (_sort, limit = 1000, skip = 0) => structuredClone(data[name].slice(skip, skip + limit)),
    filter: async (query, _sort, limit = 1000) => structuredClone(data[name].filter(row => Object.entries(query).every(([k, v]) => row[k] === v)).slice(0, limit)),
    get: async id => structuredClone(data[name].find(row => row.id === id)),
    updateMany: async (query, ops) => {
      const rows = data[name].filter(row => Object.entries(query).every(([k, v]) => row[k] === v));
      for (const row of rows) { Object.assign(row, structuredClone(ops.$set || {})); for (const [k, v] of Object.entries(ops.$inc || {})) row[k] = (row[k] || 0) + v; row.updated_date = `updated-${++seq}`; }
      writes.push({ name, query, ops }); return { updated: rows.length };
    },
  }]));
  return { api, data, writes };
}
const deps = { now: () => stamp, uuid: () => 'delete-test-lock' };

test('unused first attempt is removable despite sharing YA-0007 with the correct quote', () => {
  assert.deepEqual(unusedQuoteBlockers(old, sources()), []);
  const patch = unusedQuoteDeletionPatch(old, sources(), payload(), owner.email, stamp);
  assert.equal(patch.deleted_at, stamp); assert.equal(patch.budget_usage, 'reference');
  assert.equal(patch.inputs, undefined); assert.equal(patch.quote, undefined); assert.equal(patch.job_id, undefined);
});
test('missing reference checks fail closed and a linked job is protected', () => {
  assert.match(unusedQuoteBlockers(old, {})[0], /completely checked/);
  assert.match(unusedQuoteBlockers(correct, sources()).join(' '), /linked to a job/);
});
test('explicit budget links, snapshots, and exact quote references block deletion', () => {
  for (const ref of [{ budget_id: old.id }, { budget_snapshot: { id: old.id } }, { vendor_quote_ref: old.quote_number }]) {
    assert.match(unusedQuoteBlockers(old, sources({ purchaseOrders: [ref] })).join(' '), /purchase order/);
  }
  assert.match(unusedQuoteBlockers(old, sources({ vendorOrders: [{ budget_id: old.id }] })).join(' '), /supplier order/);
});
test('accounting, setup and revision references are protected', () => {
  assert.match(unusedQuoteBlockers(old, sources({ costInputs: [{ budget_snapshot: { source_budget_ids: [old.id] } }] })).join(' '), /Accounting/);
  assert.match(unusedQuoteBlockers(old, sources({ costInputs: [{ quote_number: '3526703, 987654' }] })).join(' '), /Accounting/);
  assert.match(unusedQuoteBlockers(old, sources({ setupSheets: [{ sources: { budget_id: old.id } }] })).join(' '), /setup/);
  assert.match(unusedQuoteBlockers(old, sources({ budgets: [old, { id: 'replacement', replaces_budget_id: old.id }] })).join(' '), /version/);
});
test('unconfirmed and stale requests cannot remove a quote', () => {
  assert.throws(() => unusedQuoteDeletionPatch(old, sources(), { ...payload(), review_confirmed: false }, owner.email, stamp), /Confirm/);
  assert.throws(() => unusedQuoteDeletionPatch(old, sources(), { ...payload(), expected_version: 'stale' }, owner.email, stamp), /changed/);
});
test('deleted attempts never enter active totals or become orderable again', () => {
  const gone = { ...old, deleted_at: stamp, budget_usage: 'included' };
  assert.equal(isLiveBudget(gone), false);
  assert.deepEqual(activeBudgets([gone, correct]).map(r => r.id), [correct.id]);
  assert.throws(() => prepareBudgetPO({ ...gone, job_id: 'sandy' }), /deleted/);
  assert.throws(() => assertBudgetVersion(gone, budgetVersion(gone)), /deleted/);
});
test('server deletion keeps source values and every job/PO/accounting record intact', async () => {
  const s = store(), before = structuredClone(s.data);
  const result = await procurementAction(s.api, payload(), owner, deps);
  assert.equal(result.deleted, true); assert.equal(result.budget_id, old.id);
  const deleted = s.data.JobBudgets[0];
  assert.deepEqual(deleted.inputs, old.inputs); assert.deepEqual(deleted.quote, old.quote);
  assert.equal(deleted.drive_quote_file_id, old.drive_quote_file_id);
  for (const name of ['Jobs', 'PurchaseOrders', 'VendorOrders', 'JobCostInputs', 'JobSetupSheets']) assert.deepEqual(s.data[name], before[name]);
  assert.deepEqual(s.data.JobBudgets[1], correct);
  assert.equal(s.data.ProcurementControl[0].lock_token, '');
  const overview = await procurementAction(s.api, { action: 'overview' }, owner, deps);
  assert.deepEqual(overview.budgets.map(r => r.id), [correct.id]);
});
test('repeated delete is idempotent and does not alter the recovery record again', async () => {
  const s = store(); await procurementAction(s.api, payload(), owner, deps);
  const first = structuredClone(s.data.JobBudgets[0]);
  const result = await procurementAction(s.api, payload(), owner, deps);
  assert.equal(result.already_deleted, true); assert.deepEqual(s.data.JobBudgets[0], first);
});
test('non-owner, missing review and failed reads never delete a quote', async () => {
  const s = store();
  await assert.rejects(procurementAction(s.api, payload(), { role: 'admin', email: 'not-owner@example.com' }, deps), /owner-only/);
  await assert.rejects(procurementAction(s.api, { ...payload(), review_confirmed: false }, owner, deps), /Confirm/);
  assert.equal(s.writes.length, 0);
  s.api.JobCostInputs.list = async () => { throw new Error('read failed'); };
  await assert.rejects(procurementAction(s.api, payload(), owner, deps), /read failed/);
  assert.equal(s.data.JobBudgets[0].deleted_at, undefined);
});
test('compare-and-set detects a concurrent change and leaves quote undeleted', async () => {
  const s = store(); s.api.JobBudgets.updateMany = async () => ({ updated: 0 });
  await assert.rejects(procurementAction(s.api, payload(), owner, deps), /Another edit/);
  assert.equal(s.data.JobBudgets[0].deleted_at, undefined);
});
test('deleted quote cannot be reactivated through scope selection', async () => {
  const s = store(); await procurementAction(s.api, payload(), owner, deps);
  await assert.rejects(procurementAction(s.api, { ...payload(), action: 'budget_usage', budget_usage: 'included' }, owner, deps), /deleted/);
});
test('UI supplies confirmation, server action and errors instead of a client-only deletion', () => {
  const src = readFileSync(new URL('../src/components/budgets/DeleteUnusedQuoteButton.jsx', import.meta.url), 'utf8');
  for (const token of ['window.confirm', 'delete_unused_quote', 'expected_version', 'role="alert"', 'Delete unused quote']) assert.ok(src.includes(token));
});
