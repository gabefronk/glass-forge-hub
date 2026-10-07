// Pure viewmodel for the unified Purchasing page. No React, no SDK, no I/O.
// Builds one compact card per job from the procurement overview + owner money
// inputs. Computes the four currency tiles, the reference quiet line, the
// next action, and a search string. Profit is computed read-only.
//
// Grounding rules:
//  - Windows incl tax is window-only and tax-inclusive with provenance: the
//    supplier's printed single-price quote total whose subtotal + explicit
//    printed tax reconciles (see sourceQuoteInclTax). Never the budget's
//    cost_material_tax (contains the labor overhead adder), never PO/vendor
//    amounts (no tax field). Unknown → withhold as "Needs review".
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
import { activeBudgets, budgetFigures, budgetRollup, isLiveBudget, amount, roundMoney, isIgnoredWorkItem, sameVendor, pText } from './purchasingCoreTwin.js';
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

// Window-only, tax-inclusive source value. The budget's cost_material_tax is
// NOT used: it includes the labor-driven overhead adder before tax, so
// labelling it "windows incl tax" and then subtracting rough labor/material
// would double-count labor. PO amount_dealer and VendorOrder amount carry no
// tax field, so they cannot prove tax-inclusive either. The only source that
// proves it is the supplier's own printed single-price quote: subtotal +
// explicit printed tax (zero is valid) must reconcile to the printed total.
// Absent tax, own (Glass Forge) quote, dealer+customer quote, or totals that
// do not reconcile → null with a reason (shown as "Needs review").
// Cost role must be PROVEN by positive document evidence, never by the absence
// of Gabriel's name:
//  - issuer: the parser's document issuer (quote.vendor, letterhead) is present,
//    is not us, and matches the budget's explicit vendor/manufacturer;
//  - recipient: the quote is billed TO us (bill_to names Glass Forge / YA Windows),
//    so customer_total is what we pay, not what our customer pays;
//  - scope: every line is a window/door/glass unit with a printed extended price
//    and the lines sum to the subtotal, so no freight/parts/material is mixed in.
const OWN_QUOTE = /gabriel|\bgabe\b|fronk|glass\s*forge/i;
const OUR_ACCOUNT = /glass\s*forge|\bya\s+windows|\by\.\s?a\.\s+windows/i;
const UNIT_KINDS = ['window', 'door', 'glass'];
const printed = (v) => typeof v === 'number' && Number.isFinite(v) && v >= 0;
const no = (reason) => ({ value: null, reason });
export function sourceQuoteInclTax(budget) {
  const q = budget?.quote;
  if (!q || q.price_levels !== 'single') return no('no_single_supplier_total');
  const issuer = pText(q.vendor);
  if (!issuer) return no('issuer_absent');
  if (OWN_QUOTE.test(`${issuer} ${q.quoted_by || ''} ${q.prepared_by || ''}`) || OUR_ACCOUNT.test(issuer)) return no('own_quote');
  if (!pText(budget.vendor) && !pText(budget.manufacturer)) return no('budget_vendor_absent');
  if (!sameVendor({ vendor: issuer, manufacturer: q.manufacturer }, budget)) return no('issuer_vendor_mismatch');
  if (!OUR_ACCOUNT.test(pText(q.bill_to))) return no('recipient_unproven');
  const lines = Array.isArray(q.lines) ? q.lines : [];
  if (!lines.length) return no('scope_unproven');
  if (lines.some((l) => l?.kind === 'part')) return no('mixed_scope');
  if (lines.some((l) => !UNIT_KINDS.includes(l?.kind) || !printed(l?.extended))) return no('scope_unproven');
  if (!printed(q.customer_tax)) return { value: null, reason: 'tax_absent' };
  if (!printed(q.customer_total)) return { value: null, reason: 'total_absent' };
  const sub = printed(q.net_total) ? q.net_total : printed(q.customer_sub_total) ? q.customer_sub_total : null;
  if (sub == null) return { value: null, reason: 'subtotal_absent' };
  if (Math.abs(sub + q.customer_tax - q.customer_total) > 0.01) return { value: null, reason: 'totals_do_not_reconcile' };
  const lineSum = lines.reduce((s, l) => s + l.extended, 0);
  if (Math.abs(lineSum - sub) > 0.01) return no('scope_unproven');
  return { value: roundMoney(q.customer_total), reason: null };
}

// Tile 1 — Windows incl tax. Single active reviewed scope with a verified
// source value; anything else withholds with a status.
export function windowsInclTax(jobBudgets = []) {
  const live = jobBudgets.filter(isLiveBudget);
  const active = activeBudgets(live);
  if (active.length === 0) {
    // Draft-only quotes exist → the job has a quote that needs review, not "no quote".
    const drafts = live.filter((b) => b.budget_usage !== 'reference');
    return drafts.length
      ? { value: null, status: 'review', budgetId: drafts.length === 1 ? drafts[0].id : null, provenance: null, reason: 'draft' }
      : { value: null, status: 'empty', budgetId: null, provenance: null };
  }
  if (active.length > 1) return { value: null, status: 'withheld', budgetId: null, provenance: null, reason: 'multiple_scopes' };
  if (!budgetFigures(active[0]).ready) return { value: null, status: 'review', budgetId: active[0].id, provenance: null, reason: 'numbers_not_reviewed' };
  const src = sourceQuoteInclTax(active[0]);
  if (src.value == null) return { value: null, status: 'review', budgetId: active[0].id, provenance: null, reason: src.reason };
  return { value: src.value, status: 'ready', budgetId: active[0].id, provenance: 'source_quote', reason: null };
}

// Tile 4 — Profit. Dash until all three inputs resolve.
export function computeProfit(windowsValue, roughValue, saleValue) {
  if (windowsValue == null || roughValue == null || saleValue == null) {
    return { value: null, tone: 'unknown' };
  }
  const p = roundMoney(saleValue - windowsValue - roughValue);
  return { value: p, tone: p > 0 ? 'positive' : p < 0 ? 'negative' : 'zero' };
}

// --- Display candidates (DISPLAY ONLY — no datastore writes) ---
// The verified canonical value (windowsInclTax / owner money input) is kept
// separate on the card (card.windows.value / card.rough.value / card.sale.value
// and the verified card.profit). These helpers build the BEST-KNOWN number shown
// in the tile when the verified value is null: a real figure from the budget /
// PO / order fields with an honest label and an amber review flag. Truly absent
// → null (dash). A real 0 stays 0. Never invents a number, never mislabels a
// budget estimate as owner-entered actual, never uses customer sale / dealer
// dual-price customer_total as supplier cost. For multiple scopes / PO
// conflict: one deterministic candidate + alternatives in the expansion,
// labelled estimate/review — never first/last guess or a sum that double-counts.

// Deterministic budget pick for display candidates: prefer a budget with a
// verified source quote, then one with real cost inputs, then by id (stable).
function sortedDisplayPool(jobBudgets = []) {
  const live = jobBudgets.filter(isLiveBudget);
  const active = activeBudgets(live);
  const pool = active.length ? active : live.filter((b) => b.budget_usage !== 'reference');
  const score = (b) => {
    const src = sourceQuoteInclTax(b);
    const hasCost = ['material_true_cost', 'labor_cost_sub_pay', 'additional_install_material', 'additional_equipment']
      .some((k) => (amount(b.inputs?.[k]) ?? 0) > 0);
    return (src.value != null && budgetFigures(b).ready ? 4 : 0) + (hasCost ? 2 : 0);
  };
  return [...pool].sort((a, b) => (score(b) - score(a)) || String(a.id).localeCompare(String(b.id)));
}
export function pickDisplayBudget(jobBudgets = []) { return sortedDisplayPool(jobBudgets)[0] || null; }

// Best-known windows-cost candidate from ONE budget. Priority: verified
// source quote → cost_material_tax (incl. overhead — honest label, NOT labor)
// → PO dealer amount (no tax) → vendor order amount (no tax) → dealer price
// (dual-price quote, labelled dealer not supplier). Never customer_total /
// actual_total_sell (sale-side, not supplier cost).
function bestWindowsFromBudget(budget, jobPOs, jobOrders) {
  if (!budget) return { value: null, label: null, source: 'none', budgetId: null };
  const src = sourceQuoteInclTax(budget);
  if (src.value != null && budgetFigures(budget).ready) return { value: src.value, label: 'Supplier quote total incl tax', source: 'source_quote', budgetId: budget.id };
  const fig = budgetFigures(budget);
  const hasCost = ['material_true_cost', 'labor_cost_sub_pay', 'additional_install_material', 'additional_equipment']
    .some((k) => (amount(budget.inputs?.[k]) ?? 0) > 0);
  if (hasCost && fig.calculated && fig.calculated.cost_material_tax > 0) return { value: fig.calculated.cost_material_tax, label: 'Material incl tax (budget, incl. overhead)', source: 'cost_material_tax', budgetId: budget.id };
  const po = jobPOs.find((p) => { const a = amount(p.amount_dealer); return a != null && a > 0; });
  if (po) return { value: Number(amount(po.amount_dealer)), label: 'PO dealer amount (no tax verified)', source: 'po_dealer', budgetId: budget.id };
  const vo = jobOrders.find((o) => { const a = amount(o.amount); return a != null && a > 0; });
  if (vo) return { value: Number(amount(vo.amount)), label: 'Vendor order amount (no tax verified)', source: 'vendor_order', budgetId: budget.id };
  const q = budget.quote || {};
  const dealer = amount(q.dealer_subtotal) ?? amount(q.dealer_total);
  if (dealer != null && dealer > 0) return { value: Number(dealer), label: 'Dealer price (review)', source: 'dealer_price', budgetId: budget.id };
  return { value: null, label: 'No cost figure', source: 'none', budgetId: budget.id };
}

// Windows display tile. Verified canonical stays separate (card.windows.value);
// this is the best-known candidate shown in the tile. Multiple scopes / PO
// conflict → one deterministic candidate + alternatives, labelled review.
export function windowsDisplayCandidate(jobBudgets = [], jobPOs = [], jobOrders = [], { conflict = false } = {}) {
  const sorted = sortedDisplayPool(jobBudgets);
  if (!sorted.length) return { value: null, label: conflict ? 'PO conflict — no cost figure' : null, review: conflict, source: conflict ? 'po_conflict' : 'empty', budgetId: null, alternatives: [] };
  if (sorted.length === 1) {
    const c = bestWindowsFromBudget(sorted[0], jobPOs, jobOrders);
    const reviewed = budgetFigures(sorted[0]).ready;
    const review = conflict || !(c.source === 'source_quote' && reviewed);
    return { value: c.value, label: conflict ? `PO conflict — ${c.label || 'review'}` : c.label, review, source: conflict ? 'po_conflict' : c.source, budgetId: c.budgetId, alternatives: [] };
  }
  const pick = bestWindowsFromBudget(sorted[0], jobPOs, jobOrders);
  const alternatives = sorted.slice(1).map((b) => bestWindowsFromBudget(b, jobPOs, jobOrders)).filter((a) => a.value != null);
  const baseLabel = `${pick.label || 'Estimate'} · 1 of ${sorted.length} scopes`;
  return { value: pick.value, label: conflict ? `PO conflict — ${baseLabel}` : baseLabel, review: true, source: conflict ? 'po_conflict' : 'multiple_scopes', budgetId: pick.budgetId, alternatives };
}

// Rough labor/material display: owner-entered (verified) when present; else
// budget labor_cost_sub_pay + additional_install_material as an estimate
// (labelled estimate, never mislabeled owner-entered actual). Duplicate owner
// entries → owner ambiguous, fall to budget estimate with a duplicate flag.
export function roughDisplayCandidate(budget, ownerValue, duplicate) {
  if (ownerValue != null && !duplicate) return { value: ownerValue, label: 'Owner-entered', review: false, source: 'owner' };
  const labor = amount(budget?.inputs?.labor_cost_sub_pay);
  const mat = amount(budget?.inputs?.additional_install_material);
  const est = ((labor ?? 0) > 0 || (mat ?? 0) > 0) ? roundMoney((labor ?? 0) + (mat ?? 0)) : null;
  if (est == null) return { value: null, label: null, review: false, source: 'none' };
  return { value: est, label: duplicate ? 'Budget labor + material (estimate) — duplicate owner entries' : 'Budget labor + material (estimate)', review: true, source: 'budget_estimate' };
}

// Sale price display: owner-entered (verified) when present; else budget
// actual_total_sell (target) or suggested_total_sell as an estimate, labelled
// estimate — never mislabeled owner-entered actual.
export function saleDisplayCandidate(budget, ownerValue, duplicate) {
  if (ownerValue != null && !duplicate) return { value: ownerValue, label: 'Owner-entered', review: false, source: 'owner' };
  const sell = amount(budget?.inputs?.actual_total_sell);
  if (sell != null && sell > 0) return { value: Number(sell), label: duplicate ? 'Budget target sell (estimate) — duplicate owner entries' : 'Budget target sell (estimate)', review: true, source: 'budget_estimate' };
  const suggested = budgetFigures(budget).calculated?.suggested_total_sell;
  if (suggested != null && suggested > 0) return { value: suggested, label: 'Budget suggested sell (estimate)', review: true, source: 'budget_suggested' };
  return { value: null, label: null, review: false, source: 'none' };
}

// Display profit from the three display inputs (candidate or verified). Shown
// only when all three resolve; flagged when any input is a candidate. The
// verified profit (card.profit, from verified inputs only) stays separate and
// is never persisted.
export function profitDisplayCalc(windowsDisp, roughDisp, saleDisp) {
  if (windowsDisp?.value == null || roughDisp?.value == null || saleDisp?.value == null) return { value: null, tone: 'unknown', review: false };
  const p = roundMoney(saleDisp.value - windowsDisp.value - roughDisp.value);
  const review = Boolean(windowsDisp.review || roughDisp.review || saleDisp.review);
  return { value: p, tone: p > 0 ? 'positive' : p < 0 ? 'negative' : 'zero', review };
}

// Reference quiet line — Quote# / Mfr order# / YA PO / ETA / Payment.
// green = confirmed/complete, amber = needs action, none = not present.
// Aggregates ALL active records; "Multiple" when distinct values conflict.
export function refsForJob(jobId, { budgets = [], purchaseOrders = [], vendorOrders = [], today = '' } = {}) {
  const pos = activePOs(purchaseOrders, jobId);
  const jobBudgets = budgets.filter((b) => b.job_id === jobId && isLiveBudget(b));
  const active = activeBudgets(jobBudgets);

  // Draft-only: show the draft quote number as an amber reference (never money).
  const drafts = active.length ? [] : jobBudgets.filter((b) => b.budget_usage === 'draft');
  const quoteNumbers = [...new Set((active.length ? active : drafts).map((b) => b.quote_number).filter(Boolean))];
  const quoteNumber = quoteNumbers.length > 1 ? 'Multiple' : (quoteNumbers[0] || null);
  const quoteDraft = !active.length && drafts.length > 0;
  const quoteStatus = quoteDraft ? 'amber'
    : !active.length ? 'none'
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
  // ETA — Delivered only when EVERY order is received; some received → Partial.
  // A missing ETA on any pending order keeps the single-date label amber.
  const receivedCount = orders.filter((o) => o.received_date).length;
  const etaDates = [...new Set(orders.map((o) => o.eta_date).filter(Boolean))];
  const etaMissing = orders.some((o) => !o.eta_date);
  let etaLabel = null, etaStatus = 'none';
  if (!orders.length) { etaLabel = null; etaStatus = 'none'; }
  else if (receivedCount === orders.length) { etaLabel = 'Delivered'; etaStatus = 'green'; }
  else if (receivedCount > 0) { etaLabel = 'Partial'; etaStatus = 'amber'; }
  else if (etaDates.length === 0) { etaLabel = null; etaStatus = 'amber'; }
  else if (etaDates.length > 1) { etaLabel = 'Multiple'; etaStatus = 'amber'; }
  else { etaLabel = etaDates[0]; etaStatus = (etaMissing || (today && etaDates[0] < today)) ? 'amber' : 'green'; }

  // Payment — actual schema: paid/reconciled status or paid_at. Mixed → attention.
  const paidOrders = orders.filter(isOrderPaid);
  const payment = !orders.length ? 'none'
    : paidOrders.length === orders.length ? 'green'
    : 'amber';
  const paymentLabel = !orders.length ? null
    : paidOrders.length === orders.length ? 'Paid'
    : paidOrders.length > 0 ? 'Partial' : 'Unpaid';

  return {
    quoteNumber, quoteStatus, quoteDraft, yaPo, poStatus, mfrOrder, mfrStatus,
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
    const win = isConflict ? { value: null, status: 'withheld', budgetId: null, provenance: null, reason: 'po_conflict' } : windowsInclTax(jobBudgets);

    const money = moneyByJob.get(job.id);
    const moneyDup = !!money?.duplicate;
    const rough = money && !moneyDup && amount(money.rough_labor_material) != null ? Number(amount(money.rough_labor_material)) : null;
    const sale = money && !moneyDup && amount(money.sale_price) != null ? Number(amount(money.sale_price)) : null;
    const profit = isConflict ? { value: null, tone: 'unknown' } : computeProfit(win.value, rough, sale);

    // Display candidates (DISPLAY ONLY — no datastore writes). The verified
    // canonical value (win.value / rough / sale) stays separate on the card;
    // these build the best-known number shown in the tile when verified is
    // null, with an honest label and amber review flag. Truly absent → null
    // (dash). A real 0 stays 0. Multiple scopes / conflict → one deterministic
    // candidate + alternatives, labelled estimate/review.
    const jobActivePOs = jobPOs.filter((p) => p.status !== 'cancelled');
    const jobActiveOrders = activeVendorOrders(vendor_orders.filter((o) => o.job_id === job.id), purchase_orders);
    const pickBudget = pickDisplayBudget(jobBudgets);
    const winDisplay = windowsDisplayCandidate(jobBudgets, jobActivePOs, jobActiveOrders, { conflict: isConflict });
    const roughDisplay = roughDisplayCandidate(pickBudget, rough, moneyDup);
    const saleDisplay = saleDisplayCandidate(pickBudget, sale, moneyDup);
    const profitDisp = profitDisplayCalc(winDisplay, roughDisplay, saleDisplay);

    const refs = refsForJob(job.id, { budgets, purchaseOrders: purchase_orders, vendorOrders: vendor_orders, today });
    const next = nextActionForJob(job.id, { budgets, purchaseOrders: purchase_orders, vendorOrders: vendor_orders, conflicts, today });

    const activeBs = activeBudgets(jobBudgets);
    const fileBudget = activeBs[0] || jobBudgets[0] || null;
    const supplier = fileBudget?.vendor || fileBudget?.manufacturer ||
      (jobPOs.find((p) => p.status !== 'cancelled')?.vendor) || '';
    const units = activeBs.reduce((s, b) => s + (Number(b.openings_qty) || 0), 0);
    const files = {
      sourceQuote: safeHref(fileBudget?.source_pdf_url) || fileHref(fileBudget?.drive_quote_file_id),
      // Budget id only (never the private ref); the server resolves its receipt on click.
      privateSourceBudgetId: fileBudget && /^[a-f0-9]{64}$/.test(fileBudget.source_sha256 || '') ? fileBudget.id : null,
      budgetSheet: fileHref(fileBudget?.drive_budget_xlsx_file_id),
      driveFolder: safeHref(job.drive_job_folder_url) ||
        (job.drive_job_folder_id ? `https://drive.google.com/drive/folders/${encodeURIComponent(job.drive_job_folder_id)}` : '') ||
        (fileBudget?.drive_job_folder_id ? `https://drive.google.com/drive/folders/${encodeURIComponent(fileBudget.drive_job_folder_id)}` : ''),
    };
    // Search on ALL raw refs (not the "Multiple" display label) so a specific number still finds the card.
    const rawRefs = [
      ...jobBudgets.filter(isLiveBudget).map((b) => b.quote_number),
      ...jobPOs.filter((p) => p.status !== 'cancelled').map((p) => p.po_number),
      ...activeVendorOrders(vendor_orders.filter((o) => o.job_id === job.id), purchase_orders).map((o) => o.order_number),
    ];
    const search = (purchasingText(job) + ' ' + [...rawRefs, supplier].filter(Boolean).join(' ')).toLowerCase();

    cards.push({
      job: { id: job.id, canonical_name: job.canonical_name, address: job.address, builder: job.builder },
      windows: { ...win, display: winDisplay },
      rough: { value: rough, moneyId: money?.id || null, duplicate: moneyDup, display: roughDisplay },
      sale: { value: sale, moneyId: money?.id || null, duplicate: moneyDup, display: saleDisplay },
      profit,
      profitDisplay: profitDisp,
      refs, next, files, supplier, units, conflict: isConflict, search,
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

// Inline per-job workspace helpers.
// sectionForNextKey maps a card's next-action key to the inline section it
// should open. 'job' (and any unknown key) returns null — that is the external
// Open-job link, which stays a Link and never opens an inline section.
export function sectionForNextKey(key) {
  return key === 'budgets' || key === 'orders' || key === 'tracking' ? key : null;
}

// jobProcurementRecords filters the procurement overview to ONE job by EXACT
// immutable job_id — never a name join. Cancelled POs and the vendor orders
// whose linked PO is cancelled are excluded everywhere (matches the card refs).
export function jobProcurementRecords(data = {}, jobId = '') {
  if (!jobId) return { budgets: [], pos: [], orders: [], conflicts: [] };
  const cancelledPOIds = new Set((data.purchase_orders || []).filter((p) => p.status === 'cancelled').map((p) => p.id));
  return {
    budgets: (data.budgets || []).filter((b) => b.job_id === jobId && isLiveBudget(b)),
    pos: (data.purchase_orders || []).filter((p) => p.job_id === jobId && p.status !== 'cancelled'),
    orders: (data.vendor_orders || []).filter((o) => o.job_id === jobId && !(o.purchase_order_id && cancelledPOIds.has(o.purchase_order_id))),
    conflicts: (data.conflicts || []).filter((c) => (c.job_ids || []).includes(jobId)),
  };
}