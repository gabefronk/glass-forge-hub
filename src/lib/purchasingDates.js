import { effectiveSupplierEta } from '../../base44/shared/supplierEtaCore.mjs';
import { validDate, supplierForPO, referenceConflicts } from '../../base44/shared/procurementCore.js';
import { isIgnoredWorkItem } from '../../base44/shared/billingCore.js';

export function purchasingJobName(row, jobs = []) {
  if (!row?.job_id) return row?.purchase_type === 'shop' ? 'Shop purchase' : 'No job linked';
  const job = jobs.find(j => j.id === row.job_id);
  if (!job) return 'Linked job unavailable';
  return String(job.canonical_name || '').trim() || String(job.display_name || '').trim() || 'Unnamed linked job';
}
export function displayDate(value) {
  if (!validDate(value)) return '';
  return new Date(value + 'T12:00:00Z').toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' });
}
function recordedDay(value) {
  // Require a timestamp with timezone; a date-only string must never shift a day.
  if (typeof value !== 'string' || !/T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return '';
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}
export function statusDate(row = {}) {
  const entries = Array.isArray(row.status_history) ? row.status_history : [];
  const entry = entries.at(-1);
  const date = entry?.status === row.status ? recordedDay(entry.at) : '';
  return { date, basis: date ? 'recorded' : 'unknown' };
}
export function statusLabel(status) {
  return ({ eta_set: 'ETA set', ach_link_received: 'ACH link received' })[status] ||
    (status ? status.charAt(0).toUpperCase() + status.slice(1).replaceAll('_', ' ') : 'Status unknown');
}
export function statusWithDate(row) {
  const timing = statusDate(row);
  return statusLabel(row?.status) + (timing.date ? ' · recorded ' + displayDate(timing.date) : ' · date unknown');
}
export function originalOrderDate(row) {
  const dates = [...new Set((row?.status_history || []).map(h => h.source?.original_order_date).filter(validDate))];
  return dates.length === 1 ? dates[0] : '';
}
export const etaText = (supplier, po) => { const eta = effectiveSupplierEta(po, supplier); return eta.response === 'pending' ? 'Awaiting supplier ETA' : displayDate(eta.date) || 'Not confirmed'; };
export function supplierReplyText(po, supplier) {
  const eta = effectiveSupplierEta(po, supplier);
  return eta.responded_at ? (eta.response === 'owner' ? 'Owner reviewed ETA' : eta.response === 'pending' ? 'Supplier replied: still pending' : 'Supplier supplied ETA') + ' · ' + displayDate(recordedDay(eta.responded_at)) : 'No supplier-link response yet';
}

// Each supplier may supply timing to only one PO, with conflicts withheld.
export function purchasingRows(data = {}) {
  const { purchase_orders: pos = [], vendor_orders: orders = [], jobs = [] } = data;
  const blocked = new Set(referenceConflicts(pos, orders, jobs).map(c => c.number));
  const proposed = pos.filter(p => p.status !== 'cancelled' && !blocked.has(p.po_number)).map(po => ({
    po, supplier: supplierForPO(po, orders),
  }));
  const pairs = proposed.filter(p => p.supplier && proposed.filter(q => q.supplier?.id === p.supplier.id).length === 1);
  const used = new Set(pairs.map(p => p.supplier.id));
  return [
    ...pos.map(po => ({ key: 'po:' + po.id, row: po, po, supplier: pairs.find(p => p.po.id === po.id)?.supplier || null })),
    ...orders.filter(o => !used.has(o.id)).map(supplier => ({ key: 'supplier:' + supplier.id, row: supplier, po: null, supplier })),
  ].filter(({ row }) => !isIgnoredWorkItem(row) && !isIgnoredWorkItem(jobs.find(j => j.id === row.job_id) || {}));
}
export function purchasingCalendarEvents(data = {}) {
  const events = [];
  for (const item of purchasingRows(data)) {
    const { row, po, supplier, key } = item;
    const job = (data.jobs || []).find(j => j.id === row.job_id);
    const reference = [po?.po_number || supplier?.po_name, row.vendor].filter(Boolean).join(' · ');
    const common = { source: 'purchasing', job_id: row.job_id || '', job_name: purchasingJobName(row, data.jobs),
      address: job?.address || '', po_number: po?.po_number || supplier?.po_name || '', report_required: false,
      purchasing: item, purchasing_summary: reference + ' · ' + statusWithDate(row) + ' · ETA ' + etaText(supplier, po) };
    const add = (id, date, label) => { if (validDate(date)) events.push({ ...common, id: 'purchasing:' + id, event_date: date, purchasing_label: label }); };
    const timing = statusDate(row);
    const ordered = originalOrderDate(po || row);
    if (row.status !== 'ordered' || timing.date !== ordered) add(key + ':status', timing.date, statusLabel(row.status) + ' recorded');
    if (ordered) add(key + ':ordered', ordered, 'Ordered');
    const eta = effectiveSupplierEta(po, supplier);
    const cancelled = (data.purchase_orders || []).some(p => p.id === supplier?.purchase_order_id && p.status === 'cancelled');
    // One derived entry per PO (or unpaired supplier); corrections move the same entry.
    if (!validDate(supplier?.received_date) && !cancelled && !['cancelled', 'received'].includes(po?.status)) add(key + ':eta', eta.date, 'ETA');
    if (eta.responded_at) add(key + ':reply', recordedDay(eta.responded_at), eta.response === 'pending' ? 'ETA pending response' : 'ETA response');
    if (supplier) add('supplier:' + supplier.id + ':received', supplier.received_date, 'Received');
  }
  return events;
}
