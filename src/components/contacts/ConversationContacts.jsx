import {useEffect,useState} from 'react';
import {Link} from 'react-router-dom';
import {base44} from '@/api/base44Client';
export default function ConversationContacts({conversationKey,onChooseJob}){
 const [data,setData]=useState(null),[error,setError]=useState('');
 useEffect(()=>{let active=true;setData(null);setError('');base44.functions.invoke('contacts-directory',{action:'conversation',conversation_key:conversationKey}).then(r=>{if(active)setData(r.data)}).catch(()=>{if(active)setError('Contact matches are temporarily unavailable.')});return()=>{active=false}},[conversationKey]);
 if(error)return <p className="my-3 text-xs text-slate-500">{error}</p>;
 if(!data?.contacts?.length)return null;
 const linked=new Set(data.contacts.flatMap(c=>c.job_ids));
 return <div className="my-4 rounded-xl border border-[var(--gf-border)] bg-[var(--gf-teal-050)] p-3"><p className="text-xs font-semibold uppercase tracking-wide text-[var(--gf-teal-600)]">Matched contacts</p><div className="mt-2 space-y-2">{data.contacts.map(c=><div key={c.key}><Link className="text-sm font-medium text-[var(--gf-teal-600)]" to={'/contacts?contact='+c.key}>{c.name}</Link><p className="break-words text-xs text-slate-600">{c.company}</p></div>)}</div>{data.jobs.length>0&&<details className="mt-3"><summary className="min-h-9 cursor-pointer text-sm text-[var(--gf-teal-600)]">Find a job for these contacts ({data.jobs.length})</summary><div className="max-h-64 space-y-2 overflow-y-auto">{[...data.jobs].sort((a,b)=>Number(linked.has(b.id))-Number(linked.has(a.id))).map(j=>j.is_workbook?<Link key={j.id} to={'/contacts?job='+encodeURIComponent(j.id)} className="block min-h-11 rounded-lg border border-[var(--gf-border)] bg-white p-2 text-sm text-[var(--gf-teal-600)]">{j.name}<span className="block text-xs text-slate-500">Open workbook job and contacts</span></Link>:<button key={j.id} className="block min-h-11 w-full rounded-lg border border-[var(--gf-border)] bg-white p-2 text-left text-sm text-[var(--gf-teal-600)]" onClick={()=>onChooseJob(j)}>{j.name}{linked.has(j.id)&&<span className="block text-xs text-slate-500">Linked to this contact</span>}</button>)}</div></details>}</div>;
}
