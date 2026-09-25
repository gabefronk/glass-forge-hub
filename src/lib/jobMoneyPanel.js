import { computeJobBudget } from "../../base44/shared/jobBudgetMath.js";
import { withComputedAmounts } from "./feeMath.js";
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

const BUDGET_COST_INPUTS = ["material_true_cost", "overhead_adder", "additional_install_material", "additional_equipment", "labor_cost_sub_pay", "labor_sell_price"];

// Keep the client-side owner check in one testable place. Entity RLS is the second
// boundary; this check prevents a crew browser from making a financial request at all.
export const canLoadJobMoney = (user) => isAgentCenterOwner(user);

export function aggregateJobMoney(jobId, { budgets = [], purchaseOrders = [], feeLines = [] } = {}) {
  const linkedBudgets = budgets
    .filter((row) => row.job_id === jobId)
    .map((row) => {
      const computed = computeJobBudget(row.inputs || {});
      return {
        ...row,
        displayComputed: {
          ...computed,
          total_cost_overhead: BUDGET_COST_INPUTS.some((field) => amount(row.inputs?.[field]) !== null) ? computed.total_cost_overhead : null,
          actual_total_sell: amount(row.inputs?.actual_total_sell) === null ? null : computed.actual_total_sell,
        },
      };
    });
  const linkedPurchaseOrders = purchaseOrders.filter((row) => row.job_id === jobId);
  const linkedFeeLines = withComputedAmounts(feeLines)
    .filter((row) => row.job_id === jobId && !row.superseded_by);

  return {
    budgets: linkedBudgets,
    purchaseOrders: linkedPurchaseOrders,
    feeLines: linkedFeeLines,
    totals: {
      budgetCost: total(linkedBudgets.map((row) => row.displayComputed), "total_cost_overhead"),
      budgetSell: total(linkedBudgets.map((row) => row.displayComputed), "actual_total_sell"),
      poDealer: total(linkedPurchaseOrders, "amount_dealer"),
      poCustomer: total(linkedPurchaseOrders, "amount_customer"),
      feeRecorded: total(linkedFeeLines, "fee_amt"),
      feeBilled: linkedFeeLines.length ? (total(linkedFeeLines.filter((row) => row.billed_to_bfs), "fee_amt") ?? 0) : null,
      feePaid: linkedFeeLines.length ? (total(linkedFeeLines.filter((row) => row.paid_to_ya), "fee_amt") ?? 0) : null,
    },
  };
}
