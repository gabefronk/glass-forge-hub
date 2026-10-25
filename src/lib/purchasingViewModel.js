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
//  - The displayed windows estimate (not the verified figure above) is always on
//    one basis, materials as billed: PO/order/dealer amounts and budget material are
//    taken as entered, no use tax added (Gabriel, Oct 24 2026), and the budget's
//    labor overhead adder is never included.
import { activeBudgets, budgetFigures, budgetRollup, isLiveBudget, amount, roundMoney, isIgnoredWorkItem, sameVendor, pText } from './purchasingCoreTwin.js';
import { purchasingMatches } from './purchasingMatches.js';
import { procurementPath } from './procurementRoutes.js';
import { purchasingText } from './purchasingSearch.js';
import { moneyStatesForJob } from './purchasingMoneyStates.js';

const safeHref = (v) => { try { return v && new URL(v).protocol === 'https:' ? v : ''; } catch { return ''; } };
const fileHref = (id) => (id ? `https://drive.google.com/file/d/${encodeURIComponent(id)}/view` : '');

// PO statuses that mean the vendor accepted / material is in hand.
const CONFIRMED_PO_STATUS = ['ordered', 'confirmed', 'received'];

const activePOs = (pos, jobId) => pos.filter((p) => p.job_id === jobId && p.status !== 'cancelled');
const isVendorOrderCancelled = (o, pos) => Boolean(o.purchase_order_id && pos.some((p) => p.id === o.purchase_order_id && p.status === 'cancelled'));
const activeVendorOrders = (orders, pos) => orders.filter((o) => o.job_id && !isVendorOrderCancelled(o, pos));

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
export function sourceQuoteInclTax(budget, { allowInferredRecipient = false } = {}) {
  const q = budget?.quote;
  if (!q || q.price_levels !== 'single') return no('no_single_supplier_total');
  const issuer = pText(q.vendor);
  if (!issuer) return no('issuer_absent');
  if (OWN_QUOTE.test(`${issuer} ${q.quoted_by || ''} ${q.prepared_by || ''}`) || OUR_ACCOUNT.test(issuer)) return no('own_quote');
  if (!pText(budget.vendor) && !pText(budget.manufacturer)) return no('budget_vendor_absent');
  if (!sameVendor({ vendor: issuer, manufacturer: q.manufacturer }, budget)) return no('issuer_vendor_mismatch');
  // Cost role needs recipient evidence. Proven: billed to us. Inferred (display
  // only, always flagged review): a named third party issued the doc (a vendor
  // rep/dealer login), never Gabriel and never our own account - his own sell
  // quotes are excluded by the own_quote gate above, so a third-party issuer's
  // single-price doc is the supplier's bill to the dealer.
  const recipientProven = OUR_ACCOUNT.test(pText(q.bill_to));
  if (!recipientProven) {
    const issuedBy = pText(`${q.quoted_by || ''} ${q.prepared_by || ''}`.trim());
    const thirdParty = issuedBy && !OWN_QUOTE.test(issuedBy) && !OUR_ACCOUNT.test(issuedBy);
    if (!(allowInferredRecipient && thirdParty)) return no('recipient_unproven');
  }
  const lines = Array.isArray(q.lines) ? q.lines : [];
  if (!lines.length) return no('scope_unproven');
  if (lines.some((l) => l?.kind === 'part')) return no('mixed_scope');
  if (lines.some((l) => !UNIT_KINDS.includes(l?.kind) || !printed(l?.extended))) return no('scope_unproven');
  // Tax (Gabriel, Oct 24): no use tax is ever added. The supplier's printed total is the cost.
  const taxPrinted = printed(q.customer_tax);
  if (!printed(q.customer_total)) return { value: null, reason: 'total_absent' };
  const sub = printed(q.net_total) ? q.net_total : printed(q.customer_sub_total) ? q.customer_sub_total : null;
  if (sub == null) return { value: null, reason: 'subtotal_absent' };
  if (Math.abs(sub + (taxPrinted ? q.customer_tax : 0) - q.customer_total) > 0.01) return { value: null, reason: 'totals_do_not_reconcile' };
  const lineSum = lines.reduce((s, l) => s + l.extended, 0);
  if (Math.abs(lineSum - sub) > 0.01) return no('scope_unproven');
  return { value: roundMoney(q.customer_total), reason: null, inferred: !recipientProven };
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
      .some((k) => amount(b.inputs?.[k]) != null);
    return (src.value != null && budgetFigures(b).ready ? 4 : 0) + (hasCost ? 2 : 0);
  };
  return [...pool].sort((a, b) => (score(b) - score(a)) || String(a.id).localeCompare(String(b.id)));
}
export function pickDisplayBudget(jobBudgets = []) { return sortedDisplayPool(jobBudgets)[0] || null; }

// Deterministic pick among records by an amount field: earliest id with a
// real (non-null) amount. Returns { pick, alternatives } — never sums, never
// double-counts. A real 0 is a valid amount (kept); null/empty is absent.
function pickAmount(records, field) {
  const withAmt = records
    .map((r) => ({ id: r.id, amount: amount(r[field]), ref: r.po_number || r.order_number || r.id }))
    .filter((x) => x.amount != null);
  if (!withAmt.length) return { pick: null, alternatives: [] };
  withAmt.sort((a, b) => String(a.id).localeCompare(String(b.id)));
  return { pick: withAmt[0], alternatives: withAmt.slice(1) };
}

// PO and vendor order amounts are job cost as entered (no use tax added).
function supplierCandidate(kind, pick, rest) {
  const one = (p) => ({ value: roundMoney(p.amount), label: `${kind} ${p.ref}` });
  return { ...one(pick.pick), alternatives: pick.alternatives.map(one), ...rest };
}
const poCandidate = (pick, rest) => supplierCandidate('PO', pick, rest);
const orderCandidate = (pick, rest) => supplierCandidate('Order', pick, rest);

// POs/orders scoped to ONE budget by EXACT budget_id (never same-job first).
function scopedRecords(budget, jobPOs, jobOrders) {
  const pos = jobPOs.filter((p) => p.budget_id === budget.id);
  const poIds = new Set(pos.map((p) => p.id));
  const orders = jobOrders.filter((o) => poIds.has(o.purchase_order_id));
  return { pos, orders };
}

// Best-known windows-cost candidate from ONE budget. Priority: verified
// source quote → cost_material_tax (incl. overhead — honest label, NOT labor;
// used when any real cost input is present, explicit 0 included) → PO dealer
// amount scoped to THIS budget (exact budget_id, no tax) → vendor order amount
// scoped to this budget (no tax) → dealer price (dual-price quote, labelled
// dealer not supplier). Never customer_total / actual_total_sell (sale-side).
// Multiple POs/orders on one budget → deterministic pick (earliest id) +
// alternatives, never summed.
export function bestWindowsFromBudget(budget, scopedPOs, scopedOrders) {
  if (!budget) return { value: null, label: null, source: 'none', budgetId: null, alternatives: [], inferred: false };
  const src = sourceQuoteInclTax(budget, { allowInferredRecipient: true });
  // The supplier's printed quote total is a real document figure - show it
  // whether or not the budget numbers are reviewed (the caller still flags
  // unreviewed, and recipient-inferred figures are always flagged). The
  // overhead-loaded budget math (cost_material_tax) is never shown: it mixed
  // labor overhead into a "windows" number and misled reads.
  if (src.value != null) {
    const base = 'Supplier quote total';
    return { value: src.value, label: src.inferred ? `${base} (confirm)` : base, source: 'source_quote', budgetId: budget.id, alternatives: [], inferred: Boolean(src.inferred) };
  }
  const poPick = pickAmount(scopedPOs, 'amount_dealer');
  if (poPick.pick) return poCandidate(poPick, { source: 'po_dealer', budgetId: budget.id });
  const voPick = pickAmount(scopedOrders, 'amount');
  if (voPick.pick) return orderCandidate(voPick, { source: 'vendor_order', budgetId: budget.id });
  const q = budget.quote || {};
  const dealer = amount(q.dealer_subtotal) ?? amount(q.dealer_total);
  if (dealer != null) return { value: roundMoney(dealer), label: 'Dealer price (review)', source: 'dealer_price', budgetId: budget.id, alternatives: [] };
  // Budget-review figures the owner typed (restored 10/22 after his live read:
  // the budget must show on the main row). Window material + equipment as entered;
  // never cost_material_tax, which carries the labor overhead
  // adder (labor shows in its own column). Direct records above always win.
  const material = amount(budget.inputs?.material_true_cost);
  const equipment = amount(budget.inputs?.additional_equipment);
  if (material != null || equipment != null) return { value: roundMoney((material ?? 0) + (equipment ?? 0)), label: 'Budget material', source: 'cost_material_tax', budgetId: budget.id, alternatives: [] };
  return { value: null, label: 'No cost figure', source: 'none', budgetId: budget.id, alternatives: [] };
}

// Windows display tile. Verified canonical stays separate (card.windows.value);
// this is the best-known candidate shown in the tile. The candidate comes from
// ONE deterministic budget (pickDisplayBudget) — the same budget rough/sale use
// (card.chosenBudget) — so the three tiles never disagree on scope. Multiple
// scopes → one candidate + alternatives. PO-only job (no budget) falls back to
// the job's PO amount. Conflict → po_conflict label.
export function windowsDisplayCandidate(jobBudgets = [], jobPOs = [], jobOrders = [], { conflict = false } = {}) {
  const sorted = sortedDisplayPool(jobBudgets);
  if (!sorted.length) {
    if (conflict) return { value: null, label: 'PO conflict — no cost figure', review: true, source: 'po_conflict', budgetId: null, alternatives: [] };
    // PO-only job: no budget, but real POs/orders exist → show the known amount.
    const poPick = pickAmount(jobPOs, 'amount_dealer');
    if (poPick.pick) return { ...poCandidate(poPick, { source: 'po_dealer', budgetId: null }), review: true };
    const voPick = pickAmount(jobOrders, 'amount');
    if (voPick.pick) return { ...orderCandidate(voPick, { source: 'vendor_order', budgetId: null }), review: true };
    return { value: null, label: null, review: false, source: 'empty', budgetId: null, alternatives: [] };
  }
  if (sorted.length === 1) {
    const { pos, orders } = scopedRecords(sorted[0], jobPOs, jobOrders);
    const c = bestWindowsFromBudget(sorted[0], pos, orders);
    const reviewed = budgetFigures(sorted[0]).ready;
    const review = conflict || c.inferred || !(c.source === 'source_quote' && reviewed);
    return { value: c.value, label: conflict ? `PO conflict — ${c.label || 'review'}` : c.label, review, source: conflict ? 'po_conflict' : c.source, budgetId: c.budgetId, alternatives: c.alternatives || [] };
  }
  const pick = sorted[0];
  const pickScoped = scopedRecords(pick, jobPOs, jobOrders);
  const pickC = bestWindowsFromBudget(pick, pickScoped.pos, pickScoped.orders);
  const alternatives = sorted.slice(1).map((b) => {
    const s = scopedRecords(b, jobPOs, jobOrders);
    return bestWindowsFromBudget(b, s.pos, s.orders);
  }).filter((a) => a.value != null);
  const baseLabel = `${pickC.label || 'Estimate'} · 1 of ${sorted.length} scopes`;
  return { value: pickC.value, label: conflict ? `PO conflict — ${baseLabel}` : baseLabel, review: true, source: conflict ? 'po_conflict' : 'multiple_scopes', budgetId: pickC.budgetId, alternatives };
}

// The budget is the one source of a job's money (Gabriel, Oct 24): labor (sub pay +
// additional install material) and the customer sell he types in Edit numbers.
// Computed sheet math never shows. No budget figure → dash.
export function roughDisplayCandidate(budget) {
  const labor = budget ? amount(budget.inputs?.labor_cost_sub_pay) : null;
  const mat = budget ? amount(budget.inputs?.additional_install_material) : null;
  if (labor != null || mat != null) {
    return { value: roundMoney((labor ?? 0) + (mat ?? 0)), label: 'From budget', review: false, source: 'budget_inputs' };
  }
  return { value: null, label: null, review: false, source: 'none' };
}

export function saleDisplayCandidate(budget) {
  const sell = budget ? amount(budget.inputs?.actual_total_sell) : null;
  if (sell != null) return { value: Number(sell), label: 'From budget', review: false, source: 'budget_inputs' };
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

// Reference quiet line — Quote# / Mfr order# / YA PO / ETA. Suppliers are paid up
// front (Gabe, Oct 25), so there is no supplier payment state.
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
  // No supplier confirmation yet: the glass ETA lives on the budget the money tiles
  // read from (glass_eta_date) - that is what the ETA cell sets with one click.
  const etaBudget = orders.length ? null : pickDisplayBudget(jobBudgets);
  const budgetEta = etaBudget?.glass_eta_date || null;
  let etaLabel = null, etaStatus = 'none';
  if (!orders.length) { etaLabel = budgetEta; etaStatus = budgetEta ? ((today && budgetEta < today) ? 'amber' : 'green') : 'none'; }
  else if (receivedCount === orders.length) { etaLabel = 'Delivered'; etaStatus = 'green'; }
  else if (receivedCount > 0) { etaLabel = 'Partial'; etaStatus = 'amber'; }
  else if (etaDates.length === 0) { etaLabel = null; etaStatus = 'amber'; }
  else if (etaDates.length > 1) { etaLabel = 'Multiple'; etaStatus = 'amber'; }
  else { etaLabel = etaDates[0]; etaStatus = (etaMissing || (today && etaDates[0] < today)) ? 'amber' : 'green'; }

  return {
    quoteNumber, quoteStatus, quoteDraft, yaPo, poStatus, mfrOrder, mfrStatus,
    etaLabel, etaStatus,
  };
}

// Next action from the real purchasing workflow. No dead invoicing placeholder.
// quote → PO → supplier confirmation → ETA. Suppliers are paid up front, so there
// is no payment or reconcile step.
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

  return { label: 'Open job', href: `/jobs/${encodeURIComponent(jobId)}`, key: 'job' };
}

// Brand label for the Quote cell (10/22): the plain manufacturer brand only,
// never the dealer/builder/customer name. Filler like WINDOWS / WINDOWS & DOORS
// is stripped. Shared by the job row and its per-scope rows so both read the
// same label.
export function quoteBrandLabel(manufacturer = '') {
  return pText(manufacturer)
    .replace(/\bWINDOWS?(\s*(&|AND)\s+DOORS?)?\b/gi, '')
    .replace(/\s{2,}/g, ' ')
    .replace(/[\s\-–&,/]+$/, '')
    .replace(/^[\s\-–&,/]+/, '')
    .trim();
}

// Build one card per job that has any purchasing activity. Merged, sample and
// ignored jobs are excluded. Cards are sorted by canonical name. A job in a
// PO conflict withholds windows AND profit. Duplicate job money inputs withhold.
export function buildPurchasingCards({ jobs = [], budgets = [], purchase_orders = [], vendor_orders = [], conflicts = [], today = '' } = {}) {
  const conflictJobIds = new Set();
  for (const c of conflicts) for (const id of (c.job_ids || [])) conflictJobIds.add(id);

  const activeJobIds = new Set();
  for (const b of budgets) if (b.job_id && isLiveBudget(b)) activeJobIds.add(b.job_id);
  for (const p of purchase_orders) if (p.job_id && p.status !== 'cancelled') activeJobIds.add(p.job_id);
  for (const o of vendor_orders) if (o.job_id && !isVendorOrderCancelled(o, purchase_orders)) activeJobIds.add(o.job_id);
  // A job with a typed Customer total above $0 on Budget & Orders is a sale too, even with no
  // quote or PO yet (a labor-only install, Gabe Oct 25).
  for (const j of jobs) if (amount(j.manual_customer_total) > 0) activeJobIds.add(j.id);

  const cards = [];
  for (const job of jobs) {
    if (job.merged_into || job.is_sample) continue;
    if (isIgnoredWorkItem(job)) continue;
    if (!activeJobIds.has(job.id)) continue;

    const jobBudgets = budgets.filter((b) => b.job_id === job.id);
    const jobPOs = purchase_orders.filter((p) => p.job_id === job.id);
    const isConflict = conflictJobIds.has(job.id);
    const win = isConflict ? { value: null, status: 'withheld', budgetId: null, provenance: null, reason: 'po_conflict' } : windowsInclTax(jobBudgets);

    // Display candidates (DISPLAY ONLY — no datastore writes). Truly absent → null
    // (dash). A real 0 stays 0. Multiple scopes / conflict → one deterministic
    // candidate + alternatives, labelled estimate/review. Sale and labor come from
    // the job's budget - its one money source (Oct 24) - so they are also the
    // card's verified sale/labor; the verified profit still needs a verified windows cost.
    const jobActivePOs = jobPOs.filter((p) => p.status !== 'cancelled');
    const jobActiveOrders = activeVendorOrders(vendor_orders.filter((o) => o.job_id === job.id), purchase_orders);
    const pickBudget = pickDisplayBudget(jobBudgets);
    let winDisplay = windowsDisplayCandidate(jobBudgets, jobActivePOs, jobActiveOrders, { conflict: isConflict });
    let roughDisplay = roughDisplayCandidate(pickBudget);
    let saleDisplay = saleDisplayCandidate(pickBudget);
    // Typed Budget cost / Customer total (Budget & Orders boxes) win over the quote figures, so
    // the row matches that page (Gabe, Oct 25). The typed cost is the whole job cost: it sits in
    // the windows slot with labor & material at 0, so Cost and Est. profit add up the same way.
    // Source 'owner' keeps a multi-scope roll-up from withholding them.
    const typedSell = amount(job.manual_customer_total);
    const typedCost = amount(job.manual_budget_cost);
    if (typedSell != null) saleDisplay = { value: typedSell, label: 'Typed customer total', review: false, source: 'owner' };
    if (typedCost != null) {
      winDisplay = { value: typedCost, label: 'Typed budget cost', review: false, source: 'owner', budgetId: null, alternatives: [] };
      roughDisplay = { value: 0, label: 'In the typed budget cost', review: false, source: 'owner' };
    }
    const rough = roughDisplay.value;
    const sale = saleDisplay.value;
    const profit = isConflict ? { value: null, tone: 'unknown' } : computeProfit(win.value, rough, sale);
    const profitDisp = profitDisplayCalc(winDisplay, roughDisplay, saleDisplay);

    const refs = refsForJob(job.id, { budgets, purchaseOrders: purchase_orders, vendorOrders: vendor_orders, today });
    const states = moneyStatesForJob(job.id, { budgets, purchaseOrders: purchase_orders, vendorOrders: vendor_orders });
    const next = nextActionForJob(job.id, { budgets, purchaseOrders: purchase_orders, vendorOrders: vendor_orders, conflicts, today });

    const activeBs = activeBudgets(jobBudgets);
    const fileBudget = activeBs[0] || jobBudgets[0] || null;
    // Brand label for the Quote cell (10/22): the plain manufacturer brand
    // only, never the dealer/builder/customer name. Vendor stays raw below for
    // search. Shared with the per-scope rows so both read the same label.
    const brand = quoteBrandLabel(fileBudget?.manufacturer);
    const supplier = fileBudget?.vendor || fileBudget?.manufacturer ||
      (jobPOs.find((p) => p.status !== 'cancelled')?.vendor) || '';
    const units = activeBs.reduce((s, b) => s + (Number(b.openings_qty) || 0), 0);
    const files = {
      sourceQuote: safeHref(fileBudget?.source_pdf_url) || fileHref(fileBudget?.drive_quote_file_id),
      // Budget id only (never the private ref); the server resolves its receipt on click.
      privateSourceBudgetId: fileBudget && /^[a-f0-9]{64}$/.test(fileBudget.source_sha256 || '') ? fileBudget.id : null,
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
      rough: { value: rough, display: roughDisplay },
      sale: { value: sale, display: saleDisplay },
      profit,
      profitDisplay: profitDisp,
      chosenBudget: pickBudget ? { id: pickBudget.id, title: pickBudget.title || pickBudget.quote_name || 'Budget' } : null,
      refs, next, files, supplier, brand, units, conflict: isConflict, search, states,
      // The budget the Quote cell reads its brand + number from (edited in place).
      quoteBudgetId: fileBudget?.id || null,
      quoteManufacturer: fileBudget?.manufacturer || '',
      quoteRawNumber: fileBudget?.quote_number || '',
    });
  }
  cards.sort((a, b) => String(a.job.canonical_name || '').localeCompare(String(b.job.canonical_name || '')));
  return cards;
}

// No-job entities (shop POs, unlinked quotes) are not tied to a job card.
// Surfaced in a quiet review section so they are never silently lost.
// Shop POs are cost only (no job, no customer), newest first.
export function unlinkedEntities({ budgets = [], purchase_orders = [] } = {}) {
  const unlinkedQuotes = budgets.filter((b) => isLiveBudget(b) && !b.job_id);
  const shopPOs = purchase_orders.filter((p) => p.purchase_type === 'shop' && p.status !== 'cancelled')
    .sort((a, b) => String(b.created_date || '').localeCompare(String(a.created_date || '')));
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