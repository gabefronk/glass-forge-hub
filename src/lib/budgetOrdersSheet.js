// The Budget & Orders sheet (Gabriel, Oct 31): one ruled table of a job's POs and supplier
// orders with a total row, and the job's typed figures when it has no vendor quote.
// Pure: no React, no SDK. The total uses orderedCost, the same rule as the job page.
import { orderedCost } from './jobProject.js';

const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const round = (n) => Math.round(n * 100) / 100;
const text = (v) => String(v ?? '').trim();

// A second PO on the same quote carries additional_order_reason. Name it plainly on the row.
export function reorderTag(po = {}) {
  const reason = text(po.additional_order_reason);
  if (!reason) return null;
  const label = /remake/i.test(reason) ? 'Remake' : /re-?order/i.test(reason) ? 'Reorder' : /\badd/i.test(reason) ? 'Added' : 'Extra PO';
  return { label, reason };
}

// PO amount as entered; a PO with no amount falls back to its supplier orders (as orderedCost).
function poAmount(po, linked) {
  if (num(po.amount_dealer) != null) return num(po.amount_dealer);
  const amounts = linked.map((o) => num(o.amount));
  return amounts.length && amounts.every((v) => v != null) ? round(amounts.reduce((n, v) => n + v, 0)) : null;
}

const poOrder = (a, b) => text(a.po_number).localeCompare(text(b.po_number), 'en', { numeric: true })
  || text(a.created_date).localeCompare(text(b.created_date));

// One line per PO (oldest number first) with its supplier orders, then supplier orders with no PO.
export function orderLines(rec = {}) {
  const pos = [...(rec.pos || [])].sort(poOrder);
  const orders = rec.orders || [];
  const poIds = new Set(pos.map((p) => p.id));
  const budgetOf = (id) => (rec.budgets || []).find((b) => b.id === id) || null;
  const lines = pos.map((po) => {
    const linked = orders.filter((o) => o.purchase_order_id === po.id);
    return {
      key: `po:${po.id}`, kind: 'po', po, orders: linked,
      supplier: text(po.vendor), poNumber: text(po.po_number),
      quote: text(budgetOf(po.budget_id)?.quote_number) || text(po.vendor_quote_ref),
      orderNumbers: linked.map((o) => text(o.order_number)).filter(Boolean),
      eta: linked.map((o) => o.eta_date).filter(Boolean).sort()[0] || '',
      amount: poAmount(po, linked), tag: reorderTag(po),
    };
  });
  for (const o of orders) {
    if (o.purchase_order_id && poIds.has(o.purchase_order_id)) continue;
    lines.push({
      key: `o:${o.id}`, kind: 'order', po: null, orders: [o],
      supplier: text(o.vendor), poNumber: '', quote: '',
      orderNumbers: text(o.order_number) ? [text(o.order_number)] : [],
      eta: o.eta_date || '', amount: num(o.amount), tag: null,
    });
  }
  return lines;
}

// The total row: what the job has ordered from suppliers so far.
export function sheetTotal(jobId, rec = {}) {
  return orderedCost(jobId, { purchase_orders: rec.pos || [], vendor_orders: rec.orders || [], budgets: rec.budgets || [] });
}

// A job with no vendor quote: its typed Budget cost / Customer total (they drive Purchasing),
// split into the supplier orders above and everything else (crew trips, extras).
export function typedBudget(job = {}, ordered = null) {
  const cost = num(job.manual_budget_cost);
  const sell = num(job.manual_customer_total);
  const orders = num(ordered);
  const gap = cost != null && orders != null ? round(cost - orders) : null;
  const margin = cost != null && sell != null ? round(sell - cost) : null;
  return {
    any: cost != null || sell != null,
    cost, sell, orders,
    other: gap != null && gap > 0 ? gap : null,
    overBy: gap != null && gap < 0 ? -gap : null,
    margin,
    marginPct: margin != null && sell ? margin / sell : null,
  };
}
