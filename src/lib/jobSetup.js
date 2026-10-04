import { computeJobBudget, roundMoney } from "../../base44/shared/jobBudgetMath.js";

export const PLACEHOLDER_TERMS = Object.freeze({
  deposit_pct: "",
  payment_schedule: "",
  estimated_lead_time: "",
  estimated_start: "",
  warranty_text: "",
  quote_valid_days: "",
});

export function contractReviewIssues(sheet = {}) {
  const t = sheet.terms || {}, customer = sheet.customer || {}, pricing = sheet.pricing || {};
  const issues = [];
  const nonnegative = value => finite(value) && Number(value) >= 0;
  if (!["name", "job_site_address"].every(k => String(customer[k] || "").trim())) issues.push("Enter the customer name and job site address.");
  const pricesReady = ["sell_price", "tax", "contract_total"].every(k => nonnegative(pricing[k]));
  if (!pricesReady) issues.push("Enter the subtotal, customer tax and contract total (enter 0 when tax is zero).");
  else if (Math.abs(roundMoney(Number(pricing.sell_price) + Number(pricing.tax)) - roundMoney(Number(pricing.contract_total))) > 0.01) issues.push("Contract total must equal subtotal plus customer tax.");
  if (!Array.isArray(sheet.scope_lines) || !sheet.scope_lines.length ||
      !sheet.scope_lines.every(line => String(line.product || line.description || "").trim() && finite(line.qty) && Number(line.qty) > 0 && nonnegative(line.customer_price))) {
    issues.push("Each scope line needs a description, quantity and nonnegative customer price.");
  }
  if (!finite(t.deposit_pct) || Number(t.deposit_pct) < 0 || Number(t.deposit_pct) > 100) issues.push("Enter a deposit percentage from 0 to 100.");
  if (!finite(t.quote_valid_days) || !Number.isInteger(Number(t.quote_valid_days)) || Number(t.quote_valid_days) <= 0) issues.push("Enter how many days the quote is valid.");
  if (!["payment_schedule", "estimated_lead_time", "warranty_text"].every(k => String(t[k] || "").trim() && !/placeholder|confirm|tbd/i.test(String(t[k])))) issues.push("Review the payment schedule, lead time and warranty.");
  return issues;
}

export function contractTermsReady(sheet = {}) {
  return contractReviewIssues(sheet).length === 0;
}

const present = (v) => v !== undefined && v !== null && String(v).trim() !== "";
const finite = (v) => present(v) && Number.isFinite(Number(v));
const first = (...values) => values.find(present);
const n = (v) => finite(v) ? Number(v) : "";

function normalizeLine(line = {}, index = 0) {
  const width = first(line.width, line.rough_width, line.size?.width);
  const height = first(line.height, line.rough_height, line.size?.height);
  return {
    mark: String(first(line.mark, line.id, line.tag, index + 1) || ""),
    qty: n(first(line.qty, line.quantity)),
    size: String(first(line.size_label, typeof line.size === "string" ? line.size : "", width && height ? `${width} × ${height}` : "") || ""),
    product: String(first(line.product, line.style, line.series, line.type) || ""),
    description: String(first(line.description, line.notes, line.configuration_description) || ""),
    customer_price: n(first(line.customer_extended, line.line_totals?.customer, line.extended_price, line.total)),
  };
}

export function mapScopeLines(job = {}, budget = {}) {
  const snap = job.accepted_quote_snapshot || {};
  const resultLines = Array.isArray(snap.result?.lines) ? snap.result.lines : [];
  const quoteLines = resultLines.length ? resultLines : (Array.isArray(snap.lines) ? snap.lines : []);
  const budgetLines = budget.quote?.lines || budget.quote?.items || budget.lines || [];
  const lines = (quoteLines.length ? quoteLines : budgetLines).map(normalizeLine);
  const install = snap.install_summary;
  if (install?.enabled && install.complete) {
    if (finite(install.sell) && Number(install.sell) > 0) lines.push({ mark: "INSTALL", qty: 1, size: "", product: "Installation", description: "Accepted installation scope, including installation extras and trip minimum where applicable", customer_price: Number(install.sell) });
    if (finite(install.extra_sell) && Number(install.extra_sell) > 0) lines.push({ mark: "EXTRAS", qty: 1, size: "", product: "Installation materials / equipment", description: "Accepted additional materials and equipment", customer_price: Number(install.extra_sell) });
  }
  return lines;
}

export function buildSetupDraft({ job = {}, budget = {}, costInput = {}, installBudget = {} } = {}) {
  const totals = job.accepted_quote_snapshot?.result?.totals || {};
  const inputs = budget.inputs || {};
  const install = job.accepted_quote_snapshot?.install_summary || installBudget.summary || {};
  const costs = {
    material_product: n(first(inputs.material_true_cost, costInput.product_cost, totals.dealer_total, totals.dealer_cost)),
    labor: n(first(inputs.labor_cost_sub_pay, costInput.actual_labor_cost, install.cost)),
    install_materials: n(first(inputs.additional_install_material, costInput.installation_material_cost)),
    equipment: n(inputs.additional_equipment),
    other: n(inputs.overhead_adder),
  };
  // Budget actual_total_sell already includes customer tax. It must not be used as
  // a subtotal and taxed again. This seeds new drafts only; saved contracts stay intact.
  const acceptedInstall = job.accepted_quote_snapshot?.install_summary;
  const hasAcceptedInstall = acceptedInstall?.enabled === true;
  const packageTotal = hasAcceptedInstall && acceptedInstall.complete ? n(acceptedInstall.customer_total) : "";
  // Product tax cannot stand in for tax on the combined installed package.
  const tax = hasAcceptedInstall ? "" : n(first(totals.tax, totals.tax_amount));
  const acceptedSubtotal = n(first(totals.sell_subtotal, totals.subtotal, totals.customer_subtotal));
  const contractTotal = hasAcceptedInstall ? packageTotal : n(first(totals.customer_total, totals.total, inputs.actual_total_sell,
    finite(acceptedSubtotal) && finite(tax) ? roundMoney(Number(acceptedSubtotal) + Number(tax)) : ""));
  const sellPrice = hasAcceptedInstall ? "" : finite(acceptedSubtotal) ? acceptedSubtotal
    : finite(contractTotal) && finite(tax) && Number(contractTotal) >= Number(tax) ? roundMoney(Number(contractTotal) - Number(tax)) : "";
  return {
    job_id: job.id || "",
    status: "draft",
    customer: {
      name: String(first(job.customer_name, budget.quote?.customer_name) || ""), phone: String(job.customer_phone || ""),
      email: String(job.customer_email || ""), billing_address: String(job.billing_address || ""),
      job_site_address: String(job.address || ""), builder_gc: String(job.builder || ""),
    },
    scope_lines: mapScopeLines(job, budget), scope_notes: "", inclusions: "", exclusions: "",
    costs,
    pricing: { sell_price: sellPrice, tax, contract_total: contractTotal },
    sources: {
      material_product: present(inputs.material_true_cost) ? "Job budget" : present(costInput.product_cost) ? "Job cost inputs" : present(totals.dealer_total ?? totals.dealer_cost) ? "Accepted quote" : "Manual",
      labor: present(inputs.labor_cost_sub_pay) ? "Job budget" : present(costInput.actual_labor_cost) ? "Job cost inputs" : present(install.cost) ? "Install budget" : "Manual",
      sell_price: present(acceptedSubtotal) ? "Accepted quote subtotal" : present(sellPrice) ? "Contract total less stated customer tax" : "Customer tax / subtotal needs review",
      contract_total: hasAcceptedInstall ? finite(packageTotal) ? "Accepted products + installation + extras; reconcile customer tax" : "Accepted installation total unavailable - review quote" : present(totals.customer_total ?? totals.total) ? "Accepted quote total" : present(inputs.actual_total_sell) ? "Included job budget total (tax included)" : "Manual",
      tax: hasAcceptedInstall ? "Review customer tax for the full installed package" : present(tax) ? "Accepted quote" : "Manual customer tax - verify jurisdiction",
    },
    terms: { ...PLACEHOLDER_TERMS }, approved_date: "", approver_name: "",
  };
}

export function computeSetupTotals(sheet = {}) {
  const c = sheet.costs || {}, p = sheet.pricing || {};
  const hasBudgetData = [c.material_product, c.labor, c.install_materials, c.equipment, c.other].some(finite);
  const budget = computeJobBudget({
    material_true_cost: c.material_product, labor_cost_sub_pay: c.labor,
    additional_install_material: c.install_materials, additional_equipment: Number(c.equipment || 0) + Number(c.other || 0),
    actual_total_sell: p.contract_total || p.sell_price,
  });
  const sellPrice = finite(p.sell_price) ? Number(p.sell_price) : hasBudgetData ? budget.suggested_total_sell : "";
  const tax = finite(p.tax) ? Number(p.tax) : ""; // Workbook use-tax is an internal cost, not customer sales tax.
  const contractTotal = finite(p.contract_total) ? Number(p.contract_total) : finite(sellPrice) && finite(tax) ? roundMoney(Number(sellPrice) + Number(tax)) : "";
  const costBudget = hasBudgetData ? budget.total_cost_overhead : "";
  const profit = finite(contractTotal) && finite(costBudget) ? roundMoney(Number(contractTotal) - Number(costBudget)) : "";
  return { budget, cost_budget: costBudget, sell_price: finite(sellPrice) ? roundMoney(Number(sellPrice)) : "", tax: finite(tax) ? roundMoney(Number(tax)) : "", contract_total: contractTotal, gross_profit: profit, profit_margin_pct: Number(contractTotal) > 0 && finite(profit) ? Number(profit) / Number(contractTotal) : null };
}

// Explicit customer-safe allowlist. Never spread setup/pricing objects into this model.
export function toContractViewModel(sheet = {}, job = {}) {
  const totals = computeSetupTotals(sheet);
  return {
    job_name: String(job.canonical_name || ""), customer: {
      name: String(sheet.customer?.name || ""), phone: String(sheet.customer?.phone || ""), email: String(sheet.customer?.email || ""),
      billing_address: String(sheet.customer?.billing_address || ""), job_site_address: String(sheet.customer?.job_site_address || ""), builder_gc: String(sheet.customer?.builder_gc || ""),
    },
    scope_lines: (sheet.scope_lines || []).map(({ mark, qty, size, product, description, customer_price }) => ({ mark, qty, size, product, description, customer_price })),
    scope_notes: String(sheet.scope_notes || ""), inclusions: String(sheet.inclusions || ""), exclusions: String(sheet.exclusions || ""),
    sell_price: totals.sell_price, tax: totals.tax, contract_total: totals.contract_total,
    deposit_pct: finite(sheet.terms?.deposit_pct) ? Number(sheet.terms.deposit_pct) : null,
    deposit_amount: finite(sheet.terms?.deposit_pct) && finite(totals.contract_total) ? roundMoney(Number(totals.contract_total) * Number(sheet.terms.deposit_pct) / 100) : null,
    payment_schedule: String(sheet.terms?.payment_schedule || ""), estimated_lead_time: String(sheet.terms?.estimated_lead_time || ""),
    estimated_start: String(sheet.terms?.estimated_start || ""), warranty_text: String(sheet.terms?.warranty_text || ""),
    quote_valid_days: finite(sheet.terms?.quote_valid_days) ? Number(sheet.terms.quote_valid_days) : null,
  };
}
