import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { ArrowRight } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { purchasingWorkflow } from '@/lib/purchasingWorkflow';
import { monthLabel } from '@/lib/feeMath';
import { validMonth } from '../../../base44/shared/procurementCore.js';
import { denverDate } from '../../../base44/shared/billingCore.js';

export default function PurchasingWorkflow({ job, data, month = '', disabled = false, onAction = undefined }) {
  const [saved, setSaved] = useState({ id: '', rows: [], status: 'loading' });
  useEffect(() => {
    let active = true;
    setSaved({ id: job.id, rows: [], status: 'loading' });
    const refresh = () => base44.entities.JobSetupSheets.filter({ job_id: job.id }, '-updated_date', 2)
      .then(rows => { if (active) setSaved({ id: job.id, rows, status: 'loaded' }); })
      .catch(() => { if (active) setSaved({ id: job.id, rows: [], status: 'error' }); });
    refresh();
    window.addEventListener('focus', refresh);
    return () => { active = false; window.removeEventListener('focus', refresh); };
  }, [job.id, data]);
  const state = saved.id === job.id ? saved : { rows: [], status: 'loading' };
  const model = purchasingWorkflow({ job, budgets: data.budgets, purchaseOrders: data.purchase_orders, supplierOrders: data.vendor_orders, conflicts: data.conflicts, setups: state.rows, setupState: state.status, month });
  const next = model.next;
  const billingMonth = monthLabel(validMonth(month) ? month : denverDate().slice(0, 7));
  return <section aria-label="This job's workflow" className="overflow-hidden rounded-xl border border-slate-200 bg-white">
    <div className="flex flex-wrap items-center justify-between gap-3 border-l-2 border-[var(--gf-teal-600)] p-4 sm:p-5">
      <div><p className="text-xs font-semibold uppercase tracking-wider text-slate-500">Up next</p><h2 className="mt-1 text-lg font-bold text-slate-900">{disabled ? 'Refresh records before continuing' : next.title}</h2><p className="mt-1 max-w-2xl text-sm text-slate-600">{disabled ? 'The last loaded records may be incomplete.' : next.detail}</p></div>
      {!disabled && next.editor && onAction ? <button type="button" onClick={() => onAction(next)} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[var(--gf-teal-600)] px-4 py-2 text-sm font-semibold text-white">Continue<ArrowRight size={16}/></button> : !disabled && <Link to={next.href} target={next.key === 'setup' ? '_blank' : undefined} rel={next.key === 'setup' ? 'noopener noreferrer' : undefined} className="inline-flex min-h-11 items-center gap-2 rounded-lg bg-[var(--gf-teal-600)] px-4 py-2 text-sm font-semibold text-white">Open {next.key === 'setup' ? 'setup' : next.key === 'tracking' ? 'supplier tracking' : next.key === 'orders' ? 'purchase orders' : next.key === 'budgets' ? 'quotes & budget' : 'billing'}<ArrowRight size={16}/></Link>}
    </div>
    <details className="border-t border-slate-100"><summary className="min-h-11 cursor-pointer px-4 py-3 text-xs font-medium text-slate-500">Job flow · Billing {billingMonth}{model.matchedCount > 0 ? ` · ${model.matchedCount} connections recognized` : ''}</summary>
    <nav aria-label="Job purchasing workflow" className="grid gap-px bg-slate-200 sm:grid-cols-2 xl:grid-cols-5">
      {model.steps.map((step, index) => <Link key={step.key} to={step.href} target={step.key === 'setup' ? '_blank' : undefined} rel={step.key === 'setup' ? 'noopener noreferrer' : undefined} className="min-w-0 bg-white p-4 transition-colors hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-emerald-700">
        <span className="text-xs font-semibold text-slate-400">0{index + 1}</span><strong className="mt-1 block text-sm text-slate-900">{step.title}</strong><span className="mt-2 block text-xs font-semibold text-emerald-800">{disabled ? 'Refresh needed' : step.status}</span><span className="mt-1 block text-xs leading-5 text-slate-500">{step.detail}</span>
      </Link>)}
    </nav></details>
    {job.source_window_quote_id && <p className="border-t p-3 text-xs text-slate-600"><Link className="font-semibold underline" to={`/window-quotes?quote=${encodeURIComponent(job.source_window_quote_id)}&section=result`}>Original window quote</Link> · Accepted revision {job.accepted_quote_revision || job.accepted_quote_snapshot?.revision || 'recorded'}</p>}
  </section>;
}
