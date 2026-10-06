import test from 'node:test';
import assert from 'node:assert/strict';
import { matchWasatchAchPaid, findWasatchAchPaid, WASATCH_SENDER } from '../base44/shared/wasatchAch.js';

const OWNER_MB = { key: 'gf-gmail', visibility: 'owner' };
const MANAGER_MB = { key: 'ya-outlook', visibility: 'managers' };
const ACH = 'Wasatch Windows LLC\nInvoice INV001186 has been paid.\nAmount Paid: $7,787.92\nPayment Method: ACH (bank account ending 6612)';
const msg = (o = {}) => ({ direction: 'incoming', from_name: 'Wasatch windows llc', from_email: WASATCH_SENDER, subject: 'Invoice - INV001186 (PAID)', text: ACH, sent_at: '2026-10-06T12:08:47.000Z', ...o });

test('matches only a Helcim "Invoice - INV (PAID)" for Wasatch with ACH evidence, in the owner mailbox', () => {
  assert.deepEqual(matchWasatchAchPaid(OWNER_MB, msg()), { tax_record: true, vendor: 'Wasatch Windows LLC', reference: 'INV001186', amount_total: 7787.92, receipt_date: '2026-10-06' });
  assert.equal(matchWasatchAchPaid(OWNER_MB, msg({ subject: 'Fwd: Invoice - INV001186 (PAID)' })).reference, 'INV001186');
  assert.equal(matchWasatchAchPaid(OWNER_MB, msg({ text: ACH.replace('ACH (bank account ending 6612)', 'Bank withdrawal') })).tax_record, true);
  assert.equal(matchWasatchAchPaid(OWNER_MB, msg({ text: 'Wasatch Windows LLC paid by ACH.' })).amount_total, null, 'no labelled amount -> null, never a guess');
  assert.equal(matchWasatchAchPaid(OWNER_MB, msg({ sent_at: '2026-10-07T03:00:00.000Z' })).receipt_date, '2026-10-06', 'Denver date');
});

test('rejects other merchants, spoofed senders, display-name-only identity, non-payment notices, card payments, missing ACH evidence', () => {
  const no = (o, why, mb = OWNER_MB) => assert.equal(matchWasatchAchPaid(mb, msg(o)), null, why);
  no({ text: 'Acme Glass Supply\nAmount Paid: $50.00\nPayment Method: ACH' }, 'other Helcim merchant');
  no({ from_email: 'billing@wasatch-pay.com' }, 'spoofed sender with the right display name');
  no({ text: 'Invoice INV001186 has been paid.\nAmount Paid: $7,787.92\nPayment Method: ACH' }, 'merchant only in the display name');
  no({ subject: 'You have an upcoming payment to Wasatch windows llc' }, 'upcoming');
  no({ subject: 'Confirmation of ACH Payment Agreement with Wasatch windows llc' }, 'agreement');
  no({ subject: 'New Payment Request' }, 'payment request');
  no({ subject: 'Invoice - INV001186' }, 'unpaid invoice');
  no({ text: 'Wasatch Windows LLC\nAmount Paid: $84.00\nPaid with Visa ending 4242' }, 'card payment');
  no({ text: 'Wasatch Windows LLC\nAmount Paid: $84.00\nACH payment pending' }, 'pending ACH');
  no({ text: 'Wasatch Windows LLC\nAmount Paid: $84.00' }, 'no ACH evidence');
  no({ direction: 'outgoing' }, 'outgoing');
  no({}, 'manager mailbox', MANAGER_MB);
});

test('findWasatchAchPaid returns the newest matching message only', () => {
  const a = msg({ message_id: 'a' });
  const b = msg({ message_id: 'b', subject: 'New Payment Request' });
  assert.equal(findWasatchAchPaid(OWNER_MB, [a, b]).message.message_id, 'a');
  assert.equal(findWasatchAchPaid(OWNER_MB, [b]), null);
  assert.equal(findWasatchAchPaid(OWNER_MB, null), null);
});