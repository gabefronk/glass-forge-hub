import {useCallback,useEffect,useState} from 'react';
import JobResearchPanel from './JobResearchPanel';
import {Link} from 'react-router-dom';
import {base44} from '@/api/base44Client';

const label=s=>String(s||'').replaceAll('_',' ');
const when=s=>s?new Date(s).toLocaleString('en-US',{timeZone:'America/Denver'}):'Not verified';
function EvidenceList({items}) {
  if(!items?.length)return <p className="text-sm text-slate-500">No safely matched records in this section.</p>;
  return <div className="space-y-3">{items.slice(0,30).map(e=><article key={e.source_key} className="rounded-lg border border-slate-200 bg-white p-3 text-sm">
    <div className="flex flex-wrap justify-between gap-2"><strong>{e.date_info?.local_date||'Date unknown'} · {label(e.category)}</strong><span className="text-xs text-slate-500">{label(e.certainty)}</span></div>
    <p className="mt-1 whitespace-pre-wrap break-words text-slate-700">{e.text||'Document reference only; text has not been extracted.'}</p>
    {!!e.attachments?.length&&<p className="mt-2 text-xs text-slate-600">{e.attachments.map(a=>a.name||'Attachment').join(' · ')}</p>}
    <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500"><span>{label(e.source_type)} · {label(e.status||'recorded')}</span><span>Source checked: {when(e.source_checked_at)}</span>{e.source_url&&<a href={e.source_url} className="text-teal-700 underline">Open source workspace</a>}</div>
  </article>)}</div>;
}
export default function JobKnowledgePanel({jobId}) {
  const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[tab,setTab]=useState('upcoming');
  const load=useCallback(async()=>{const result=await base44.functions.invoke('job-knowledge',{action:'get',job_id:jobId});return result.data;},[jobId]);
  useEffect(()=>{let current=true;setData(null);setError('');load().then(d=>{if(current)setData(d);}).catch(()=>{if(current)setError('The prepared job information could not load.');});return()=>{current=false;};},[load]);
  const refresh=async()=>{setBusy(true);setError('');try{const result=(await base44.functions.invoke('job-knowledge',{action:'refresh'})).data;if(result.status==='busy')setError('A preparation is already running. Check again shortly.');setData(await load());}catch{setError('Preparation could not finish. The previous complete job brief remains available.');}finally{setBusy(false);}};
  const c=data?.context;
  const items=tab==='upcoming'?[...(c?.next_arrivals||[]),...(c?.next_events||[])].sort((a,b)=>String(a.date).localeCompare(String(b.date))):tab==='notes'?c?.latest_notes:tab==='documents'?c?.latest_documents:c?.timeline;
  return <section className="my-5 rounded-2xl border border-slate-200 bg-white p-5" aria-label="Prepared job information">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold text-slate-900">Job brief</h2><p className="mt-1 text-sm text-slate-600">Calendar, arrivals, service, reports and notes together.</p></div><button type="button" onClick={refresh} disabled={busy} className="rounded-lg border border-slate-300 px-3 py-2 text-sm disabled:opacity-50">{busy?'Preparing…':'Prepare latest job data'}</button></div>
    {error&&<p role="alert" className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{error}</p>}
    {!c?<p className="mt-4 text-sm text-slate-500">{error?'Job information is unavailable. Use the source workspaces while the connection is checked.':data?.status==='missing_or_ambiguous'?'This job has missing or conflicting prepared records. Rebuild the preparation before using its facts.':data?'This job has not been prepared yet.':'Loading prepared job information…'}</p>:<>
      <div className="mt-4 flex flex-wrap gap-3 text-xs text-slate-600"><span>Prepared {when(data.prepared_at)}</span><span>{c.counts?.evidence||0} linked records</span><span>{c.counts?.conflicts||0} conflicts</span><span>{c.counts?.gaps||0} checks needed</span></div>
      {(data.stale||c.status!=='ready')&&<p className="mt-3 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">{data.stale?'This brief is over 26 hours old. ':''}Some source information needs verification. A saved schedule is not proof of completed work, and an estimated arrival is not a delivery confirmation.</p>}
      <div className="my-4 flex flex-wrap gap-2">{[['upcoming','Upcoming & arrivals'],['notes','Notes & reports'],['documents','Documents'],['timeline','Timeline']].map(([key,title])=><button type="button" key={key} onClick={()=>setTab(key)} aria-pressed={tab===key} className={'rounded-lg px-3 py-2 text-sm '+(tab===key?'bg-teal-900 text-white':'bg-slate-100 text-slate-700')}>{title}</button>)}</div>
      <EvidenceList items={items}/>
      {(items?.length>30||c.items_truncated)&&<p className="mt-3 text-xs text-slate-500">Showing a concise selection. All {c.counts?.evidence||0} source references are retained in this brief.</p>}
      <details className="mt-4 border-t pt-3"><summary className="cursor-pointer text-sm font-medium">Source freshness and open checks</summary><div className="mt-3 grid gap-2 sm:grid-cols-2">{Object.values(c.sources||{}).map(s=><div key={s.source_type} className="rounded-lg bg-slate-50 p-3 text-xs"><strong>{label(s.source_type)} · {label(s.state)}</strong><p className="mt-1">Checked {when(s.checked_at)}</p>{s.range_end&&<p>Coverage {s.range_start} through {s.range_end}</p>}</div>)}</div><ul className="mt-3 space-y-1 pl-4 text-xs text-slate-600">{[...(c.conflicts||[]),...(c.gaps||[])].slice(0,30).map((g,i)=><li key={i}>{label(g.code)}{g.detail?': '+g.detail:''}</li>)}</ul><Link to="/admin/agents" className="mt-3 inline-block text-sm text-teal-800 underline">Review assigned exceptions</Link></details>
    </>}
    <JobResearchPanel key={jobId} jobId={jobId}/>
  </section>;
}