import { referenceConflicts, supplierForPO, validDate, text } from './procurementCore.js';

export const isAmsco = vendor => /^(amsco|amsco windows)$/i.test(text(vendor));
export function supplierEtaCandidates({ purchase_orders = [], vendor_orders = [], jobs = [] }) {
  const conflicts = new Set(referenceConflicts(purchase_orders, vendor_orders, jobs).map(c => c.number));
  return purchase_orders.filter(po => {
    const job = jobs.find(j => j.id === po.job_id);
    return isAmsco(po.vendor) && ['emailed', 'ordered', 'confirmed'].includes(po.status) &&
      job && !job.merged_into && !job.is_sample && !conflicts.has(text(po.po_number).toUpperCase());
  });
}
export function linkedEtaSupplier(po, orders = [], pos = []) {
  const supplier = supplierForPO(po, orders);
  if (!supplier || pos.filter(p => supplierForPO(p, orders)?.id === supplier.id).length !== 1) return null;
  return supplier;
}
export function effectiveSupplierEta(po, supplier) {
  const response = po?.supplier_eta || supplier?.supplier_eta;
  if (supplier?.eta_reviewed_at && Date.parse(supplier.eta_reviewed_at) > (Date.parse(response?.responded_at) || 0)) {
    return { date: validDate(supplier.eta_date) ? supplier.eta_date : '', response: 'owner', responded_at: supplier.eta_reviewed_at, previous_eta_date: '', source: 'Owner reviewed ETA' };
  }
  if (response && ['eta', 'pending'].includes(response.response)) {
    return { date: response.response === 'eta' && validDate(response.eta_date) ? response.eta_date : '',
      response: response.response, responded_at: response.responded_at, previous_eta_date: response.previous_eta_date || '',
      source: 'Supplier link response', supplier_eta: response };
  }
  return { date: validDate(supplier?.eta_date) ? supplier.eta_date : '', response: 'none', responded_at: '', previous_eta_date: '', source: supplier?.eta_source || '' };
}
// Read-time projection only: supplier ETA responses are authoritative on their PO.
// Financial/source records are never returned by the public endpoint.
export function projectSupplierEtas(data) {
  const pos = data.purchase_orders || [], orders = data.vendor_orders || [];
  const conflicts = new Set(referenceConflicts(pos, orders, data.jobs || []).map(c => c.number));
  const eligible = pos.filter(po => isAmsco(po.vendor) && !conflicts.has(text(po.po_number).toUpperCase()));
  return { ...data, vendor_orders: orders.map(order => {
    const matches = eligible.filter(po => linkedEtaSupplier(po, orders, pos)?.id === order.id && po.supplier_eta);
    if (matches.length !== 1) return order;
    const response = matches[0].supplier_eta;
    const eta = effectiveSupplierEta(matches[0], order);
    return { ...order, eta_date: eta.date, eta_source: eta.source, supplier_eta: response };
  }) };
}
export function publicEtaOrder(po, data) {
  const job = data.jobs.find(j => j.id === po.job_id);
  const supplier = linkedEtaSupplier(po, data.vendor_orders, data.purchase_orders);
  const eta = effectiveSupplierEta(po, supplier);
  return { id: po.id, job_name: text(job?.canonical_name) || text(job?.display_name) || 'Unnamed linked job',
    po_number: text(po.po_number), quote_number: text(po.vendor_quote_ref), supplier_order: text(supplier?.order_number),
    eta_date: eta.date, response: eta.response, responded_at: eta.responded_at, previous_eta_date: eta.previous_eta_date,
    version: po.updated_date + '|' + (supplier?.updated_date || ''), supplier: 'AMSCO' };
}
