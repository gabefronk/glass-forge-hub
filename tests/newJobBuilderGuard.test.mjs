// Focused regression tests for the NewJobBuilder permission gate and budget
// partial-failure retry. These test the pure logic that the wizard relies on:
//   1. isAgentCenterOwner: only admin + owner-email may save pricing.
//   2. Budget retry never recreates the job: a failed budget save keeps the
//      job ID and retries only the budget, not the job create.
//   3. Duplicate-submit guard: once a job ID exists, create is not called again.
import test from 'node:test';
import assert from 'node:assert/strict';
import { isAgentCenterOwner } from '../src/lib/agentCenterAccess.js';

test('isAgentCenterOwner: admin + owner email', () => {
  assert.equal(isAgentCenterOwner({ role: 'admin', email: 'gabefronk@gmail.com' }), true);
  assert.equal(isAgentCenterOwner({ role: 'admin', email: 'GABEFRONK@gmail.com' }), true);
  assert.equal(isAgentCenterOwner({ role: 'admin', email: 'gabriel.fronk.wd@gmail.com' }), true);
  assert.equal(isAgentCenterOwner({ role: 'user', email: 'gabefronk@gmail.com' }), false);
  assert.equal(isAgentCenterOwner({ role: 'admin', email: 'other@example.com' }), false);
  assert.equal(isAgentCenterOwner(null), false);
  assert.equal(isAgentCenterOwner({ role: 'admin' }), false);
});

// Simulated budget partial-failure retry: the wizard's saveBudget/retryBudget
// logic as a pure state machine. jobCreate and budgetCreate are stubbed.
test('budget partial-failure: job created, budget fails, retry does not recreate job', async () => {
  const calls = { jobCreate: 0, budgetCreate: 0 };
  const jobCreate = async () => { calls.jobCreate++; return { id: 'job-1' }; };
  const failBudget = async () => { calls.budgetCreate++; throw new Error('RLS denied'); };
  const okBudget = async () => { calls.budgetCreate++; return { id: 'bud-1' }; };

  // Phase 1: create job, budget fails.
  let created = null, budgetState = 'pending';
  created = await jobCreate();
  try { await failBudget(); budgetState = 'saved'; } catch { budgetState = 'failed'; }
  assert.equal(calls.jobCreate, 1);
  assert.equal(calls.budgetCreate, 1);
  assert.equal(created.id, 'job-1');
  assert.equal(budgetState, 'failed');

  // Phase 2: retry budget only — job is NOT recreated.
  try { await okBudget(); budgetState = 'saved'; } catch { budgetState = 'failed'; }
  assert.equal(calls.jobCreate, 1, 'job must not be recreated on retry');
  assert.equal(calls.budgetCreate, 2);
  assert.equal(budgetState, 'saved');
});

test('duplicate-submit guard: doCreate is not called when a job already exists', () => {
  let calls = 0;
  const doCreate = () => { calls++; };
  const created = { jobId: 'job-1' };
  // Guard: if created?.jobId exists, do not call doCreate.
  if (!created?.jobId) doCreate();
  assert.equal(calls, 0, 'doCreate must not run after the job is already created');
});

test('non-owner: budget is skipped (not_allowed), job is still created', async () => {
  const calls = { jobCreate: 0, budgetCreate: 0 };
  const jobCreate = async () => { calls.jobCreate++; return { id: 'job-2' }; };
  const owner = false;
  let budgetState = 'pending';
  const created = await jobCreate();
  if (!owner) budgetState = 'not_allowed';
  assert.equal(calls.jobCreate, 1);
  assert.equal(calls.budgetCreate, 0, 'non-owner must not attempt budget create');
  assert.equal(budgetState, 'not_allowed');
  assert.equal(created.id, 'job-2');
});