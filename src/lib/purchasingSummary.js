// Totals + filters for the Purchasing summary bar. Pure: no React, no SDK.
// Totals add only figures that are actually showing on the rows (the same
// display values the table renders), so the bar always ties to the rows below.

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const round = (n) => Math.round(n * 100) / 100;

// Each money column: a job row's own figure, or, when a multi-scope job row
// withholds it (applyScopeRollup), the figures its scope rows show. Scope rows
// never overlap (each PO and order belongs to one scope) and share one cost
// basis (materials incl tax), so adding them ties the bar to the rows below.
const FIELDS = {
  windows: { job: (c) => c.windows?.display, scope: (s) => s.windows },
  rough: { job: (c) => c.rough?.display, scope: (s) => s.rough },
  sale: { job: (c) => c.sale?.display, scope: (s) => s.sale },
  profit: { job: (c) => c.profitDisplay, scope: (s) => s.profit },
};

function column(card, field) {
  const f = FIELDS[field];
  const own = f.job(card);
  if (!own?.suppressed) return { value: num(own?.value) ?? 0, missing: false };
  const values = (card.scopes || []).map((s) => num(f.scope(s)?.value));
  return { value: values.reduce((n, v) => n + (v ?? 0), 0), missing: !values.length || values.some((v) => v == null) };
}

export function summarizeCards(cards = []) {
  const totals = { jobs: cards.length };
  const incomplete = new Set();
  for (const field of Object.keys(FIELDS)) {
    totals[field] = round(cards.reduce((n, c) => {
      const col = column(c, field);
      if (col.missing) incomplete.add(c);
      return n + col.value;
    }, 0));
  }
  totals.quotes = cards.filter((c) => c.refs?.quoteNumber).length;
  totals.pos = cards.filter((c) => c.refs?.yaPo).length;
  // Multi-scope jobs with a scope row that has no figure for a column: the
  // bar then says it is partial instead of reading as a complete total.
  totals.partialScopes = incomplete.size;
  return totals;
}

// --- Header figures and the one filter dropdown (M2, Oct 24) ---

const isOrderPaid = (o) => ['paid', 'reconciled'].includes(o?.status) || Boolean(o?.paid_at);
const rawAmount = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));

// What we owe suppliers on one job, at the raw PO amount (payables never carry
// the use tax; job cost does). Each live PO is owed until every supplier order
// under it is marked paid; a supplier order with no PO is owed at its own
// amount until paid. Cancelled POs and orders under them are excluded, as on
// the rows. `missing` counts unpaid records with no amount.
export function supplierPayables(jobId, { purchase_orders = [], vendor_orders = [] } = {}) {
  const cancelled = new Set(purchase_orders.filter((p) => p.status === 'cancelled').map((p) => p.id));
  const pos = purchase_orders.filter((p) => p.job_id === jobId && p.status !== 'cancelled');
  const orders = vendor_orders.filter((o) => o.job_id === jobId && !(o.purchase_order_id && cancelled.has(o.purchase_order_id)));
  const poIds = new Set(pos.map((p) => p.id));
  let owed = 0, items = 0, unpaid = 0, missing = 0;
  const add = (value) => { unpaid += 1; if (value == null) missing += 1; else owed += value; };
  for (const po of pos) {
    items += 1;
    const linked = orders.filter((o) => o.purchase_order_id === po.id);
    if (!(linked.length && linked.every(isOrderPaid))) add(rawAmount(po.amount_dealer));
  }
  for (const o of orders) {
    if (o.purchase_order_id && poIds.has(o.purchase_order_id)) continue;
    // Reference-only placeholders (no PO, number or amount) are not payables.
    if (!o.purchase_order_id && rawAmount(o.amount) == null && !String(o.order_number || '').trim()) continue;
    items += 1;
    if (!isOrderPaid(o)) add(rawAmount(o.amount));
  }
  const label = !items ? null : !unpaid ? 'Paid' : unpaid < items ? 'Partial' : 'Unpaid';
  return { owed: round(owed), items, unpaid, missing, label, tone: !items ? 'gray' : !unpaid ? 'green' : 'amber' };
}

// Share of the sale still owed by the customer at each payment stage. There is
// no customer payment ledger yet (no customer invoices recorded), so the stage
// is the evidence: half down means half collected, full payment means none
// owed, every other stage (or none) means the whole sale is still owed.
const OWED_SHARE = { paid: 0, half_down: 0.5, partial: 0.5 };
export const customerOwedShare = (stage) => (stage in OWED_SHARE ? OWED_SHARE[stage] : 1);

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

// Per-job facts the header and the filter both read, so a count and a figure
// can never disagree. `card.payables` comes from supplierPayables and
// `card.paymentStage` from the job's payment_status (attached by the page).
export function jobFlags(card, today = '') {
  const sale = column(card, 'sale');
  const windows = column(card, 'windows');
  const sold = sale.value || 0;
  const stage = card?.paymentStage || '';
  const ap = card?.payables || { owed: 0, items: 0, unpaid: 0 };
  const eta = card?.refs?.etaLabel || '';
  const openOrder = ap.items > 0 && eta !== 'Delivered';
  // A $0 cost is treated as missing: it would read as free material (100% margin).
  const hasCost = !windows.missing && windows.value > 0;
  return {
    sold,
    customerOwes: sold ? round(sold * customerOwedShare(stage)) : 0,
    weOwe: ap.owed || 0,
    open_orders: openOrder,
    needs_eta: openOrder && !eta,
    eta_late: ISO_DAY.test(eta) && Boolean(today) && eta < today,
    deposit_due: Boolean(sold) && !stage,
    supplier_unpaid: ap.unpaid > 0,
    missing_cost: !hasCost,
  };
}

export const PURCHASING_FILTERS = [
  { key: 'all', label: 'All jobs' },
  { key: 'open_orders', label: 'Open orders' },
  { key: 'needs_eta', label: 'Needs ETA' },
  { key: 'eta_late', label: 'ETA late' },
  { key: 'deposit_due', label: 'Deposit due' },
  { key: 'supplier_unpaid', label: 'Supplier unpaid' },
  { key: 'missing_cost', label: 'Missing cost' },
];

export function applyPurchasingFilter(cards = [], key = 'all', today = '') {
  if (key === 'all' || !PURCHASING_FILTERS.some((f) => f.key === key)) return cards;
  return cards.filter((c) => jobFlags(c, today)[key]);
}

export function purchasingFilterCounts(cards = [], today = '') {
  const counts = Object.fromEntries(PURCHASING_FILTERS.map((f) => [f.key, 0]));
  counts.all = cards.length;
  for (const c of cards) {
    const flags = jobFlags(c, today);
    for (const f of PURCHASING_FILTERS) if (f.key !== 'all' && flags[f.key]) counts[f.key] += 1;
  }
  return counts;
}

// Header figures over exactly the rows shown. Sold and Est. profit are the Sale
// price and Profit columns (summarizeCards); Customers owe and We owe suppliers
// add each shown job's own figure from jobFlags.
export function headerFigures(cards = [], today = '') {
  const totals = summarizeCards(cards);
  let customersOwe = 0, weOwe = 0, apMissing = 0;
  for (const c of cards) {
    const flags = jobFlags(c, today);
    customersOwe += flags.customerOwes;
    weOwe += flags.weOwe;
    apMissing += c?.payables?.missing || 0;
  }
  return { jobs: cards.length, sold: totals.sale, customersOwe: round(customersOwe), weOwe: round(weOwe), profit: totals.profit, partialScopes: totals.partialScopes, apMissing };
}