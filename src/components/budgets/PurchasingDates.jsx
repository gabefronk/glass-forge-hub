import { Link } from 'react-router-dom';
import { displayDate, etaText, originalOrderDate, statusWithDate, supplierReplyText } from '@/lib/purchasingDates';
import { procurementPath } from '@/lib/procurementRoutes';

export default function PurchasingDates({ row, supplier, showStatus = true }) {
  const ordered = originalOrderDate(row);
  return <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-600">
    {showStatus && <span>{statusWithDate(row)}</span>}
    {supplier && supplier.id !== row.id && <span>Supplier: {statusWithDate(supplier)}</span>}
    {ordered && <span>Ordered <strong>{displayDate(ordered)}</strong></span>}
    <span>ETA <strong>{etaText(supplier, row)}</strong></span>
    {(row.supplier_eta || supplier?.supplier_eta) && <span>{supplierReplyText(row, supplier)}</span>}
    {supplier?.received_date && <span>Received <strong>{displayDate(supplier.received_date) || 'Date unknown'}</strong></span>}
  </div>;
}
export function PurchasingCalendarDetails({ event, onClose }) {
  const { row, po, supplier } = event.purchasing;
  return <section className="mb-4 rounded-xl border bg-white p-5" aria-label="Purchasing calendar details">
    <div className="flex items-start justify-between gap-3"><h2 className="text-lg font-bold">{event.job_name}</h2><button type="button" onClick={onClose} className="rounded-lg border px-3 py-2">Close</button></div>
    <p className="mt-1 text-sm">{po?.po_number || supplier?.po_name || 'No PO reference'} · {row.vendor || 'Supplier unknown'}{supplier?.order_number ? ' · Supplier order ' + supplier.order_number : ''}</p>
    <p className="mt-2 font-semibold">{event.purchasing_label} · {displayDate(event.event_date)}</p>
    <PurchasingDates row={row} supplier={supplier} />
    <p className="mt-2 text-xs text-slate-500">Recorded dates are when a status was saved, not proof of the original order date. ETA is a supplier estimate, not an installation booking.</p>
    <div className="mt-3 flex gap-4 text-sm font-semibold underline">{row.job_id && <Link to={'/jobs/' + row.job_id}>Open job</Link>}<Link to={procurementPath(row.job_id || '', po ? 'orders' : 'tracking')}>Open purchasing record</Link></div>
  </section>;
}
