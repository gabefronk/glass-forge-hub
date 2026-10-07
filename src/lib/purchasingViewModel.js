// Pure viewmodel for the unified Purchasing page. No React, no SDK, no I/O.
// Builds one compact card per job from the procurement overview + owner money
// inputs. Computes the four currency tiles, the reference quiet line, the
// next action, and a search string. Profit is computed read-only.
//
// Grounding rules:
//  - Windows incl tax is a grounded, tax-inclusive field with provenance.
//    Preferred source: a scoped confirmed PO's budget_snapshot.cost_material_tax
//    (the actual ordered scope, captured at issuance). Fallback: the single
//    active reviewed budget's calculated cost_material_tax. Unknown/conflicting
//    → withhold. Never substitute gross dealer_amount/customer amount.
//  - Multiple legitimate scopes cannot double-count a single tile → withhold.
//    A replacement chain resolves to its survivor (activeBudgets).
//  - A job in a PO conflict withholds windows AND profit.
//  - Rough labor/material and sale price come only from the owner money input.
//    Unset or duplicate job inputs → withhold. No fallback to budget sell.
//  - Profit = sale − windows incl tax − rough labor/material. Dash until all
//    three resolve. Green positive, red negative, zero valid.
//  - Refs aggregate ALL active records (cancelled POs and vendor orders whose
//    linked PO is cancelled are excluded everywhere). Multiple distinct →
//    "Multiple". Payment uses actual schema paid statuses (paid/reconciled or
//    paid_at). ETA "Delivered" when received_date set (not past amber).
//  - Units count only current explicit selected scope (active included budgets).
//  - Job links are by exact job_id, never inferred from a name.
import { activeBudgets, budgetFigures, budgetRollup, isLiveBudget, amount, roundMoney, isIgnoredWorkItem } from './purchasingCoreTwin.js';
import { purchasingMatches } from './purchasingMatches.js';
import { procurementPath } from './procurementRoutes.js';
import { purchasingText } from './purchasingSearch.js';

const safeHref = (v) => { try { return v && new URL(v).protocol === 'https:' ? v : ''; } catch { return ''; } };
const fileHref = (id) => (id ? `https://drive.google.com/file/d/${encodeURIComponent(id)}/view` : '');

// PO statuses that mean the vendor accepted / material is in hand.
const CONFIRMED_PO_STATUS = ['ordered', 'confirmed', 'received'];
// VendorOrder statuses that mean payment is complete.
const PAID_VO_STATUS = ['paid', 'reconciled'];

const activePOs = (pos, jobId) => pos.filter((p) => p.job_id === jobId && p.status !== 'cancelled');
const isVendorOrderCancelled = (o, pos) => Boolean(o.purchase_order_id && pos.some((p) => p.id === o.purchase_order_id && p.status === 'cancelled'));
const activeVendorOrders = (orders, pos) => orders.filter((o) => o.job_id && !isVendorOrderCancelled(o, pos));
const isOrderPaid = (o) => PAID_VO_STATUS.includes(o.status) || Boolean(o.paid_at);

// Tile 1 — Windows incl tax. Grounded, provenance-tracked, never gross.
export function windowsInclTax(jobBudgets = [], purchaseOrders = []) {
  const live = jobBudgets.filter(isLiveBudget);
  const active = activeBudgets(live);
  if (active.length === 0) return { value: null, status: 'empty', budgetId: null, provenance: null };

  // A scoped confirmed PO carries the budget as reviewed at issuance. Its
  // snapshot cost_material_tax is the grounded actual order incl tax.
  const snapshotTax = (po) => {
    const s = po?.budget_snapshot;
    const v = s?.calculated?.cost_material_tax ?? s?.cost_material_tax;
    return typeof v === 'number' && Number.isFinite(v) ? roundMoney(v) : null;
  };
  const confirmed = purchaseOrders.filter((po) =>
    po && po.budget_id && active.some((b) => b.id === po.budget_id) &&
    CONFIRMED_PO_STATUS.includes(po.status) && snapshotTax(po) != null);

  if (confirmed.length === 1) {
    return { value: snapshotTax(confirmed[0]), status: 'ready', budgetId: confirmed[0].budget_id, provenance: 'order', poId: confirmed[0].id };
  }
  if (confirmed.length > 1) {
    const vals = [...new Set(confirmed.map(snapshotTax))];
    if (vals.length === 1) return { value: vals[0], status: 'ready', budgetId: confirmed[0].budget_id, provenance: 'order' };
    // Multiple legitimate scopes with different tax-inclusive costs → cannot double-count.
    return { value: null, status: 'withheld', budgetId: null, provenance: null };
  }

  // No confirmed order → fall back to the single active reviewed budget.
  if (active.length > 1) return { value: null, status: 'withheld', budgetId: null, provenance: null };
  const figures = budgetFigures(active[0]);
  if (!figures.ready) return { value: null, status: 'review', budgetId: active[0].id, provenance: null };
  const v = figures.calculated?.cost_material_tax;
  return { value: typeof v === 'number' && Number.isFinite(v) ? roundMoney(v) : null, status: 'ready', budgetId: active[0].id, provenance: 'budget' };
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
// Aggregates ALL active records; "Multiple" when distinct values conflict.
export function refsForJob(jobId, { budgets = [], purchaseOrders = [], vendorOrders = [], today = '' } = {}) {
  const pos = activePOs(purchaseOrders, jobId);
  const jobBudgets = budgets.filter((b) => b.job_id === jobId && isLiveBudget(b));
  const active = activeBudgets(jobBudgets);

  const quoteNumbers = [...new Set(active.map((b) => b.quote_number).filter(Boolean))];
  const quoteNumber = quoteNumbers.length > 1 ? 'Multiple' : (quoteNumbers[0] || null);
  const quoteStatus = !active.length ? 'none'
    : active.length > 1 ? 'amber'
    : (active[0].budget_usage === 'draft' || !budgetFigures(active[0]).ready) ? 'amber'
    : 'green';

  const poNumbers = [...new Set(pos.map((p) => p.po_number).filter(Boolean))];
  const yaPo = poNumbers.length > 1 ? 'Multiple' : (poNumbers[0] || null);
  const confirmedPos = pos.filter((p) => CONFIRMED_PO_STATUS.includes(p.status));
  const poStatus = !pos.length ? 'none'
    : confirmedPos.length === pos.length ? 'green'
    : 'amber';

  const orders = activeVendorOrders(vendorOrders.filter((o) => o.job_id === jobId), purchaseOrders);
  const orderNumbers = [...new Set(orders.map((o) => o.order_number).filter(Boolean))];
  const mfrOrder = orderNumbers.length > 1 ? 'Multiple' : (orderNumbers[0] || null);
  const mfrStatus = !orders.length ? 'none'
    : orders.every((o) => o.order_number) ? 'green'
    : 'amber';

  // ETA — Delivered beats overdue; multiple distinct ETAs → Multiple + review.
  const received = orders.some((o) => o.received_date);
  const etaDates = [...new Set(orders.map((o) => o.eta_date).filter(Boolean))];
  let etaLabel = null, etaStatus = 'none';
  if (received) { etaLabel = 'Delivered'; etaStatus = 'green'; }
  else if (!orders.length) { etaLabel = null; etaStatus = 'none'; }
  else if (etaDates.length === 0) { etaLabel = null; etaStatus = 'amber'; }
  else if (etaDates.length > 1) { etaLabel = 'Multiple'; etaStatus = 'amber'; }
  else { etaLabel = etaDates[0]; etaStatus = (today && etaDates[0] < today) ? 'amber' : 'green'; }

  // Payment — actual schema: paid/reconciled status or paid_at. Mixed → attention.
  const paidOrders = orders.filter(isOrderPaid);
  const payment = !orders.length ? 'none'
    : paidOrders.length === orders.length ? 'green'
    : 'amber';
  const paymentLabel = !orders.length ? null
    : paidOrders.length === orders.length ? 'Paid'
    : paidOrders.length > 0 ? 'Partial' : 'Unpaid';

  return {
    quoteNumber, quoteStatus, yaPo, poStatus, mfrOrder, mfrStatus,
    etaLabel, etaStatus, payment, paymentLabel,
  };
}

// Next action from the real purchasing workflow. No dead invoicing placeholder.
// ordered → eta_set → ach_link_received → paid → reconciled.
export function nextActionForJob(jobId, { budgets = [], purchaseOrders = [], vendorOrders = [], conflicts = [], today = '' } = {}) {
  const pos = activePOs(purchaseOrders, jobId);
  const jobBudgets = budgets.filter((b) => b.job_id === jobId && isLiveBudget(b));
  const active = activeBudgets(jobBudgets);
  const rollup = budgetRollup(jobBudgets);
  const orders = activeVendorOrders(vendorOrders.filter((o) => o.job_id === jobId), purchaseOrders);
  const jobConflicts = conflicts.filter((c) => (c.job_ids || []).includes(jobId));
  const matches = purchasingMatches(jobId, jobBudgets, pos, orders, conflicts);
  const pendingPO = active.filter((b) => !matches.budgetPairs.some((p) => p.budget.id === b.id));
  const missingConfirmations = pos.filter((po) => !matches.supplierPairs.some((p) => p.po.id === po.id));
  const unmatched = orders.filter((o) => !matches.supplierPairs.some((p) => p.supplier.id === o.id));
  const reviewQuote = active.find((b) => b.budget_usage === 'draft' || !budgetFigures(b).ready) ||
    (!active.length ? jobBudgets.find((b) => b.budget_usage !== 'reference') : null);

  if (jobConflicts.length) return { label: 'Resolve PO conflict', href: procurementPath(jobId, 'orders'), key: 'orders' };
  if (reviewQuote || (active.length && rollup.status !== 'ready')) return { label: 'Review numbers', href: procurementPath(jobId, 'budgets'), key: 'budgets' };
  if (pendingPO.length) return { label: 'Prepare PO', href: procurementPath(jobId, 'orders'), key: 'orders' };
  if (unmatched.length || missingConfirmations.length) return { label: 'Confirm order', href: procurementPath(jobId, 'tracking'), key: 'tracking' };

  const needsETA = orders.filter((o) => !o.received_date && !o.eta_date);
  const overdue = orders.filter((o) => !o.received_date && o.eta_date && today && o.eta_date < today);
  if (needsETA.length || overdue.length) return { label: 'Record ETA', href: procurementPath(jobId, 'tracking'), key: 'tracking' };

  // Payment only when NOT already paid and progressed past ordering.
  const needsPayment = orders.filter((o) => !isOrderPaid(o) && (o.status === 'eta_set' || o.status === 'ach_link_received' || o.received_date || o.ach_link));
  if (needsPayment.length) return { label: 'Record payment', href: procurementPath(jobId, 'tracking'), key: 'tracking' };

  const needsReconcile = orders.filter((o) => isOrderPaid(o) && o.status !== 'reconciled' && !o.reconciled_at);
  if (needsReconcile.length) return { label: 'Reconcile', href: procurementPath(jobId, 'tracking'), key: 'tracking' };

  return { label: 'Open job', href: `/jobs/${encodeURIComponent(jobId)}`, key: 'job' };
}

// Build one card per job that has any purchasing activity. Merged, sample and
// ignored jobs are excluded. Cards are sorted by canonical name. A job in a
// PO conflict withholds windows AND profit. Duplicate job money inputs withhold.
export function buildPurchasingCards({ jobs = [], budgets = [], purchase_orders = [], vendor_orders = [], moneyInputs = [], conflicts = [], today = '' } = {}) {
  const moneyByJob = new Map();
  for (const m of moneyInputs) {
    if (!m?.job_id) continue;
    if (moneyByJob.has(m.job_id)) {
      moneyByJob.set(m.job_id, { ...moneyByJob.get(m.job_id), duplicate: true, rough_labor_material: null, sale_price: null });
    } else {
      moneyByJob.set(m.job_id, m);
    }
  }
  const conflictJobIds = new Set();
  for (const c of conflicts) for (const id of (c.job_ids || [])) conflictJobIds.add(id);

  const activeJobIds = new Set();
  for (const b of budgets) if (b.job_id && isLiveBudget(b)) activeJobIds.add(b.job_id);
  for (const p of purchase_orders) if (p.job_id && p.status !== 'cancelled') activeJobIds.add(p.job_id);
  for (const o of vendor_orders) if (o.job_id && !isVendorOrderCancelled(o, purchase_orders)) activeJobIds.add(o.job_id);
  for (const m of moneyInputs) if (m?.job_id) activeJobIds.add(m.job_id);

  const cards = [];
  for (const job of jobs) {
    if (job.merged_into || job.is_sample) continue;
    if (isIgnoredWorkItem(job)) continue;
    if (!activeJobIds.has(job.id)) continue;

    const jobBudgets = budgets.filter((b) => b.job_id === job.id);
    const jobPOs = purchase_orders.filter((p) => p.job_id === job.id);
    const isConflict = conflictJobIds.has(job.id);
    const win = isConflict ? { value: null, status: 'withheld', budgetId: null, provenance: null } : windowsInclTax(jobBudgets, jobPOs);

    const money = moneyByJob.get(job.id);
    const moneyDup = !!money?.duplicate;
    const rough = money && !moneyDup && amount(money.rough_labor_material) != null ? Number(amount(money.rough_labor_material)) : null;
    const sale = money && !moneyDup && amount(money.sale_price) != null ? Number(amount(money.sale_price)) : null;
    const profit = isConflict ? { value: null, tone: 'unknown' } : computeProfit(win.value, rough, sale);

    const refs = refsForJob(job.id, { budgets, purchaseOrders: purchase_orders, vendorOrders: vendor_orders, today });
    const next = nextActionForJob(job.id, { budgets, purchaseOrders: purchase_orders, vendorOrders: vendor_orders, conflicts, today });

    const activeBs = activeBudgets(jobBudgets);
    const fileBudget = activeBs[0] || jobBudgets[0] || null;
    const supplier = fileBudget?.vendor || fileBudget?.manufacturer ||
      (jobPOs.find((p) => p.status !== 'cancelled')?.vendor) || '';
    const units = activeBs.reduce((s, b) => s + (Number(b.openings_qty) || 0), 0);
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
      windows: win,
      rough: { value: rough, moneyId: money?.id || null, duplicate: moneyDup },
      sale: { value: sale, moneyId: money?.id || null, duplicate: moneyDup },
      profit, refs, next, files, supplier, units, conflict: isConflict, search,
    });
  }
  cards.sort((a, b) => String(a.job.canonical_name || '').localeCompare(String(b.job.canonical_name || '')));
  return cards;
}

// No-job entities (shop POs, unlinked quotes) are not tied to a job card.
// Surfaced in a quiet review section so they are never silently lost.
export function unlinkedEntities({ budgets = [], purchase_orders = [] } = {}) {
  const unlinkedQuotes = budgets.filter((b) => isLiveBudget(b) && !b.job_id);
  const shopPOs = purchase_orders.filter((p) => p.purchase_type === 'shop' && p.status !== 'cancelled');
  return { unlinkedQuotes, shopPOs };
}

export function cardMatchesSearch(card, query) {
  const q = String(query || '').trim().toLowerCase();
  if (!q) return true;
  return q.split(/\s+/).filter(Boolean).every((term) => card.search.includes(term));
}