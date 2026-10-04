import { Link } from 'react-router-dom';
import { useAuth } from '@/lib/AuthContext';
import { usePurchasingDates } from '@/lib/usePurchasingDates';
import { purchasingRows } from '@/lib/purchasingDates';
import { procurementPath } from '@/lib/procurementRoutes';
import PurchasingDates from '@/components/budgets/PurchasingDates';

export default function JobPurchasingDates({ jobId, memberIds = [] }) {
  const { user } = useAuth();
  const { data, error, loading } = usePurchasingDates(user);
  if (!data && !error && !loading) return null;
  const ids = new Set([jobId, ...memberIds]);
  const rows = purchasingRows(data || {}).filter(item => ids.has(item.row.job_id));
  return <section className="mt-5 rounded-xl border bg-white p-4" aria-label="Purchasing dates">
    <h2 className="text-base font-bold">Order status &amp; delivery dates</h2>
    {error && <p role="alert" className="mt-2 text-sm text-amber-800">{error}</p>}
    {loading && !data && <p className="mt-2 text-sm">Loading purchasing dates…</p>}
    {data && !rows.length && <p className="mt-2 text-sm text-slate-500">No purchase orders or supplier confirmations linked.</p>}
    {rows.map(({ key, row, po, supplier }) => <div key={key} className="mt-3 rounded-lg border p-3">
      <Link className="text-sm font-semibold underline" to={procurementPath(row.job_id, po ? 'orders' : 'tracking')}>{po?.po_number || supplier?.po_name || 'Supplier order'} · {row.vendor || 'Supplier unknown'}{supplier?.order_number ? ' · #' + supplier.order_number : ''}</Link>
      <PurchasingDates row={row} supplier={supplier} />
    </div>)}
    <p className="mt-3 text-xs text-slate-500">Recorded dates show when a status was saved. ETA is a supplier estimate, not an installation booking. These same dates appear in the Hub calendar.</p>
  </section>;
}
