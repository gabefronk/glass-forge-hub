// Request payment (Gabe, Oct 25): for a job sold outside BFS, build a prompt he copies into
// ChatGPT, which creates a DRAFT invoice in his QuickBooks Online company. The Hub never sends
// or emails anything. Every figure comes from the job's Purchasing row and its customer
// invoices. Pure: no React, no SDK.

const cents = (v) => Math.round(Number(v) * 100);
const dollars = (c) => c / 100;
const fmt = (v) => (v == null ? '—' : Number(v).toLocaleString('en-US', { style: 'currency', currency: 'USD' }));

export const REQUEST_KINDS = [
  { key: 'half', label: 'Half down', kind: 'deposit' },
  { key: 'final', label: 'Final payment', kind: 'balance' },
  { key: 'full', label: 'Full amount', kind: 'balance' },
];
export const requestKind = (key) => REQUEST_KINDS.find((k) => k.key === key) || REQUEST_KINDS[0];

// The likely next request from the job stage. Paid means nothing is left to request.
const EARLY = ['', 'sent_to_customer', 'ordered'];
export function suggestedRequest(stage = '') {
  if (stage === 'paid') return null;
  return EARLY.includes(stage) ? 'half' : 'final';
}

// What the customer has paid so far: recorded customer invoices marked paid when there are
// any; otherwise the stage is the evidence - from Half down paid on (before Paid), half the
// sale is taken as received.
const AFTER_HALF_DOWN = ['half_down', 'delivered', 'installed', 'billed', 'waiting_on_check', 'waiting_on_payment'];
export function receivedSoFar({ sale, stage = '', invoices = [] } = {}) {
  const live = invoices.filter((i) => !i.voided_at && i.kind !== 'labor_billing');
  if (live.length) return { value: dollars(live.filter((i) => i.paid_date).reduce((n, i) => n + cents(i.amount || 0), 0)), from: 'invoices' };
  if (sale == null) return { value: 0, from: 'stage' };
  if (stage === 'paid') return { value: Number(sale), from: 'stage' };
  if (AFTER_HALF_DOWN.includes(stage)) return { value: dollars(Math.round(cents(sale) / 2)), from: 'stage' };
  return { value: 0, from: 'stage' };
}

// The three amounts, in cents so a half cent rounds the same way every time: half down rounds
// up, and the final payment is whatever is left.
export function requestAmounts({ sale, received = 0 } = {}) {
  if (sale == null) return { half: null, final: null, full: null };
  const total = cents(sale);
  return { half: dollars(Math.round(total / 2)), final: dollars(total - cents(received)), full: dollars(total) };
}

// What the job is, in one line: the supplier quote's brand, number and units, else the job name.
export function scopeLine(job = {}, budgets = []) {
  const live = budgets.filter((b) => b.job_id === job.id && !b.deleted_at && b.budget_usage !== 'reference');
  const b = live[0];
  if (!b) return `${job.canonical_name || 'This job'}`;
  const brand = String(b.manufacturer || b.vendor || '').trim();
  const units = Number(b.openings_qty) || 0;
  return [brand && `${brand} quote ${b.quote_number || ''}`.trim(), units ? `${units} units` : ''].filter(Boolean).join(', ') || `${job.canonical_name || 'This job'}`;
}

// Things to fix before billing. Shown above the prompt; they never block it.
export function requestChecks({ sale, budgets = [], job = {}, stage = '', amount } = {}) {
  const out = [];
  if (sale == null) out.push('No sale price on this job yet');
  const live = budgets.filter((b) => b.job_id === job.id && !b.deleted_at && b.budget_usage !== 'reference');
  if (live.some((b) => b.budget_usage === 'draft')) out.push('The budget is still a Draft');
  if (live.some((b) => b.quote?.openings_qty_review)) out.push('Quantity needs review on the quote');
  if (stage === 'paid') out.push('This job is already marked Paid');
  if (amount != null && amount <= 0) out.push('Nothing is left to request');
  return out;
}

export function customerLabel(job = {}) {
  const name = String(job.customer_name || '').trim();
  if (name) return name;
  const builder = String(job.builder || '').trim();
  return builder ? `${job.canonical_name} (${builder})` : String(job.canonical_name || 'the customer');
}

export function buildPaymentPrompt({ key, job = {}, budgets = [], sale, received = 0, receivedFrom = 'stage', amount }) {
  const k = requestKind(key);
  const scope = scopeLine(job, budgets);
  const what = `${scope}, supply and install, ${job.canonical_name}`;
  const desc = key === 'half'
    ? `Half down (50% deposit) on ${what}. Contract ${fmt(sale)}.`
    : key === 'final'
      ? `Final payment on ${what}. Contract ${fmt(sale)}; ${fmt(received)} already received.`
      : `Payment in full for ${what}. Contract ${fmt(sale)}.`;
  const receivedText = received > 0 ? `${fmt(received)}${receivedFrom === 'stage' ? ' (half down, from the job stage)' : ''}` : '$0.00';
  return `Create a DRAFT invoice in my QuickBooks Online company. Do not send it and do not email anyone. Leave it for me to review.

Customer: ${customerLabel(job)}. Find this customer in QuickBooks. If there is no exact match, stop and ask me before creating one. Keep the email already on the customer.
Job: ${job.canonical_name}. ${scope}.

Invoice type: ${k.label}
Contract total: ${fmt(sale)}
Already received: ${receivedText}
Amount of this invoice: ${fmt(amount)}

One line item:
- Product/service: my existing window install item (ask me if none fits)
- Description: ${desc}
- Qty 1, Rate ${fmt(amount)}, Amount ${fmt(amount)}

Sales tax: none. The contract total already includes tax.
Terms: Due on receipt. Invoice date: today.
Memo: ${job.canonical_name}, ${k.label.toLowerCase()}.
Online payments: turn on card and bank transfer (ACH) if available.

Use these numbers exactly. Do not add tax, fees or discounts, and do not round.
When done, reply with the invoice number, the total and a link to the draft.`;
}
