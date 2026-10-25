import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useParams, useSearchParams } from 'react-router-dom';
import { ArrowLeft, RefreshCw } from 'lucide-react';
import { useAuth } from '@/lib/AuthContext';
import { isPurchaseOrderOwner } from '@/lib/purchaseOrderAccess';
import { procurementPath } from '@/lib/procurementRoutes';
import { C } from '@/lib/feeUI';
import { PageShell, PageHero } from '@/components/PageShell';
import PageNotFound from '@/lib/PageNotFound';
import PurchasingJobWorkspace from '@/components/purchasing/PurchasingJobWorkspace';
import BudgetSummaryStats from '@/components/purchasing/BudgetSummaryStats';
import { buttonClass, secondaryStyle, purchasingRequest, messageOf } from '@/components/budgets/ProcurementForms';
import { budgetRollup, isLiveBudget } from '../../base44/shared/procurementCore.js';

// Budget & Orders for one job: the same purchasing workspace a Purchasing row expands,
// on its own page. Without a job there is nothing to show here, so the Purchasing tab
// (the all-jobs view) takes over.
const SECTIONS = ['budgets', 'orders', 'tracking'];
const emptyData = { jobs: [], budgets: [], purchase_orders: [], vendor_orders: [], conflicts: [] };

// Old /job-budgets and /purchase-orders links: open the job's workspace, else Purchasing.
export function LegacyPurchasingRedirect({ section }) {
  const [params] = useSearchParams();
  return <Navigate replace to={procurementPath(params.get('job_id') || '', section, params.get('month') || '')} />;
}

export default function Procurement() {
  const { user } = useAuth();
  const { id: jobId = '' } = useParams();
  if (!isPurchaseOrderOwner(user)) return <PageNotFound />;
  if (!jobId) return <Navigate replace to="/purchasing" />;
  return <JobBudgetOrders jobId={jobId} />;
}

function JobBudgetOrders({ jobId }) {
  const [params, setParams] = useSearchParams();
  const wanted = params.get('section');
  const section = SECTIONS.includes(wanted) ? wanted : 'budgets';
  const [data, setData] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const loadSeq = useRef(0);
  const load = useCallback(async (quiet = false) => {
    const version = ++loadSeq.current; if (quiet !== true) setLoading(true); setError('');
    try { const result = await purchasingRequest({ action: 'overview' }); if (version === loadSeq.current) setData({ ...result, budgets: result.budgets.filter(isLiveBudget) }); }
    catch (e) { if (version === loadSeq.current) setError(messageOf(e)); }
    finally { if (version === loadSeq.current) setLoading(false); }
  }, []);
  useEffect(() => { load(); return () => { loadSeq.current++; }; }, [load]);
  useEffect(() => { setNotice(''); }, [jobId]);

  const current = data || emptyData;
  const job = current.jobs.find((j) => j.id === jobId);
  const rollup = useMemo(() => budgetRollup(current.budgets.filter((b) => b.job_id === jobId)), [current.budgets, jobId]);
  const changeSection = (tab) => { const p = new URLSearchParams(params); p.set('section', tab); setParams(p); };
  const onSaved = (message) => { setNotice(message || 'Saved.'); load(true); };

  if (loading && !data) return <PageShell><p className="rounded-xl border bg-white p-5 text-sm">Loading budgets, orders and supplier tracking...</p></PageShell>;
  if (data && !job) return <PageShell><article className="rounded-xl border bg-white p-5" style={{ borderColor: C.border }}><h1 className="text-xl font-bold">Job not found</h1><p className="my-3 text-sm">No job was created or changed. Open the existing job from Jobs.</p><Link to="/jobs" className={buttonClass} style={secondaryStyle}>Back to Jobs</Link></article></PageShell>;

  const locked = loading || Boolean(error) || Boolean(job?.merged_into || job?.is_sample);
  return <PageShell width="max-w-[1240px]">
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <Link to={`/jobs/${job.id}`} className="inline-flex items-center gap-1 font-semibold" style={{ color: C.text }}><ArrowLeft size={15} />Back to job</Link>
      <div className="flex flex-wrap gap-2">
        <Link to="/purchasing/supplier-eta" className={buttonClass} style={secondaryStyle}>Supplier ETA link</Link>
        <button disabled={loading} onClick={() => load()} className={buttonClass} style={secondaryStyle}><RefreshCw size={15} />Refresh</button>
      </div>
    </div>
    <PageHero eyebrow="Glass Forge / purchasing" title="Budget & Orders" sub={job.canonical_name}>
      <BudgetSummaryStats job={job} rollup={rollup} disabled={loading || Boolean(job?.merged_into || job?.is_sample)} onSaved={onSaved} />
    </PageHero>
    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">{error} Records may be incomplete. Editing is disabled until Refresh succeeds.</p>}
    {job.merged_into && <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">This is a merged job record. <Link className="underline" to={procurementPath(job.merged_into, section)}>Open the current job's Budget & Orders</Link>. No job links have been changed.</p>}
    {notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</p>}
    <fieldset disabled={locked} className="min-w-0 border-0 p-0">
      <PurchasingJobWorkspace job={job} data={current} section={section} onSection={changeSection} onSaved={onSaved} />
    </fieldset>
  </PageShell>;
}
