import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { Bot, Monitor, LockKeyhole, RefreshCw, ArrowUpRight, FileText, Clock3 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import { isAgentCenterOwner } from "@/lib/agentCenterAccess";
const control="mt-2 min-h-11 w-full min-w-0 rounded-xl border border-slate-300 bg-white px-3 py-2.5 text-base sm:text-sm focus:outline-none focus:ring-2 focus:ring-[#2A5EA8]";
const when=value=>value?new Date(value).toLocaleString():"Not reported";
const labels={request:"Request",note:"Private note",result:"Recorded result"};
function Badge({connection,status}){
 const tone=connection==="manual"?"bg-slate-100 text-slate-600":/attention|stale|Disabled/.test(status)?"bg-amber-50 text-amber-800":"bg-blue-50 text-blue-800";
 return <span className={"rounded-full px-2.5 py-1 text-xs font-medium "+tone}>{connection==="manual"?"Manual":status}</span>;
}
export default function AdminAgentCenter(){
 const {user}=useAuth(),owner=isAgentCenterOwner(user);
 const [data,setData]=useState(null),[loading,setLoading]=useState(false),[saving,setSaving]=useState(false),[error,setError]=useState(""),[notice,setNotice]=useState("");
 const [target,setTarget]=useState("sales_tracker_agent"),[kind,setKind]=useState("request"),[title,setTitle]=useState(""),[body,setBody]=useState("");
 const [saveKey,setSaveKey]=useState(()=>crypto.randomUUID());
 async function refresh(){setLoading(true);setError("");try{const r=await base44.functions.invoke("agentCenter",{action:"inventory"});setData(r.data);}catch(e){setError(e.response?.data?.error||"Agent Center is unavailable.");}finally{setLoading(false);}}
 useEffect(()=>{if(owner)refresh();},[owner]);
 function change(setter,value){setter(value);setSaveKey(crypto.randomUUID());setNotice("");}
 async function save(e){
  e.preventDefault();setSaving(true);setError("");setNotice("");
  try{
   const r=await base44.functions.invoke("agentCenter",{action:"entry",target_id:target,kind,title,body,request_key:saveKey});
   setData(d=>d?{...d,entries:[r.data.entry,...d.entries.filter(x=>x.id!==r.data.entry.id)]}:d);
   setNotice(kind==="request"?"Request saved for manual review. It has not been sent to an agent.":"Private entry saved.");
   setTitle("");setBody("");setSaveKey(crypto.randomUUID());
  }catch(e){setError(e.response?.data?.error||"The save response was interrupted. Retry the same entry to check its saved status.");}finally{setSaving(false);}
 }
 if(!owner)return <div className="mx-auto max-w-lg p-8"><LockKeyhole className="mb-4 h-6 w-6 text-slate-500"/><h1 className="text-xl font-semibold">Owner access required</h1><p className="mt-2 text-sm text-slate-600">This workspace is private to the Glass Forge owner.</p></div>;
 const inventory=data?.inventory||[],selected=inventory.find(a=>a.id===target),entries=data?.entries||[],attention=inventory.filter(a=>/attention|stale/.test(a.status)).length;
 return <div className="mx-auto max-w-7xl space-y-6 p-4 pb-32 text-[#131A26] sm:p-6 sm:pb-32">
  <header className="rounded-2xl bg-[#172438] p-5 text-white sm:p-7">
   <div className="flex flex-wrap items-start justify-between gap-4"><div><p className="flex items-center gap-2 text-xs uppercase tracking-widest text-slate-300"><LockKeyhole className="h-3.5 w-3.5"/>Private · Owner workspace</p><h1 className="mt-3 text-2xl font-semibold sm:text-3xl">Agent Center</h1><p className="mt-2 max-w-2xl text-sm leading-relaxed text-slate-300">See your agents, keep requests in one place, and review what has been recorded.</p></div><button onClick={refresh} disabled={loading} className="flex min-h-11 items-center gap-2 rounded-xl border border-slate-500 px-4 text-sm disabled:opacity-50"><RefreshCw className={"h-4 w-4 "+(loading?"animate-spin":"")}/>{loading?"Refreshing…":"Refresh"}</button></div>
   <div className="mt-6 grid grid-cols-3 gap-3 border-t border-slate-600 pt-5">{[[inventory.length,"Workspaces"],[attention,"Need attention"],[entries.filter(e=>e.kind==="request").length,"Saved requests"]].map(([n,label])=><div key={label}><p className="text-2xl font-semibold">{data?n:"—"}</p><p className="mt-1 text-xs text-slate-300">{label}</p></div>)}</div>
  </header>
  {error&&<p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">{error}</p>}
  {data?.warnings?.map(message=><p role="status" key={message} className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">{message}</p>)}
  <section aria-label="Agent and workspace inventory"><div className="mb-3 flex flex-wrap items-end justify-between gap-2"><h2 className="text-lg font-semibold">Agents & workspaces</h2><p className="text-xs text-slate-500">{data?"Checked "+when(data.checked_at):"Loading inventory…"}</p></div>
   <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{inventory.map(item=><article key={item.id} className="flex min-w-0 flex-col rounded-2xl border border-[#DDE3EC] bg-white p-5 shadow-sm">
    <div className="mb-4 flex items-start justify-between gap-2"><div className="rounded-xl bg-[#EEF3FB] p-2.5 text-[#2A5EA8]">{item.id.startsWith("worker:")||item.connection==="manual"?<Monitor className="h-5 w-5"/>:<Bot className="h-5 w-5"/>}</div><Badge connection={item.connection} status={item.status}/></div>
    <h3 className="font-semibold">{item.name}</h3><p className="mt-1 text-xs text-slate-500">{item.provider} · {item.host}</p><p className="mt-3 text-sm leading-relaxed text-slate-700">{item.assignment}</p>
    <dl className="mt-4 space-y-2 border-t pt-3 text-xs"><div className="flex justify-between gap-2"><dt className="text-slate-500">Connection</dt><dd className="capitalize">{item.connection}</dd></div><div className="flex justify-between gap-2"><dt className="text-slate-500">Last check-in</dt><dd className="text-right">{when(item.updated_at)}</dd></div>{item.data_updated_at&&<div className="flex justify-between gap-2"><dt className="text-slate-500">Source captured</dt><dd className="text-right">{when(item.data_updated_at)}</dd></div>}</dl>
    <details className="mt-3 text-xs leading-relaxed text-slate-600"><summary className="min-h-8 cursor-pointer font-medium">Available actions & connection details</summary><p>{item.allowed_actions.join(" · ")}</p><p className="mt-2">{item.evidence}</p></details>
    {item.url&&<Link to={item.url} className="mt-auto flex min-h-11 items-center gap-2 pt-3 text-sm font-medium text-[#2A5EA8]">Open workspace<ArrowUpRight className="h-4 w-4"/></Link>}
   </article>)}</div>
  </section>
  <div className="grid items-start gap-5 lg:grid-cols-2">
   <section className="min-w-0 rounded-2xl border border-[#DDE3EC] bg-white p-5 sm:p-6"><h2 className="flex items-center gap-2 text-lg font-semibold"><FileText className="h-5 w-5 text-[#2A5EA8]"/>Private requests & notes</h2><p className="mt-2 text-sm leading-relaxed text-slate-600">Save an entry for your own review. Sending instructions to another workspace will require a connected dispatch API.</p>
    <form className="mt-5 space-y-4" onSubmit={save}><label className="block text-sm font-medium">Workspace<select className={control} value={target} disabled={saving||!data} onChange={e=>change(setTarget,e.target.value)}>{inventory.map(a=><option key={a.id} value={a.id}>{a.name}</option>)}</select></label>
     <label className="block text-sm font-medium">Entry type<select className={control} value={kind} disabled={saving} onChange={e=>change(setKind,e.target.value)}>{Object.entries(labels).map(([value,label])=><option key={value} value={value}>{label}</option>)}</select></label>
     <label className="block text-sm font-medium">Title<input className={control} value={title} maxLength={160} required disabled={saving} onChange={e=>change(setTitle,e.target.value)} placeholder="What needs attention?"/></label>
     <label className="block text-sm font-medium">Details<textarea className={control+" min-h-36 resize-y"} value={body} maxLength={5000} required disabled={saving} onChange={e=>change(setBody,e.target.value)} placeholder="Add the request, context, or a result you verified."/></label>
     {selected?.connection==="manual"&&<p className="text-xs text-slate-500">This workspace has no live connection. Entries stay here for manual follow-up.</p>}
     <button disabled={saving||!data||!title.trim()||!body.trim()} className="min-h-11 w-full rounded-xl bg-[#2A5EA8] px-4 py-3 text-sm font-medium text-white disabled:opacity-50">{saving?"Saving…":kind==="request"?"Save request for review":"Save private entry"}</button>
     {notice&&<p role="status" className="rounded-xl bg-green-50 p-3 text-sm text-green-800">{notice}</p>}
    </form>
   </section>
   <section className="min-w-0 rounded-2xl border border-[#DDE3EC] bg-white p-5 sm:p-6"><h2 className="flex items-center gap-2 text-lg font-semibold"><Clock3 className="h-5 w-5 text-[#2A5EA8]"/>Activity & recorded results</h2><p className="mt-2 text-sm leading-relaxed text-slate-600">A private history of saved entries. Results here are owner records; automated execution is not connected.</p>
    {!entries.length&&<div className="mt-5 rounded-xl border border-dashed p-6 text-center text-sm text-slate-500">Your saved requests, notes and results will appear here.</div>}
    <ol className="mt-5 space-y-3">{entries.map(entry=><li key={entry.id} className="rounded-xl border bg-slate-50 p-4"><div className="flex flex-wrap justify-between gap-2 text-xs text-slate-500"><span>{labels[entry.kind]} · {inventory.find(a=>a.id===entry.target_id)?.name||"Registered workspace"}</span><time>{when(entry.recorded_at)}</time></div><h3 className="mt-2 break-words font-medium">{entry.title}</h3><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-slate-600">{entry.body}</p><p className="mt-3 text-xs text-slate-500">{entry.kind==="request"?"Saved for manual review · not dispatched":entry.kind==="result"?"Result recorded by owner":"Private owner note"}</p></li>)}</ol>
    {data?.has_more_entries&&<p className="mt-3 text-xs text-slate-500">Showing the latest 100 entries. Earlier entries remain stored.</p>}
   </section>
  </div>
 </div>;
}
