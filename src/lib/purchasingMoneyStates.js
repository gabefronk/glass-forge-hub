// Four distinct money states per job for vendor/material spend.
//
// Estimated -> Committed -> Incurred -> Paid are STAGES OF THE SAME MONEY.
// A dollar committed on a PO becomes incurred when the vendor bills it and
// paid when it is settled - so the four figures overlap by design and must
// NEVER be summed together, and none of them is an independent extra cost.
//
// State definitions (QBO-style job costing, from records the Hub already has):
//  - estimated:  the reviewed budget cost rollup for the job's active scopes.
//  - committed:  what open POs obligate us to pay (dealer amounts, no tax
//                field exists on a PO). Cancelled POs are excluded.
//  - incurred:   vendor bills actually received - the vendor has asked for
//                money (ACH link received) or the bill is already settled.
//                An UNPAID vendor bill still counts here; payment state does
//                not change incurred cost. Orders placed but not yet billed
//                (ordered / eta_set) stay commitment-stage only.
//  - paid:       vendor orders recorded paid or reconciled.
//
// Honest absence: a state with no qualifying records is null (dash), never 0.
// A state whose records include a missing amount reports partial: true so the
// shown figure is never mistaken for a complete total.

import { budgetRollup, isLiveBudget, amount, roundMoney } from './purchasingCoreTwin.js';

const BILLED_VO_STATUS = ['ach_link_received', 'paid', 'reconciled'];
const PAID_VO_STATUS = ['paid', 'reconciled'];

const isVendorOrderCancelled = (o, pos) =>
  Boolean(o.purchase_order_id && pos.some((p) => p.id === o.purchase_order_id && p.status === 'cancelled'));
export const isOrderPaid = (o) => PAID_VO_STATUS.includes(o?.status) || Boolean(o?.paid_at);
export const isOrderBilled = (o) =>
  BILLED_VO_STATUS.includes(o?.status) || Boolean(o?.ach_link) || Boolean(o?.paid_at);

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

  return {
    // Budget estimate is a cost rollup of active scopes; withheld (null) when
    // the rollup needs review, matching the money-tile withholding rules.
    estimated: { value: rollup.status === 'ready' ? rollup.cost : null, status: rollup.status, scopes: rollup.count },
    committed: sumKnown(pos, 'amount_dealer'),
    incurred: sumKnown(orders.filter(isOrderBilled), 'amount'),
    paid: sumKnown(orders.filter(isOrderPaid), 'amount'),
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
