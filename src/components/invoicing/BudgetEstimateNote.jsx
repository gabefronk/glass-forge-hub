import { Link } from 'react-router-dom';
import { procurementPath } from '@/lib/procurementRoutes';

const money = value => value == null || value === '' || !Number.isFinite(Number(value)) ? '\u2014' : Number(value).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
export default function BudgetEstimateNote({ jobId, input, month }) {
  if (!jobId) return null;
  const estimate = input?.budget_snapshot;
  return <section className="my-4 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-emerald-950" aria-label="Budget estimate reference">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="text-sm font-bold">Budget estimate reference</h3><p className="mt-1 text-xs leading-5">{estimate ? `Snapshot linked ${input.budget_synced_at || '(date not recorded)'}.` : 'No reviewed budget snapshot is linked to this accounting month yet.'} Estimates do not change recorded revenue, labor, invoice amounts or payments.</p></div><Link className="text-sm font-semibold underline" to={`${procurementPath(jobId, 'invoicing')}${month ? `&month=${encodeURIComponent(month)}` : ''}`}>Review budget connection</Link></div>
    {estimate && <><dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">{[['Estimated cost', estimate.cost], ['Budget customer total', estimate.sell], ['Estimated margin dollars', estimate.margin_dollars]].map(([label, value]) => <div key={label}><dt className="text-xs">{label}</dt><dd className="font-bold tabular-nums">{money(value)}</dd></div>)}<div><dt className="text-xs">Included scopes</dt><dd className="font-bold">{estimate.count ?? '\u2014'}</dd></div></dl>{estimate.status !== 'ready' && <p className="mt-3 text-xs font-semibold text-amber-900">This estimate needs review: {(estimate.warnings || []).join(' ') || 'no complete included scopes'}</p>}<p className="mt-3 text-xs">This is a saved estimate, not a live recalculation. Review and refresh after changing quote scope or revisions.</p></>}
  </section>;
}
