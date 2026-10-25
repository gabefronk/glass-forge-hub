import PersonalJobPicker from "@/components/PersonalJobPicker";
import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {Plus,RefreshCw,Users,X,Search,Sun,Inbox,CalendarDays,Hourglass,ListTodo,Check,ChevronRight} from 'lucide-react';
import {base44} from '@/api/base44Client';
import {useAuth} from '@/lib/AuthContext';
import {PageShell} from '@/components/PageShell';
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
 const emptyText={today:'Your day is clear. Tap the sun on any task to add it here.',inbox:'Nothing waiting to be planned. Add a task above.',upcoming:'Nothing scheduled ahead.',waiting:'Nothing waiting on someone else.',all:'No open tasks. Capture a loose end above.'};
 const VIEW_META={today:{label:'My Day',Icon:Sun},inbox:{label:'Tasks',Icon:Inbox},upcoming:{label:'Planned',Icon:CalendarDays},waiting:{label:'Waiting',Icon:Hourglass},all:{label:'All',Icon:ListTodo}};
 const heading=person==='all'?'Team tasks':view==='today'?'My Day':VIEW_META[view].label;
 const longDate=new Date(today+'T12:00:00Z').toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',timeZone:'UTC'});
 const whoLine=person==='all'?'Everyone':person!=='mine'&&shownMember?shownMember.display_name:firstName?`Hi ${firstName}`:'';
 // Microsoft To Do-style page (Oct 24): a plain header, one scrolling row of lists, an
 // "Add a task" row, round check circles, a sun button to move a task into My Day and a
 // Completed section. Same records, same actions and the same details dialog as before.
 return <PageShell width="max-w-[880px]" className="space-y-4">
  <header className="flex items-end justify-between gap-3 pt-1">
   <div className="min-w-0">
    <h1 className="m-0 text-[30px] font-bold leading-tight tracking-[-0.03em] text-[#101617] max-[699px]:text-[26px]">{heading}</h1>
    <p className="m-0 mt-0.5 text-[14px] text-[#566063]">{longDate}{whoLine?` · ${whoLine}`:''}</p>
   </div>
   <button type="button" className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-[#34403f] hover:bg-black/5 disabled:opacity-50" disabled={busy||loading} onClick={()=>refresh()} aria-label="Refresh tasks" title="Refresh"><RefreshCw className={'h-[18px] w-[18px] '+(loading?'animate-spin':'')}/></button>
  </header>
  <nav aria-label="Task lists" className="-mx-1 flex gap-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">{PERSONAL_VIEWS.map(key=>{const {label,Icon}=VIEW_META[key],on=view===key;return <button key={key} type="button" aria-pressed={on} onClick={()=>setView(key)} className={'inline-flex h-10 shrink-0 items-center gap-2 rounded-full px-3.5 text-[14px] font-medium transition-colors '+(on?'bg-[#0B3F3B] text-white':'bg-white/70 text-[#34403f] hover:bg-white')}><Icon className="h-4 w-4" aria-hidden="true"/>{label}<span className={'tabular-nums text-[13px] '+(on?'text-white/80':'text-[#566063]')}>{views[key].length}</span></button>;})}</nav>
  {error&&<p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-900">{error}</p>}
  {notice&&<p role="status" className="rounded-xl bg-[#e2eeeb] px-3 py-2.5 text-sm text-[#082f2c]">{notice}</p>}
  {loading&&!data&&<p role="status" className="p-8 text-center text-[#566063]">Loading your day…</p>}
  {data&&<>
   {data.truncated&&<p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">The task limit was reached. Some tasks may not be shown in this view.</p>}
   <form onSubmit={quickAdd} className="flex min-h-[56px] items-center gap-3 rounded-xl bg-white px-4 shadow-[0_1px_2px_rgba(21,24,26,.06)] focus-within:ring-2 focus-within:ring-[#10524c]">
    <Plus className="h-5 w-5 shrink-0 text-[#0B3F3B]" aria-hidden="true"/>
    <label htmlFor="today-capture" className="sr-only">Add a task</label>
    <input id="today-capture" className="min-h-[52px] min-w-0 flex-1 bg-transparent text-base text-[#101617] outline-none placeholder:text-[#0B3F3B]/80" placeholder={person!=='mine'&&shownMember?`Add a task for ${shownMember.display_name}`:view==='today'?'Add a task to My Day':'Add a task'} maxLength={200} value={capture} disabled={busy||!canAdd} onChange={e=>{setCapture(e.target.value);createKey.current=crypto.randomUUID();}}/>
    {capture.trim()&&<button className="h-9 shrink-0 rounded-lg bg-[#0B3F3B] px-3.5 text-sm font-semibold text-white disabled:opacity-50" disabled={busy||!canAdd}>Add</button>}
   </form>
   <div className="flex items-center gap-2">
    <label className="relative min-w-0 flex-1"><span className="sr-only">Search tasks</span><Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#616a6d]"/><input type="search" value={query} onChange={e=>setQuery(e.target.value)} className="h-10 w-full rounded-lg bg-white/70 pl-9 pr-3 text-sm text-[#101617] outline-none placeholder:text-[#616a6d] focus:bg-white focus:ring-2 focus:ring-[#10524c]" placeholder="Search"/></label>
    <label className="shrink-0"><span className="sr-only">Filter category</span><select className="h-10 max-w-[170px] rounded-lg bg-white/70 px-2.5 text-sm text-[#34403f] outline-none focus:ring-2 focus:ring-[#10524c]" value={category} onChange={e=>setCategory(e.target.value)}><option value="">All categories</option>{BOARD_LANES.map(l=><option key={l.key} value={l.key}>{l.label}</option>)}</select></label>
   </div>
   <ul className="flex flex-col gap-1" aria-label={heading}>{visible.map(t=>{const overdue=dueState(t,today)==='overdue',inDay=isForToday(t,today);return <li key={t.id} className="group flex items-center gap-1 rounded-xl bg-white pr-1.5 shadow-[0_1px_2px_rgba(21,24,26,.06)] hover:bg-[#fdfcf9]">
    <button type="button" disabled={busy} onClick={()=>setStatus(t,'done')} aria-label={'Mark '+t.title+' done'} className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full disabled:opacity-50"><span className="flex h-[22px] w-[22px] items-center justify-center rounded-full border-2 border-[#8c9eaf] text-transparent transition-colors group-hover:border-[#0B3F3B] hover:text-[#0B3F3B]"><Check className="h-3.5 w-3.5" strokeWidth={3}/></span></button>
    <button type="button" className="min-h-[52px] min-w-0 flex-1 py-2.5 text-left" onClick={()=>openTask(t)}>
     <span className="block break-words text-[15px] leading-snug text-[#101617]">{t.title}</span>
     {((inDay&&view!=='today')||t.due_date||isWaiting(t)||(!isWaiting(t)&&t.focus_date&&view!=='today')||t.category||person==='all'||t.job_id)&&<span className="mt-0.5 flex flex-wrap items-center gap-x-2.5 gap-y-0.5 text-[12.5px] text-[#566063]">
      {inDay&&view!=='today'&&<span className="inline-flex items-center gap-1"><Sun className="h-3 w-3"/>My Day</span>}
      {t.due_date&&<span className={'inline-flex items-center gap-1 '+(overdue?'font-semibold text-[#a43432]':'')}><CalendarDays className="h-3 w-3"/>{dueText(t,today)}</span>}
      {isWaiting(t)&&<span className="inline-flex items-center gap-1 text-[#6f4e10]"><Hourglass className="h-3 w-3"/>{t.waiting_on}{t.follow_up_date?` · ${shortDate(t.follow_up_date)}`:''}</span>}
      {!isWaiting(t)&&t.focus_date&&view!=='today'&&!inDay&&<span>Planned {shortDate(t.focus_date)}</span>}
      {t.category&&<span>{laneLabel(laneKey(t))}</span>}
      {person==='all'&&<span>{nameOf(t)}</span>}
      {t.job_id&&<span className="min-w-0 truncate">{jobName(jobs.find(j=>j.id===t.job_id)||{})}</span>}
     </span>}
    </button>
    {!inDay&&!isWaiting(t)&&<button type="button" disabled={busy} onClick={()=>focusToday(t)} aria-label={'Add '+t.title+' to My Day'} title="Add to My Day" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[#616a6d] hover:bg-[#faf0da] hover:text-[#6f4e10] disabled:opacity-50"><Sun className="h-[18px] w-[18px]"/></button>}
   </li>;})}</ul>
   {!visible.length&&<div className="flex flex-col items-center gap-2 rounded-xl bg-white/60 px-6 py-10 text-center"><Sun className="h-8 w-8 text-[#b8955a]" aria-hidden="true"/><p className="m-0 text-[15px] font-semibold text-[#101617]">{query||category?'No tasks match':view==='today'?'Focus on your day':'All clear'}</p><p className="m-0 max-w-[340px] text-sm text-[#566063]">{query||category?'Try another search or category.':emptyText[view]}</p></div>}
   {recentDone.length>0&&<details className="group/done">
    <summary className="inline-flex min-h-10 cursor-pointer list-none items-center gap-2 rounded-lg bg-white/70 px-3 text-sm font-semibold text-[#34403f] hover:bg-white [&::-webkit-details-marker]:hidden"><ChevronRight className="h-4 w-4 transition-transform group-open/done:rotate-90"/>Completed<span className="font-normal text-[#566063]">{recentDone.length}</span></summary>
    <ul className="mt-1 flex flex-col gap-1">{recentDone.map(t=><li key={t.id} className="flex items-center gap-1 rounded-xl bg-white/80 pr-2">
     <button type="button" disabled={busy} onClick={()=>setStatus(t,'open')} aria-label={'Reopen '+t.title} title="Reopen" className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full disabled:opacity-50"><span className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-[#0B3F3B] text-white"><Check className="h-3.5 w-3.5" strokeWidth={3}/></span></button>
     <button type="button" className="min-h-12 min-w-0 flex-1 py-2 text-left" onClick={()=>openTask(t)}><span className="block break-words text-[15px] text-[#616a6d] line-through">{t.title}</span>{t.completed_at&&<span className="block text-[12px] text-[#616a6d]">Completed {fmt(t.completed_at)}</span>}</button>
    </li>)}</ul>
   </details>}
   {person==='mine'&&context}
   {owner&&<details className="rounded-xl bg-white/70 p-4"><summary className="min-h-8 cursor-pointer text-sm font-medium text-[#34403f]">Team settings</summary><div className="mt-3 flex flex-wrap items-end gap-3"><label className="flex-1 text-sm">View tasks for<select aria-label="Choose a person's tasks" className={field} value={person} disabled={busy} onChange={e=>changeView(e.target.value)}><option value="mine">Me — {me?.display_name}</option><option value="all">Everyone</option>{members.filter(m=>m.id!==me?.id).map(m=><option key={m.id} value={m.id}>{m.display_name}{m.active?'':' (inactive)'}</option>)}</select></label><button type="button" className={btn+' flex items-center gap-2'} disabled={busy} onClick={manage}><Users className="h-4 w-4"/>Manage team</button></div>{shownMember?.pending_account&&<p className="mt-3 text-sm text-amber-800">{shownMember.display_name} needs a verified sign-in account linked before they can access these tasks.</p>}
   {owner&&teamOpen&&<form onSubmit={saveMember} aria-label="Manage team" className="space-y-4 rounded-2xl border bg-white p-5"><h2 className="font-semibold">Team members and account links</h2><p className="text-sm text-slate-600">Link only the correct existing sign-in account. No invitation or email is sent here. A person without a linked account remains pending.</p><label className="block text-sm">Person<select className={field} value={memberForm.id} disabled={busy} onChange={e=>memberEdit(members.find(m=>m.id===e.target.value))}><option value="">Add a new person</option>{members.filter(m=>m.member_key!=='gabriel').map(m=><option key={m.id} value={m.id}>{m.display_name}</option>)}</select></label><label className="block text-sm">Display name<input className={field} required maxLength={120} disabled={busy} value={memberForm.display_name} onChange={e=>setMemberForm({...memberForm,display_name:e.target.value})}/></label><label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={memberForm.active} disabled={busy} onChange={e=>setMemberForm({...memberForm,active:e.target.checked})}/>Active and available for assignments</label><fieldset className="space-y-2"><legend className="mb-2 text-sm font-medium">Existing sign-in accounts</legend>{accounts.map(a=><label key={a.id} className="flex min-h-11 items-center gap-2 rounded-lg border p-3 text-sm"><input type="checkbox" disabled={busy||a.owner_account||Boolean(a.member_id&&a.member_id!==memberForm.id)} checked={memberForm.auth_user_ids.includes(a.id)} onChange={e=>setMemberForm({...memberForm,auth_user_ids:e.target.checked?[...memberForm.auth_user_ids,a.id]:memberForm.auth_user_ids.filter(id=>id!==a.id)})}/><span className="break-all">{a.full_name||a.email} · {a.email}{a.member_id&&a.member_id!==memberForm.id?' · already linked':''}</span></label>)}</fieldset><div className="flex flex-wrap gap-2"><button className={btn} disabled={busy}>{busy?'Saving...':'Save member'}</button><button type="button" className={btn} disabled={busy} onClick={()=>setTeamOpen(false)}>Cancel</button></div></form>}
   </details>}
  </>}
  {data&&selected&&edit&&<div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:items-center" onClick={()=>{if(!busy){setSelected(null);setEdit(null);}}}><div id="personal-task-dialog" role="dialog" aria-modal="true" aria-labelledby="task-details-title" className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-5 shadow-xl" onClick={e=>e.stopPropagation()}><form onSubmit={save} className="space-y-4"><div className="flex items-center justify-between"><h2 id="task-details-title" className="text-lg font-semibold">Task details</h2><button type="button" aria-label="Close task details" disabled={busy} className="p-2" onClick={()=>{setSelected(null);setEdit(null);}}><X className="h-4 w-4"/></button></div>
   {error&&<p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-900">{error}</p>}
   {stale&&<p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">This task changed. Close it and open the current version before saving.</p>}
   {canEditContent?<><label className="block text-sm">Title<input required maxLength={200} className={field} value={edit.title} disabled={busy||stale} onChange={e=>setEdit({...edit,title:e.target.value})}/></label><label className="block text-sm">Details<textarea rows={3} maxLength={5000} className={field} value={edit.details||''} disabled={busy||stale} onChange={e=>setEdit({...edit,details:e.target.value})}/></label></>:<><h3 className="font-semibold">{selected.title}</h3><p className="whitespace-pre-wrap break-words text-sm">{selected.details||'No additional details.'}</p></>}
   <div className="grid gap-3 sm:grid-cols-2"><label className="block text-sm">Plan for<input type="date" className={field} value={edit.focus_date||''} disabled={busy||stale} onChange={e=>setEdit({...edit,focus_date:e.target.value})}/><span className="text-xs text-slate-500">When you want to work on it.</span></label><label className="block text-sm">Deadline (optional)<input type="date" className={field} value={edit.due_date||''} disabled={busy||stale||!canEditContent} onChange={e=>setEdit({...edit,due_date:e.target.value})}/></label></div>
   <label className="block text-sm">Waiting on (optional)<input maxLength={200} className={field} placeholder="A person, delivery, or answer" value={edit.waiting_on||''} disabled={busy||stale} onChange={e=>setEdit({...edit,waiting_on:e.target.value})}/></label>{edit.waiting_on?.trim()&&<label className="block text-sm">Follow up on<input type="date" className={field} value={edit.follow_up_date||''} disabled={busy||stale} onChange={e=>setEdit({...edit,follow_up_date:e.target.value})}/><span className="text-xs text-slate-500">Returns to Today on this date. Deadlines still appear when due.</span></label>}
   {canEditContent&&<><label className="block text-sm">Category (optional)<select className={field} value={edit.category} disabled={busy||stale} onChange={e=>setEdit({...edit,category:e.target.value})}><option value="">No category</option>{BOARD_LANES.map(l=><option key={l.key} value={l.key}>{l.label}</option>)}</select></label><PersonalJobPicker value={edit.job_id||''} onChange={id=>setEdit({...edit,job_id:id})} disabled={busy||stale} existingLabel={jobs.find(j=>j.id===edit.job_id)?.canonical_name||''} /></>}
   {owner&&<label className="block text-sm">Assign to<select className={field} value={edit.assignee_member_id} disabled={busy||stale} onChange={e=>setEdit({...edit,assignee_member_id:e.target.value})}>{members.filter(m=>m.active||m.id===edit.assignee_member_id).map(m=><option key={m.id} value={m.id}>{m.display_name}{m.active?'':' (inactive)'}</option>)}</select></label>}
   <label className="block text-sm">Status<select className={field} value={edit.status} disabled={busy||stale} onChange={e=>setEdit({...edit,status:e.target.value})}>{statuses.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><label className="block text-sm">Progress note<textarea rows={2} maxLength={3000} className={field} value={edit.progress_note||''} disabled={busy||stale} onChange={e=>setEdit({...edit,progress_note:e.target.value})}/></label><div className="flex flex-wrap gap-2"><button className={btn} disabled={busy||stale}>{busy?'Saving…':'Save changes'}</button>{owner&&<button type="button" className={btn} disabled={busy||stale} onClick={()=>{if(window.confirm('Archive this task? Its record will be retained.'))mutate({action:'archive',id:selected.id,expected_revision:selected.revision},'Task archived; its record was retained.');}}>Archive task</button>}</div>
  </form></div></div>}
 </PageShell>;
}
