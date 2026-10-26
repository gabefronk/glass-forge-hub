import test from 'node:test';
import assert from 'node:assert/strict';
import { unlinkedMoneyGroups } from '../src/lib/unlinkedMoney.js';

test('shop purchases are never listed as POs needing a job or a budget', () => {
  const g = unlinkedMoneyGroups({
    pos: [
      { id: 'shop', job_id: '', purchase_type: 'shop', status: 'issued' },
      { id: 'shopJob', job_id: 'j1', purchase_type: 'shop', status: 'ordered' },
      { id: 'orphan', job_id: '', purchase_type: 'job', status: 'ordered' },
      { id: 'void', job_id: null, status: 'cancelled' },
      { id: 'noBudget', job_id: 'j2', budget_id: null, status: 'ordered' },
    ],
  });
  assert.deepEqual(g.posNoJob.map((p) => p.id), ['orphan']);
  assert.deepEqual(g.posNoBudget.map((p) => p.id), ['noBudget']);
});

test('only unbilled billable lines with no job, and live budgets with no job', () => {
  const g = unlinkedMoneyGroups({
    lines: [{ id: 'a', billable: true }, { id: 'b', billable: true, job_id: 'j' }, { id: 'c', billable: false }, { id: 'd', billable: true, billed_to_bfs: true }],
    budgets: [{ id: 'x' }, { id: 'y', deleted_at: '2026-10-04' }, { id: 'z', job_id: 'j' }],
  });
  assert.deepEqual(g.lines.map((r) => r.id), ['a']);
  assert.deepEqual(g.budgets.map((b) => b.id), ['x']);
});
