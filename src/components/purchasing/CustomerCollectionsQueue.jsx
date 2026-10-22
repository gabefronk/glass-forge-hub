import { useEffect, useState } from 'react';
import { displayDate } from '@/lib/purchasingDates';
import { Link } from 'react-router-dom';
import { base44 } from '@/api/base44Client';

const money = v => v == null ? 'Needs review' : Number(v).toLocaleString('en-US',{style:'currency',currency:'USD'});
const btn='min-h-10 rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50';
export function CollectionItem({ item, onSave, busy, error }) {
  const {line,job_name,completion,ambiguous}=item;
  const [date,setDate]=useState(''),[reference,setReference]=useState(''),[reviewed,setReviewed]=useState(false),[mode,setMode]=useState('');
  const state=line.customer_collection_state;
  const complete=completion?.completion==='complete';
  const paid=state==='paid';
  const payload={line_id:line.id,expected_updated_date:line.updated_date,review_confirmed:true};
  const run=async action=>{const ok=await onSave({...payload,action,...(action==='paid'?{received_date:date,reference}:{})});if(ok){setMode('');setReviewed(false);}};
  return <article className="rounded-xl border border-stone-300 bg-white p-4">
    <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="font-bold">{job_name}</h3><span className="rounded-full bg-stone-100 px-3 py-1 text-xs font-bold">{paid?'Customer paid':!complete?'Work incomplete':!state?'Review enrollment':state==='prepared'?'Request prepared - not sent':'Complete - customer unpaid'}</span></div>
    <p className="mt-1 text-xs text-stone-600">Outside BFS · {Math.round((line.split_pct ?? .5)*100)}% profit split · Work date {line.job_date ? displayDate(line.job_date) : 'Not recorded'}</p>
    <p className="mt-2 text-sm">Sale {money(line.sale_price)} · Full cost {money(line.cost)}. Missing prices stay on review. Nothing is sent to QuickBooks here.</p>
    {ambiguous && <p role="alert" className="mt-2 text-sm text-red-800">Multiple profit-split lines share this job. Review which work this payment covers before continuing.</p>}
    {!complete && !paid && <p className="mt-2 text-sm text-red-800">Latest report is incomplete. Resolve the work before requesting payment.</p>}
    <div className="mt-3 flex flex-wrap gap-2 text-sm">
      <Link className={btn} to={`/jobs/${line.job_id}`}>Open job</Link>
      {paid ? <Link className={btn} to={`/?job_id=${line.job_id}&month=${line.invoice_month}`}>Invoicing · {line.invoice_month}</Link> : <>
        {!state ? <button className={btn} disabled={busy||ambiguous||!complete} onClick={()=>{setMode('enroll');setReviewed(false);}}>Review this job for collection</button> : <>
          <button className={btn} disabled={busy||ambiguous||!complete} onClick={()=>{setMode('prepare');setReviewed(false);}}>Request payment in QuickBooks</button>
          <button className={btn} disabled={busy||ambiguous||!complete} onClick={()=>{setMode('paid');setReviewed(false);}}>Record customer paid</button>
        </>}
      </>}
    </div>
    {mode && <form className="mt-4 space-y-3 rounded-lg bg-stone-50 p-3" onSubmit={e=>{e.preventDefault();if(reviewed)run(mode);}}>
      <h4 className="font-bold">{mode==='paid'?'Record received customer payment':mode==='prepare'?'Prepare payment request':'Enable collection for this completed job'}</h4>
      {mode==='prepare' && <p className="text-sm">Review the job, bill-to contact and final amount in QuickBooks yourself. This only records that your request is prepared. It does not create an invoice or send anything.</p>}
      {mode==='enroll' && <p className="text-sm">Move this existing item to Purchasing's customer-payment queue. It will leave monthly Invoicing until customer payment is recorded. Work dates, prices and supplier payments stay unchanged.</p>}
      {mode==='paid' && <><label className="block text-sm">Customer payment received date<input className="mt-1 block min-h-10 rounded border p-2" type="date" value={date} required onChange={e=>{setDate(e.target.value);setReviewed(false);}} /></label>
      <label className="block text-sm">Receipt / payment reference<input className="mt-1 block min-h-10 w-full rounded border p-2" maxLength={300} minLength={3} required value={reference} onChange={e=>{setReference(e.target.value);setReviewed(false);}} /></label>
      <p className="text-sm">The same item will appear in the received month's Invoicing. This records money already received; it does not collect or send money. Supplier payment is unchanged.</p></>}
      <label className="flex gap-2 text-sm"><input type="checkbox" checked={reviewed} onChange={e=>setReviewed(e.target.checked)} />{mode==='paid'?'I verified customer payment, date and reference.':'I reviewed this job and this action.'}</label>
      <button className={btn} disabled={!reviewed||busy}>{busy?'Saving...':mode==='paid'?'Save received payment':mode==='prepare'?'Mark request prepared':'Enable customer collection'}</button>
      <button type="button" className={btn} disabled={busy} onClick={()=>setMode('')}>Cancel</button>
    </form>}
    {error && <p role="alert" className="mt-2 text-sm text-red-800">{error}</p>}
  </article>;
}
export default function CustomerCollectionsQueue({ query='', onChanged }) {
  const [items,setItems]=useState([]),[loading,setLoading]=useState(true),[error,setError]=useState(''),[busy,setBusy]=useState('');
  const load=async()=>{setError('');try{const r=await base44.functions.invoke('customerCollections',{action:'list'});const d=r?.data??r;if(!Array.isArray(d.items)||d.error)throw new Error(d.error||'Collection data unavailable');setItems(d.items);}catch(e){setError(e?.response?.data?.error||e.message);}finally{setLoading(false);}};
  useEffect(()=>{load();},[]);
  const save=async p=>{setBusy(p.line_id);setError('');try{const r=await base44.functions.invoke('customerCollections',p);if(r?.data?.error)throw new Error(r.data.error);await load();onChanged?.();return true;}catch(e){setError(e?.response?.data?.error||e.message);return false;}finally{setBusy('');}};
  const filtered=items.filter(i=>`${i.job_name} ${i.line.job_date}`.toLowerCase().includes(query.toLowerCase()));
  return <section aria-label="Customer payment queue" className="mb-5 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-stone-900">
    <h2 className="text-lg font-bold">Customer payment queue</h2><p className="mb-3 text-sm">Completed outside-BFS work. Customer receipts are separate from supplier payments. Existing jobs require explicit enrollment; no historical amounts are backfilled.</p>
    {loading?<p>Loading customer collections...</p>:null}{error?<p role="alert" className="mb-3 text-red-800">{error}. Reload before retrying.</p>:null}
    {!loading&&!error&&!filtered.length?<p className="text-sm">No matching completed outside-BFS work.</p>:null}
    <div className="space-y-3">{filtered.map(item=><CollectionItem key={item.line.id} item={item} onSave={save} busy={busy===item.line.id} error={busy?'':undefined} />)}</div>
  </section>;
}
