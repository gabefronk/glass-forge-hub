import './support/register-src-alias.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';

const { PAYMENT_STAGES, paymentStage, paymentPatch } = await import('../src/lib/jobPayment.js');

test('the five tracking stages match what Gabriel asked for (Partial added 10/22)', () => {
  assert.deepEqual(PAYMENT_STAGES.map((s) => s.label), [
    'Job installed',
    'Sent for payment · QuickBooks',
    'Waiting on payment',
    'Partial payment',
    'Paid',
  ]);
});

test('paymentStage rejects unknown keys and finds known ones', () => {
  assert.equal(paymentStage('paid').label, 'Paid');
  assert.equal(paymentStage('nonsense'), null);
  assert.equal(paymentStage(undefined), null);
});

test('tapping a stage sets status and timestamp', () => {
  const patch = paymentPatch({ payment_status: null, payment_status_at: null }, 'sent_for_payment', '2026-10-21T10:00:00Z');
  assert.deepEqual(patch, { payment_status: 'sent_for_payment', payment_status_at: '2026-10-21T10:00:00Z' });
});

test('tapping a different stage moves to it', () => {
  const patch = paymentPatch({ payment_status: 'installed', payment_status_at: '2026-10-20T09:00:00Z' }, 'waiting_on_payment', '2026-10-21T10:00:00Z');
  assert.deepEqual(patch, { payment_status: 'waiting_on_payment', payment_status_at: '2026-10-21T10:00:00Z' });
});

test('tapping the active stage again clears tracking', () => {
  const patch = paymentPatch({ payment_status: 'paid', payment_status_at: '2026-10-21T10:00:00Z' }, 'paid', '2026-10-21T11:00:00Z');
  assert.deepEqual(patch, { payment_status: null, payment_status_at: null });
});

test('an unknown stage throws instead of writing garbage', () => {
  assert.throws(() => paymentPatch({}, 'half-paid'), /unknown payment stage/);
});
