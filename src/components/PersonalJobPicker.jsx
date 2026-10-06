import {useEffect,useRef,useState} from 'react';
import {Search,X} from 'lucide-react';
import {base44} from '@/api/base44Client';
import {useAuth} from '@/lib/AuthContext';

const labelOf=job=>job.canonical_name||'Unnamed job';
const errorText=e=>e.response?.data?.error||e.message||'Job search is unavailable. Try again.';

/** Search only. A job is linked only when the user picks its exact ID. */
export default function PersonalJobPicker({value='',onChange,disabled=false,existingLabel=''}){
 const {user}=useAuth();
 const [open,setOpen]=useState(false),[query,setQuery]=useState(''),[result,setResult]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState(''),[picked,setPicked]=useState(null);
 const generation=useRef(0),identity=useRef(user?.id),mounted=useRef(false),input=useRef(null),trigger=useRef(null);
 identity.current=user?.id;
 const currentResult=result?.userId===user?.id?result:null;
 const selectedLabel=picked?.userId===user?.id&&picked.id===value?picked.label:existingLabel||'Existing linked job';
 const cancelSearch=()=>{generation.current++;setResult(null);setBusy(false);setError('');};
 const close=()=>{cancelSearch();setOpen(false);setQuery('');requestAnimationFrame(()=>{if(mounted.current)trigger.current?.focus();});};
 useEffect(()=>{mounted.current=true;return()=>{mounted.current=false;generation.current++;};},[]);
 useEffect(()=>{generation.current++;setOpen(false);setQuery('');setResult(null);setBusy(false);setError('');setPicked(null);},[user?.id]);
 useEffect(()=>{if(open&&!disabled)input.current?.focus();},[open,disabled]);
 useEffect(()=>{
  const sequence=++generation.current,uid=user?.id,term=query.trim();
  setResult(null);setError('');setBusy(false);
  if(!open||disabled||!uid||term.length<2)return;
  setBusy(true);
  const timer=setTimeout(async()=>{
   try{
    const response=await base44.functions.invoke('todos',{action:'search_jobs',query:term});
    if(response.data?.error)throw new Error(response.data.error);
    if(!mounted.current||sequence!==generation.current||uid!==identity.current)return;
    const byId=new Map();
    for(const job of response.data?.jobs||[]){if(job?.id&&!byId.has(job.id))byId.set(job.id,job);}
    const all=[...byId.values()];
    setResult({userId:uid,jobs:all.slice(0,30),truncated:Boolean(response.data?.truncated)||all.length>30});
   }catch(e){if(mounted.current&&sequence===generation.current&&uid===identity.current)setError(errorText(e));}
   finally{if(mounted.current&&sequence===generation.current&&uid===identity.current)setBusy(false);}
  },300);
  return()=>{clearTimeout(timer);generation.current++;};
 },[query,open,disabled,user?.id]);
 const choose=job=>{
  if(disabled||currentResult?.userId!==user?.id)return;
  setPicked({id:job.id,label:labelOf(job),userId:user?.id});
  onChange(job.id);close();
 };
 const jobs=currentResult?.jobs||[];
 const duplicates=new Set(jobs.filter((job,index)=>jobs.some((other,i)=>i!==index&&labelOf(other).toLowerCase()===labelOf(job).toLowerCase())).map(labelOf));
 return <div className="space-y-2">
  <div className="flex flex-wrap items-center gap-2 text-sm">
   {value?<><span className="min-w-0 flex-1 break-words">Job: <strong className="font-medium">{selectedLabel}</strong></span><button type="button" className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm disabled:opacity-50" disabled={disabled} aria-expanded={open} ref={trigger} onClick={()=>open?close():setOpen(true)}>Change</button><button type="button" className="min-h-10 rounded-lg px-2 text-slate-500 disabled:opacity-50" disabled={disabled} aria-label="Clear linked job" onClick={()=>{onChange('');setPicked(null);close();}}><X className="h-4 w-4"/></button></>:<button type="button" className="min-h-10 rounded-lg border border-slate-300 px-3 text-sm disabled:opacity-50" disabled={disabled} aria-expanded={open} ref={trigger} onClick={()=>open?close():setOpen(true)}>Link a job (optional)</button>}
  </div>
  {open&&<div className="rounded-xl border border-slate-200 p-3" onKeyDown={e=>{if(e.key==='Escape'){e.preventDefault();e.stopPropagation();close();}}}>
   <label className="relative block"><span className="sr-only">Search jobs to link</span><Search className="absolute left-3 top-3 h-4 w-4 text-slate-400"/><input ref={input} type="search" className="min-h-10 w-full rounded-lg border border-slate-300 pl-9 pr-3 text-sm" maxLength={120} placeholder="Search job name" value={query} disabled={disabled} onChange={e=>{cancelSearch();setQuery(e.target.value);}}/></label>
   {query.trim().length<2&&<p className="mt-2 text-xs text-slate-500">Type at least 2 characters to find a job.</p>}
   {busy&&<p role="status" className="mt-2 text-xs text-slate-500">Finding jobs…</p>}
   {error&&<p role="alert" className="mt-2 text-xs text-red-700">{error}</p>}
   {currentResult&&!busy&&<><ul className="mt-2 max-h-60 divide-y divide-slate-100 overflow-y-auto" aria-label="Matching jobs">{jobs.map(job=><li key={job.id}><button type="button" disabled={disabled} className="min-h-11 w-full rounded-lg px-2 py-2 text-left text-sm hover:bg-slate-50 disabled:opacity-50" onClick={()=>choose(job)}><span className="block break-words font-medium">{labelOf(job)}</span>{(job.stage||duplicates.has(labelOf(job)))&&<span className="block text-xs text-slate-500">{job.stage||'No stage'}{duplicates.has(labelOf(job))?` · ${String(job.id).slice(-6)}`:''}</span>}</button></li>)}</ul>{!jobs.length&&<p className="mt-2 text-xs text-slate-500">No jobs found. Try a different name.</p>}{currentResult.truncated&&<p className="mt-2 text-xs text-slate-500">More jobs match. Add more of the name to narrow the list.</p>}</>}
  </div>}
 </div>;
}
