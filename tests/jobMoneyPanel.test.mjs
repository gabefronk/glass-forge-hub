import test from "node:test";
import assert from "node:assert/strict";
import { aggregateJobMoney, canLoadJobMoney } from "../src/lib/jobMoneyPanel.js";

test("money requests are allowed only for an existing owner account", () => {
  assert.equal(canLoadJobMoney({ role: "admin", email: "gabefronk@gmail.com" }), true);
  assert.equal(canLoadJobMoney({ role: "admin", email: "crew@example.com" }), false);
  assert.equal(canLoadJobMoney({ role: "user", email: "gabefronk@gmail.com" }), false);
  assert.equal(canLoadJobMoney(null), false);
});

test("aggregates only linked source records and keeps estimate, PO, billed, and paid totals distinct", () => {
  const result = aggregateJobMoney("job-1", {
    budgets: [
      { id: "b1", job_id: "job-1", inputs: { material_true_cost: 1000, actual_total_sell: 2000 } },
      { id: "other-budget", job_id: "job-2", inputs: { material_true_cost: 9000, actual_total_sell: 9999 } },
    ],
    purchaseOrders: [
      { id: "po1", job_id: "job-1", amount_dealer: 700, amount_customer: 1200, status: "received" },
      { id: "other-po", job_id: "job-2", amount_dealer: 8000, amount_customer: 9000 },
    ],
    feeLines: [
      { id: "f1", job_id: "job-1", labor_amt: 1000, fee_pct: 0.1, manually_adjusted: true, billed_to_bfs: true, paid_to_ya: false },
      { id: "f2", job_id: "job-1", labor_amt: 500, fee_pct: 0.1, manually_adjusted: true, billed_to_bfs: true, paid_to_ya: true },
      { id: "duplicate", job_id: "job-1", labor_amt: 9000, fee_pct: 1, manually_adjusted: true, paid_to_ya: true, superseded_by: "f1" },
      { id: "other-fee", job_id: "job-2", labor_amt: 9000, fee_pct: 1, manually_adjusted: true, paid_to_ya: true },
    ],
  });

  assert.equal(result.totals.budgetCost, 1074.5);
  assert.equal(result.totals.budgetSell, 2000);
  assert.equal(result.totals.poDealer, 700);
  assert.equal(result.totals.poCustomer, 1200);
  assert.equal(result.totals.feeRecorded, 150);
  assert.equal(result.totals.feeBilled, 150);
  assert.equal(result.totals.feePaid, 50);
  assert.deepEqual(result.purchaseOrders.map((row) => row.id), ["po1"]);
  assert.deepEqual(result.feeLines.map((row) => row.id), ["f1", "f2"]);
});

test("a received purchase order never contributes to the paid total", () => {
  const result = aggregateJobMoney("job-1", {
    purchaseOrders: [{ id: "po1", job_id: "job-1", amount_dealer: 4000, status: "received" }],
  });
  assert.equal(result.totals.poDealer, 4000);
  assert.equal(result.totals.feePaid, null);
});

test("missing source amounts remain unavailable instead of becoming invented zero totals", () => {
  const result = aggregateJobMoney("job-1", {
    budgets: [{ id: "b1", job_id: "job-1", inputs: {} }],
    purchaseOrders: [{ id: "po1", job_id: "job-1", status: "issued" }],
  });
  assert.equal(result.totals.budgetCost, null);
  assert.equal(result.totals.budgetSell, null);
  assert.equal(result.totals.poDealer, null);
  assert.equal(result.totals.poCustomer, null);
  assert.equal(result.totals.feeRecorded, null);
});
