import { activeBudgets, budgetFigures, budgetRollup } from "../../base44/shared/procurementCore.js";
import { withComputedAmounts } from "./feeMath.js";
import { isOrderPaid, isPaymentRequested } from "./purchasingMoneyStates.js";
import { withCompanions, buildSupersededSet } from "./invoicingFilters.js";
import { isAgentCenterOwner } from "./agentCenterAccess.js";
import { buildPurchasingCards } from "./purchasingViewModel.js";
import { scopesForJob, applyScopeRollup } from "./purchasingScopes.js";
import { summarizeCards } from "./purchasingSummary.js";

const amount = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const total = (rows, field) => {
  const values = rows.map((row) => amount(row[field])).filter((value) => value !== null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
};

// One rule for a job's money everywhere: the job page headline is the Purchasing row for
// the job (owner-entered sale and labor first, then the budget; cost on the materials incl
// tax basis; multi-scope jobs add their scope rows). Records on duplicate job records count
// toward the primary job. A figure the row shows as a dash is null here, not 0. Returns null
// when the job record is not loaded.
export function jobMoneyHeadline(jobId, memberIds = [], { jobs = [], budgets = [], purchaseOrders = [], vendorOrders = [], moneyInputs = [], today = '' } = {}) {
  const job = jobs.find((j) => j.id === jobId);
  if (!job) return null;
  const ids = new Set([jobId, ...memberIds]);
  const toPrimary = (rows) => rows.filter((r) => ids.has(r.job_id)).map((r) => ({ ...r, job_id: jobId }));
  const data = { jobs: [job], budgets: toPrimary(budgets), purchase_orders: toPrimary(purchaseOrders), vendor_orders: toPrimary(vendorOrders) };
  const [card] = buildPurchasingCards({ ...data, moneyInputs: moneyInputs.filter((m) => m.job_id === jobId), today });
  if (!card) return null;
  const rolled = applyScopeRollup({ ...card, scopes: scopesForJob(jobId, data) });
  const totals = summarizeCards([rolled]);
  const shown = (d, value) => (d?.suppressed || d?.value != null ? value : null);
  return {
    cost: shown(rolled.windows?.display, totals.windows),
    laborMaterial: shown(rolled.rough?.display, totals.rough),
    sale: shown(rolled.sale?.display, totals.sale),
    profit: shown(rolled.profitDisplay, totals.profit),
    partial: totals.partialScopes > 0,
  };
}

// Keep the client-side owner check in one testable place. Entity RLS is the second
// boundary; this check prevents a crew browser from making a financial request at all.
export const canLoadJobMoney = (user) => isAgentCenterOwner(user);

// jobId may be one id or a list (the job plus its duplicate records), so money
// attached to any record in the duplicate group shows on the job page.
export function aggregateJobMoney(jobId, { budgets = [], purchaseOrders = [], feeLines = [], calendarEvents = [], vendorOrders = [] } = {}) {
  const ids = new Set(Array.isArray(jobId) ? jobId : [jobId]);
  const linkedBudgets = budgets
    .filter((row) => ids.has(row.job_id))
    .map((row) => {
      const figures = budgetFigures(row);
      return {
        ...row,
        displayComputed: {
          ...figures.calculated,
          total_cost_overhead: figures.cost,
          actual_total_sell: figures.sell,
        },
      };
    });
  const activeIds = new Set(activeBudgets(linkedBudgets).map(row => row.id));
  const estimate = budgetRollup(linkedBudgets);
  const linkedPurchaseOrders = purchaseOrders.filter((row) => ids.has(row.job_id));
  const activePurchaseOrders = linkedPurchaseOrders.filter(row => row.status !== 'cancelled');
  const computed = withComputedAmounts(feeLines);
  const audited = withCompanions(computed, calendarEvents);
  const excluded = buildSupersededSet(audited, calendarEvents);
  const linkedFeeLines = audited.filter(row => ids.has(row.job_id) && !excluded.has(row.id));
  // Vendor/material money. Incurred actual is NOT computable: vendor orders
  // have no invoice/bill field, and an ACH link or paid mark is not bill
  // evidence - so only payment-requested and paid indicators surface, never
  // an invented actual. Vendor orders whose linked PO is cancelled are
  // excluded everywhere.
  const cancelledPOIds = new Set(linkedPurchaseOrders.filter(row => row.status === 'cancelled').map(row => row.id));
  const linkedVendorOrders = vendorOrders.filter(row => ids.has(row.job_id) && !(row.purchase_order_id && cancelledPOIds.has(row.purchase_order_id)));
  const requestedOrders = linkedVendorOrders.filter(isPaymentRequested);
  const paidOrders = linkedVendorOrders.filter(isOrderPaid);

  return {
    budgets: linkedBudgets.map(row => ({ ...row, included_in_budget: activeIds.has(row.id) })),
    budgetWarnings: estimate.warnings,
    purchaseOrders: linkedPurchaseOrders,
    vendorOrders: linkedVendorOrders,
    feeLines: linkedFeeLines,
    totals: {
      budgetCost: estimate.cost,
      budgetSell: estimate.sell,
      poDealer: total(activePurchaseOrders, "amount_dealer"),
      poCustomer: total(activePurchaseOrders, "amount_customer"),
      voPaymentRequested: total(requestedOrders, "amount"),
      voPaid: total(paidOrders, "amount"),
      feeRecorded: total(linkedFeeLines, "fee_amt"),
      feeBilled: linkedFeeLines.length ? (total(linkedFeeLines.filter((row) => row.billed_to_bfs), "fee_amt") ?? 0) : null,
      feePaid: linkedFeeLines.length ? (total(linkedFeeLines.filter((row) => row.paid_to_ya), "fee_amt") ?? 0) : null,
    },
  };
}
