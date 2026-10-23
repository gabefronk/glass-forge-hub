// Per-scope rows for the Purchasing board. A job holding more than one scope —
// a second quote budget, a reorder PO, a supplier order with no PO — lists each
// scope on its own row under the job's roll-up row, so a second order keeps its
// own quote, PO, ETA and supplier payment instead of hiding behind "Multiple".
//
// Display only: nothing here writes, sums across scopes, or changes the job's
// own roll-up figures. Every figure comes from the scope's own records, using
// the same provenance rules the board already uses (see purchasingViewModel):
//  - a quote-scope windows value = that budget's verified supplier total, else
//    its own PO / order amount, else its reviewed figure;
//  - a PO or order scope shows only that record's own amount (no tax verified);
//  - labor & material and sale price come only from the scope's own budget
//    review inputs — a scope without a budget shows a dash, never a guess.
// A reorder (several POs on ONE budget) splits into one row per PO: the quote
// stays the shared budget, the money is that PO's own payable, and the budget's
// labor/material and sale price stay off the rows because they belong to the
// whole quote, not to one order — the job's roll-up row carries those.
import { isLiveBudget, budgetFigures, pText } from './purchasingCoreTwin.js';
import {
  bestWindowsFromBudget, windowsDisplayCandidate, roughDisplayCandidate,
  saleDisplayCandidate, profitDisplayCalc, paymentState, quoteBrandLabel,
} from './purchasingViewModel.js';

// PO statuses that mean the vendor accepted / material is in hand.
const CONFIRMED_PO_STATUS = ['ordered', 'confirmed', 'received'];
const NONE = { value: null, label: null, review: false, source: 'none' };
const EMPTY_QUOTE_CARD = { refs: { quoteNumber: null, quoteStatus: null }, brand: '', quoteBudgetId: null, quoteManufacturer: '', quoteRawNumber: '' };

// Supplier payment across this scope's orders — same semantics as paymentState
// (paid/reconciled or paid_at), never labelling an unknown as unpaid.
function paymentFor(orders) {
  if (!orders.length) return { label: null, tone: 'gray' };
  const paid = orders.filter((o) => ['paid', 'reconciled'].includes(o.status) || Boolean(o.paid_at));
  if (paid.length === orders.length) return { label: 'Paid', tone: 'green' };
  if (paid.length) return { label: 'Partial', tone: 'amber' };
  return paymentState(orders[0]).label === 'Unknown' ? { label: 'Unknown', tone: 'gray' } : { label: 'Unpaid', tone: 'amber' };
}

// The scope's ETA is the ETA of ITS records: one pending supplier order keeps
// the date on that order (the cell writes to the supplier record), otherwise the
// budget's glass ETA when nothing is on order. Several pending orders, or one
// with no order number/amount, cannot be written from a cell — that row points
// at the supplier tracking section instead.
function etaFor(budget, orders) {
  const pending = orders.filter((o) => !o.received_date);
  if (!orders.length) {
    const date = budget?.glass_eta_date || '';
    return { target: budget ? { budgetId: budget.id, date } : null, label: date || null };
  }
  if (!pending.length) return { target: null, label: 'Delivered' };
  if (pending.length > 1) return { target: null, label: 'Multiple' };
  const one = pending[0];
  const date = one.eta_date || '';
  if (one.order_number && one.amount != null) return { target: { order: one, date }, label: date || null };
  return { target: null, label: date || null };
}

const poTone = (pos) => (!pos.length ? null
  : pos.every((p) => CONFIRMED_PO_STATUS.includes(p.status)) ? 'green' : 'amber');

function budgetQuoteCard(budget) {
  return {
    refs: {
      quoteNumber: pText(budget.quote_number) || null,
      quoteStatus: budgetFigures(budget).ready && budget.budget_usage !== 'draft' ? 'green' : 'amber',
    },
    brand: quoteBrandLabel(budget.manufacturer),
    quoteBudgetId: budget.id,
    quoteManufacturer: budget.manufacturer || '',
    quoteRawNumber: budget.quote_number || '',
  };
}

function budgetScope(budget, pos, orders) {
  const windows = bestWindowsFromBudget(budget, pos, orders);
  const rough = roughDisplayCandidate(budget, null, false);
  const sale = saleDisplayCandidate(budget, null, false);
  const eta = etaFor(budget, orders);
  const poNumbers = [...new Set(pos.map((p) => p.po_number).filter(Boolean))];
  return {
    key: `budget:${budget.id}`,
    label: [pText(budget.title) || pText(budget.quote_name) || 'Quote', budget.quote_number ? `Quote ${budget.quote_number}` : '', poNumbers.join(', ')].filter(Boolean).join(' · '),
    windows, rough, sale,
    profit: profitDisplayCalc(windows, rough, sale),
    quoteCard: budgetQuoteCard(budget),
    poNumber: poNumbers.length > 1 ? 'Multiple' : (poNumbers[0] || null),
    poStatus: poTone(pos),
    payment: paymentFor(orders),
    etaTarget: eta.target,
    etaLabel: eta.label,
  };
}

// A PO that no listed quote budget claims: its own payable, its own orders.
function poScope(po, orders, quoteCard = EMPTY_QUOTE_CARD, extraLabel = '') {
  const windows = windowsDisplayCandidate([], [po], orders, {});
  const eta = etaFor(null, orders);
  return {
    key: `po:${po.id}`,
    label: [po.po_number ? `PO ${po.po_number}` : 'Purchase order', pText(po.vendor), orders.length === 1 ? orders[0].order_number : '', extraLabel].filter(Boolean).join(' · '),
    windows, rough: NONE, sale: NONE,
    profit: profitDisplayCalc(windows, NONE, NONE),
    quoteCard,
    poNumber: po.po_number || null,
    poStatus: poTone([po]),
    payment: paymentFor(orders),
    etaTarget: eta.target,
    etaLabel: eta.label,
  };
}

// A supplier confirmation with neither a PO nor a budget behind it.
function orderScope(order) {
  const windows = windowsDisplayCandidate([], [], [order], {});
  const eta = etaFor(null, [order]);
  return {
    key: `order:${order.id}`,
    label: [order.order_number ? `Order ${order.order_number}` : 'Supplier order', pText(order.vendor)].filter(Boolean).join(' · '),
    windows, rough: NONE, sale: NONE,
    profit: profitDisplayCalc(windows, NONE, NONE),
    quoteCard: EMPTY_QUOTE_CARD,
    poNumber: null,
    poStatus: null,
    payment: paymentFor([order]),
    etaTarget: eta.target,
    etaLabel: eta.label,
  };
}

// One entry per scope on this job: each live quote budget, then each PO no
// listed budget claims, then each supplier order with neither. A budget with
// several POs (a reorder) splits into one row per PO. Cancelled POs, and orders
// under a cancelled PO, are excluded everywhere — exactly as the card refs.
export function scopesForJob(jobId, { budgets = [], purchase_orders = [], vendor_orders = [] } = {}) {
  if (!jobId) return [];
  const cancelledPOIds = new Set(purchase_orders.filter((p) => p.status === 'cancelled').map((p) => p.id));
  const liveBudgets = budgets.filter((b) => b.job_id === jobId && isLiveBudget(b) && b.budget_usage !== 'reference');
  const pos = purchase_orders.filter((p) => p.job_id === jobId && p.status !== 'cancelled');
  const orders = vendor_orders.filter((o) => o.job_id === jobId && !(o.purchase_order_id && cancelledPOIds.has(o.purchase_order_id)));
  const claimedPOIds = new Set();
  const claimedOrderIds = new Set();
  const scopes = [];
  for (const budget of liveBudgets) {
    const scopedPOs = pos.filter((p) => p.budget_id === budget.id);
    const scopedOrders = orders.filter((o) => scopedPOs.some((p) => p.id === o.purchase_order_id));
    scopedOrders.forEach((o) => claimedOrderIds.add(o.id));
    if (scopedPOs.length > 1) {
      const quoteNumber = pText(budget.quote_number) ? `Quote ${budget.quote_number}` : '';
      for (const po of scopedPOs) {
        claimedPOIds.add(po.id);
        scopes.push(poScope(po, scopedOrders.filter((o) => o.purchase_order_id === po.id), budgetQuoteCard(budget), quoteNumber));
      }
      continue;
    }
    scopedPOs.forEach((p) => claimedPOIds.add(p.id));
    scopes.push(budgetScope(budget, scopedPOs, scopedOrders));
  }
  for (const po of pos) {
    if (claimedPOIds.has(po.id)) continue;
    const scopedOrders = orders.filter((o) => o.purchase_order_id === po.id);
    scopedOrders.forEach((o) => claimedOrderIds.add(o.id));
    scopes.push(poScope(po, scopedOrders));
  }
  for (const order of orders) {
    if (claimedOrderIds.has(order.id)) continue;
    // Reference-only order rows (no PO, no order number, no amount) carry no
    // purchasing figure a scope row could show or edit - e.g. the disputed
    // dual-mapped AMSCO placeholder recorded by the Oct 13 PO reconciliation.
    // They stay visible in supplier tracking; they are not a scope.
    if (!order.purchase_order_id && order.amount == null && !pText(order.order_number)) continue;
    scopes.push(orderScope(order));
  }
  return scopes;
}