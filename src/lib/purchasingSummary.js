import { PAYMENT_STAGES } from './jobPayment.js';

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

// Share of the sale still owed by the customer at each job stage. There is no
// customer payment ledger yet (no customer invoices recorded), so the stage is
// the evidence (Gabriel, Oct 24): a job only sent to the customer is not sold
// yet, half down means half collected, paid means none owed, and every other
// stage (or none set) means the whole sale is still owed.
const OWED_SHARE = { sent_to_customer: 0, paid: 0, half_down: 0.5, partial: 0.5 };
export const customerOwedShare = (stage) => (stage in OWED_SHARE ? OWED_SHARE[stage] : 1);

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

// A job with no stage, or only Sent to customer, is a quote that is not sold yet (Gabe,
// Oct 25): it sits in its own section and is left out of every figure and count.
export const NOT_SOLD_STAGES = ['', 'sent_to_customer'];
export const isSold = (card) => !NOT_SOLD_STAGES.includes(card?.paymentStage || '');

// Per-job facts the header and the filter both read, so a count and a figure
// can never disagree. `card.paymentStage` is the job's payment_status (attached by
// the page). Suppliers are paid up front (Gabe, Oct 25): there are no payables.
export function jobFlags(card, today = '') {
  const sale = column(card, 'sale');
  const sold = sale.value || 0;
  const stage = card?.paymentStage || '';
  const eta = card?.refs?.etaLabel || '';
  const openOrder = Boolean(card?.refs?.yaPo || card?.refs?.mfrOrder) && eta !== 'Delivered';
  // A $0 cost is treated as missing: it would read as free material (100% margin).
  // A multi-scope job needs a cost on every scope row.
  const own = card?.windows?.display;
  const costs = own?.suppressed ? (card.scopes || []).map((s) => num(s.windows?.value)) : [num(own?.value)];
  const hasCost = costs.length > 0 && costs.every((v) => v > 0);
  return {
    sold,
    customerOwes: sold ? round(sold * customerOwedShare(stage)) : 0,
    quoted: Boolean(card?.refs?.quoteNumber),
    po_placed: Boolean(card?.refs?.yaPo),
    open_orders: openOrder,
    needs_eta: openOrder && !eta,
    eta_late: ISO_DAY.test(eta) && Boolean(today) && eta < today,
    waiting_payment: stage === 'waiting_on_payment' || stage === 'waiting_on_check',
    deposit_due: Boolean(sold) && !stage,
    missing_cost: !hasCost,
  };
}

// The Show dropdown (approved design, Oct 24). The page hides an option whose count is 0.
export const PURCHASING_FILTERS = [
  { key: 'all', label: 'All jobs' },
  { key: 'quoted', label: 'Quoted' },
  { key: 'po_placed', label: 'PO placed' },
  { key: 'eta_late', label: 'ETA late' },
  { key: 'needs_eta', label: 'Needs ETA' },
  { key: 'waiting_payment', label: 'Waiting on payment or check' },
  { key: 'missing_cost', label: 'Missing cost' },
];

// ETA said in a few characters: "Nov 9 · 16d", or "Oct 13 · 11d late" (late: true).
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayNum = (iso) => Date.parse(iso + 'T12:00:00Z') / 86400000;
export function etaShort(label, today = '') {
  if (!label) return { text: '', late: false };
  if (!ISO_DAY.test(label)) return { text: label, late: false };
  const [, m, d] = label.split('-').map(Number);
  const date = `${MONTHS[m - 1]} ${d}`;
  if (!ISO_DAY.test(today)) return { text: date, late: false };
  const days = Math.round(dayNum(label) - dayNum(today));
  if (days === 0) return { text: `${date} · today`, late: false };
  return days > 0 ? { text: `${date} · ${days}d`, late: false } : { text: `${date} · ${-days}d late`, late: true };
}

// ETA as a plain date, "10/13/26" (Gabriel, Oct 24: the grid shows just the date,
// no countdown and no late flag). Labels that are not a date ("Delivered") pass through.
export function etaDate(label) {
  if (!label) return '';
  if (!ISO_DAY.test(label)) return label;
  const [y, m, d] = label.split('-');
  return `${m}/${d}/${y.slice(2)}`;
}

// A multi-scope job's ETA as one date: the earliest dated scope, else its first label.
export function etaEarliest(labels = []) {
  const dates = labels.filter((l) => ISO_DAY.test(l || '')).sort();
  return etaDate(dates[0] || labels.find(Boolean) || '');
}

// A multi-scope job's ETAs as one phrase: "62–63d late", "5–12d", or the single ETA.
export function etaRange(labels = [], today = '') {
  const dates = labels.filter((l) => ISO_DAY.test(l || ''));
  if (!dates.length || !ISO_DAY.test(today)) return etaShort(labels.find(Boolean) || '', today);
  const days = dates.map((l) => Math.round(dayNum(l) - dayNum(today)));
  const lo = Math.min(...days), hi = Math.max(...days);
  if (lo === hi) return etaShort(dates[0], today);
  if (hi < 0) return { text: `${-hi}–${-lo}d late`, late: true };
  if (lo >= 0) return { text: `${lo}–${hi}d`, late: false };
  return { text: `${-lo}d late – ${hi}d`, late: true };
}

// Column-header sorting for the grid. Default: ETA, soonest first. ETA order: dated
// (earliest first), then other labels, then no ETA, then Delivered.
export const PURCHASING_SORTS = ['job', 'eta', 'payment', 'windows', 'sale', 'profit'];
export const DEFAULT_PURCHASING_SORT = { key: 'eta', dir: 'asc' };
const STAGE_ORDER = ['', ...PAYMENT_STAGES.map((s) => s.key)];
function etaKey(card) {
  const labels = card?.scopes?.length > 1 ? card.scopes.map((s) => s.etaLabel) : [card?.refs?.etaLabel];
  const dates = labels.filter((l) => ISO_DAY.test(l || '')).sort();
  if (dates.length) return `0${dates[0]}`;
  const l = labels.find(Boolean) || '';
  return l === 'Delivered' ? '3' : l ? '1' : '2';
}
const SORT_VALUE = {
  job: (c) => `${c.job?.builder || ''} ${c.job?.canonical_name || ''}`.trim().toLowerCase(),
  eta: etaKey,
  payment: (c) => STAGE_ORDER.indexOf(c.paymentStage || ''),
  windows: (c) => column(c, 'windows').value + column(c, 'rough').value,
  sale: (c) => column(c, 'sale').value,
  profit: (c) => column(c, 'profit').value,
};
export function sortCards(cards = [], sort = DEFAULT_PURCHASING_SORT) {
  const s = PURCHASING_SORTS.includes(sort?.key) ? sort : DEFAULT_PURCHASING_SORT;
  const get = SORT_VALUE[s.key];
  const sign = s.dir === 'desc' ? -1 : 1;
  return [...cards].sort((a, b) => {
    const x = get(a), y = get(b);
    const c = typeof x === 'number' ? x - y : String(x).localeCompare(String(y));
    return c * sign || SORT_VALUE.job(a).localeCompare(SORT_VALUE.job(b));
  });
}

// One job's own figures as the grid shows them (a multi-scope job adds its scope rows).
export function cardFigures(card) {
  const t = summarizeCards([card]);
  return { windows: t.windows, cost: Math.round((t.windows + t.rough) * 100) / 100, sale: t.sale, profit: t.profit };
}

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
// price and Profit columns (summarizeCards). Job cost is windows plus labor &
// material on the same rows (a row with no sale still adds its cost); the page shows it
// as a negative number (money out). Customers owe adds each job's figure from jobFlags.
export function headerFigures(cards = [], today = '') {
  const totals = summarizeCards(cards);
  let customersOwe = 0;
  for (const c of cards) customersOwe += jobFlags(c, today).customerOwes;
  return { jobs: cards.length, sold: totals.sale, customersOwe: round(customersOwe), cost: round(totals.windows + totals.rough), profit: totals.profit, partialScopes: totals.partialScopes };
}