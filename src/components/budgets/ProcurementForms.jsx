import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';
import { C } from '@/lib/feeUI';
import { amount, prepareBudgetPO, activeBudgets, budgetVersion } from '../../../base44/shared/procurementCore.js';
import { denverDate } from '../../../base44/shared/billingCore.js';

export const money = value => amount(value) === null ? '\u2014' : amount(value).toLocaleString('en-US', { style: 'currency', currency: 'USD' });
export const percent = value => value == null ? '\u2014' : `${(value * 100).toFixed(1)}%`;
export const buttonClass = 'inline-flex min-h-10 items-center justify-center gap-2 rounded-lg border px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed disabled:opacity-50';
export const primaryStyle = { backgroundColor: C.accent, color: '#fff', borderColor: C.accent };
export const secondaryStyle = { backgroundColor: C.card, color: C.text, borderColor: C.border };
export async function purchasingRequest(body) {
  const response = await base44.functions.invoke('procurement', body);
  const data = response?.data ?? response;
  if (data?.error) throw new Error(data.error);
  return data;
}
export const messageOf = error => error?.response?.data?.error || error?.message || 'The request could not be completed. Refresh before retrying.';
export function Field({ label, value, onChange, type = 'text', children, disabled = false, hint }) {
  const cls = 'mt-1 w-full min-w-0 rounded-lg border bg-white px-3 py-2.5 text-sm text-slate-900 disabled:opacity-60';
  return <label className="block min-w-0 text-xs font-semibold text-slate-600">{label}
    {children ? <select className={cls} value={value} disabled={disabled} onChange={e => onChange(e.target.value)}>{children}</select>
      : <input className={cls} type={type} step={type === 'number' ? 'any' : undefined} min={type === 'number' ? '0' : undefined} inputMode={type === 'number' ? 'decimal' : undefined} value={value ?? ''} disabled={disabled} onChange={e => onChange(e.target.value)} />}
    {hint && <span className="mt-1 block font-normal leading-5">{hint}</span>}
  </label>;
}
export function FormPanel({ title, children }) {
  return <section className="rounded-xl border border-emerald-200 bg-white p-4 sm:p-5"><h3 className="mb-4 text-base font-bold text-slate-900">{title}</h3>{children}</section>;
}
function ErrorLine({ error }) { return error ? <p role="alert" className="mt-3 rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p> : null; }
function Review({ checked, onChange, children }) { return <label className="my-4 flex items-start gap-2 text-sm text-slate-700"><input className="mt-1" type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} />{children}</label>; }
function Buttons({ busy, enabled = true, label, onCancel }) {
  return <div className="mt-3 flex flex-wrap gap-2"><button type="submit" disabled={busy || !enabled} className={buttonClass} style={primaryStyle}>{busy ? 'Saving...' : label}</button><button type="button" disabled={busy} onClick={onCancel} className={buttonClass} style={secondaryStyle}>Cancel</button></div>;
}

export function PurchaseOrderForm({ job, budgets, initialBudget, onDone, onCancel }) {
  const eligible = useMemo(() => activeBudgets(budgets.filter(b => b.job_id === job.id)), [budgets, job.id]);
  const [form, setForm] = useState(() => initialBudget ? prepareBudgetPO(initialBudget).form : { job_id: job.id, budget_id: '', vendor: '', vendor_quote_ref: '', amount_dealer: '', amount_customer: '', notes: '', budget_version: '' });
  const [reviewed, setReviewed] = useState(false), [zero, setZero] = useState(false);
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const key = useRef(crypto.randomUUID());
  const source = budgets.find(b => b.id === form.budget_id);
  const set = (name, value) => { setForm(f => ({ ...f, [name]: value })); setReviewed(false); };
  function selectBudget(id) {
    const b = eligible.find(x => x.id === id);
    setForm(b ? prepareBudgetPO(b).form : { job_id: job.id, budget_id: '', vendor: '', vendor_quote_ref: '', amount_dealer: '', amount_customer: '', notes: '', budget_version: '' });
    setReviewed(false); setZero(false); setError('');
  }
  async function submit(event) {
    event.preventDefault(); if (busy || !reviewed) return;
    setBusy(true); setError('');
    try {
      const result = await purchasingRequest({ ...form, action: 'issue_po', request_key: key.current, review_confirmed: reviewed, zero_amount_confirmed: zero });
      onDone(result, result.job_update?.ok === false ? `${result.po_number} was saved, but its job reference needs review. Do not issue it again.` : `${result.po_number} issued and linked to ${job.canonical_name}. Not sent to the supplier.`);
    } catch (e) { setError(messageOf(e)); }
    finally { setBusy(false); }
  }
  return <FormPanel title={`Prepare PO \u00b7 ${job.canonical_name}`}><form onSubmit={submit}><fieldset disabled={busy} className="min-w-0 border-0 p-0">
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Source quote / budget" value={form.budget_id} onChange={selectBudget}><option value="">Manual PO (no budget source)</option>{eligible.map(b => <option value={b.id} key={b.id}>{b.title}</option>)}</Field>
      <Field label="Supplier" value={form.vendor} onChange={v => set('vendor', v)} />
      <Field label="Supplier quote / reference" value={form.vendor_quote_ref} onChange={v => set('vendor_quote_ref', v)} />
      <Field label="Supplier payable for this PO" type="number" value={form.amount_dealer} onChange={v => { set('amount_dealer', v); setZero(false); }} hint="Review supplier tax and freight. This is not the whole-job budget cost." />
      <Field label="Customer amount for this PO scope (optional)" type="number" value={form.amount_customer} onChange={v => set('amount_customer', v)} hint="Leave blank when the customer price belongs to the whole job, not this order." />
      <Field label="Reason for an additional PO for the same quote (when needed)" value={form.additional_order_reason || ''} onChange={v => set('additional_order_reason', v)} />
    </div>
    {source && <p className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-600">Budget customer total: <strong>{money(source.inputs?.actual_total_sell)}</strong> (context only). {prepareBudgetPO(source).supplier_hint}</p>}
    <label className="mt-3 block text-xs font-semibold text-slate-600">Scope / ordering notes<textarea className="mt-1 min-h-20 w-full rounded-lg border p-3 text-sm" value={form.notes} onChange={e => set('notes', e.target.value)} /></label>
    {amount(form.amount_dealer) === 0 && <Review checked={zero} onChange={setZero}>The supplier payable is intentionally zero.</Review>}
    <Review checked={reviewed} onChange={setReviewed}>I reviewed the job, supplier, source quote, scope and payable. Issue a PO record only; do not place or email an order.</Review>
    <ErrorLine error={error} /><Buttons busy={busy} enabled={reviewed && !!form.vendor && !!form.vendor_quote_ref && amount(form.amount_dealer) !== null && (amount(form.amount_dealer) !== 0 || zero)} label="Issue reviewed PO" onCancel={onCancel} />
  </fieldset></form></FormPanel>;
}

export function BudgetUsageForm({ budget, budgets, onDone, onCancel }) {
  const sourceVersion = useRef(budgetVersion(budget));
  const [usage, setUsage] = useState(budget.budget_usage || 'included');
  const [replaces, setReplaces] = useState(budget.replaces_budget_id || '');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  const key = useRef(crypto.randomUUID());
  async function save(e) {
    e.preventDefault(); if (busy) return;
    setBusy(true); setError('');
    try { const r = await purchasingRequest({ action: 'budget_usage', budget_id: budget.id, budget_version: sourceVersion.current, budget_usage: usage, replaces_budget_id: usage === 'included' ? replaces : '', review_confirmed: true, request_key: key.current }); onDone(r, r.message); }
    catch (e2) { setError(messageOf(e2)); } finally { setBusy(false); }
  }
  return <FormPanel title="Choose how this quote counts"><form onSubmit={save}><fieldset disabled={busy} className="min-w-0 border-0 p-0">
    <div className="grid gap-3 sm:grid-cols-2"><Field label="Budget use" value={usage} onChange={setUsage}><option value="draft">Draft - not in totals</option><option value="included">Include in this job's budget</option><option value="reference">Reference only - keep in history</option></Field>
      {usage === 'included' && <Field label="Replaces an earlier quote?" value={replaces} onChange={setReplaces}><option value="">No - separate scope / add-on</option>{budgets.filter(b => b.id !== budget.id && b.job_id === budget.job_id).map(b => <option value={b.id} key={b.id}>{b.title}</option>)}</Field>}</div>
    <p className="mt-3 text-sm text-slate-600">Replacement versions exclude the earlier quote from current totals. Source files, previous numbers and issued purchase orders stay in history. Customer approvals and invoices are not rewritten.</p>
    <ErrorLine error={error} /><Buttons busy={busy} label="Save scope selection" onCancel={onCancel} />
  </fieldset></form></FormPanel>;
}

export function SupplierOrderForm({ jobs, purchaseOrders, initialJobId = '', initialPO, order, onDone, onCancel }) {
  const sourceVersion = useRef(order?.updated_date);
  const [form, setForm] = useState(() => ({ job_id: order?.job_id || initialPO?.job_id || initialJobId, purchase_order_id: order?.purchase_order_id || initialPO?.id || '', order_number: order?.order_number || '', amount: order?.amount ?? '', eta_date: order?.eta_date || '', received_date: order?.received_date || '', notes: order?.notes || '' }));
  const [reviewed, setReviewed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const key = useRef(crypto.randomUUID());
  const set = (name, value) => { setForm(f => ({ ...f, [name]: value, ...(name === 'job_id' ? { purchase_order_id: '' } : {}) })); setReviewed(false); };
  const pos = purchaseOrders.filter(p => p.job_id === form.job_id && p.status !== 'cancelled');
  async function submit(e) {
    e.preventDefault(); if (busy || !reviewed) return; setBusy(true); setError('');
    try { const r = await purchasingRequest({ ...form, action: 'save_supplier_order', order_id: order?.id, expected_updated_date: sourceVersion.current, request_key: key.current, review_confirmed: true }); onDone(r, 'Supplier confirmation saved against the selected job and PO. No order or payment was sent.'); }
    catch (e2) { setError(messageOf(e2)); } finally { setBusy(false); }
  }
  return <FormPanel title={order ? 'Update supplier confirmation' : 'Record supplier confirmation'}><form onSubmit={submit}><fieldset disabled={busy} className="min-w-0 border-0 p-0">
    <div className="grid gap-3 sm:grid-cols-2">
      <Field label="Job" value={form.job_id} disabled={Boolean(order?.job_id || initialPO)} onChange={v => set('job_id', v)}><option value="">Choose existing job</option>{jobs.filter(j => !j.merged_into && !j.is_sample).map(j => <option value={j.id} key={j.id}>{j.canonical_name}</option>)}</Field>
      <Field label="Purchase order" value={form.purchase_order_id} disabled={Boolean(order?.purchase_order_id || initialPO)} onChange={v => set('purchase_order_id', v)}><option value="">Choose PO</option>{pos.map(p => <option value={p.id} key={p.id}>{p.po_number} - {p.vendor} - {p.vendor_quote_ref}</option>)}</Field>
      <Field label="Supplier confirmation / order number" value={form.order_number} onChange={v => set('order_number', v)} />
      <Field label="Confirmed supplier amount" type="number" value={form.amount} onChange={v => set('amount', v)} hint="Record what the supplier confirmed. An issued PO is not a supplier confirmation." />
      <Field label="Supplier ETA" type="date" value={form.eta_date} onChange={v => set('eta_date', v)} />
      <Field label="Received date (only when received)" type="date" value={form.received_date} onChange={v => set('received_date', v)} />
    </div>
    <Field label="Notes" value={form.notes} onChange={v => set('notes', v)} />
    <Review checked={reviewed} onChange={setReviewed}>These details come from the supplier confirmation. Record them only; do not place an order or change the installation calendar.</Review>
    <ErrorLine error={error} /><Buttons busy={busy} enabled={reviewed && !!form.job_id && !!form.purchase_order_id} label="Save supplier confirmation" onCancel={onCancel} />
  </fieldset></form></FormPanel>;
}

export function OrderStatusForm({ row, supplier = false, onDone, onCancel }) {
  const sourceVersion = useRef(row.updated_date);
  const [status, setStatus] = useState(row.status || 'issued'), [note, setNote] = useState('');
  const [reviewed, setReviewed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState('');
  const key = useRef(crypto.randomUUID());
  const options = supplier ? [['ordered', 'Unpaid / ordered'], ['eta_set', 'Unpaid / ETA received'], ['ach_link_received', 'Payment link received (unpaid)'], ['paid', 'Paid - payment verified'], ['reconciled', 'Reconciled']] : [['issued', 'Issued - not sent'], ['emailed', 'Sent to supplier'], ['ordered', 'Ordered'], ['confirmed', 'Supplier confirmed'], ['received', 'Received'], ['cancelled', 'Cancelled (retain number)']];
  async function submit(e) {
    e.preventDefault(); if (busy || !reviewed) return; setBusy(true); setError('');
    try { const r = await purchasingRequest({ action: supplier ? 'vendor_status' : 'po_status', po_id: supplier ? undefined : row.id, order_id: supplier ? row.id : undefined, status, note, expected_updated_date: sourceVersion.current, request_key: key.current, review_confirmed: true }); onDone(r, r.message); }
    catch (e2) { setError(messageOf(e2)); } finally { setBusy(false); }
  }
  return <FormPanel title={`Record status - ${row.po_number || row.title}`}><form onSubmit={submit}><fieldset disabled={busy} className="min-w-0 border-0 p-0">
    <div className="grid gap-3 sm:grid-cols-2"><Field label="Recorded status" value={status} onChange={v => { setStatus(v); setReviewed(false); }}>{options.map(([v, label]) => <option key={v} value={v}>{label}</option>)}</Field><Field label="Evidence / payment reference / reason" value={note} onChange={v => { setNote(v); setReviewed(false); }} /></div>
    <Review checked={reviewed} onChange={setReviewed}>I verified this status. This records a fact only; it does not send money, email a supplier or bill the customer.</Review>
    <ErrorLine error={error} /><Buttons busy={busy} enabled={reviewed && note.trim().length >= 3} label="Save recorded status" onCancel={onCancel} />
  </fieldset></form></FormPanel>;
}

export function InvoiceBridge({ job }) {
  const [month, setMonth] = useState(() => denverDate().slice(0, 7));
  const [preview, setPreview] = useState(null), [route, setRoute] = useState('');
  const [reviewed, setReviewed] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(''), [notice, setNotice] = useState('');
  const key = useRef(crypto.randomUUID());
  useEffect(() => {
    let active = true; setPreview(null); setError(''); setReviewed(false); setNotice('');
    purchasingRequest({ action: 'invoice_preview', job_id: job.id, month }).then(p => { if (active) setPreview(p); }).catch(e => { if (active) setError(messageOf(e)); });
    return () => { active = false; };
  }, [job.id, month]);
  async function sync(e) {
    e.preventDefault(); if (!preview || !reviewed || busy) return; setBusy(true); setError('');
    try { const r = await purchasingRequest({ action: 'sync_estimate', job_id: job.id, month, route, preview_version: preview.version, request_key: key.current, review_confirmed: true }); setNotice(r.message); setPreview(await purchasingRequest({ action: 'invoice_preview', job_id: job.id, month })); setReviewed(false); key.current = crypto.randomUUID(); }
    catch (e2) { setError(messageOf(e2)); } finally { setBusy(false); }
  }
  return <FormPanel title="Budget estimate & invoicing"><form onSubmit={sync}><fieldset disabled={busy} className="min-w-0 border-0 p-0">
    <div className="flex flex-wrap items-end justify-between gap-3"><Field label="Accounting month" type="month" value={month} onChange={setMonth} /><Link className={buttonClass} style={secondaryStyle} to={`/?job_id=${encodeURIComponent(job.id)}&month=${encodeURIComponent(month)}`}>Open this job in Invoicing</Link></div>
    <p className="mt-3 text-sm leading-6 text-slate-600">Budgets are estimates. Invoice amounts, actual labor, customer payments and supplier payments remain separate records. Linking below does not create an invoice, approve an order or overwrite actual financial amounts.</p>
    {preview && <>
      <div className="my-4 grid gap-3 sm:grid-cols-3">{[['Budget cost', preview.estimate.cost], ['Budget customer total', preview.estimate.sell], ['Budget margin dollars', preview.estimate.margin_dollars]].map(([label, value]) => <div key={label} className="rounded-lg bg-slate-50 p-3"><div className="text-xs text-slate-500">{label}</div><strong className="text-lg">{money(value)}</strong></div>)}</div>
      {preview.estimate.warnings.length > 0 && <p className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{preview.estimate.warnings.join(' ')}</p>}
      {preview.existing ? <div className="mt-4 rounded-lg border p-3 text-sm text-slate-600"><strong>Existing accounting record (unchanged):</strong><div className="mt-2 flex flex-wrap gap-x-5 gap-y-2"><span>Product revenue {money(preview.existing.product_sell)}</span><span>Recorded labor cost {money(preview.existing.actual_labor_cost)}</span><span>Recorded install revenue {money(preview.existing.installation_revenue)}</span></div><p className="mt-2 text-xs">Last estimate link: {preview.existing.budget_synced_at || 'Not linked yet'}. Historical figures are retained; differences require your review.</p></div>
        : <div className="mt-4"><Field label="Business route for the new accounting record" value={route} onChange={setRoute}><option value="">Choose the job's route</option><option value="bfs_installed_sale">BFS installed sale</option><option value="bfs_supply_ya_install">BFS supply-only + Y.A. install</option><option value="bfs_to_ya_turnkey">BFS-to-Y.A. turnkey</option><option value="direct_manufacturer_turnkey">Direct manufacturer turnkey</option></Field></div>}
      {preview.closed ? <p className="mt-4 font-semibold text-amber-800">This month is closed. Its accounting records cannot be updated here.</p> : <>
        <Review checked={reviewed} onChange={setReviewed}>I reviewed the included scopes and accounting month. Link this estimate without changing actual costs, invoices or payments.</Review>
        <button className={buttonClass} style={primaryStyle} disabled={busy || !reviewed || preview.estimate.status !== 'ready' || (!preview.existing && !route)}>{busy ? 'Linking...' : 'Link / refresh budget estimate'}</button>
      </>}
    </>}
    {!preview && !error && <p className="mt-3 text-sm">Loading estimate and accounting records...</p>}
    <ErrorLine error={error} />{notice && <p role="status" className="mt-3 rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</p>}
  </fieldset></form></FormPanel>;
}
