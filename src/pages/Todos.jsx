import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {Plus,RefreshCw,RotateCcw,Users,X,Search} from 'lucide-react';
import {base44} from '@/api/base44Client';
import {useAuth} from '@/lib/AuthContext';
import {PageShell,PageHero,heroBtn,heroSecondary} from '@/components/PageShell';
import {BOARD_LANES,daysBetween,dueState,laneKey,laneLabel} from '@/lib/todoBoard';
import {PERSONAL_VIEWS,personalTaskViews,filterPersonalTasks,isForToday,isWaiting,initialPersonalView} from '@/lib/personalToday';
import {denverDate} from '../../base44/shared/billingCore.js';

const call=async payload=>{
 const response=await base44.functions.invoke('todos',payload);
 if(response.data?.error)throw new Error(response.data.error);
 return response.data;
};
const errorText=e=>e.response?.data?.error||e.message||'The task could not be saved. Reload before retrying.';
const btn='min-h-10 rounded-xl border border-slate-300 bg-white px-4 py-2 text-sm font-medium disabled:opacity-50';
const smallBtn='inline-flex min-h-9 items-center gap-1 rounded-lg border border-slate-300 bg-white px-2.5 text-xs font-medium disabled:opacity-50';
const field='mt-1 min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm';
const statuses=[['open','Open'],['in_progress','In progress'],['done','Done']];
const initialView=()=>initialPersonalView(typeof window==='undefined'?'':window.location.search);


const fmt=v=>v?new Date(v).toLocaleString():'';
const shortDate=ymd=>ymd?new Date(ymd+'T12:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'}):'';
const dueText=(t,today)=>{const s=dueState(t,today),d=daysBetween(today,t.due_date);return s==='overdue'?`Overdue ${-d}d · ${shortDate(t.due_date)}`:s==='today'?'Due today':s==='soon'?`Due ${shortDate(t.due_date)} (${d}d)`:`Due ${shortDate(t.due_date)}`;};

export default function Todos({context=null}){
 const {user}=useAuth();
 const [rawData,setData]=useState(null),[person,setPerson]=useState('mine'),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const data=rawData?._loaded_user_id===user?.id?rawData:null;
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[capture,setCapture]=useState(''),[view,setView]=useState(initialView),[query,setQuery]=useState(''),[category,setCategory]=useState('');
 const [selected,setSelected]=useState(null),[edit,setEdit]=useState(null),[teamOpen,setTeamOpen]=useState(false),[accounts,setAccounts]=useState([]);
 const [memberForm,setMemberForm]=useState({id:'',display_name:'',active:true,auth_user_ids:[],revision:0});
 const request=useRef(0),createKey=useRef(crypto.randomUUID()),memberKey=useRef(crypto.randomUUID()),identity=useRef(user?.id);
 identity.current=user?.id;
 const today=denverDate();
 const refresh=useCallback(async({quiet=false}={})=>{
  const sequence=++request.current,uid=user?.id;
  if(!quiet)setLoading(true);
  try{
   const result=await call({action:'board',member_id:person});
   if(sequence!==request.current||uid!==identity.current)return;
   setData({...result,_loaded_user_id:uid});setError('');
  }catch(e){if(sequence===request.current&&uid===identity.current){setData(null);setError(errorText(e));}}
  finally{if(sequence===request.current&&uid===identity.current)setLoading(false);}
 },[person,user?.id]);
 useEffect(()=>{request.current++;setData(null);setSelected(null);setEdit(null);setCapture('');setView(initialView());setQuery('');setCategory('');setPerson('mine');setBusy(false);setTeamOpen(false);setAccounts([]);setMemberForm({id:'',display_name:'',active:true,auth_user_ids:[],revision:0});setNotice('');setError('');createKey.current=crypto.randomUUID();memberKey.current=crypto.randomUUID();},[user?.id]);
 useEffect(()=>{
  refresh();
  const timer=setInterval(()=>{if(!document.hidden)refresh({quiet:true});},60000);
  const focus=()=>refresh({quiet:true});window.addEventListener('focus',focus);
  return()=>{request.current++;clearInterval(timer);window.removeEventListener('focus',focus);};
 },[refresh]);
 useEffect(()=>{setSelected(null);setEdit(null);setNotice('');},[person]);
 useEffect(()=>{
  if(!selected)return;
  const previous=document.activeElement;
  const dialog=document.getElementById('personal-task-dialog');
  const focusable=()=>[...(dialog?.querySelectorAll('button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),a[href]')||[])];
  focusable()[0]?.focus();
  const onKey=e=>{
   if(e.key==='Escape'&&!busy){setSelected(null);setEdit(null);}
   if(e.key==='Tab'){const nodes=focusable(),first=nodes[0],last=nodes[nodes.length-1];if(e.shiftKey&&document.activeElement===first){e.preventDefault();last?.focus();}else if(!e.shiftKey&&document.activeElement===last){e.preventDefault();first?.focus();}}
  };
  document.addEventListener('keydown',onKey);return()=>{document.removeEventListener('keydown',onKey);previous?.focus();};
 },[selected,busy]);
 const mutate=async(payload,message)=>{
  const uid=user?.id;setBusy(true);setError('');setNotice('');
  try{
   const result=await call(payload);
   if(uid!==identity.current)return null;
   setSelected(null);setEdit(null);setNotice(message);await refresh({quiet:true});window.dispatchEvent(new Event('personal-tasks-updated'));return uid===identity.current?result:null;
  }catch(e){if(uid===identity.current){await refresh({quiet:true});if(uid===identity.current)setError(errorText(e));}return null;}
  finally{if(uid===identity.current)setBusy(false);}
 };
 const owner=data?.owner===true,members=data?.members||[],tasks=data?.tasks||[],recentDone=data?.recent_done||[],me=data?.member;
 const views=useMemo(()=>personalTaskViews(tasks,today),[tasks,today]);
 const visible=useMemo(()=>filterPersonalTasks(views[view],query,category),[views,view,query,category]);
 const shownMember=members.find(m=>m.id===(person==='mine'?me?.id:person));
 const targetMemberId=person==='all'||person==='mine'?me?.id:person;
 const canAdd=shownMember?.active!==false;
 const nameOf=t=>members.find(m=>m.id===t.assignee_member_id)?.display_name||me?.display_name||'';
 const openTask=t=>{setSelected(t);setEdit({...t,category:laneKey(t)});setNotice('');};
 const changeView=id=>{request.current++;setData(null);setLoading(true);setPerson(id);};
 const quickAdd=async e=>{e.preventDefault();if(!capture.trim())return;const result=await mutate({action:'create',title:capture.trim(),details:'',assignee_member_id:targetMemberId||'',due_date:'',category:'',request_key:createKey.current},'Added to Inbox.');if(result){setCapture('');createKey.current=crypto.randomUUID();setView('inbox');}};
 const setStatus=(t,status)=>mutate({action:'update_task',id:t.id,expected_revision:t.revision,patch:{status}},status==='done'?`Done: ${t.title}`:'Task reopened.');
 const focusToday=t=>mutate({action:'update_task',id:t.id,expected_revision:t.revision,patch:{focus_date:today}},'Added to Today.');
 const canEditContent=owner||(selected?.created_by_user_id===user?.id&&selected?.assignee_member_id===me?.id);
 const save=async e=>{e.preventDefault();if(!selected)return;const patch={status:edit.status,progress_note:edit.progress_note||'',focus_date:edit.focus_date||'',waiting_on:edit.waiting_on||'',follow_up_date:edit.waiting_on?.trim()?edit.follow_up_date||'':''};if(canEditContent)Object.assign(patch,{title:edit.title,details:edit.details||'',due_date:edit.due_date||'',category:edit.category||'',job_id:edit.job_id||''});if(owner)patch.assignee_member_id=edit.assignee_member_id;await mutate({action:'update_task',id:selected.id,expected_revision:selected.revision,patch},'Task saved.');};
 const manage=async()=>{setError('');const uid=user?.id;try{const r=await call({action:'account_options'});if(uid!==identity.current)return;setAccounts(r.accounts||[]);setTeamOpen(true);}catch(e){if(uid===identity.current)setError(errorText(e));}};
 const saveMember=async e=>{e.preventDefault();const r=await mutate({action:'manage_member',...memberForm,request_key:memberKey.current},'Team member saved.');if(r){setTeamOpen(false);setMemberForm({id:'',display_name:'',active:true,auth_user_ids:[],revision:0});memberKey.current=crypto.randomUUID();}};
 const memberEdit=m=>{setMemberForm(m?{id:m.id,display_name:m.display_name,active:m.active,auth_user_ids:[...(m.auth_user_ids||[])],revision:m.revision}:{id:'',display_name:'',active:true,auth_user_ids:[],revision:0});memberKey.current=crypto.randomUUID();};
 const current=selected&&[...tasks,...recentDone].find(t=>t.id===selected.id);
 const stale=selected&&(!current||current.revision!==selected.revision);
 const firstName=(shownMember?.display_name||me?.display_name||user?.full_name||'').split(' ')[0];
 const jobs=data?.jobs||[];
 const jobName=j=>j.canonical_name||j.job_name||j.name||j.title||'Linked job';
 const emptyText={today:'Your day is clear. Add something from Inbox when you’re ready.',inbox:'Nothing waiting to be planned. Capture a loose end above.',upcoming:'Nothing scheduled ahead.',waiting:'Nothing waiting on someone else.',all:'No open tasks. Capture a loose end above.'};
 return <PageShell width="max-w-[1200px]" className="space-y-4">
  <PageHero eyebrow="Your day, in one place" title={person==='all'?'Team tasks':firstName?`Today, ${firstName}`:'Today'} sub="Capture a loose end. Choose what matters today. Keep the rest for later."
   actions={<button type="button" className={heroBtn+' disabled:opacity-50'} style={heroSecondary} disabled={busy||loading} onClick={()=>refresh()} aria-label="Refresh Today"><RefreshCw className={'h-4 w-4 '+(loading?'animate-spin':'')}/><span>Refresh</span></button>}/>
  {error&&<p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">{error}</p>}
  {notice&&<p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</p>}
  {loading&&!data&&<p role="status" className="p-8 text-center text-slate-600">Loading your day…</p>}
  {data&&<>
   {data.truncated&&<p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">The task limit was reached. Some tasks may not be shown in this view.</p>}
   <section className="card-shadow rounded-2xl border border-[#d3cabb] bg-white p-4 sm:p-5" aria-label="Your tasks">
    <form onSubmit={quickAdd} className="flex items-center gap-2"><label htmlFor="today-capture" className="sr-only">Capture a task</label><input id="today-capture" className="min-h-12 min-w-0 flex-1 rounded-xl border border-slate-300 px-3 text-base" placeholder={person!=='mine'&&shownMember?`Add a task for ${shownMember.display_name}…`:'What do you need to remember?'} maxLength={200} value={capture} disabled={busy||!canAdd} onChange={e=>{setCapture(e.target.value);createKey.current=crypto.randomUUID();}}/><button className="inline-flex min-h-12 items-center gap-1 rounded-xl bg-[#0B3F3B] px-4 font-medium text-white disabled:opacity-50" disabled={busy||!canAdd||!capture.trim()}><Plus className="h-4 w-4"/>Add</button></form>
    <div className="mt-5 flex flex-wrap gap-1 border-b border-slate-200 pb-3" aria-label="Task views">{PERSONAL_VIEWS.map(key=><button key={key} type="button" aria-pressed={view===key} className={'min-h-10 rounded-lg px-3 text-sm font-medium '+(view===key?'bg-[#0B3F3B] text-white':'text-slate-600 hover:bg-slate-100')} onClick={()=>setView(key)}>{key[0].toUpperCase()+key.slice(1)} <span className="ml-1 opacity-75">{views[key].length}</span></button>)}</div>
    <div className="my-3 flex flex-wrap items-center gap-2"><label className="relative min-w-44 flex-1"><span className="sr-only">Search tasks</span><Search className="absolute left-3 top-3 h-4 w-4 text-slate-400"/><input type="search" value={query} onChange={e=>setQuery(e.target.value)} className="min-h-10 w-full rounded-lg border border-slate-200 pl-9 pr-3 text-sm" placeholder="Search tasks"/></label><label><span className="sr-only">Filter category</span><select className="min-h-10 rounded-lg border border-slate-200 px-2 text-sm" value={category} onChange={e=>setCategory(e.target.value)}><option value="">All categories</option>{BOARD_LANES.map(l=><option key={l.key} value={l.key}>{l.label}</option>)}</select></label></div>
    <ul className="divide-y divide-slate-100">{visible.map(t=><li key={t.id} className="flex items-start gap-3 py-3"><input type="checkbox" className="mt-2 h-5 w-5 shrink-0 accent-[#0B3F3B]" checked={false} disabled={busy} aria-label={'Mark '+t.title+' done'} onChange={()=>setStatus(t,'done')}/><button type="button" className="min-h-10 min-w-0 flex-1 text-left" onClick={()=>openTask(t)}><span className="block break-words text-sm font-semibold">{t.title}</span><span className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-500">{t.due_date&&<span className={dueState(t,today)==='overdue'?'font-semibold text-red-700':''}>{dueText(t,today)}</span>}{isWaiting(t)&&<span className="text-amber-800">Waiting on {t.waiting_on}{t.follow_up_date?` · Follow up ${shortDate(t.follow_up_date)}`:''}</span>}{!isWaiting(t)&&t.focus_date&&<span>Planned {shortDate(t.focus_date)}</span>}{t.category&&<span>{laneLabel(laneKey(t))}</span>}{person==='all'&&<span>{nameOf(t)}</span>}{t.job_id&&<span>{jobName(jobs.find(j=>j.id===t.job_id)||{})}</span>}</span></button>{!isForToday(t,today)&&!isWaiting(t)&&<button type="button" className={smallBtn+' shrink-0'} disabled={busy} onClick={()=>focusToday(t)} aria-label={'Plan '+t.title+' for today'}>Today</button>}</li>)}</ul>
    {!visible.length&&<p className="py-8 text-center text-sm text-slate-500">{query||category?'No tasks match these filters.':emptyText[view]}</p>}
   </section>
   {person==='mine'&&context}
   <details className="rounded-xl border border-[#d3cabb] bg-white p-4"><summary className="min-h-8 cursor-pointer text-sm font-medium">Recently done ({recentDone.length})</summary><ul className="mt-2 divide-y">{recentDone.map(t=><li key={t.id} className="flex items-center gap-3 py-2"><button type="button" className="min-h-10 min-w-0 flex-1 text-left text-sm" onClick={()=>openTask(t)}><span className="break-words line-through text-slate-500">{t.title}</span>{t.completed_at&&<span className="block text-xs text-slate-400">{fmt(t.completed_at)}</span>}</button><button type="button" className={smallBtn} disabled={busy} onClick={()=>setStatus(t,'open')}><RotateCcw className="h-3 w-3"/>Reopen</button></li>)}</ul>{!recentDone.length&&<p className="py-2 text-sm text-slate-500">Nothing finished recently.</p>}</details>
   {owner&&<details className="rounded-xl border border-[#d3cabb] bg-white p-4"><summary className="min-h-8 cursor-pointer text-sm font-medium">Team settings</summary><div className="mt-3 flex flex-wrap items-end gap-3"><label className="flex-1 text-sm">View tasks for<select aria-label="Choose a person's tasks" className={field} value={person} disabled={busy} onChange={e=>changeView(e.target.value)}><option value="mine">Me — {me?.display_name}</option><option value="all">Everyone</option>{members.filter(m=>m.id!==me?.id).map(m=><option key={m.id} value={m.id}>{m.display_name}{m.active?'':' (inactive)'}</option>)}</select></label><button type="button" className={btn+' flex items-center gap-2'} disabled={busy} onClick={manage}><Users className="h-4 w-4"/>Manage team</button></div>{shownMember?.pending_account&&<p className="mt-3 text-sm text-amber-800">{shownMember.display_name} needs a verified sign-in account linked before they can access these tasks.</p>}
   {owner&&teamOpen&&<form onSubmit={saveMember} aria-label="Manage team" className="space-y-4 rounded-2xl border bg-white p-5"><h2 className="font-semibold">Team members and account links</h2><p className="text-sm text-slate-600">Link only the correct existing sign-in account. No invitation or email is sent here. A person without a linked account remains pending.</p><label className="block text-sm">Person<select className={field} value={memberForm.id} disabled={busy} onChange={e=>memberEdit(members.find(m=>m.id===e.target.value))}><option value="">Add a new person</option>{members.filter(m=>m.member_key!=='gabriel').map(m=><option key={m.id} value={m.id}>{m.display_name}</option>)}</select></label><label className="block text-sm">Display name<input className={field} required maxLength={120} disabled={busy} value={memberForm.display_name} onChange={e=>setMemberForm({...memberForm,display_name:e.target.value})}/></label><label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={memberForm.active} disabled={busy} onChange={e=>setMemberForm({...memberForm,active:e.target.checked})}/>Active and available for assignments</label><fieldset className="space-y-2"><legend className="mb-2 text-sm font-medium">Existing sign-in accounts</legend>{accounts.map(a=><label key={a.id} className="flex min-h-11 items-center gap-2 rounded-lg border p-3 text-sm"><input type="checkbox" disabled={busy||a.owner_account||Boolean(a.member_id&&a.member_id!==memberForm.id)} checked={memberForm.auth_user_ids.includes(a.id)} onChange={e=>setMemberForm({...memberForm,auth_user_ids:e.target.checked?[...memberForm.auth_user_ids,a.id]:memberForm.auth_user_ids.filter(id=>id!==a.id)})}/><span className="break-all">{a.full_name||a.email} · {a.email}{a.member_id&&a.member_id!==memberForm.id?' · already linked':''}</span></label>)}</fieldset><div className="flex flex-wrap gap-2"><button className={btn} disabled={busy}>{busy?'Saving...':'Save member'}</button><button type="button" className={btn} disabled={busy} onClick={()=>setTeamOpen(false)}>Cancel</button></div></form>}
   </details>}
  </>}
  {data&&selected&&edit&&<div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:items-center" onClick={()=>{if(!busy){setSelected(null);setEdit(null);}}}><div id="personal-task-dialog" role="dialog" aria-modal="true" aria-labelledby="task-details-title" className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl" onClick={e=>e.stopPropagation()}><form onSubmit={save} className="space-y-4"><div className="flex items-center justify-between"><h2 id="task-details-title" className="text-lg font-semibold">Task details</h2><button type="button" aria-label="Close task details" disabled={busy} className="p-2" onClick={()=>{setSelected(null);setEdit(null);}}><X className="h-4 w-4"/></button></div>
   {error&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-900">{error}</p>}
   {stale&&<p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">This task changed. Close it and open the current version before saving.</p>}
   {canEditContent?<><label className="block text-sm">Title<input required maxLength={200} className={field} value={edit.title} disabled={busy||stale} onChange={e=>setEdit({...edit,title:e.target.value})}/></label><label className="block text-sm">Details<textarea rows={3} maxLength={5000} className={field} value={edit.details||''} disabled={busy||stale} onChange={e=>setEdit({...edit,details:e.target.value})}/></label></>:<><h3 className="font-semibold">{selected.title}</h3><p className="whitespace-pre-wrap break-words text-sm">{selected.details||'No additional details.'}</p></>}
   <div className="grid gap-3 sm:grid-cols-2"><label className="block text-sm">Plan for<input type="date" className={field} value={edit.focus_date||''} disabled={busy||stale} onChange={e=>setEdit({...edit,focus_date:e.target.value})}/><span className="text-xs text-slate-500">When you want to work on it.</span></label><label className="block text-sm">Deadline (optional)<input type="date" className={field} value={edit.due_date||''} disabled={busy||stale||!canEditContent} onChange={e=>setEdit({...edit,due_date:e.target.value})}/></label></div>
   <label className="block text-sm">Waiting on (optional)<input maxLength={200} className={field} placeholder="A person, delivery, or answer" value={edit.waiting_on||''} disabled={busy||stale} onChange={e=>setEdit({...edit,waiting_on:e.target.value})}/></label>{edit.waiting_on?.trim()&&<label className="block text-sm">Follow up on<input type="date" className={field} value={edit.follow_up_date||''} disabled={busy||stale} onChange={e=>setEdit({...edit,follow_up_date:e.target.value})}/><span className="text-xs text-slate-500">Returns to Today on this date. Deadlines still appear when due.</span></label>}
   {canEditContent&&<><label className="block text-sm">Category (optional)<select className={field} value={edit.category} disabled={busy||stale} onChange={e=>setEdit({...edit,category:e.target.value})}><option value="">No category</option>{BOARD_LANES.map(l=><option key={l.key} value={l.key}>{l.label}</option>)}</select></label><label className="block text-sm">Job (optional)<select className={field} value={edit.job_id||''} disabled={busy||stale} onChange={e=>setEdit({...edit,job_id:e.target.value})}><option value="">No linked job</option>{edit.job_id&&!jobs.some(j=>j.id===edit.job_id)&&<option value={edit.job_id}>Existing linked job</option>}{jobs.map(j=><option key={j.id} value={j.id}>{jobName(j)}</option>)}</select>{data.jobs_truncated&&<span className="text-xs text-amber-800">Only the first available jobs are listed. Existing links are kept.</span>}</label></>}
   {owner&&<label className="block text-sm">Assign to<select className={field} value={edit.assignee_member_id} disabled={busy||stale} onChange={e=>setEdit({...edit,assignee_member_id:e.target.value})}>{members.filter(m=>m.active||m.id===edit.assignee_member_id).map(m=><option key={m.id} value={m.id}>{m.display_name}{m.active?'':' (inactive)'}</option>)}</select></label>}
   <label className="block text-sm">Status<select className={field} value={edit.status} disabled={busy||stale} onChange={e=>setEdit({...edit,status:e.target.value})}>{statuses.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><label className="block text-sm">Progress note<textarea rows={2} maxLength={3000} className={field} value={edit.progress_note||''} disabled={busy||stale} onChange={e=>setEdit({...edit,progress_note:e.target.value})}/></label><div className="flex flex-wrap gap-2"><button className={btn} disabled={busy||stale}>{busy?'Saving…':'Save changes'}</button>{owner&&<button type="button" className={btn} disabled={busy||stale} onClick={()=>{if(window.confirm('Archive this task? Its record will be retained.'))mutate({action:'archive',id:selected.id,expected_revision:selected.revision},'Task archived; its record was retained.');}}>Archive task</button>}</div>
  </form></div></div>}
 </PageShell>;
}
