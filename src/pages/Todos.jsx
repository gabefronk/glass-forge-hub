import {useCallback,useEffect,useRef,useState} from 'react';
import {CheckSquare,Plus,RefreshCw,Users,ArrowLeft} from 'lucide-react';
import {base44} from '@/api/base44Client';
import {useAuth} from '@/lib/AuthContext';

const call=async payload=>{
 const response=await base44.functions.invoke('todos',payload);
 if(response.data?.error)throw new Error(response.data.error);
 return response.data;
};
const errorText=e=>e.response?.data?.error||e.message||'The task could not be saved. Reload before retrying.';
const btn='min-h-11 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium disabled:opacity-50';
const field='mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm';
const statuses=[['open','Open'],['in_progress','In progress'],['done','Done']];
const emptyTask=id=>({title:'',details:'',assignee_member_id:id||'',due_date:''});
const fmt=v=>v?new Date(v).toLocaleString():'';

export default function Todos(){
 const {user}=useAuth();
 const [data,setData]=useState(null),[person,setPerson]=useState('mine'),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[creating,setCreating]=useState(false),[form,setForm]=useState(emptyTask(''));
 const [selected,setSelected]=useState(null),[edit,setEdit]=useState(null),[teamOpen,setTeamOpen]=useState(false),[accounts,setAccounts]=useState([]);
 const [memberForm,setMemberForm]=useState({id:'',display_name:'',active:true,auth_user_ids:[],revision:0});
 const [offset,setOffset]=useState(0);
 const request=useRef(0),createKey=useRef(crypto.randomUUID()),memberKey=useRef(crypto.randomUUID()),identity=useRef(user?.id);
 identity.current=user?.id;
 const refresh=useCallback(async({quiet=false}={})=>{
  const sequence=++request.current,uid=user?.id;
  if(!quiet)setLoading(true);
  try{
   const result=await call({action:'list',member_id:person,offset});
   if(sequence!==request.current||uid!==identity.current)return;
   setData(result);setError('');
  }catch(e){if(sequence===request.current&&uid===identity.current){setData(null);setError(errorText(e));}}
  finally{if(sequence===request.current&&uid===identity.current)setLoading(false);}
 },[person,offset,user?.id]);
 useEffect(()=>{request.current++;setData(null);setSelected(null);setEdit(null);setCreating(false);setTeamOpen(false);setAccounts([]);setNotice('');},[user?.id]);
 useEffect(()=>{
  refresh();
  const timer=setInterval(()=>{if(!document.hidden)refresh({quiet:true});},20000);
  const focus=()=>refresh({quiet:true});window.addEventListener('focus',focus);
  return()=>{request.current++;clearInterval(timer);window.removeEventListener('focus',focus);};
 },[refresh]);
 useEffect(()=>{setSelected(null);setEdit(null);setNotice('');},[person,offset]);
 const mutate=async(payload,message)=>{
  const uid=user?.id;setBusy(true);setError('');setNotice('');
  try{
   const result=await call(payload);
   if(uid!==identity.current)return null;
   setSelected(null);setEdit(null);setNotice(message);await refresh();return result;
  }catch(e){if(uid===identity.current){setSelected(null);setEdit(null);await refresh();setError(errorText(e));}return null;}
  finally{if(uid===identity.current)setBusy(false);}
 };
 const owner=data?.owner===true,members=data?.members||[],tasks=data?.tasks||[],me=data?.member;
 const shownMember=members.find(m=>m.id===(person==='mine'?me?.id:person));
 const openTask=t=>{setSelected(t);setEdit({...t});setNotice('');};
 const changeView=id=>{request.current++;setData(null);setLoading(true);setPerson(id);setOffset(0);setCreating(false);};
 const add=()=>{setForm(emptyTask(person==='all'||person==='mine'?me?.id:person));createKey.current=crypto.randomUUID();setCreating(true);setSelected(null);setEdit(null);};
 const create=async e=>{e.preventDefault();const saved=await mutate({action:'create',...form,request_key:createKey.current},'Task created.');if(saved){setCreating(false);createKey.current=crypto.randomUUID();}};
 const save=async e=>{e.preventDefault();if(!selected)return;const patch=owner?{title:edit.title,details:edit.details,due_date:edit.due_date,assignee_member_id:edit.assignee_member_id,status:edit.status,progress_note:edit.progress_note}:{status:edit.status,progress_note:edit.progress_note};await mutate({action:'update_task',id:selected.id,expected_revision:selected.revision,patch},'Task saved.');};
 const manage=async()=>{setError('');try{const r=await call({action:'account_options'});setAccounts(r.accounts||[]);setTeamOpen(true);}catch(e){setError(errorText(e));}};
 const saveMember=async e=>{e.preventDefault();const r=await mutate({action:'manage_member',...memberForm,request_key:memberKey.current},'Team member saved.');if(r){setTeamOpen(false);setMemberForm({id:'',display_name:'',active:true,auth_user_ids:[],revision:0});memberKey.current=crypto.randomUUID();}};
 const memberEdit=m=>{setMemberForm(m?{id:m.id,display_name:m.display_name,active:m.active,auth_user_ids:[...(m.auth_user_ids||[])],revision:m.revision}:{id:'',display_name:'',active:true,auth_user_ids:[],revision:0});memberKey.current=crypto.randomUUID();};
 const current=selected&&tasks.find(t=>t.id===selected.id);
 const stale=selected&&(!current||current.revision!==selected.revision);
 return <div className="mx-auto max-w-6xl space-y-5 p-4 pb-32 sm:p-6" style={{color:'var(--gf-ink)'}}>
  <header className="rounded-2xl p-5 text-white sm:p-6" style={{backgroundColor:'var(--gf-sidebar-top)'}}>
   <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs uppercase tracking-widest text-slate-300">Your work, one step at a time</p><h1 className="mt-2 flex items-center gap-2 text-2xl font-semibold"><CheckSquare className="h-6 w-6"/>To-do</h1><p className="mt-2 text-sm text-slate-300">{owner?'Your list and a clear view of the whole team.':'Your assigned tasks and progress.'}</p></div><button type="button" className={btn+' flex items-center gap-2 text-slate-800'} disabled={busy||loading} onClick={()=>refresh()}><RefreshCw className={'h-4 w-4 '+(loading?'animate-spin':'')}/>Refresh</button></div>
  </header>
  {error&&<p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">{error}</p>}
  {notice&&<p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</p>}
  {loading&&!data&&<p role="status" className="p-8 text-center text-slate-600">Loading your tasks...</p>}
  {data&&<>
   <section className="flex flex-wrap items-end justify-between gap-3 rounded-2xl border bg-white p-4">
    {owner?<label className="min-w-48 text-sm font-medium">List<select aria-label="Choose a person's task list" className={field} value={person} disabled={busy} onChange={e=>changeView(e.target.value)}><option value="mine">My list - {me?.display_name}</option><option value="all">Everyone</option>{members.filter(m=>m.id!==me?.id).map(m=><option key={m.id} value={m.id}>{m.display_name}{m.active?'':' (inactive)'}{m.pending_account?' - account pending':''}</option>)}</select></label>:<h2 className="text-lg font-semibold">{me?.display_name}&apos;s list</h2>}
    <div className="flex flex-wrap gap-2">{owner&&<button type="button" className={btn+' flex items-center gap-2'} disabled={busy} onClick={manage}><Users className="h-4 w-4"/>Team</button>}<button type="button" className={btn+' flex items-center gap-2'} disabled={busy||shownMember?.active===false} onClick={add}><Plus className="h-4 w-4"/>Add task</button></div>
   </section>
   {person==='all'&&owner&&<section aria-label="Team progress" className="grid gap-3 sm:grid-cols-3">{(data.team_summary||[]).map(m=><button type="button" key={m.id} className="rounded-xl border bg-white p-4 text-left" onClick={()=>changeView(m.id)}><h2 className="font-semibold">{m.display_name}</h2><p className="mt-2 text-sm">{m.counts.open} open · {m.counts.in_progress} in progress · {m.counts.done} done</p><p className="mt-1 text-xs text-slate-500">{m.counts.done} of {m.counts.total} complete{m.pending_account?' · Account link pending':''}{m.active?'':' · Inactive'}</p></button>)}</section>}
   {shownMember?.pending_account&&<p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{shownMember.display_name}&apos;s list is ready for assignments. Only Gabriel can access it until a verified sign-in account is linked.</p>}
   {creating&&<form onSubmit={create} className="space-y-4 rounded-2xl border bg-white p-5" aria-label="New task"><h2 className="font-semibold">New task</h2><label className="block text-sm">Title<input autoFocus required maxLength={200} className={field} value={form.title} disabled={busy} onChange={e=>{setForm({...form,title:e.target.value});createKey.current=crypto.randomUUID();}}/></label><label className="block text-sm">Instructions<textarea maxLength={5000} rows={4} className={field} value={form.details} disabled={busy} onChange={e=>{setForm({...form,details:e.target.value});createKey.current=crypto.randomUUID();}}/></label>{owner&&<label className="block text-sm">Assign to<select className={field} value={form.assignee_member_id} required disabled={busy} onChange={e=>{setForm({...form,assignee_member_id:e.target.value});createKey.current=crypto.randomUUID();}}>{members.filter(m=>m.active).map(m=><option key={m.id} value={m.id}>{m.display_name}{m.pending_account?' - account pending':''}</option>)}</select></label>}<label className="block max-w-xs text-sm">Due date (optional)<input type="date" className={field} value={form.due_date} disabled={busy} onChange={e=>{setForm({...form,due_date:e.target.value});createKey.current=crypto.randomUUID();}}/></label><div className="flex gap-2"><button className={btn} disabled={busy||!form.title.trim()}>{busy?'Saving...':'Create task'}</button><button type="button" className={btn} disabled={busy} onClick={()=>setCreating(false)}>Cancel</button></div></form>}
   {selected&&edit&&<form onSubmit={save} className="space-y-4 rounded-2xl border bg-white p-5" aria-label="Task details"><button type="button" className="flex min-h-11 items-center gap-2 text-sm" onClick={()=>{setSelected(null);setEdit(null);}}><ArrowLeft className="h-4 w-4"/>Back to list</button>{stale&&<p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">This task changed or moved to another list. Close it and open the current version before saving.</p>}
    {owner?<><label className="block text-sm">Title<input required maxLength={200} className={field} value={edit.title} disabled={busy||stale} onChange={e=>setEdit({...edit,title:e.target.value})}/></label><label className="block text-sm">Instructions<textarea rows={5} maxLength={5000} className={field} value={edit.details||''} disabled={busy||stale} onChange={e=>setEdit({...edit,details:e.target.value})}/></label><label className="block text-sm">Assign to<select className={field} value={edit.assignee_member_id} disabled={busy||stale} onChange={e=>setEdit({...edit,assignee_member_id:e.target.value})}>{members.filter(m=>m.active||m.id===edit.assignee_member_id).map(m=><option key={m.id} value={m.id}>{m.display_name}{m.pending_account?' - account pending':''}{m.active?'':' - inactive'}</option>)}</select></label><label className="block max-w-xs text-sm">Due date<input type="date" className={field} value={edit.due_date||''} disabled={busy||stale} onChange={e=>setEdit({...edit,due_date:e.target.value})}/></label></>:<><h2 className="text-lg font-semibold">{selected.title}</h2><p className="whitespace-pre-wrap break-words text-sm">{selected.details||'No additional instructions.'}</p>{selected.due_date&&<p className="text-sm">Due {selected.due_date}</p>}</>}
    <label className="block text-sm">Status<select className={field} value={edit.status} disabled={busy||stale} onChange={e=>setEdit({...edit,status:e.target.value})}>{statuses.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><label className="block text-sm">Progress note<textarea rows={3} maxLength={3000} className={field} value={edit.progress_note||''} disabled={busy||stale} onChange={e=>setEdit({...edit,progress_note:e.target.value})}/></label>{selected.completed_at&&<p className="text-xs text-slate-500">Completed {fmt(selected.completed_at)}</p>}<div className="flex flex-wrap gap-2"><button className={btn} disabled={busy||stale}>{busy?'Saving...':'Save changes'}</button>{owner&&<button type="button" className={btn} disabled={busy||stale} onClick={()=>{if(window.confirm('Archive this task? It will leave the active list, but its record will be retained.'))mutate({action:'archive',id:selected.id,expected_revision:selected.revision},'Task archived; its record was retained.');}}>Archive task</button>}</div>
   </form>}
   <section aria-label="Task totals" className="flex flex-wrap gap-3">{statuses.map(([key,label])=><span className="rounded-full border bg-white px-4 py-2 text-sm" key={key}>{label}: {data.counts?.[key]||0}</span>)}</section>
   {statuses.map(([key,label])=>{const items=tasks.filter(t=>t.status===key),content=<div className="mt-3 space-y-2">{items.length?items.map(t=><article key={t.id} className="rounded-xl border border-slate-200 bg-white p-4"><div className="flex flex-wrap items-start justify-between gap-3"><button type="button" className="min-w-0 flex-1 text-left" onClick={()=>openTask(t)}><h3 className="break-words font-medium">{t.title}</h3><p className="mt-1 text-xs text-slate-500">{members.find(m=>m.id===t.assignee_member_id)?.display_name||me?.display_name}{t.due_date?' · Due '+t.due_date:''}</p>{t.progress_note&&<p className="mt-2 whitespace-pre-wrap break-words text-sm text-slate-600">{t.progress_note}</p>}</button><select aria-label={'Status for '+t.title} className="min-h-11 rounded-lg border bg-white px-3 text-sm" value={t.status} disabled={busy} onChange={e=>mutate({action:'update_task',id:t.id,expected_revision:t.revision,patch:{status:e.target.value}},'Status saved.')}>{statuses.map(([s,l])=><option key={s} value={s}>{l}</option>)}</select></div></article>):<p className="rounded-xl border border-dashed p-4 text-sm text-slate-500">No {label.toLowerCase()} tasks on this page.</p>}</div>;return key==='done'?<details key={key} className="rounded-2xl bg-slate-50 p-4"><summary className="min-h-8 cursor-pointer font-semibold">Done ({data.counts?.done||0})</summary>{content}</details>:<section key={key}><h2 className="text-lg font-semibold">{label}</h2>{content}</section>;})}
   {(offset>0||data.has_more)&&<nav aria-label="Task pages" className="flex justify-between gap-3"><button className={btn} disabled={busy||offset===0} onClick={()=>setOffset(Math.max(0,offset-100))}>Previous</button><p className="py-3 text-xs">Showing {offset+1}-{offset+tasks.length} of {data.counts?.total||0}</p><button className={btn} disabled={busy||!data.has_more} onClick={()=>setOffset(offset+100)}>Next</button></nav>}
   {owner&&teamOpen&&<form onSubmit={saveMember} aria-label="Manage team" className="space-y-4 rounded-2xl border bg-white p-5"><h2 className="font-semibold">Team members and account links</h2><p className="text-sm text-slate-600">Link only the correct existing sign-in account. No invitation or email is sent here. A person without a linked account remains pending.</p><label className="block text-sm">Person<select className={field} value={memberForm.id} disabled={busy} onChange={e=>memberEdit(members.find(m=>m.id===e.target.value))}><option value="">Add a new person</option>{members.filter(m=>m.member_key!=='gabriel').map(m=><option key={m.id} value={m.id}>{m.display_name}</option>)}</select></label><label className="block text-sm">Display name<input className={field} required maxLength={120} disabled={busy} value={memberForm.display_name} onChange={e=>setMemberForm({...memberForm,display_name:e.target.value})}/></label><label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={memberForm.active} disabled={busy} onChange={e=>setMemberForm({...memberForm,active:e.target.checked})}/>Active and available for assignments</label><fieldset className="space-y-2"><legend className="mb-2 text-sm font-medium">Existing sign-in accounts</legend>{accounts.map(a=><label key={a.id} className="flex min-h-11 items-center gap-2 rounded-lg border p-3 text-sm"><input type="checkbox" disabled={busy||a.owner_account||Boolean(a.member_id&&a.member_id!==memberForm.id)} checked={memberForm.auth_user_ids.includes(a.id)} onChange={e=>setMemberForm({...memberForm,auth_user_ids:e.target.checked?[...memberForm.auth_user_ids,a.id]:memberForm.auth_user_ids.filter(id=>id!==a.id)})}/><span className="break-all">{a.full_name||a.email} · {a.email}{a.member_id&&a.member_id!==memberForm.id?' · already linked':''}</span></label>)}</fieldset><div className="flex flex-wrap gap-2"><button className={btn} disabled={busy}>{busy?'Saving...':'Save member'}</button><button type="button" className={btn} disabled={busy} onClick={()=>setTeamOpen(false)}>Cancel</button></div></form>}
   <p className="text-xs text-slate-500">Tasks are internal records. Status changes do not send messages, change appointments, configure computers, or place orders.</p>
  </>}
 </div>;
}
