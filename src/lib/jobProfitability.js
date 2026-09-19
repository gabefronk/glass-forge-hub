import { computeFeeAmt, formatMoney } from "@/lib/feeMath";
import { isReady } from "@/lib/invoicingFilters";

export const JOB_PROFIT_ROUTES = Object.freeze({
  bfs_installed_sale: "BFS installed sale",
  bfs_supply_ya_install: "BFS supply-only + Y.A. install",
  bfs_to_ya_turnkey: "BFS-to-Y.A. turnkey",
  direct_manufacturer_turnkey: "Direct manufacturer turnkey",
});

const splitRoutes = new Set(["bfs_to_ya_turnkey", "direct_manufacturer_turnkey"]);
const num = (v) => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const key = (v) => String(v || "").trim().toLowerCase();

function quoteTotalsFromSnapshot(snapshot) {
  const result = snapshot?.result || snapshot;
  const totals = result?.totals || {};
  const productCost = num(totals.dealer_cost ?? totals.dealer_total ?? totals.product_cost);
  const productSell = num(totals.customer_total ?? totals.total ?? totals.product_sell);
  if (productCost === null && productSell === null) return null;
  return {
    product_cost: productCost,
    product_sell: productSell,
    source_label: snapshot?.native_quote_number || result?.native_quote_number || snapshot?.quote_number || "accepted quote",
    source_type: "quote_snapshot",
  };
}

function quoteTotalsFromRequest(quote) {
  if (!quote) return null;
  const accepted = quote.accepted_snapshot;
  const fromAccepted = quoteTotalsFromSnapshot(accepted);
  if (fromAccepted) return { ...fromAccepted, quote_id: quote.id, source_label: quote.title || fromAccepted.source_label };
  const result = quote.result;
  const totals = result?.totals || {};
  const productCost = num(totals.dealer_cost ?? totals.dealer_total ?? totals.product_cost);
  const productSell = quote.worker_status === "ready" && result?.verified === true ? num(totals.customer_total ?? totals.total ?? totals.product_sell) : null;
  if (productCost === null && productSell === null) return null;
  return { product_cost: productCost, product_sell: productSell, quote_id: quote.id, source_label: quote.title || result?.native_quote_number || "QuoteRequests", source_type: "quote_request" };
}

function quoteIndex(quotes = []) {
  const byId = new Map();
  const byJob = new Map();
  const byName = new Map();
  for (const q of quotes || []) {
    if (q.id) byId.set(q.id, q);
    if (q.job_id) byJob.set(q.job_id, q);
    if (q.title) byName.set(key(q.title), q);
    const native = q.result?.native_quote_number || q.accepted_snapshot?.result?.native_quote_number;
    if (native) byName.set(key(native), q);
  }
  return { byId, byJob, byName };
}

function matchedMaterialSource(job, input, quotes) {
  if (input?.material_source === "manual") {
    return { product_cost: num(input.product_cost), product_sell: num(input.product_sell), source_label: "manual job cost input", source_type: "manual" };
  }
  const fromJob = quoteTotalsFromSnapshot(job?.accepted_quote_snapshot);
  if (fromJob) return { ...fromJob, job_id: job?.id, source_label: `Job accepted quote${fromJob.source_label ? ` · ${fromJob.source_label}` : ""}` };
  const idx = quoteIndex(quotes);
  const q = input?.quote_request_id ? idx.byId.get(input.quote_request_id) : null;
  const byJob = job?.source_window_quote_id ? idx.byId.get(job.source_window_quote_id) : job?.id ? idx.byJob.get(job.id) : null;
  const byName = input?.quote_number ? idx.byName.get(key(input.quote_number)) : null;
  const matched = q || byJob || byName;
  const totals = quoteTotalsFromRequest(matched);
  return totals ? { ...totals, matched_by: q ? "quote_request_id" : byJob ? "job quote link" : "quote number/title" } : null;
}

function jobKey(row) {
  return row.job_id || row.job_name_norm || row.job_name_raw || "unmatched";
}

function buildGroups(rows = []) {
  const groups = new Map();
  for (const row of rows) {
    const id = jobKey(row);
    if (!groups.has(id)) groups.set(id, { key: id, job_id: row.job_id || "", name: row.job_name_norm || row.job_name_raw || "Unnamed job", lines: [] });
    groups.get(id).lines.push(row);
  }
  return [...groups.values()];
}

function inputKey(input) {
  return input.job_id || input.job_name_norm || input.job_name_raw || "";
}

function sum(arr, fn) {
  return round2(arr.reduce((total, item) => total + (Number(fn(item)) || 0), 0));
}

function invoiceAmount(row) {
  const stored = num(row?.fee_amt);
  return stored ?? computeFeeAmt(row);
}

function splitShare(totalProfit, pct) {
  if (totalProfit === null || pct === null) return { glass_forge_share: null, ya_share: null };
  const glassForgeShare = round2(totalProfit * pct);
  return { glass_forge_share: glassForgeShare, ya_share: round2(totalProfit - glassForgeShare) };
}

function profitSplitLine(row) {
  if (row?.fee_type !== "profit_split") return null;
  const customerSell = num(row.sale_price);
  const yaCostBasis = num(row.cost);
  const splitPct = num(row.split_pct) ?? 0.5;
  const productProfit = customerSell !== null && yaCostBasis !== null ? round2(customerSell - yaCostBasis) : null;
  const shares = splitShare(productProfit, splitPct);
  const missing = [];
  if (customerSell === null) missing.push("customer sell price");
  if (yaCostBasis === null) missing.push("Y.A. cost basis");
  return {
    id: row.id,
    job_name: row.job_name_raw || row.job_name_norm || "Profit split job",
    calendar_event_id: row.calendar_event_id || null,
    source_label: row.calendar_event_id ? "Google Calendar FeeLine" : row.note_text ? "confirmed FeeLine note" : "FeeLine",
    customer_sell: customerSell,
    ya_cost_basis: yaCostBasis,
    product_profit: productProfit,
    split_pct: splitPct,
    ya_share: shares.ya_share,
    glass_forge_share: shares.glass_forge_share,
    invoice_amount: invoiceAmount(row),
    invoice_status: row.paid_to_ya ? "paid" : row.billed_to_bfs ? "billed" : row.needs_review ? "review" : "ready",
    missing_inputs: missing,
  };
}

function profitSplitSummary(lines) {
  const splitLines = lines.map(profitSplitLine).filter(Boolean);
  if (!splitLines.length) return null;
  return {
    lines: splitLines,
    customer_sell: sum(splitLines, (r) => r.customer_sell),
    ya_cost_basis: sum(splitLines, (r) => r.ya_cost_basis),
    product_profit: sum(splitLines, (r) => r.product_profit),
    ya_share: sum(splitLines, (r) => r.ya_share),
    glass_forge_share: sum(splitLines, (r) => r.glass_forge_share),
    invoice_amount: sum(splitLines, (r) => r.invoice_amount),
    missing_inputs: [...new Set(splitLines.flatMap((r) => r.missing_inputs))],
  };
}

export function aggregateProfitSplitSummaries(records = []) {
  const lines = records.flatMap((r) => r.profit_split?.lines || []);
  return {
    count: lines.length,
    customer_sell: sum(lines, (r) => r.customer_sell),
    ya_cost_basis: sum(lines, (r) => r.ya_cost_basis),
    product_profit: sum(lines, (r) => r.product_profit),
    ya_share: sum(lines, (r) => r.ya_share),
    glass_forge_share: sum(lines, (r) => r.glass_forge_share),
    invoice_amount: sum(lines, (r) => r.invoice_amount),
    missing_inputs: [...new Set(lines.flatMap((r) => r.missing_inputs))],
  };
}

function completionChain(group, reportStatusMap, supersededSet) {
  const billableLines = group.lines.filter((r) => r.billable && !(supersededSet && supersededSet.has(r.id)));
  const evidenceReceived = billableLines.some((r) => {
    const status = reportStatusMap?.get?.(r.calendar_event_id);
    return ["ok", "waived", "pre_compliance", "no_source_data"].includes(status) || !!r.probuild_post_id || (Array.isArray(r.photo_urls) && r.photo_urls.length > 0);
  });
  const readyLines = billableLines.filter((r) => isReady(r, reportStatusMap, supersededSet));
  const billedLines = billableLines.filter((r) => r.billed_to_bfs);
  const paidLines = billableLines.filter((r) => r.paid_to_ya);
  return {
    evidence_received: evidenceReceived,
    ready_to_invoice: readyLines.length > 0,
    ready_count: readyLines.length,
    billing_email_sent: billedLines.length > 0,
    billed_or_paid: billedLines.length > 0 || paidLines.length > 0,
  };
}

export function calculateJobProfitability({ rows = [], jobs = [], quotes = [], costInputs = [], reportStatusMap, supersededSet } = {}) {
  const jobById = new Map((jobs || []).filter((j) => j.id).map((j) => [j.id, j]));
  const inputByKey = new Map((costInputs || []).map((i) => [inputKey(i), i]).filter(([k]) => k));
  return buildGroups(rows).map((group) => {
    const job = group.job_id ? jobById.get(group.job_id) : null;
    const input = inputByKey.get(group.job_id) || inputByKey.get(group.name) || null;
    const split = profitSplitSummary(group.lines);
    const route = input?.route || (split ? "direct_manufacturer_turnkey" : "bfs_installed_sale");
    const material = matchedMaterialSource(job, input, quotes);
    const productSell = num(input?.product_sell) ?? material?.product_sell ?? split?.customer_sell ?? null;
    const productCost = num(input?.product_cost) ?? material?.product_cost ?? split?.ya_cost_basis ?? null;
    const productProfit = productSell !== null && productCost !== null ? round2(productSell - productCost) : null;
    const productSplitPct = num(input?.product_split_pct) ?? (split?.lines.length === 1 ? split.lines[0].split_pct : null) ?? (splitRoutes.has(route) ? 0.5 : 1);
    const productProfitContribution = split ? split.glass_forge_share : productProfit === null ? null : round2(productProfit * productSplitPct);
    const installationRevenue = num(input?.installation_revenue) ?? sum(group.lines, (r) => r.fee_type === "profit_split" ? 0 : r.labor_amt);
    const actualLabor = num(input?.actual_labor_cost);
    const workerCount = num(input?.worker_count);
    const workdayCount = num(input?.workday_count) ?? 1;
    const laborCost = actualLabor ?? (workerCount !== null ? round2(workerCount * workdayCount * 200) : null);
    const laborEstimated = actualLabor === null && workerCount !== null;
    const directInstallMaterialCost = num(input?.installation_material_cost);
    const rollPrice = num(input?.material_roll_price);
    const expectedWindowsPerRoll = num(input?.expected_windows_per_roll);
    const jobWindowCount = num(input?.job_window_count);
    const rollMode = input?.material_roll_mode || "fractional";
    const plannedRollUse = rollPrice !== null && expectedWindowsPerRoll > 0 && jobWindowCount !== null
      ? (rollMode === "whole_roll" ? Math.ceil(jobWindowCount / expectedWindowsPerRoll) : jobWindowCount / expectedWindowsPerRoll)
      : null;
    const plannedMaterialCost = plannedRollUse !== null ? round2(plannedRollUse * rollPrice) : null;
    const installMaterialCost = directInstallMaterialCost ?? plannedMaterialCost;
    const installationProfit = laborCost !== null && installMaterialCost !== null ? round2(installationRevenue - laborCost - installMaterialCost) : null;
    const knownRevenue = round2((productSell || 0) + (installationRevenue || 0));
    const knownProductContribution = productProfitContribution ?? 0;
    const knownInstallationProfit = installationProfit ?? 0;
    const grossProfit = productProfitContribution !== null && installationProfit !== null ? round2(knownProductContribution + knownInstallationProfit) : null;
    const grossMargin = grossProfit !== null && knownRevenue > 0 ? grossProfit / knownRevenue : null;
    const overhead = num(input?.allocated_overhead);
    const knownCostTotal = [productCost, laborCost, installMaterialCost, overhead].reduce((total, value) => total + (value ?? 0), 0);
    const ebit = grossProfit !== null && overhead !== null ? round2(grossProfit - overhead) : null;
    const missing = [];
    if (productSell === null) missing.push("product sell/revenue");
    if (productCost === null) missing.push("product/material cost");
    if (laborCost === null) missing.push("actual labor or worker/day count");
    if (installMaterialCost === null) missing.push("installation material/consumables or roll plan");
    if (overhead === null) missing.push("allocated overhead");
    return {
      ...group,
      route,
      route_label: JOB_PROFIT_ROUTES[route] || route,
      input,
      material_source: material,
      customer_revenue: productSell,
      known_revenue: knownRevenue,
      product_sell: productSell,
      product_cost: productCost,
      product_profit: productProfit,
      product_split_pct: productSplitPct,
      product_profit_contribution: productProfitContribution,
      profit_split: split,
      ya_profit_share: split?.ya_share ?? (productProfit === null ? null : round2(productProfit - (productProfitContribution ?? 0))),
      glass_forge_profit_share: productProfitContribution,
      installation_revenue: installationRevenue,
      installation_labor_cost: laborCost,
      installation_labor_estimated: laborEstimated,
      workday_count: workdayCount,
      installation_material_cost: installMaterialCost,
      planned_material_cost: plannedMaterialCost,
      material_roll_use: plannedRollUse,
      material_roll_mode: rollMode,
      installation_profit: installationProfit,
      total_gross_profit: grossProfit,
      gross_margin: grossMargin,
      allocated_overhead: overhead,
      known_cost_total: round2(knownCostTotal),
      ebit_contribution: ebit,
      provisional: missing.length > 0 || laborEstimated,
      missing_inputs: missing,
      completion_chain: completionChain(group, reportStatusMap, supersededSet),
      invoice_fee_total: sum(group.lines, invoiceAmount),
    };
  }).sort((a, b) => (b.total_gross_profit ?? b.invoice_fee_total ?? 0) - (a.total_gross_profit ?? a.invoice_fee_total ?? 0));
}

export function moneyOrDash(value) {
  return value === null || value === undefined ? "-" : `$${formatMoney(value)}`;
}

export function percentOrDash(value) {
  return value === null || value === undefined ? "-" : `${(value * 100).toFixed(1)}%`;
}
