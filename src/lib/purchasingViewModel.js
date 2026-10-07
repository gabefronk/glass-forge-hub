// Pure viewmodel for the unified Purchasing page. No React, no SDK, no I/O.
// Builds one compact card per job from the procurement overview + owner
// money inputs. Computes the four currency tiles, the reference quiet line,
// the next action, and a search string. Profit is computed read-only.
//
// Rules honored here:
//  - Windows incl tax comes from the single reviewed active budget's workbook
//    cost_material_tax (B21). Multiple/conflicting active budgets withhold.
//    Unreviewed → review. None → empty. No arithmetic tax guess.
//  - Rough labor/material and sale price come only from the owner money input.
//    Unset → dash. No fallback to the budget estimate sell (not interchangeable).
//  - Profit = sale − windows incl tax − rough labor/material. Dash until all
//    three resolve. Green positive, red negative, zero valid.
//  - Job links are by exact job_id, never inferred from a name.
import { activeBudgets, budgetFigures, budgetRollup, isLiveBudget, amount, roundMoney, isIgnoredWorkItem } from './purchasingCoreTwin.js';
import { purchasingMatches } from './purchasingMatches.js';
import { procurementPath } from './procurementRoutes.js';
import { purchasingText } from './purchasingSearch.js';

const safeHref = (v) => { try { return v && new URL(v).protocol === 'https:' ? v : ''; } catch { return ''; } };
const fileHref = (id) => (id ? `https://drive.google.com/file/d/${encodeURIComponent(id)}/view` : '');
const isPaid = (s) => ['paid', 'reconciled'].includes(s);

// Tile 1 — Windows incl tax.
export function windowsInclTax(jobBudgets = []) {
  const live = jobBudgets.filter(isLiveBudget);
  const active = activeBudgets(live);
  if (active.length === 0) return { value: null, status: 'empty', budgetId: null };
  if (active.length > 1) return { value: null, status: 'withheld', budgetId: null };
  const figures = budgetFigures(active[0]);
  if (!figures.ready) return { value: null, status: 'review', budgetId: active[0].id };
  const v = figures.calculated?.cost_material_tax;
  return { value: typeof v === 'number' && Number.isFinite(v) ? roundMoney(v) : null, status: 'ready', budgetId: active[0].id };
}

// Tile 4 — Profit. Dash until all three inputs resolve.
export function computeProfit(windowsValue, roughValue, saleValue) {
  if (windowsValue == null || roughValue == null || saleValue == null) {
    return { value: null, tone: 'unknown' };
  }
  const p = roundMoney(saleValue - windowsValue - roughValue);
  return { value: p, tone: p > 0 ? 'positive' : p < 0 ? 'negative' : 'zero' };
}

// Reference quiet line — Quote# / Mfr order# / YA PO / ETA / Payment.
// green = confirmed/complete, amber = needs action, none = not present.
export function refsForJob(jobId, { budgets = [], purchaseOrders = [], vendorOrders = [], today = '' } = {}) {
  const jobBudgets = budgets.filter((b) => b.job_id === jobId && isLiveBudget(b));
  const active = activeBudgets(jobBudgets);
  const quoteBudget = active[0] || jobBudgets[0] || null;
  const quoteNumber = quoteBudget?.quote_number || null;
  const quoteStatus = !quoteBudget ? 'none'
    : active.length > 1 ? 'amber'
    : quoteBudget.budget_usage === 'draft' || !budgetFigures(quoteBudget).ready ? 'amber'
    : 'green';

  const pos = purchaseOrders.filter((p) => p.job_id === jobId && p.status !== 'cancelled');
  const yaPo = pos.map((p) => p.po_number).filter(Boolean).join(', ') || null;
  const poStatus = !pos.length ? 'none' : 'green';

  const orders = vendorOrders.filter((o) => o.job_id === jobId);
  const order = orders[0] || null;
  const mfrOrder = orders.map((o) => o.order_number).filter(Boolean).join(', ') || null;
  const mfrStatus = !orders.length ? 'none' : order?.order_number ? 'green' : 'amber';

  const etaDate = order?.eta_date || null;
  const etaStatus = !order ? 'none' : !etaDate ? 'amber' : today && etaDate < today ? 'amber' : 'green';

  const payment = order ? (isPaid(order.status) ? 'green' : 'amber') : 'none';
  return {
    quoteNumber, quoteStatus, mfrOrder, mfrStatus, yaPo, poStatus,
    etaDate, etaStatus, payment, paymentStatus: order?.status || null,
  };
}

// Next action — Review numbers / Prepare PO / Confirm order / Record payment /
// Review billing, from the real purchasing state. Returns a link into the
// existing job-scoped workspace (forms/dialogs live there).
export function nextActionForJob(jobId, { budgets = [], purchaseOrders = [], vendorOrders = [], conflicts = [], today = '' } = {}) {
  const jobBudgets = budgets.filter((b) => b.job_id === jobId && isLiveBudget(b));
  const included = activeBudgets(jobBudgets);
  const rollup = budgetRollup(jobBudgets);
  const pos = purchaseOrders.filter((p) => p.job_id === jobId && p.status !== 'cancelled');
  const orders = vendorOrders.filter((o) => o.job_id === jobId);
  const jobConflicts = conflicts.filter((c) => (c.job_ids || []).includes(jobId));
  const matches = purchasingMatches(jobId, jobBudgets, pos, orders, conflicts);
  const pendingPO = included.filter((b) => !matches.budgetPairs.some((p) => p.budget.id === b.id));
  const missingConfirmations = pos.filter((po) => !matches.supplierPairs.some((p) => p.po.id === po.id));
  const unmatched = orders.filter((o) => !matches.supplierPairs.some((p) => p.supplier.id === o.id));
  const waitingDelivery = orders.filter((o) => !o.received_date);
  const needsETA = waitingDelivery.filter((o) => !o.eta_date);
  const overdue = waitingDelivery.filter((o) => o.eta_date && today && o.eta_date < today);
  const reviewQuote = included.find((b) => b.budget_usage === 'draft' || !budgetFigures(b).ready) ||
    (!included.length ? jobBudgets.find((b) => b.budget_usage !== 'reference') : null);

  if (jobConflicts.length) return { label: 'Resolve PO conflict', href: procurementPath(jobId, 'orders'), key: 'orders' };
  if (reviewQuote || (included.length && rollup.status !== 'ready')) return { label: 'Review numbers', href: procurementPath(jobId, 'budgets'), key: 'budgets' };
  if (pendingPO.length) return { label: 'Prepare PO', href: procurementPath(jobId, 'orders'), key: 'orders' };
  if (unmatched.length) return { label: 'Confirm order', href: procurementPath(jobId, 'tracking'), key: 'tracking' };
  if (missingConfirmations.length) return { label: 'Confirm order', href: procurementPath(jobId, 'tracking'), key: 'tracking' };
  if (overdue.length || needsETA.length) return { label: 'Record ETA', href: procurementPath(jobId, 'tracking'), key: 'tracking' };
  if (waitingDelivery.length) return { label: 'Record payment', href: procurementPath(jobId, 'tracking'), key: 'tracking' };
  return { label: 'Review billing', href: procurementPath(jobId, 'invoicing'), key: 'invoicing' };
}

// Build one card per job that has any purchasing activity. Merged, sample and
// ignored jobs are excluded. Cards are sorted by canonical name.
export function buildPurchasingCards({ jobs = [], budgets = [], purchase_orders = [], vendor_orders = [], moneyInputs = [], conflicts = [], today = '' } = {}) {
  const moneyByJob = new Map();
  for (const m of moneyInputs) if (m?.job_id) moneyByJob.set(m.job_id, m);
  const conflictJobIds = new Set();
  for (const c of conflicts) for (const id of (c.job_ids || [])) conflictJobIds.add(id);

  const activeJobIds = new Set();
  for (const b of budgets) if (b.job_id) activeJobIds.add(b.job_id);
  for (const p of purchase_orders) if (p.job_id && p.status !== 'cancelled') activeJobIds.add(p.job_id);
  for (const o of vendor_orders) if (o.job_id) activeJobIds.add(o.job_id);
  for (const m of moneyInputs) if (m?.job_id) activeJobIds.add(m.job_id);

  const cards = [];
  for (const job of jobs) {
    if (job.merged_into || job.is_sample) continue;
    if (isIgnoredWorkItem(job)) continue;
    if (!activeJobIds.has(job.id)) continue;

    const jobBudgets = budgets.filter((b) => b.job_id === job.id);
    const win = windowsInclTax(jobBudgets);
    const money = moneyByJob.get(job.id);
    const rough = money && amount(money.rough_labor_material) != null ? Number(amount(money.rough_labor_material)) : null;
    const sale = money && amount(money.sale_price) != null ? Number(amount(money.sale_price)) : null;
    const profit = computeProfit(win.value, rough, sale);
    const refs = refsForJob(job.id, { budgets, purchaseOrders: purchase_orders, vendorOrders: vendor_orders, today });
    const next = nextActionForJob(job.id, { budgets, purchaseOrders: purchase_orders, vendorOrders: vendor_orders, conflicts, today });

    const fileBudget = activeBudgets(jobBudgets)[0] || jobBudgets[0] || null;
    const supplier = fileBudget?.vendor || fileBudget?.manufacturer ||
      (purchase_orders.find((p) => p.job_id === job.id && p.status !== 'cancelled')?.vendor) || '';
    const units = jobBudgets.reduce((s, b) => s + (Number(b.openings_qty) || 0), 0);
    const files = {
      sourceQuote: safeHref(fileBudget?.source_pdf_url) || fileHref(fileBudget?.drive_quote_file_id),
      budgetSheet: fileHref(fileBudget?.drive_budget_xlsx_file_id),
      driveFolder: safeHref(job.drive_job_folder_url) ||
        (job.drive_job_folder_id ? `https://drive.google.com/drive/folders/${encodeURIComponent(job.drive_job_folder_id)}` : '') ||
        (fileBudget?.drive_job_folder_id ? `https://drive.google.com/drive/folders/${encodeURIComponent(fileBudget.drive_job_folder_id)}` : ''),
    };
    const search = (purchasingText(job) + ' ' + [refs.quoteNumber, refs.mfrOrder, refs.yaPo, supplier].filter(Boolean).join(' ')).toLowerCase();

    cards.push({
      job: { id: job.id, canonical_name: job.canonical_name, address: job.address, builder: job.builder },
      windows: win, rough: { value: rough, moneyId: money?.id || null }, sale: { value: sale, moneyId: money?.id || null },
      profit, refs, next, files, supplier, units, conflict: conflictJobIds.has(job.id), search,
    });
  }
  cards.sort((a, b) => String(a.job.canonical_name || '').localeCompare(String(b.job.canonical_name || '')));
  return cards;
}

export function cardMatchesSearch(card, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  return q.split(/\s+/).filter(Boolean).every((term) => card.search.includes(term));
}