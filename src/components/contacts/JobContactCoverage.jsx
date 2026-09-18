import {useCallback,useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import {HardHat,RefreshCw} from 'lucide-react';
import {base44} from '@/api/base44Client';
import {ContactSuggestions} from '@/components/jobs/JobContacts';
import {confirmContactLink} from '@/hooks/use-job-contacts';
import {invokeErrorOf} from '@/lib/jobContacts';
// Every job's link coverage plus proposed links. Loaded only when opened; read-only until the owner saves a link.
export default function JobContactCoverage(){
 const [data,setData]=useState(null),[error,setError]=useState(''),[loading,setLoading]=useState(false),[visible,setVisible]=useState(60);
 const request=useRef(0);
 const load=useCallback(async()=>{const n=++request.current;setLoading(true);setError('');try{const r=await base44.functions.invoke('contacts-directory',{action:'job_contact_coverage'});if(r.data?.error)throw Object.assign(Error(r.data.error),{response:{data:r.data}});if(n===request.current)setData(r.data);}catch(e){if(n!==request.current)return;const {message}=invokeErrorOf(e);setError(/unsupported action/i.test(message)?'Job coverage appears once the updated contacts function is published.':message||'Job coverage could not be loaded.');}finally{if(n===request.current)setLoading(false);}},[]);
 const s=data?.summary;
 return <details className="rounded-2xl border bg-white p-4" onToggle={e=>{if(e.currentTarget.open&&!data&&!loading)load();}}>
  <summary className="flex min-h-10 cursor-pointer items-center gap-2 text-sm font-medium"><HardHat className="h-4 w-4"/>Job contacts: missing superintendents and suggested links{s?` (${s.missing_superintendent} missing a superintendent)`:''}</summary>
  <div className="mt-3 space-y-4">
   <div className="flex flex-wrap items-start justify-between gap-2"><p className="max-w-3xl text-sm text-slate-600">Suggestions come from workbook labels, message threads linked to a job, and the owner's notes. They are proposals: nothing is saved until you choose <strong>Link to this job</strong> and then <strong>Save link</strong>.</p><button disabled={loading} className="flex min-h-10 items-center gap-2 rounded-xl border border-slate-300 px-3 text-sm" onClick={load}><RefreshCw className="h-4 w-4"/>{loading?'Loading…':'Refresh'}</button></div>
   {error&&<p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-800">{error}</p>}
   {s&&<div className="grid gap-2 sm:grid-cols-3">
    <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900"><strong className="block text-2xl">{s.missing_contacts}</strong>of {s.jobs} jobs have no linked contact</p>
    <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900"><strong className="block text-2xl">{s.missing_superintendent}</strong>of {s.jobs} jobs have no superintendent</p>
    <p className="rounded-xl bg-blue-50 p-3 text-sm text-blue-900"><strong className="block text-2xl">{s.suggestions}</strong>suggested links on {s.jobs_with_suggestions} jobs</p>
   </div>}
   {data&&!data.directory&&<p className="text-sm text-amber-800">No contacts directory is imported, so suggestions cannot be matched to people yet.</p>}
   {data?.messages==='unavailable'&&<p className="text-xs text-slate-500">Message threads could not be checked.</p>}
   {data?.unmatched_seeds?.length>0&&<div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900"><p className="font-medium">Owner notes not yet matched to a Glass Forge job</p><ul className="mt-1 list-disc pl-5">{data.unmatched_seeds.map(n=><li key={n.id}>{n.name}{n.phone?` (${n.phone})`:''}: {n.label}. {n.note}</li>)}</ul></div>}
   {data?.suggested?.map(job=><section key={job.id} className="rounded-xl border p-3"><div className="mb-2 flex flex-wrap items-baseline justify-between gap-2"><Link to={'/jobs/'+job.id} className="break-words text-sm font-semibold text-blue-700">{job.name}</Link><span className="text-xs text-slate-500">{job.status.linked} linked · {job.superintendents.length?'Superintendent: '+job.superintendents.join(', '):'No superintendent'}</span></div><ContactSuggestions suggestions={job.suggestions} onConfirm={async({contactKey,role})=>{await confirmContactLink({jobId:job.id,contactKey,role});await load();}}/></section>)}
   {data&&!data.suggested?.length&&<p className="text-sm text-slate-500">No suggested links right now.</p>}
   {data?.missing?.length>0&&<details className="rounded-xl border p-3"><summary className="min-h-9 cursor-pointer text-sm">Jobs with no linked contacts ({data.missing.length})</summary><ul className="mt-2 grid gap-1 sm:grid-cols-2">{data.missing.slice(0,visible).map(j=><li key={j.id}><Link to={'/jobs/'+j.id} className="break-words text-sm text-blue-700">{j.name}</Link>{j.suggestions>0&&<span className="text-xs text-slate-500"> · {j.suggestions} suggested</span>}</li>)}</ul>{data.missing.length>visible&&<button className="mt-2 min-h-10 text-sm text-blue-700 underline" onClick={()=>setVisible(n=>n+60)}>Show more</button>}</details>}
  </div>
 </details>;
}
