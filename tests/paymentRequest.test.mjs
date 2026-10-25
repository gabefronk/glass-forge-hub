// Request payment: amounts, what was received, the suggested request and the ChatGPT prompt.
import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestedRequest, receivedSoFar, requestAmounts, requestChecks, buildPaymentPrompt, scopeLine, customerLabel } from '../src/lib/paymentRequest.js';

const becky = { id: 'b', canonical_name: 'Becky Retro', builder: 'Cash Customer', payment_status: 'half_down' };
const budget = { id: 'q', job_id: 'b', manufacturer: 'Pella', quote_number: '21464768', openings_qty: 20, budget_usage: 'draft', quote: { openings_qty_review: true } };

test('the stage suggests the request; Paid has none', () => {
  assert.deepEqual(['', 'sent_to_customer', 'ordered'].map(suggestedRequest), ['half', 'half', 'half']);
  assert.deepEqual(['half_down', 'installed', 'billed', 'waiting_on_payment'].map(suggestedRequest), ['final', 'final', 'final', 'final']);
  assert.equal(suggestedRequest('paid'), null);
});

test('half down rounds up to the cent and the final payment is what is left', () => {
  const received = receivedSoFar({ sale: 59318.51, stage: 'half_down' });
  assert.deepEqual(received, { value: 29659.26, from: 'stage' });
  assert.deepEqual(requestAmounts({ sale: 59318.51, received: received.value }), { half: 29659.26, final: 29659.25, full: 59318.51 });
  assert.equal(receivedSoFar({ sale: 600, stage: 'ordered' }).value, 0);
  assert.deepEqual(requestAmounts({ sale: null }), { half: null, final: null, full: null });
});

test('recorded customer invoices win over the stage', () => {
  const invoices = [
    { kind: 'deposit', amount: 20000, paid_date: '2026-10-01' },
    { kind: 'progress', amount: 5000 },
    { kind: 'balance', amount: 999, paid_date: '2026-10-02', voided_at: '2026-10-03' },
    { kind: 'labor_billing', amount: 7777, paid_date: '2026-10-02' },
  ];
  assert.deepEqual(receivedSoFar({ sale: 59318.51, stage: 'half_down', invoices }), { value: 20000, from: 'invoices' });
});

test('checks flag a draft budget, a quantity to review, no sale, Paid and nothing left', () => {
  assert.deepEqual(requestChecks({ sale: 59318.51, budgets: [budget], job: becky, stage: 'half_down', amount: 29659.25 }), ['The budget is still a Draft', 'Quantity needs review on the quote']);
  assert.deepEqual(requestChecks({ sale: null, job: becky, stage: 'paid', amount: 0 }), ['No sale price on this job yet', 'This job is already marked Paid', 'Nothing is left to request']);
});

test('the prompt asks ChatGPT for a draft QuickBooks invoice with the exact figures', () => {
  const p = buildPaymentPrompt({ key: 'final', job: becky, budgets: [budget], sale: 59318.51, received: 29659.26, receivedFrom: 'stage', amount: 29659.25 });
  assert.match(p, /Create a DRAFT invoice in my QuickBooks Online company\. Do not send it and do not email anyone\./);
  assert.match(p, /Customer: Becky Retro \(Cash Customer\)\./);
  assert.match(p, /Job: Becky Retro\. Pella quote 21464768, 20 units\./);
  assert.match(p, /Invoice type: Final payment/);
  assert.match(p, /Contract total: \$59,318\.51/);
  assert.match(p, /Already received: \$29,659\.26 \(half down, from the job stage\)/);
  assert.match(p, /Amount of this invoice: \$29,659\.25/);
  assert.match(p, /Qty 1, Rate \$29,659\.25, Amount \$29,659\.25/);
  assert.match(p, /Use these numbers exactly/);
});

test('a labor-only job with no quote uses its name; a named customer wins', () => {
  const job = { id: 'l', canonical_name: 'install - bryan lairen', builder: 'Install', customer_name: 'Bryan Lairen' };
  assert.equal(scopeLine(job, []), 'install - bryan lairen');
  assert.equal(customerLabel(job), 'Bryan Lairen');
  const p = buildPaymentPrompt({ key: 'full', job, budgets: [], sale: 600, received: 0, amount: 600 });
  assert.match(p, /Payment in full for install - bryan lairen\. Contract \$600\.00\./);
  assert.match(p, /Already received: \$0\.00/);
});
