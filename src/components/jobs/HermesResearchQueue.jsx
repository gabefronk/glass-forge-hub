import {useEffect,useRef,useState} from 'react';
import {base44} from '@/api/base44Client';
const labels={queued:'Waiting for local Hermes',claimed:'Local Hermes is reviewing',cancel_requested:'Stopping local review',cancelled:'Cancelled',review_ready:'Ready for your review',failed:'Needs attention'};
export default function HermesResearchQueue({jobId,research}){
  const [open,setOpen]=useState(false),[data,setData]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const current=useRef(true);
  useEffect(()=>{current.current=true;return()=>{current.current=false;};},[]);
  const load=async()=>{try{const r=(await base44.functions.invoke('research-queue',{action:'status',job_id:jobId})).data;if(current.current){setData(r);setError('');}}catch{if(current.current)setError('The local research queue is unavailable. Your job information is unchanged.');}};
  useEffect(()=>{if(!open)return;load();const timer=setInterval(load,15000);return()=>clearInterval(timer);},[open,jobId]);
  const act=async(action,extra={})=>{setBusy(true);setError('');try{await base44.functions.invoke('research-queue',{action,...extra});await load();}catch(e){if(current.current)setError(e.response?.data?.error||'The request could not finish. Refresh before retrying.');}finally{if(current.current)setBusy(false);}};
  const seen=data?.last_worker_seen_at?new Date(data.last_worker_seen_at).toLocaleString():'Not connected yet';
  return <details className="mt-4 border-t pt-3" onToggle={e=>setOpen(e.currentTarget.open)}>
    <summary className="cursor-pointer text-sm font-medium">Local Hermes research</summary>
    <p className="mt-2 text-sm text-slate-600">Let the local model review this job’s prepared context. Missing iPad documents remain a source request for the Mac.</p>
    {error&&<p role="alert" className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{error}</p>}
    {data&&<p className="mt-3 text-xs text-slate-600">{data.paused?'Queue paused':'Queue accepting work'} · Last worker check: {seen} · {data.retained_tasks}/{data.capacity} retained tasks</p>}
    <div className="mt-3 flex flex-wrap gap-2">
      <button type="button" disabled={busy||!data} onClick={()=>act('enqueue',{query:{job_id:jobId},research})} className="rounded-lg bg-teal-900 px-3 py-2 text-sm text-white disabled:opacity-50">Ask local Hermes to review</button>
      <button type="button" disabled={busy||!data} onClick={()=>act('enqueue_canary')} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50">Test local connection</button>
      <button type="button" disabled={busy||!data} onClick={()=>act('set_paused',{paused:!data?.paused})} className="rounded-lg border px-3 py-2 text-sm disabled:opacity-50">{data?.paused?'Resume research queue':'Pause research queue'}</button>
      <button type="button" disabled={busy} onClick={load} className="rounded-lg border px-3 py-2 text-sm">Refresh local status</button>
    </div>
    <p className="mt-2 text-xs text-slate-500">Results are drafts for you to review. This connection does not send texts, email, change jobs, or operate the iPad.</p>
    <div className="mt-4 space-y-3">{(data?.tasks||[]).slice().reverse().map(t=><article key={t.task_id} className="rounded-lg border bg-white p-3 text-sm">
      <div className="flex flex-wrap justify-between gap-2"><strong>{t.job_name||'Research task'} · {String(t.purpose||'').replaceAll('_',' ')}</strong><span>{labels[t.status]||t.status}</span></div>
      {t.result&&<><p className="mt-2 whitespace-pre-wrap">{t.result.summary}</p>{!!t.result.draft_reply&&<div className="mt-2 rounded bg-slate-50 p-3"><strong className="text-xs">Suggested wording</strong><p className="mt-1 whitespace-pre-wrap">{t.result.draft_reply}</p></div>}{!!t.result.missing_sources?.length&&<ul className="mt-2 list-disc pl-4">{t.result.missing_sources.map((s,i)=><li key={i}>{s}</li>)}</ul>}<p className="mt-2 text-xs text-slate-500">Local result awaiting owner review. Source citations: {t.result.cited_source_keys.join(', ')||'none supplied'}</p></>}
      {t.error&&<p className="mt-2 text-amber-900">{t.error.detail}</p>}
      {['queued','claimed'].includes(t.status)&&<button type="button" disabled={busy} onClick={()=>act('cancel',{task_id:t.task_id})} className="mt-2 rounded border px-3 py-1 text-sm">Cancel review</button>}
      {t.status==='cancel_requested'&&<p className="mt-2 text-xs">Cancellation requested. Waiting for the worker to confirm it stopped.</p>}
    </article>)}</div>
  </details>;
}
