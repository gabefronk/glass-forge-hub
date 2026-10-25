// One job's money the way QuickBooks Projects lays it out: income, costs and profit, with an
// estimate column and an actual column. Pure: no React, no SDK.
//  - Estimate is the job's Purchasing row (jobMoneyHeadline), so the two screens never disagree.
//  - Actual is what has been recorded against the job: customer invoices (Invoices), supplier
//    POs and orders at their entered amounts, and JobCostInputs labor and material.
//  - Payables and job cost both use the PO amount as entered (no use tax added).
// Records filed under duplicate job records count toward the primary job.
import { jobMoneyHeadline } from './jobMoneyPanel.js';
import { jobInvoiceSummary } from './invoiceRegister.js';
import { supplierPayables, customerOwedShare } from './purchasingSummary.js';

const round = (n) => Math.round(n * 100) / 100;
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const isOrderPaid = (o) => ['paid', 'reconciled'].includes(o?.status) || Boolean(o?.paid_at);
// Both parts known → their sum; either unknown → null (a dash, never a guess).
const add = (a, b) => (a == null || b == null ? null : round(a + b));
const less = (a, b) => (a == null || b == null ? null : round(a - b));
const cost = (v) => (num(v) == null ? null : round(num(v)));
const ratio = (part, whole) => (part == null || !whole ? null : part / whole);

// Supplier cost recorded so far: each live PO at its dealer amount as entered (a PO with no
// amount falls back to its supplier orders), plus supplier orders with no PO.
// Paid or not, it is cost. `partial` means a PO or order has no amount.
export function orderedCost(jobId, { purchase_orders = [], vendor_orders = [], budgets = [] } = {}) {
  const cancelled = new Set(purchase_orders.filter((p) => p.status === 'cancelled').map((p) => p.id));
  const pos = purchase_orders.filter((p) => p.job_id === jobId && p.status !== 'cancelled');
  const orders = vendor_orders.filter((o) => o.job_id === jobId && !(o.purchase_order_id && cancelled.has(o.purchase_order_id)));
  const poIds = new Set(pos.map((p) => p.id));
  const budgetOf = (id) => (id ? budgets.find((b) => b.id === id) : null) || null;
  let total = 0, counted = 0, partial = false;
  const take = (value) => { if (value == null) partial = true; else { total += value; counted += 1; } };
  for (const po of pos) {
    const budget = budgetOf(po.budget_id);
    const linked = orders.filter((o) => o.purchase_order_id === po.id).map((o) => cost(o.amount));
    take(num(po.amount_dealer) != null ? cost(po.amount_dealer) : (linked.length && linked.every((v) => v != null) ? linked.reduce((n, v) => n + v, 0) : null));
  }
  for (const o of orders) {
    if (o.purchase_order_id && poIds.has(o.purchase_order_id)) continue;
    if (!o.purchase_order_id && num(o.amount) == null && !String(o.order_number || '').trim()) continue;
    take(cost(o.amount));
  }
  return { value: counted ? round(total) : null, partial };
}

// Actual install labor and material from JobCostInputs (one row per job per month).
function laborActual(rows) {
  const values = rows.flatMap((r) => [num(r.actual_labor_cost), num(r.installation_material_cost)]).filter((v) => v != null);
  return values.length ? round(values.reduce((n, v) => n + v, 0)) : null;
}

const line = (key, label, estimate, actual, extra = {}) => ({ key, label, estimate, actual, variance: less(actual, estimate), ...extra });

export function jobProject(jobId, memberIds = [], { jobs = [], budgets = [], purchaseOrders = [], vendorOrders = [], invoices = [], costInputs = [], today = '' } = {}) {
  const job = jobs.find((j) => j.id === jobId);
  const head = jobMoneyHeadline(jobId, memberIds, { jobs, budgets, purchaseOrders, vendorOrders, today });
  if (!job || !head) return null;
  const ids = new Set([jobId, ...memberIds]);
  const toPrimary = (rows) => rows.filter((r) => ids.has(r.job_id)).map((r) => ({ ...r, job_id: jobId }));
  const records = { purchase_orders: toPrimary(purchaseOrders), vendor_orders: toPrimary(vendorOrders), budgets };

  const billed = jobInvoiceSummary(toPrimary(invoices), jobId);
  const supplier = orderedCost(jobId, records);
  const payables = supplierPayables(jobId, records);
  const labor = laborActual(toPrimary(costInputs));

  const income = billed.list.length ? billed.invoiced : null;
  const costEstimate = add(head.cost, head.laborMaterial);
  const costActual = add(supplier.value, labor);
  const profitActual = less(income, costActual);
  // Until customer invoices are recorded, the payment stage is the only evidence (as on Purchasing).
  const customerOwes = billed.list.length
    ? round((head.sale ?? billed.invoiced) - billed.paid)
    : head.sale == null ? null : round(head.sale * customerOwedShare(job.payment_status || ''));

  return {
    contract: head.sale,
    invoiced: billed.invoiced,
    received: billed.paid,
    invoices: billed.list,
    customerOwes,
    customerOwesFrom: billed.list.length ? 'invoices' : 'stage',
    weOwe: payables.owed,
    weOweMissing: payables.missing,
    rows: [
      line('income', 'Income', head.sale, income),
      line('windows', 'Windows + tax', head.cost, supplier.value, { cost: true, estimatePartial: head.partial, actualPartial: supplier.partial }),
      line('labor', 'Labor & material', head.laborMaterial, labor, { cost: true }),
      line('cost', 'Total cost', costEstimate, costActual, { cost: true, total: true }),
      line('profit', 'Profit', head.profit, profitActual, { total: true }),
    ],
    margin: { estimate: ratio(head.profit, head.sale), actual: ratio(profitActual, income) },
  };
}
