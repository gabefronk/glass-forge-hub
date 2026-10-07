// Pure regression tests for the inline per-job workspace selection helpers.
// No React, no SDK, no I/O. Verifies next-action → inline-section mapping and
// that jobProcurementRecords filters by EXACT immutable job id (never a name
// join), excluding cancelled POs and their vendor orders.
import test from 'node:test';
import assert from 'node:assert/strict';
import { sectionForNextKey, jobProcurementRecords } from '../src/lib/purchasingViewModel.js';

const JOB = 'a'.repeat(24);
const OTHER = 'b'.repeat(24);
const PO1 = 'c'.repeat(24);

test('sectionForNextKey: budgets/orders/tracking map to themselves; job and unknown → null (external link)', () => {
  assert.equal(sectionForNextKey('budgets'), 'budgets');
  assert.equal(sectionForNextKey('orders'), 'orders');
  assert.equal(sectionForNextKey('tracking'), 'tracking');
  assert.equal(sectionForNextKey('job'), null);
  assert.equal(sectionForNextKey(''), null);
  assert.equal(sectionForNextKey('invoicing'), null);
});

test('jobProcurementRecords: empty jobId returns all empty', () => {
  const r = jobProcurementRecords({ budgets: [{ id: 'x', job_id: JOB }], purchase_orders: [], vendor_orders: [], conflicts: [] }, '');
  assert.deepEqual(r, { budgets: [], pos: [], orders: [], conflicts: [] });
});

test('jobProcurementRecords: filters budgets/pos/orders/conflicts by EXACT job_id only', () => {
  const data = {
    budgets: [
      { id: 'b1', job_id: JOB, title: 'A' },
      { id: 'b2', job_id: OTHER, title: 'B' },
      { id: 'b3', job_id: JOB, deleted_at: '2026-01-01', title: 'deleted' },
    ],
    purchase_orders: [
      { id: PO1, job_id: JOB, po_number: 'YA-1', status: 'ordered' },
      { id: 'p2', job_id: OTHER, po_number: 'YA-2', status: 'ordered' },
    ],
    vendor_orders: [
      { id: 'o1', job_id: JOB, order_number: '09-1', purchase_order_id: PO1 },
      { id: 'o2', job_id: JOB, order_number: '09-2' },
      { id: 'o3', job_id: OTHER, order_number: '09-3' },
    ],
    conflicts: [
      { number: 'YA-1', job_ids: [JOB, OTHER] },
      { number: 'YA-9', job_ids: [OTHER] },
    ],
  };
  const r = jobProcurementRecords(data, JOB);
  assert.deepEqual(r.budgets.map((b) => b.id), ['b1']); // b2 other job, b3 deleted excluded
  assert.deepEqual(r.pos.map((p) => p.id), [PO1]); // p2 other job excluded
  assert.deepEqual(r.orders.map((o) => o.id), ['o1', 'o2']); // o3 other job excluded
  assert.deepEqual(r.conflicts.map((c) => c.number), ['YA-1']); // only conflict touching JOB
});

test('jobProcurementRecords: cancelled PO and its linked vendor order are excluded', () => {
  const data = {
    budgets: [],
    purchase_orders: [
      { id: PO1, job_id: JOB, po_number: 'YA-1', status: 'cancelled' },
      { id: 'p2', job_id: JOB, po_number: 'YA-2', status: 'ordered' },
    ],
    vendor_orders: [
      { id: 'o1', job_id: JOB, order_number: '09-1', purchase_order_id: PO1 }, // linked to cancelled PO
      { id: 'o2', job_id: JOB, order_number: '09-2', purchase_order_id: 'p2' },
      { id: 'o3', job_id: JOB, order_number: '09-3' }, // no PO link, kept
    ],
    conflicts: [],
  };
  const r = jobProcurementRecords(data, JOB);
  assert.deepEqual(r.pos.map((p) => p.id), ['p2']); // cancelled PO1 excluded
  assert.deepEqual(r.orders.map((o) => o.id), ['o2', 'o3']); // o1 excluded (linked to cancelled PO)
});

test('jobProcurementRecords: a name match never pulls in another job (exact id only)', () => {
  // Two jobs share a canonical_name but differ in id — only the exact-id job's records surface.
  const data = {
    budgets: [{ id: 'b1', job_id: JOB, title: 'SameName' }],
    purchase_orders: [{ id: 'p1', job_id: OTHER, po_number: 'YA-1', status: 'ordered' }],
    vendor_orders: [],
    conflicts: [],
  };
  const r = jobProcurementRecords(data, OTHER);
  assert.deepEqual(r.budgets.map((b) => b.id), []); // b1 belongs to JOB, not OTHER
  assert.deepEqual(r.pos.map((p) => p.id), ['p1']);
});