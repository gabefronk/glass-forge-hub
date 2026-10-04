import { activeBudgets, budgetFigures, budgetRollup } from "../../base44/shared/procurementCore.js";
import { withComputedAmounts } from "./feeMath.js";
import { withCompanions, buildSupersededSet } from "./invoicingFilters.js";
import { isAgentCenterOwner } from "./agentCenterAccess.js";

const amount = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const total = (rows, field) => {
  const values = rows.map((row) => amount(row[field])).filter((value) => value !== null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
};

// Keep the client-side owner check in one testable place. Entity RLS is the second
// boundary; this check prevents a crew browser from making a financial request at all.
export const canLoadJobMoney = (user) => isAgentCenterOwner(user);

// jobId may be one id or a list (the job plus its duplicate records), so money
// attached to any record in the duplicate group shows on the job page.
export function aggregateJobMoney(jobId, { budgets = [], purchaseOrders = [], feeLines = [], calendarEvents = [] } = {}) {
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

  return {
    budgets: linkedBudgets.map(row => ({ ...row, included_in_budget: activeIds.has(row.id) })),
    budgetWarnings: estimate.warnings,
    purchaseOrders: linkedPurchaseOrders,
    feeLines: linkedFeeLines,
    totals: {
      budgetCost: estimate.cost,
      budgetSell: estimate.sell,
      poDealer: total(activePurchaseOrders, "amount_dealer"),
      poCustomer: total(activePurchaseOrders, "amount_customer"),
      feeRecorded: total(linkedFeeLines, "fee_amt"),
      feeBilled: linkedFeeLines.length ? (total(linkedFeeLines.filter((row) => row.billed_to_bfs), "fee_amt") ?? 0) : null,
      feePaid: linkedFeeLines.length ? (total(linkedFeeLines.filter((row) => row.paid_to_ya), "fee_amt") ?? 0) : null,
    },
  };
}
