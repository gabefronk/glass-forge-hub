// Money states per job for VENDOR MATERIAL spend, built only from what the
// records can actually prove.
//
// Estimated -> Committed -> Ordered are STAGES OF THE SAME MONEY. They overlap by
// design and must NEVER be summed together. Suppliers are paid up front (Gabe,
// Oct 25), so there is no supplier payment state or payables figure.
//
//  - estimated:  reviewed budget cost rollup - material INCL TAX + sub-pay
//                labor + overhead.
//  - committed:  PO dealer amounts, vendor material only.
//  - ordered:    supplier order amounts.
//  - incurred:   NOT TRACKED (no supplier bill records).
//
// Honest absence: a state with no qualifying records is null (dash), never 0.
// A state whose records include a missing amount reports partial: true so the
// shown figure is never mistaken for a complete total.

import { budgetRollup, isLiveBudget, amount, roundMoney } from './purchasingCoreTwin.js';

const isVendorOrderCancelled = (o, pos) =>
  Boolean(o.purchase_order_id && pos.some((p) => p.id === o.purchase_order_id && p.status === 'cancelled'));

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
    // Incurred actual is unknown until vendor bills exist as records.
    incurred: { value: null, tracked: false },
    ordered: sumKnown(orders, 'amount'),
  };
}

// True when there is anything worth showing at all.
export function hasMoneyStates(states) {
  if (!states) return false;
  return Boolean(
    states.estimated?.scopes > 0 ||
    states.committed?.records > 0 ||
    states.ordered?.records > 0
  );
}
