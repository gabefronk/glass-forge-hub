import test from "node:test";
import assert from "node:assert/strict";
import { calculateJobProfitability } from "../src/lib/jobProfitability.js";

const baseLine = {
  id: "line-1",
  job_id: "job-1",
  job_name_norm: "Pulte Home - Lot 12",
  invoice_month: "2026-09",
  job_date: "2026-09-05",
  source: "calendar",
  billable: true,
  billed_to_bfs: false,
  labor_amt: 1000,
  fee_amt: 100,
  fee_pct: 0.1,
  calendar_event_id: "event-1",
};

test("linked quote costs, actual labor, install materials and overhead produce final EBIT", () => {
  const [job] = calculateJobProfitability({
    rows: [baseLine],
    reportStatusMap: new Map([["event-1", "ok"]]),
    jobs: [{ id: "job-1", accepted_quote_snapshot: { result: { totals: { dealer_cost: 7000, customer_total: 10000 } } } }],
    costInputs: [{ job_id: "job-1", month: "2026-09", route: "bfs_installed_sale", actual_labor_cost: 450, installation_material_cost: 125, allocated_overhead: 75 }],
  });
  assert.equal(job.product_profit, 3000);
  assert.equal(job.product_profit_contribution, 3000);
  assert.equal(job.installation_profit, 425);
  assert.equal(job.total_gross_profit, 3425);
  assert.equal(job.ebit_contribution, 3350);
  assert.equal(job.provisional, false);
  assert.equal(job.completion_chain.ready_to_invoice, true);
});

test("split routes split product profit only and keep install profit separate", () => {
  const [job] = calculateJobProfitability({
    rows: [{ ...baseLine, labor_amt: 2500 }],
    reportStatusMap: new Map([["event-1", "ok"]]),
    costInputs: [{ job_id: "job-1", month: "2026-09", route: "direct_manufacturer_turnkey", product_sell: 12000, product_cost: 8000, actual_labor_cost: 900, installation_material_cost: 100, allocated_overhead: 0 }],
  });
  assert.equal(job.product_profit, 4000);
  assert.equal(job.product_profit_contribution, 2000);
  assert.equal(job.installation_profit, 1500);
  assert.equal(job.total_gross_profit, 3500);
});

test("labor fallback is per worker per workday and remains provisional", () => {
  const [job] = calculateJobProfitability({
    rows: [baseLine],
    reportStatusMap: new Map([["event-1", "ok"]]),
    costInputs: [{ job_id: "job-1", month: "2026-09", route: "bfs_supply_ya_install", worker_count: 3, workday_count: 2, installation_material_cost: 40 }],
  });
  assert.equal(job.installation_labor_cost, 1200);
  assert.equal(job.installation_labor_estimated, true);
  assert.equal(job.installation_profit, -240);
  assert.equal(job.provisional, true);
});

test("roll planning supports fractional and whole-roll material assumptions", () => {
  const fractional = calculateJobProfitability({ rows: [baseLine], costInputs: [{ job_id: "job-1", month: "2026-09", worker_count: 1, material_roll_price: 180, expected_windows_per_roll: 30, job_window_count: 12 }] })[0];
  assert.equal(fractional.planned_material_cost, 72);
  assert.equal(fractional.material_roll_use, 0.4);

  const whole = calculateJobProfitability({ rows: [baseLine], costInputs: [{ job_id: "job-1", month: "2026-09", worker_count: 1, material_roll_price: 180, expected_windows_per_roll: 30, job_window_count: 31, material_roll_mode: "whole_roll" }] })[0];
  assert.equal(whole.planned_material_cost, 360);
  assert.equal(whole.material_roll_use, 2);
});

test("missing costs do not block invoice readiness or fabricate EBIT", () => {
  const [job] = calculateJobProfitability({ rows: [baseLine], reportStatusMap: new Map([["event-1", "ok"]]) });
  assert.equal(job.completion_chain.ready_to_invoice, true);
  assert.equal(job.product_cost, null);
  assert.equal(job.ebit_contribution, null);
  assert.ok(job.missing_inputs.includes("product/material cost"));
});

test("BFS installed sales keep labor basis, FeeLine invoice amount and product revenue distinct", () => {
  const rows = [
    { ...baseLine, id: "pulte", job_id: "pulte", job_name_norm: "pulte home - bldg 18 the peaks 131-135", labor_amt: 6425, fee_amt: 642.5, calendar_event_id: "pulte-event" },
    { ...baseLine, id: "ivory", job_id: "ivory", job_name_norm: "ivory - 217 christensen farms", labor_amt: 2493, fee_amt: 249.3, calendar_event_id: "ivory-event" },
    { ...baseLine, id: "holmes", job_id: "holmes", job_name_norm: "holmes homes - 214-216", labor_amt: 1800, fee_amt: 180, calendar_event_id: "holmes-event" },
  ];
  const reportStatusMap = new Map(rows.map((row) => [row.calendar_event_id, "ok"]));
  const records = calculateJobProfitability({ rows, reportStatusMap });
  const byId = new Map(records.map((job) => [job.job_id, job]));

  assert.equal(byId.get("pulte").installation_revenue, 6425);
  assert.equal(byId.get("pulte").invoice_fee_total, 642.5);
  assert.equal(byId.get("pulte").customer_revenue, null);
  assert.equal(byId.get("pulte").product_sell, null);
  assert.equal(byId.get("pulte").product_profit, null);
  assert.equal(byId.get("pulte").total_gross_profit, null);
  assert.equal(byId.get("pulte").ebit_contribution, null);
  assert.equal(byId.get("pulte").completion_chain.ready_to_invoice, true);

  assert.equal(byId.get("ivory").invoice_fee_total, 249.3);
  assert.equal(byId.get("ivory").customer_revenue, null);
  assert.equal(byId.get("holmes").invoice_fee_total, 180);
  assert.equal(byId.get("holmes").customer_revenue, null);
});
