import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { UploadCloud, ArrowLeft, FileText, RefreshCw, AlertTriangle, Plus } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useAuth } from '@/lib/AuthContext';
import { isPurchaseOrderOwner } from '@/lib/purchaseOrderAccess';
import { procurementPath } from '@/lib/procurementRoutes';
import { purchasingText, purchasingSearchIndex, matchesPurchasingSearch } from '@/lib/purchasingSearch';
import { C } from '@/lib/feeUI';
import { PageShell, PageHero, HeroStat } from '@/components/PageShell';
import PageNotFound from '@/lib/PageNotFound';
import { NumbersEditor, LinkJobEditor } from '@/components/budgets/BudgetReviewRow';
import DeleteUnusedQuoteButton from '@/components/budgets/DeleteUnusedQuoteButton';
import PurchasingWorkflow from '@/components/budgets/PurchasingWorkflow';
import { PurchaseOrderForm, BudgetUsageForm, SupplierOrderForm, OrderStatusForm, InvoiceBridge, Field, money, percent, buttonClass, primaryStyle, secondaryStyle, purchasingRequest, messageOf } from '@/components/budgets/ProcurementForms';
import { activeBudgets, budgetForPO, budgetFigures, budgetRollup, supplierForPO, isLiveBudget } from '../../base44/shared/procurementCore.js';

const SECTIONS = [['budgets', 'Quotes & budget'], ['orders', 'Purchase orders'], ['tracking', 'Supplier tracking'], ['invoicing', 'Invoicing']];
const emptyData = { jobs: [], budgets: [], purchase_orders: [], vendor_orders: [], conflicts: [] };
const safeHref = value => { try { const url = new URL(value); return url.protocol === 'https:' ? url.href : ''; } catch { return ''; } };
const fileHref = id => id ? `https://drive.google.com/file/d/${encodeURIComponent(id)}/view` : '';
const isPaid = row => ['paid', 'reconciled'].includes(row.status);
const jobLabel = job => [job.canonical_name || job.id, job.address || job.builder, String(job.id).slice(-6)].filter(Boolean).join(' - ');
function External({ href, children }) { const url = safeHref(href); return url ? <a href={url} target="_blank" rel="noopener noreferrer" className="inline-flex min-h-9 items-center gap-1 rounded-lg border px-3 py-1.5 text-xs font-semibold" style={secondaryStyle}>{children}</a> : null; }
function Card({ children, id }) { return <article id={id} className="min-w-0 rounded-xl border bg-white p-4 sm:p-5" style={{ borderColor: C.border }}>{children}</article>; }
function Badge({ children, warning = false }) { return <span className={`inline-flex rounded-full border px-2 py-0.5 text-xs font-semibold ${warning ? 'border-amber-200 bg-amber-50 text-amber-900' : 'border-emerald-200 bg-emerald-50 text-emerald-900'}`}>{children}</span>; }
function Metrics({ figures }) { return <dl className="my-3 grid grid-cols-2 gap-2 lg:grid-cols-4">{[['Cost basis', money(figures.cost)], ['Customer total', money(figures.sell)], ['Margin dollars', money(figures.margin_dollars)], ['Margin', percent(figures.margin_pct)]].map(([label, value]) => <div key={label} className="rounded-lg bg-slate-50 p-3"><dt className="text-xs text-slate-500">{label}</dt><dd className={`mt-1 text-base font-bold tabular-nums ${label.startsWith('Margin') && figures.margin_dollars < 0 ? 'text-amber-800' : 'text-slate-900'}`}>{value}</dd></div>)}</dl>; }

export function LegacyPurchasingRedirect({ section }) {
  const [params] = useSearchParams();
  return <Navigate replace to={procurementPath(params.get('job_id') || '', section, params.get('month') || '')} />;
}
export default function Procurement() {
  const { user } = useAuth();
  if (!isPurchaseOrderOwner(user)) return <PageNotFound />;
  return <ProcurementWorkspace />;
}
function ProcurementWorkspace() {
  const { id: jobId = '' } = useParams();
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const wanted = params.get('section');
  const section = SECTIONS.some(([key]) => key === wanted) ? wanted : 'budgets';
  const [data, setData] = useState(null), [loading, setLoading] = useState(true), [error, setError] = useState('');
  const [query, setQuery] = useState(''), [unlinkedOnly, setUnlinkedOnly] = useState(false);
  const [editor, setEditor] = useState(null), [notice, setNotice] = useState('');
  const [processing, setProcessing] = useState([]), [uploading, setUploading] = useState(false), [dragging, setDragging] = useState(false);
  const fileInput = useRef(null), uploadBusy = useRef(false), loadSeq = useRef(0);
  const load = useCallback(async () => {
    const version = ++loadSeq.current; setLoading(true); setError('');
    try { const result = await purchasingRequest({ action: 'overview' }); if (version === loadSeq.current) setData({ ...result, budgets: result.budgets.filter(isLiveBudget) }); }
    catch (e) { if (version === loadSeq.current) setError(messageOf(e)); }
    finally { if (version === loadSeq.current) setLoading(false); }
  }, []);
  useEffect(() => { load(); return () => { loadSeq.current++; }; }, [load]);
  useEffect(() => { setEditor(null); setNotice(''); setQuery(''); setUnlinkedOnly(false); }, [jobId]);
  const current = data || emptyData;
  const job = current.jobs.find(j => j.id === jobId);
  const availableJobs = useMemo(() => current.jobs.filter(j => !j.merged_into && !j.is_sample).sort((a, b) => String(a.canonical_name).localeCompare(String(b.canonical_name))), [current.jobs]);
  const searchIndex = useMemo(() => purchasingSearchIndex(current), [current]);
  const matches = row => matchesPurchasingSearch(searchIndex.get(row) || purchasingText(row), query);
  const needle = query.trim().toLowerCase();
  const visible = rows => rows.filter(r => (!jobId || r.job_id === jobId) && (!unlinkedOnly || !r.job_id) && (!needle || matches(r)));
  const budgets = visible(current.budgets), pos = visible(current.purchase_orders), orders = visible(current.vendor_orders);
  const jobBudgets = current.budgets.filter(b => b.job_id === jobId);
  const sectionCounts = { budgets: budgets.length, orders: pos.length, tracking: orders.length };
  const pathFor = (id, tab = section) => procurementPath(id, tab, params.get('month') || '');
  const active = new Set(activeBudgets(jobBudgets).map(b => b.id));
  const rollup = budgetRollup(jobBudgets);
  const conflicts = current.conflicts.filter(c => !jobId || c.job_ids.includes(jobId));
  const conflictNumbers = new Set(current.conflicts.map(c => c.number));
  const incomplete = loading || Boolean(error);
  const changeSection = tab => { const p = new URLSearchParams(params); p.set('section', tab); setParams(p); setEditor(null); };
  const openEditor = next => { setNotice(''); setEditor({ ...next, key: crypto.randomUUID() }); };
  const done = (_result, message) => { setEditor(null); setNotice(message || 'Saved.'); load(); };
  const budgetDone = result => done(result, `Budget saved. ${result?.warnings?.join(' ') || 'Issued POs, invoices and recorded payments are unchanged.'}`);
  async function processFiles(files) {
    if (uploadBusy.current || incomplete) return;
    const pdfs = Array.from(files || []).filter(f => /\.pdf$/i.test(f.name));
    if (!pdfs.length) { setNotice('Choose PDF quote files.'); return; }
    if (pdfs.length > 10 || pdfs.some(f => f.size > 30 * 1024 * 1024)) { setNotice('Use up to 10 PDFs at a time, each smaller than 30 MB.'); return; }
    const uploadJob = jobId; // Capture the selected job for the entire batch.
    uploadBusy.current = true; setUploading(true); setProcessing([]);
    try {
      for (const file of pdfs) {
        const key = crypto.randomUUID();
        const update = patch => setProcessing(rows => rows.map(row => row.key === key ? { ...row, ...patch } : row));
        setProcessing(rows => [...rows, { key, name: file.name, status: 'Uploading source PDF...' }]);
        try {
          const uploaded = await base44.integrations.Core.UploadFile({ file });
          if (!uploaded?.file_url) throw new Error('The source PDF did not upload.');
          update({ status: 'Reading quote and saving a draft...' });
          const response = await base44.functions.invoke('jobBudgetIngest', { file_url: uploaded.file_url, file_name: file.name, job_id: uploadJob || undefined, request_key: key });
          const result = response?.data ?? response;
          if (result?.error) throw new Error(result.error);
          update({ status: result.duplicate ? 'Already saved - no duplicate budget added.' : result.budget_id ? 'Draft saved. Review numbers and choose whether to include this scope.' : 'Needs review: no budget record was returned.', budget_id: result.budget_id, notes: result.notes?.join(' ') || '' });
        } catch (e) { update({ status: messageOf(e), failed: true }); }
      }
    } finally { uploadBusy.current = false; setUploading(false); load(); }
  }
  if (loading && !data) return <PageShell><p className="rounded-xl border bg-white p-5 text-sm">Loading budgets, orders and existing jobs...</p></PageShell>;
  if (jobId && data && !job) return <PageShell><Card><h1 className="text-xl font-bold">Job not found</h1><p className="my-3 text-sm">No job was created or changed. Open the existing job from Jobs.</p><Link to="/jobs" className={buttonClass} style={secondaryStyle}>Back to Jobs</Link></Card></PageShell>;
  const currentBudget = editor?.budget_id ? current.budgets.find(b => b.id === editor.budget_id) : null;
  const currentPO = editor?.po_id ? current.purchase_orders.find(p => p.id === editor.po_id) : null;
  const currentOrder = editor?.order_id ? current.vendor_orders.find(o => o.id === editor.order_id) : null;
  const editorJob = current.jobs.find(j => j.id === (editor?.job_id || jobId));
  return <PageShell width="max-w-[1240px]">
    <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
      <Link to={job ? `/jobs/${job.id}` : '/jobs'} className="inline-flex items-center gap-1 font-semibold" style={{ color: C.text }}><ArrowLeft size={15} />{job ? 'Back to job' : 'Back to Jobs'}</Link>
      <div className="flex flex-wrap gap-2">{job && <><Link to={`/jobs/${job.id}/setup`} target="_blank" rel="noopener noreferrer" className={buttonClass} style={secondaryStyle}>Setup sheet</Link><Link to={pathFor('')} className={buttonClass} style={secondaryStyle}>Purchasing overview</Link></>}<button disabled={loading || uploading} onClick={load} className={buttonClass} style={secondaryStyle}><RefreshCw size={15} />Refresh</button></div>
    </div>
    <PageHero eyebrow="Glass Forge / purchasing" title={job ? 'Budget & Orders' : 'Purchasing Overview'} sub={job ? job.canonical_name : 'Open a job to manage its quotes, budgets, purchase orders and accounting links in one place.'}>
      <details open={!job}><summary className="min-h-11 cursor-pointer py-3 text-sm font-semibold text-white">{job ? `Budget totals · Customer ${money(rollup.sell)}` : "Purchasing totals"}</summary><div className="grid grid-cols-2 gap-3 lg:grid-cols-4">{job ? <><HeroStat label="Budget cost" value={money(rollup.cost)} sub={`${rollup.count} included scopes`} /><HeroStat label="Customer total" value={money(rollup.sell)} sub="Budget estimate, not an invoice" /><HeroStat label="Margin dollars" value={money(rollup.margin_dollars)} /><HeroStat label="Margin" value={percent(rollup.margin_pct)} sub={rollup.status === 'ready' ? 'Based on included scopes' : 'Review incomplete or duplicate costs'} /></> : <><HeroStat label="Quote budgets" value={String(current.budgets.length)} /><HeroStat label="Purchase orders" value={String(current.purchase_orders.length)} /><HeroStat label="Supplier confirmations" value={String(current.vendor_orders.length)} /><HeroStat label="Reference conflicts" value={String(current.conflicts.length)} sub="Flagged, not auto-corrected" /></>}</div></details>
    </PageHero>
    {job && <PurchasingWorkflow job={job} data={current} month={params.get('month') || ''} disabled={incomplete} />}
    {error && <p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">{error} Records may be incomplete. Editing is disabled until Refresh succeeds.</p>}
    {job?.merged_into && <p className="rounded-xl bg-amber-50 p-4 text-sm text-amber-900">This is a merged job record. <Link className="underline" to={pathFor(job.merged_into)}>Open the current job workspace</Link>. No job links have been changed.</p>}
    {notice && <p role="status" className="rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</p>}
    {conflicts.length > 0 && <details className="rounded-xl border border-amber-200 bg-amber-50 p-4" open={Boolean(job)}><summary className="cursor-pointer text-sm font-bold text-amber-900"><AlertTriangle size={15} className="mr-2 inline" />{conflicts.length} PO reference conflict{conflicts.length === 1 ? '' : 's'} - review before linking</summary><div className="mt-3 space-y-2">{conflicts.map(c => <div key={c.number} className="text-sm text-amber-950"><strong>{c.number}</strong><span> appears against </span>{c.job_ids.map((id, i) => <span key={id}>{i ? ' / ' : ''}<Link className="underline" to={`/jobs/${id}`}>{current.jobs.find(j => j.id === id)?.canonical_name || id}</Link></span>)}. Original records are retained; no automatic cross-link is made.</div>)}</div></details>}
    <Card><div className="grid items-end gap-3 sm:grid-cols-2"><Field label={job ? 'Search this job\u2019s purchasing records' : 'Find a job or quote'} value={query} onChange={setQuery} />{!job && <Field label="Open an existing job" value="" onChange={id => id && navigate(pathFor(id))}><option value="">Choose job...</option>{availableJobs.filter(j => !needle || matches(j)).map(j => <option key={j.id} value={j.id}>{jobLabel(j)}</option>)}</Field>}</div>{!job && <label className="mt-3 flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" checked={unlinkedOnly} onChange={e => setUnlinkedOnly(e.target.checked)} />Show records that still need a job</label>}</Card>
    <div className="flex flex-wrap gap-2" role="tablist" aria-label="Purchasing sections">{SECTIONS.map(([key, label]) => <button key={key} role="tab" aria-selected={section === key} onClick={() => changeSection(key)} className={buttonClass} style={section === key ? primaryStyle : secondaryStyle}>{label}{sectionCounts[key] !== undefined ? ` (${sectionCounts[key]})` : ''}</button>)}</div>
    <fieldset disabled={incomplete || Boolean(job?.merged_into || job?.is_sample)} className="min-w-0 space-y-4 border-0 p-0">
      {editor && <div key={editor.key}>
        {editor.mode === 'po' && editorJob && <PurchaseOrderForm job={editorJob} budgets={current.budgets} initialBudget={currentBudget} onDone={done} onCancel={() => setEditor(null)} />}
        {editor.mode === 'usage' && currentBudget && <BudgetUsageForm budget={currentBudget} budgets={current.budgets} onDone={done} onCancel={() => setEditor(null)} />}
        {editor.mode === 'numbers' && currentBudget && <NumbersEditor budget={currentBudget} onDone={budgetDone} onRefilled={load} onCancel={() => setEditor(null)} />}
        {editor.mode === 'link' && currentBudget && <LinkJobEditor budget={currentBudget} jobs={availableJobs} allowCreate={false} onDone={budgetDone} onCancel={() => setEditor(null)} />}
        {editor.mode === 'supplier' && <SupplierOrderForm jobs={current.jobs} purchaseOrders={current.purchase_orders} initialJobId={jobId} initialPO={currentPO} order={currentOrder} onDone={done} onCancel={() => setEditor(null)} />}
        {editor.mode === 'po_status' && currentPO && <OrderStatusForm row={currentPO} onDone={done} onCancel={() => setEditor(null)} />}
        {editor.mode === 'vendor_status' && currentOrder && <OrderStatusForm row={currentOrder} supplier onDone={done} onCancel={() => setEditor(null)} />}
      </div>}
      {section === 'budgets' && <>
        <Card><h2 className="text-base font-bold text-slate-900">Add supplier quote PDFs</h2><p className="mt-1 text-sm text-slate-600">{job ? `New PDFs are attached to ${job.canonical_name}.` : 'Open a job first for direct filing, or upload here and choose its job afterward.'} New quotes start as drafts, not additional budget totals.</p>
          <button type="button" disabled={uploading} onDragOver={e => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={e => { e.preventDefault(); setDragging(false); processFiles(e.dataTransfer.files); }} onClick={() => fileInput.current?.click()} className={`mt-4 flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-7 text-sm ${dragging ? 'border-emerald-700 bg-emerald-50' : 'border-slate-300 bg-slate-50'}`}><UploadCloud size={26} /><strong>{uploading ? 'Saving quote drafts...' : 'Drop PDFs or choose files'}</strong><span>Up to 10 files, 30 MB each</span></button><input ref={fileInput} type="file" accept="application/pdf" multiple className="hidden" onChange={e => { processFiles(e.target.files); e.target.value = ''; }} />
          {processing.map(p => <div key={p.key} className={`mt-2 rounded-lg p-3 text-sm ${p.failed ? 'bg-red-50 text-red-900' : 'bg-slate-50 text-slate-700'}`}><strong>{p.name}</strong><p>{p.status}</p>{p.notes && <p className="mt-1 text-xs">{p.notes}</p>}</div>)}
        </Card>
        {!budgets.length && <Card><p className="text-sm text-slate-600">No quote budgets in this view. Existing job information is unchanged.</p></Card>}
        {budgets.map(b => {
          const figures = budgetFigures(b);
          const related = current.purchase_orders.filter(p => budgetForPO(p, current.budgets).budget?.id === b.id);
          const supplierOrders = current.vendor_orders.filter(o => o.budget_id === b.id && o.job_id === b.job_id);
          const included = Boolean(b.job_id) && (job ? active.has(b.id) : activeBudgets(current.budgets.filter(r => r.job_id === b.job_id)).some(r => r.id === b.id));
          return <Card key={b.id} id={`budget-${b.id}`}><div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><h3 className="break-words text-base font-bold text-slate-900">{b.title}</h3><p className="mt-1 text-xs text-slate-500">{b.vendor || b.manufacturer || 'Supplier needs review'}{b.quote_number ? ` / Quote ${b.quote_number}` : ''}</p></div><div className="flex flex-wrap gap-1"><Badge warning={!included}>{!b.job_id ? 'Needs a job' : included ? 'Included scope' : b.budget_usage === 'draft' ? 'Draft' : 'Reference / replaced'}</Badge>{!b.job_id && <Badge warning>Needs job</Badge>}{b.status === 'needs_review' && <Badge warning>Filing / match review</Badge>}</div></div>
            {!job && b.job_id && <Link className="mt-2 inline-block text-sm font-semibold underline" to={procurementPath(b.job_id)}>{current.jobs.find(j => j.id === b.job_id)?.canonical_name || b.job_name || 'Open job workspace'}</Link>}
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-slate-700"><span>Material before tax: <strong>{money(b.inputs?.material_true_cost)}</strong></span>{b.openings_qty > 0 && <span>{b.openings_qty} window / door units</span>}{supplierOrders.map(o => <span key={o.id}>Supplier amount: <strong>{money(o.amount)}</strong> <Link className="font-semibold underline" to={procurementPath(b.job_id, 'tracking')}>Order {o.order_number}</Link></span>)}</div>
            {b.budget_usage === 'draft' && <p className="mt-2 text-xs text-slate-500">Saved on this job. Fill in labor and your customer price, then include the reviewed scope in the budget. Nothing has been ordered or invoiced by this draft.</p>}
            <Metrics figures={figures} />{figures.warnings.length > 0 && <p className="mb-3 text-sm font-medium text-amber-800">{figures.warnings.join(' \u00b7 ')}</p>}
            <div className="flex flex-wrap gap-2"><button className={buttonClass} style={secondaryStyle} onClick={() => openEditor({ mode: 'numbers', budget_id: b.id })}>Review numbers</button>{b.job_id ? <button className={buttonClass} style={secondaryStyle} onClick={() => openEditor({ mode: 'usage', budget_id: b.id })}>Scope / revision</button> : <button className={buttonClass} style={primaryStyle} onClick={() => openEditor({ mode: 'link', budget_id: b.id })}>Link existing job</button>}
              {related.length ? related.map(p => <Link key={p.id} className={buttonClass} style={secondaryStyle} to={procurementPath(p.job_id, 'orders')}>{p.po_number}{p.budget_id ? '' : ' (matching quote)'}</Link>) : <button disabled={!b.job_id || !included || !figures.ready} className={buttonClass} style={primaryStyle} onClick={() => { changeSection('orders'); openEditor({ mode: 'po', budget_id: b.id, job_id: b.job_id }); }}>Prepare PO</button>}
              <DeleteUnusedQuoteButton budget={b} onDeleted={done} />
            </div><div className="mt-3 flex flex-wrap gap-2"><External href={b.source_pdf_url || fileHref(b.drive_quote_file_id)}><FileText size={13} />Source quote</External><External href={fileHref(b.drive_budget_xlsx_file_id)}>Budget sheet</External><External href={b.drive_job_folder_id ? `https://drive.google.com/drive/folders/${b.drive_job_folder_id}` : ''}>Drive folder</External></div>
            {b.input_history?.length > 0 && <details className="mt-3 text-xs text-slate-600"><summary className="cursor-pointer">Previous saved inputs ({b.input_history.length})</summary>{b.input_history.map((h, i) => <p key={i} className="mt-2">{h.at} / {h.action} / material {money(h.inputs?.material_true_cost)} / customer total {money(h.inputs?.actual_total_sell)}</p>)}</details>}
          </Card>;
        })}
      </>}
      {section === 'orders' && <>
        <Card><div className="flex flex-wrap items-center justify-between gap-3"><p className="max-w-2xl text-sm text-slate-600">Issue a PO from an included quote, or prepare a manual PO for this job. Supplier confirmation and payment are separate. Issued amounts are kept as reviewed snapshots.</p><button disabled={!job} className={buttonClass} style={primaryStyle} onClick={() => openEditor({ mode: 'po', job_id: jobId })}><Plus size={15} />Prepare PO</button></div>{!job && <p className="mt-2 text-xs text-slate-500">Choose an existing job above before preparing a PO.</p>}</Card>
        {!pos.length && <Card><p className="text-sm text-slate-600">No purchase orders in this view.</p></Card>}
        {pos.map(p => {
          const source = budgetForPO(p, current.budgets);
          const conflict = conflictNumbers.has(p.po_number);
          const supplier = conflict ? null : supplierForPO(p, current.vendor_orders);
          return <Card key={p.id} id={`po-${p.id}`}><div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-lg font-bold">{p.po_number} <span className="text-sm font-medium text-slate-500">{p.vendor}</span></h3><Badge warning={conflict || p.status === 'cancelled'}>{conflict ? 'Reference conflict' : p.status}</Badge></div>
            <p className="mt-2 text-sm text-slate-600">Quote {p.vendor_quote_ref || '\u2014'} / Supplier payable <strong>{money(p.amount_dealer)}</strong>{p.amount_customer != null ? ` / Customer amount for this PO ${money(p.amount_customer)}` : ''}</p>
            <p className="mt-2 text-xs text-slate-500">{source.budget ? `${source.explicit ? 'Source budget' : 'Matching same-job quote (legacy)'}: ${source.budget.title}` : source.reason}</p>
            {p.notes && <p className="mt-2 whitespace-pre-line text-sm text-slate-600">{p.notes}</p>}
            <div className="mt-3 flex flex-wrap gap-2">{p.job_id && <Link className={buttonClass} style={secondaryStyle} to={`/jobs/${p.job_id}`}>Open job</Link>}<button className={buttonClass} style={secondaryStyle} onClick={() => openEditor({ mode: 'po_status', po_id: p.id })}>Record status</button>{supplier ? <Link className={buttonClass} style={secondaryStyle} to={procurementPath(p.job_id, 'tracking')}>Supplier order {supplier.order_number}</Link> : <button disabled={conflict || !p.job_id || p.status === 'cancelled'} className={buttonClass} style={secondaryStyle} onClick={() => openEditor({ mode: 'supplier', po_id: p.id })}>Record supplier confirmation</button>}</div>
            {!p.job_id && <p className="mt-3 text-sm text-amber-800">Legacy PO has no job. It is retained for review, not automatically assigned.</p>}
          </Card>;
        })}
      </>}
      {section === 'tracking' && <>
        <Card><div className="flex flex-wrap items-center justify-between gap-3"><p className="max-w-2xl text-sm text-slate-600">Supplier confirmation, ETA, receiving and payment records. Nothing here infers installation completion or changes the calendar.</p><button className={buttonClass} style={primaryStyle} onClick={() => openEditor({ mode: 'supplier' })}><Plus size={15} />Record confirmation</button></div></Card>
        {!orders.length && <Card><p className="text-sm text-slate-600">No supplier confirmations in this view.</p></Card>}
        {orders.map(o => <Card key={o.id}><div className="flex flex-wrap items-start justify-between gap-2"><h3 className="max-w-3xl break-words text-base font-bold">{o.title}</h3><Badge warning={!isPaid(o)}>{isPaid(o) ? o.status : 'Unpaid'}</Badge></div><div className="my-3 grid grid-cols-2 gap-3 text-sm lg:grid-cols-4"><span>Confirmed amount<br /><strong>{money(o.amount)}</strong></span><span>Supplier order<br /><strong>{o.order_number || '\u2014'}</strong></span><span>ETA<br /><strong>{o.eta_date || 'Not confirmed'}</strong></span><span>Received<br /><strong>{o.received_date || 'Not recorded'}</strong></span></div><p className="text-xs text-slate-500">{o.po_name || 'No PO reference recorded'}{o.purchase_order_id ? ' / Explicit PO link' : ' / Legacy reference; confirm its PO link before editing'}</p>{o.notes && <p className="mt-2 whitespace-pre-line text-sm text-slate-600">{o.notes}</p>}<div className="mt-3 flex flex-wrap gap-2">{o.job_id && <Link className={buttonClass} style={secondaryStyle} to={`/jobs/${o.job_id}`}>Open job</Link>}<button className={buttonClass} style={secondaryStyle} onClick={() => openEditor({ mode: 'supplier', order_id: o.id })}>Details / link PO</button><button className={buttonClass} style={secondaryStyle} onClick={() => openEditor({ mode: 'vendor_status', order_id: o.id })}>Record payment status</button></div></Card>)}
      </>}
      {section === 'invoicing' && (job ? <InvoiceBridge key={job.id} job={job} /> : <Card><p className="text-sm text-slate-600">Choose an existing job above to review its budget estimate alongside invoicing. No accounting records are modified by opening this page.</p></Card>)}
    </fieldset>
  </PageShell>;
}
