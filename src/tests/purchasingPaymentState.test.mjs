// Payment tri-state tests for the inline workspace vendor-order badge. Same
// semantics as the viewmodel's refsForJob payment logic: Paid / Unpaid /
// Unknown — never blindly labels an unrecorded status "Unpaid".
import test from 'node:test';
import assert from 'node:assert/strict';
import { paymentState } from '../src/lib/purchasingViewModel.js';

test('paymentState: Paid for paid/reconciled status or paid_at', () => {
  assert.deepEqual(paymentState({ status: 'paid' }), { label: 'Paid', tone: 'ok' });
  assert.deepEqual(paymentState({ status: 'reconciled' }), { label: 'Paid', tone: 'ok' });
  assert.deepEqual(paymentState({ status: 'ordered', paid_at: '2026-10-07' }), { label: 'Paid', tone: 'ok' });
});

test('paymentState: Unpaid when recorded but not paid', () => {
  assert.deepEqual(paymentState({ status: 'ordered', amount: 100 }), { label: 'Unpaid', tone: 'warn' });
  assert.deepEqual(paymentState({ status: 'eta_set', amount: 100 }), { label: 'Unpaid', tone: 'warn' });
  assert.deepEqual(paymentState({ status: 'ach_link_received' }), { label: 'Unpaid', tone: 'warn' });
});

test('paymentState: Unknown when nothing recorded (no status, no paid_at, no real amount)', () => {
  assert.deepEqual(paymentState({}), { label: 'Unknown', tone: 'warn' });
  assert.deepEqual(paymentState({ amount: 0 }), { label: 'Unknown', tone: 'warn' });
  assert.deepEqual(paymentState({ amount: '' }), { label: 'Unknown', tone: 'warn' });
  assert.deepEqual(paymentState({ amount: null }), { label: 'Unknown', tone: 'warn' });
});