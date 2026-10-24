// Four distinct money states per job for VENDOR MATERIAL spend.
//
// Estimated -> Committed -> Incurred -> Paid are STAGES OF THE SAME MONEY.
// A dollar committed on a PO becomes incurred when the vendor bills it and
// paid when it is settled - so the four figures overlap by design and must
// NEVER be summed together, and none of them is an independent extra cost.
//
// Scope is explicit and uneven, by record design:
//  - estimated:  reviewed budget cost rollup - material INCL TAX + sub-pay
//                labor + overhead. The widest basis of the four.
//  - committed:  open PO dealer amounts - PRE-TAX (a PO carries no tax
//                field), vendor material only.
//  - incurred:   vendor bills actually received. A bill is established ONLY
//                by positive record evidence: an ACH payment link (the
//                vendor's payment request arrives with its invoice), an
//                ach_link_received status/timestamp, or a settled record.
//                An UNPAID vendor bill still counts as incurred - payment
//                state does not change incurred cost. Order confirmations,
//                ETAs and logged amounts on unbilled orders are NOT bills
//                (several records document their amount is pre-tax and not
//                the final payable), so they stay commitment-stage only.
//  - paid:       records marked paid or reconciled. Payment evidence is the
//                record's own reference (e.g. a processor invoice); unless
//                the order is reconciled, settlement is processor-marked,
//                not bank-verified - the UI says so.
//
// What these records CANNOT represent (no schema fields exist): partial
// payments, credits/refunds, and per-record tax on PO/vendor-order amounts.
// Nothing here implies full actual job cost - labor actuals are not in
// vendor orders at all.
//
// Honest absence: a state with no qualifying records is null (dash), never 0.
// A state whose records include a missing amount reports partial: true so the
// shown figure is never mistaken for a complete total.

import { budgetRollup, isLiveBudget, amount, roundMoney } from './purchasingCoreTwin.js';

const PAID_VO_STATUS = ['paid', 'reconciled'];

const isVendorOrderCancelled = (o, pos) =>
  Boolean(o.purchase_order_id && pos.some((p) => p.id === o.purchase_order_id && p.status === 'cancelled'));

export const isOrderPaid = (o) => PAID_VO_STATUS.includes(o?.status) || Boolean(o?.paid_at);

// A vendor bill exists only when the record carries positive billing evidence.
export const isOrderBilled = (o) =>
  o?.status === 'ach_link_received' || Boolean(o?.ach_link) || Boolean(o?.ach_link_received_at) || isOrderPaid(o);

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

  return {
    // Budget estimate is a cost rollup of active scopes; withheld (null) when
    // the rollup needs review, matching the money-tile withholding rules.
    estimated: { value: rollup.status === 'ready' ? rollup.cost : null, status: rollup.status, scopes: rollup.count },
    committed: sumKnown(pos, 'amount_dealer'),
    incurred: sumKnown(orders.filter(isOrderBilled), 'amount'),
    paid,
  };
}

// True when there is anything worth showing at all.
export function hasMoneyStates(states) {
  if (!states) return false;
  return Boolean(
    states.estimated?.scopes > 0 ||
    states.committed?.records > 0 ||
    states.incurred?.records > 0 ||
    states.paid?.records > 0
  );
}
