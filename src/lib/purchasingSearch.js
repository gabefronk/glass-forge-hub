// Search follows explicit IDs only. Matching text never establishes a job link.
export function purchasingText(row = {}) {
  return [row.title, row.job_name, row.canonical_name, row.customer_name, row.vendor,
    row.manufacturer, row.quote_name, row.quote_number, row.po_number, row.vendor_quote_ref,
    row.order_number, row.po_name, row.address, row.builder, row.id,
    ...(row.aliases || []), ...(row.po_numbers || []), ...(row.oe_numbers || [])]
    .filter(Boolean).join(' ').toLowerCase();
}
export function purchasingSearchIndex({ jobs = [], budgets = [], purchase_orders = [], vendor_orders = [] } = {}) {
  const jobById = new Map(jobs.map(row => [row.id, row]));
  const budgetById = new Map(budgets.map(row => [row.id, row]));
  const poById = new Map(purchase_orders.map(row => [row.id, row]));
  const index = new Map();
  for (const row of [...budgets, ...purchase_orders, ...vendor_orders]) {
    const linked = [jobById.get(row.job_id)];
    const budget = budgetById.get(row.budget_id);
    const po = poById.get(row.purchase_order_id);
    if (row.job_id && budget?.job_id === row.job_id) linked.push(budget);
    if (row.job_id && po?.job_id === row.job_id) linked.push(po);
    index.set(row, [row, ...linked.filter(Boolean)].map(purchasingText).join(' '));
  }
  return index;
}
export function matchesPurchasingSearch(value, query) {
  return String(query || '').trim().toLowerCase().split(/\s+/).filter(Boolean).every(term => value.includes(term));
}
