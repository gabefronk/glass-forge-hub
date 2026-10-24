// Money states per job for VENDOR MATERIAL spend, built only from what the
// records can actually prove.
//
// Estimated -> Committed -> Incurred -> Paid are STAGES OF THE SAME MONEY.
// They overlap by design and must NEVER be summed together.
//
//  - estimated:  reviewed budget cost rollup - material INCL TAX + sub-pay
//                labor + overhead. The widest basis of the four.
//  - committed:  open PO dealer amounts - PRE-TAX (a PO carries no tax
//                field), vendor material only.
//  - incurred:   NOT TRACKED. The vendor-order schema has no invoice/bill
//                field: an ACH payment link is a payment request (and could
//                be a deposit), an order confirmation is not a bill, and a
//                paid mark is payment evidence, not proof of what cost was
//                incurred. Until bill evidence exists as a record, incurred
//                actual stays unknown - never inferred from status fields.
//  - paid:       records marked paid or reconciled. Payment evidence is the
//                record's own reference (e.g. a processor invoice); unless
//                the order is reconciled, settlement is processor-marked,
//                not bank-verified - the UI says so.
//
// Honest indicators the records DO support (not money states):
//  - paymentRequested: orders carrying an ACH payment link or its received
//    timestamp but not yet marked paid - the vendor asked for this money.
//
// What these records CANNOT represent (no schema fields exist): incurred
// bills, partial payments, credits/refunds, and per-record tax on PO or
// vendor-order amounts. Nothing here implies full actual job cost - labor
// actuals are not in vendor orders at all.
//
// Honest absence: a state with no qualifying records is null (dash), never 0.
// A state whose records include a missing amount reports partial: true so the
// shown figure is never mistaken for a complete total.

import { budgetRollup, isLiveBudget, amount, roundMoney } from './purchasingCoreTwin.js';

const PAID_VO_STATUS = ['paid', 'reconciled'];

const isVendorOrderCancelled = (o, pos) =>
  Boolean(o.purchase_order_id && pos.some((p) => p.id === o.purchase_order_id && p.status === 'cancelled'));

export const isOrderPaid = (o) => PAID_VO_STATUS.includes(o?.status) || Boolean(o?.paid_at);

// A payment request exists when the vendor sent an ACH link (its timestamp
// or the link itself) and the order is not yet marked paid. A request is a
// signal, not a bill and not a payment.
export const isPaymentRequested = (o) =>
  (o?.status === 'ach_link_received' || Boolean(o?.ach_link) || Boolean(o?.ach_link_received_at)) && !isOrderPaid(o);

// How strong the payment evidence is: reconciled = tied out; otherwise the
// record's paid mark is processor-reported, not independently settled.
export const paymentEvidence = (o) =>
  o?.status === 'reconciled' || Boolean(o?.reconciled_at) ? 'reconciled' : 'processor_marked';

function sumKnown(records, field) {
  let total = 0, known = 0, missing = 0;
  for (const r of records) {
    const v = amount(r?.[field]);
    if (v === null) missing += 1;
    else { total += v; known += 1; }
  }
  return { value: known ? roundMoney(total) : null, records: records.length, known, missing, partial: missing > 0 };
}

export function moneyStatesForJob(jobId, { budgets = [], purchaseOrders = [], vendorOrders = [] } = {}) {
  const jobBudgets = budgets.filter((b) => b.job_id === jobId && isLiveBudget(b));
  const rollup = budgetRollup(jobBudgets);
  const pos = purchaseOrders.filter((p) => p.job_id === jobId && p.status !== 'cancelled');
  const orders = vendorOrders.filter((o) => o.job_id === jobId && !isVendorOrderCancelled(o, purchaseOrders));

  const paidOrders = orders.filter(isOrderPaid);
  const paid = sumKnown(paidOrders, 'amount');
  paid.reconciled = paidOrders.filter((o) => paymentEvidence(o) === 'reconciled').length;
  paid.processorMarked = paidOrders.length - paid.reconciled;

  const requestedOrders = orders.filter(isPaymentRequested);
  const requested = sumKnown(requestedOrders, 'amount');

  return {
    // Budget estimate is a cost rollup of active scopes; withheld (null) when
    // the rollup needs review, matching the money-tile withholding rules.
    estimated: { value: rollup.status === 'ready' ? rollup.cost : null, status: rollup.status, scopes: rollup.count },
    committed: sumKnown(pos, 'amount_dealer'),
    // Incurred actual is unknown until vendor bills exist as records.
    incurred: { value: null, tracked: false },
    paid,
    paymentRequested: requested,
  };
}

// True when there is anything worth showing at all.
export function hasMoneyStates(states) {
  if (!states) return false;
  return Boolean(
    states.estimated?.scopes > 0 ||
    states.committed?.records > 0 ||
    states.paid?.records > 0 ||
    states.paymentRequested?.records > 0
  );
}
