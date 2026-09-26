import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {AlertTriangle,CalendarClock,Check,CheckSquare,Clock,Hourglass,Play,Plus,RefreshCw,RotateCcw,Users,X} from 'lucide-react';
import {base44} from '@/api/base44Client';
import {useAuth} from '@/lib/AuthContext';
import {PageShell,PageHero,heroBtn,heroPrimary,heroSecondary} from '@/components/PageShell';
import {BOARD_LANES,UNCATEGORIZED_LANE,buildBoard,daysBetween,dueState,isStale,laneKey,laneLabel} from '@/lib/todoBoard';
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
const laneOptions=[...BOARD_LANES,UNCATEGORIZED_LANE];
const emptyTask=(id,category)=>({title:'',details:'',assignee_member_id:id||'',due_date:'',category:category||''});
const fmt=v=>v?new Date(v).toLocaleString():'';
const shortDate=ymd=>ymd?new Date(ymd+'T12:00:00Z').toLocaleDateString('en-US',{month:'short',day:'numeric',timeZone:'UTC'}):'';
const DUE_STYLE={overdue:'border-red-300 bg-red-50 text-red-800',today:'border-amber-300 bg-amber-50 text-amber-900',soon:'border-[var(--gf-border)] bg-[var(--gf-teal-050)] text-[var(--gf-teal-800)]',later:'border-slate-200 bg-slate-50 text-slate-700'};
const dueText=(t,today)=>{const s=dueState(t,today),d=daysBetween(today,t.due_date);return s==='overdue'?`Overdue ${-d}d · ${shortDate(t.due_date)}`:s==='today'?'Due today':s==='soon'?`Due ${shortDate(t.due_date)} (${d}d)`:`Due ${shortDate(t.due_date)}`;};

function Stat({icon:Icon,label,value,alert}){
 const hot=alert&&value;
 return <div className="rounded-[12px] px-3.5 py-2.5" style={hot?{backgroundColor:'rgba(224,201,148,.14)',border:'1px solid rgba(224,201,148,.35)'}:{backgroundColor:'rgba(207,227,218,.08)',border:'1px solid rgba(207,227,218,.18)'}}><div className="flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[.14em]" style={{color:hot?'#e0c994':'#9fc3b6'}}><Icon className="h-3.5 w-3.5"/>{label}</div><div className="mt-0.5 text-[22px] font-bold tabular-nums" style={{color:hot?'#e0c994':'#f2eee8',letterSpacing:'-0.02em'}}>{value}</div></div>;
}

function TaskCard({task,today,busy,assignee,showAssignee,onOpen,onStatus,onMove,onDragStart,onDragEnd}){
 const state=dueState(task,today),stale=isStale(task,today),age=daysBetween(task.created_at,today);
 return <article draggable={!busy} onDragStart={e=>onDragStart(e,task)} onDragEnd={onDragEnd} className={'rounded-xl border bg-white p-3 shadow-sm '+(state==='overdue'?'border-red-300 ring-1 ring-red-200':'border-slate-200')}>
  <button type="button" className="block w-full min-w-0 text-left" onClick={()=>onOpen(task)}>
   <div className="flex flex-wrap items-center gap-1.5">
    {task.due_date&&<span className={'rounded-full border px-2 py-0.5 text-[11px] font-semibold '+DUE_STYLE[state]}>{dueText(task,today)}</span>}
    {task.status==='in_progress'&&<span className="rounded-full border border-teal-200 bg-teal-50 px-2 py-0.5 text-[11px] font-semibold text-teal-800">In progress</span>}
    {stale&&<span className="rounded-full border border-amber-300 bg-amber-50 px-2 py-0.5 text-[11px] font-semibold text-amber-900">Waiting {age}d</span>}
   </div>
   <h4 className="mt-1.5 break-words text-sm font-semibold leading-snug">{task.title}</h4>
   {task.progress_note&&<p className="mt-1 line-clamp-2 break-words text-xs text-slate-600">{task.progress_note}</p>}
   {(showAssignee||(!stale&&age!==null&&age>=1))&&<p className="mt-1.5 text-[11px] text-slate-500">{showAssignee?assignee:''}{showAssignee&&age!==null?' · ':''}{age!==null?(age===0?'Added today':`Added ${age}d ago`):''}</p>}
  </button>
  <div className="mt-2 flex flex-wrap items-center gap-1.5 border-t border-slate-100 pt-2">
   {task.status==='open'&&<button type="button" className={smallBtn} disabled={busy} onClick={()=>onStatus(task,'in_progress')}><Play className="h-3 w-3"/>Start</button>}
   <button type="button" className={smallBtn+' border-emerald-300 text-emerald-800'} disabled={busy} onClick={()=>onStatus(task,'done')} aria-label={'Mark '+task.title+' done'}><Check className="h-3 w-3"/>Done</button>
   <label className="ml-auto text-[11px] text-slate-500"><span className="sr-only">Move {task.title} to lane</span>
    <select className="min-h-9 max-w-[9.5rem] rounded-lg border border-slate-300 bg-white px-1.5 text-xs" value={laneKey(task)} disabled={busy} onChange={e=>onMove(task,e.target.value)}>{laneOptions.filter(l=>l.key||!laneKey(task)).map(l=><option key={l.key||'none'} value={l.key}>{l.key?l.label:'Choose lane…'}</option>)}</select>
   </label>
  </div>
 </article>;
}

function Lane({lane,today,busy,canAdd,wide,memberName,showAssignee,onQuickAdd,onDropTask,cardProps}){
 const [title,setTitle]=useState(''),[over,setOver]=useState(false),key=useRef(crypto.randomUUID());
 const submit=async e=>{e.preventDefault();if(!title.trim())return;if(await onQuickAdd(lane.key,title.trim(),key.current)){setTitle('');key.current=crypto.randomUUID();}};
 return <section aria-labelledby={'lane-'+(lane.key||'none')} onDragOver={e=>{e.preventDefault();setOver(true);}} onDragLeave={()=>setOver(false)} onDrop={e=>{e.preventDefault();setOver(false);onDropTask(e,lane.key);}} className={'card-shadow flex min-w-0 flex-col rounded-[14px] border bg-white '+(over?'ring-2 ring-teal-400 ':'')+(wide?'border-red-200':'border-[#d3cabb]')} style={{borderTop:`4px solid ${lane.accent}`}}>
  <header className="px-3 pt-3">
   <div className="flex items-center justify-between gap-2"><h3 id={'lane-'+(lane.key||'none')} className="text-base font-semibold">{lane.label}</h3><span className="rounded-full bg-white px-2.5 py-0.5 text-sm font-semibold tabular-nums shadow-sm" aria-label={lane.tasks.length+' tasks'}>{lane.tasks.length}</span></div>
   <p className="mt-0.5 text-xs text-slate-500">{lane.hint}</p>
   {(lane.overdue>0||lane.dueToday>0||lane.stale>0)&&<p className="mt-1.5 flex flex-wrap gap-1.5 text-[11px] font-semibold">{lane.overdue>0&&<span className="rounded-full bg-red-600 px-2 py-0.5 text-white">{lane.overdue} overdue</span>}{lane.dueToday>0&&<span className="rounded-full bg-amber-500 px-2 py-0.5 text-white">{lane.dueToday} due today</span>}{lane.stale>0&&<span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-900">{lane.stale} waiting {'>'}1 wk</span>}</p>}
   {canAdd&&lane.key&&<form onSubmit={submit} className="mt-2 flex gap-1.5"><label className="sr-only" htmlFor={'add-'+lane.key}>Add to {lane.label}</label><input id={'add-'+lane.key} className="min-h-9 min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-2.5 text-sm" placeholder={`Add to ${lane.label}${memberName?' for '+memberName:''}…`} maxLength={200} value={title} disabled={busy} onChange={e=>{setTitle(e.target.value);key.current=crypto.randomUUID();}}/><button className={smallBtn} disabled={busy||!title.trim()} aria-label={'Add task to '+lane.label}><Plus className="h-3.5 w-3.5"/></button></form>}
  </header>
  <div className={'mt-3 flex-1 gap-2 px-3 pb-3 '+(wide?'grid sm:grid-cols-2 xl:grid-cols-4':'flex flex-col')}>
   {lane.tasks.length?lane.tasks.map(t=><TaskCard key={t.id} task={t} today={today} busy={busy} showAssignee={showAssignee} assignee={cardProps.nameOf(t)} {...cardProps}/>):<p className="rounded-xl border border-dashed border-slate-300 p-4 text-center text-xs text-slate-500">Nothing here. {canAdd&&lane.key?'Add one above or drag a card in.':''}</p>}
  </div>
 </section>;
}

export default function Todos(){
 const {user}=useAuth();
 const [data,setData]=useState(null),[person,setPerson]=useState('mine'),[error,setError]=useState(''),[notice,setNotice]=useState('');
 const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[creating,setCreating]=useState(false),[form,setForm]=useState(emptyTask('',''));
 const [selected,setSelected]=useState(null),[edit,setEdit]=useState(null),[teamOpen,setTeamOpen]=useState(false),[accounts,setAccounts]=useState([]);
 const [memberForm,setMemberForm]=useState({id:'',display_name:'',active:true,auth_user_ids:[],revision:0});
 const request=useRef(0),createKey=useRef(crypto.randomUUID()),memberKey=useRef(crypto.randomUUID()),identity=useRef(user?.id),dragged=useRef(null);
 identity.current=user?.id;
 const today=denverDate();
 const refresh=useCallback(async({quiet=false}={})=>{
  const sequence=++request.current,uid=user?.id;
  if(!quiet)setLoading(true);
  try{
   const result=await call({action:'board',member_id:person});
   if(sequence!==request.current||uid!==identity.current)return;
   setData(result);setError('');
  }catch(e){if(sequence===request.current&&uid===identity.current){setData(null);setError(errorText(e));}}
  finally{if(sequence===request.current&&uid===identity.current)setLoading(false);}
 },[person,user?.id]);
 useEffect(()=>{request.current++;setData(null);setSelected(null);setEdit(null);setCreating(false);setTeamOpen(false);setAccounts([]);setNotice('');},[user?.id]);
 useEffect(()=>{
  refresh();
  const timer=setInterval(()=>{if(!document.hidden)refresh({quiet:true});},20000);
  const focus=()=>refresh({quiet:true});window.addEventListener('focus',focus);
  return()=>{request.current++;clearInterval(timer);window.removeEventListener('focus',focus);};
 },[refresh]);
 useEffect(()=>{setSelected(null);setEdit(null);setNotice('');},[person]);
 useEffect(()=>{
  if(!creating&&!selected)return;
  const onKey=e=>{if(e.key==='Escape'&&!busy){setCreating(false);setSelected(null);setEdit(null);}};
  document.addEventListener('keydown',onKey);return()=>document.removeEventListener('keydown',onKey);
 },[creating,selected,busy]);
 const mutate=async(payload,message)=>{
  const uid=user?.id;setBusy(true);setError('');setNotice('');
  try{
   const result=await call(payload);
   if(uid!==identity.current)return null;
   setSelected(null);setEdit(null);setNotice(message);await refresh({quiet:true});return result;
  }catch(e){if(uid===identity.current){setSelected(null);setEdit(null);await refresh({quiet:true});setError(errorText(e));}return null;}
  finally{if(uid===identity.current)setBusy(false);}
 };
 const owner=data?.owner===true,members=data?.members||[],tasks=data?.tasks||[],recentDone=data?.recent_done||[],me=data?.member;
 const board=useMemo(()=>buildBoard(tasks,today),[tasks,today]);
 const shownMember=members.find(m=>m.id===(person==='mine'?me?.id:person));
 const targetMemberId=person==='all'||person==='mine'?me?.id:person;
 const canAdd=shownMember?.active!==false;
 const nameOf=t=>members.find(m=>m.id===t.assignee_member_id)?.display_name||me?.display_name||'';
 const openTask=t=>{setSelected(t);setEdit({...t,category:laneKey(t)});setNotice('');setCreating(false);};
 const changeView=id=>{request.current++;setData(null);setLoading(true);setPerson(id);setCreating(false);};
 const add=(category='')=>{setForm(emptyTask(targetMemberId,category));createKey.current=crypto.randomUUID();setCreating(true);setSelected(null);setEdit(null);};
 const create=async e=>{e.preventDefault();const saved=await mutate({action:'create',...form,request_key:createKey.current},`Task added to ${laneLabel(form.category)}.`);if(saved){setCreating(false);createKey.current=crypto.randomUUID();}};
 const quickAdd=async(category,title,key)=>Boolean(await mutate({action:'create',title,details:'',assignee_member_id:targetMemberId||'',due_date:'',category,request_key:key},`Added to ${laneLabel(category)}.`));
 const setStatus=(t,status)=>mutate({action:'update_task',id:t.id,expected_revision:t.revision,patch:{status}},status==='done'?`Done: ${t.title}`:status==='open'?'Task reopened.':'Marked in progress.');
 const move=(t,category)=>{if(category===laneKey(t))return;mutate({action:'update_task',id:t.id,expected_revision:t.revision,patch:{category}},`Moved to ${laneLabel(category)}.`);};
 const onDragStart=(e,t)=>{dragged.current=t;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('text/plain',t.id);};
 const onDragEnd=()=>{dragged.current=null;};
 // Dropping on "Needs a category" would clear a lane; the Move menu does not allow that either.
 const onDropTask=(e,category)=>{const t=dragged.current;dragged.current=null;if(t&&category&&!busy)move(t,category);};
 const save=async e=>{e.preventDefault();if(!selected)return;const patch=owner?{title:edit.title,details:edit.details,due_date:edit.due_date,assignee_member_id:edit.assignee_member_id,status:edit.status,progress_note:edit.progress_note,category:edit.category}:{status:edit.status,progress_note:edit.progress_note,category:edit.category};await mutate({action:'update_task',id:selected.id,expected_revision:selected.revision,patch},'Task saved.');};
 const manage=async()=>{setError('');try{const r=await call({action:'account_options'});setAccounts(r.accounts||[]);setTeamOpen(true);}catch(e){setError(errorText(e));}};
 const saveMember=async e=>{e.preventDefault();const r=await mutate({action:'manage_member',...memberForm,request_key:memberKey.current},'Team member saved.');if(r){setTeamOpen(false);setMemberForm({id:'',display_name:'',active:true,auth_user_ids:[],revision:0});memberKey.current=crypto.randomUUID();}};
 const memberEdit=m=>{setMemberForm(m?{id:m.id,display_name:m.display_name,active:m.active,auth_user_ids:[...(m.auth_user_ids||[])],revision:m.revision}:{id:'',display_name:'',active:true,auth_user_ids:[],revision:0});memberKey.current=crypto.randomUUID();};
 const current=selected&&[...tasks,...recentDone].find(t=>t.id===selected.id);
 const stale=selected&&(!current||current.revision!==selected.revision);
 // Most overdue = earliest due date (urgency order would put in-progress work first instead).
 const s=board.summary,firstOverdue=tasks.filter(t=>dueState(t,today)==='overdue').reduce((a,t)=>!a||String(t.due_date).slice(0,10)<String(a.due_date).slice(0,10)?t:a,null);
 const cardProps={onOpen:openTask,onStatus:setStatus,onMove:move,onDragStart,onDragEnd,nameOf};
 const showAssignee=person==='all';
 const laneProps={today,busy,canAdd,memberName:owner&&person!=='mine'&&shownMember?shownMember.display_name:'',showAssignee,onQuickAdd:quickAdd,onDropTask,cardProps};
 return <PageShell width="max-w-[1600px]" className="space-y-0" >
  <PageHero eyebrow="Nothing slips through" title="To-do board" sub={`${owner?(person==='all'?'Everyone’s open work, by lane.':`${shownMember?.display_name||me?.display_name||''}’s open work, by lane.`):'Your assigned tasks, by lane.'} Most urgent at the top of each lane.`}
   actions={<><button type="button" className={heroBtn+' disabled:opacity-50'} style={heroPrimary} disabled={busy||loading||!data||!canAdd} onClick={()=>add('')}><Plus className="h-4 w-4"/>New task</button><button type="button" className={heroBtn+' disabled:opacity-50'} style={heroSecondary} disabled={busy||loading} onClick={()=>refresh()}><RefreshCw className={'h-4 w-4 '+(loading?'animate-spin':'')} style={{color:'#e0c994'}}/>Refresh</button></>}>
   {data&&<div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-5" aria-label="Board summary">
    <Stat icon={AlertTriangle} label="Overdue" value={s.overdue} alert/><Stat icon={CalendarClock} label="Due today" value={s.dueToday} alert/><Stat icon={Clock} label="In progress" value={s.inProgress}/><Stat icon={Hourglass} label="Waiting 1 wk+" value={s.stale} alert/><Stat icon={CheckSquare} label="Open total" value={s.total}/>
   </div>}
  </PageHero>
  {error&&<p role="alert" className="rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">{error}</p>}
  {notice&&<p role="status" className="rounded-xl bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</p>}
  {loading&&!data&&<p role="status" className="p-8 text-center text-slate-600">Loading your board...</p>}
  {data&&<>
   {s.overdue>0&&<p role="alert" className="flex items-center gap-2 rounded-xl border border-red-300 bg-red-50 p-3 text-sm font-medium text-red-900"><AlertTriangle className="h-4 w-4 shrink-0"/>{s.overdue} overdue {s.overdue===1?'task':'tasks'}{firstOverdue?` — most overdue: “${firstOverdue.title}” in ${laneLabel(laneKey(firstOverdue))}`:''}. Overdue cards are outlined in red at the top of their lane.</p>}
   {data.truncated&&<p role="alert" className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">This board hit its 500-task limit, so some open tasks may not be shown. Finish or archive old tasks.</p>}
   <section className="card-shadow flex flex-wrap items-end justify-between gap-3 rounded-[14px] border bg-white p-3" style={{borderColor:'#d3cabb'}}>
    {owner?<label className="min-w-56 text-sm font-medium">Whose board<select aria-label="Choose a person's board" className={field} value={person} disabled={busy} onChange={e=>changeView(e.target.value)}><option value="mine">My board - {me?.display_name}</option><option value="all">Everyone</option>{members.filter(m=>m.id!==me?.id).map(m=><option key={m.id} value={m.id}>{m.display_name}{m.active?'':' (inactive)'}{m.pending_account?' - account pending':''}</option>)}</select></label>:<h2 className="text-lg font-semibold">{me?.display_name}&apos;s board</h2>}
    <div className="flex flex-wrap items-center gap-2"><p className="text-xs text-slate-500">Drag a card to another lane, or use its Move menu.</p>{owner&&<button type="button" className={btn+' flex items-center gap-2'} disabled={busy} onClick={manage}><Users className="h-4 w-4"/>Team</button>}</div>
   </section>
   {person==='all'&&owner&&<section aria-label="Team progress" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{(data.team_summary||[]).map(m=><button type="button" key={m.id} className="rounded-xl border bg-white p-3 text-left" onClick={()=>changeView(m.id)}><h2 className="font-semibold">{m.display_name}</h2><p className="mt-1 text-sm">{m.counts.open} open · {m.counts.in_progress} in progress</p><p className="mt-0.5 text-xs text-slate-500">{m.pending_account?'Account link pending':''}{m.active?'':' · Inactive'}</p></button>)}</section>}
   {shownMember?.pending_account&&<p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{shownMember.display_name}&apos;s board is ready for assignments. Only Gabriel can access it until a verified sign-in account is linked.</p>}
   {board.uncategorized&&<Lane lane={board.uncategorized} wide {...laneProps}/>}
   <div className="grid items-start gap-4 md:grid-cols-2 xl:grid-cols-4">{board.lanes.map(l=><Lane key={l.key} lane={l} {...laneProps}/>)}</div>
   <details className="card-shadow rounded-[14px] border bg-white p-4" style={{borderColor:'#d3cabb'}}><summary className="min-h-8 cursor-pointer font-semibold">Recently done ({recentDone.length})</summary>
    <ul className="mt-3 divide-y">{recentDone.length?recentDone.map(t=><li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"><button type="button" className="min-w-0 flex-1 text-left" onClick={()=>openTask(t)}><span className="break-words font-medium line-through decoration-slate-400">{t.title}</span><span className="ml-2 text-xs text-slate-500">{laneLabel(laneKey(t))}{t.completed_at?' · '+fmt(t.completed_at):''}{showAssignee?' · '+nameOf(t):''}</span></button><button type="button" className={smallBtn} disabled={busy} onClick={()=>setStatus(t,'open')}><RotateCcw className="h-3 w-3"/>Reopen</button></li>):<li className="py-2 text-sm text-slate-500">Nothing finished recently.</li>}</ul>
   </details>
   {owner&&teamOpen&&<form onSubmit={saveMember} aria-label="Manage team" className="space-y-4 rounded-2xl border bg-white p-5"><h2 className="font-semibold">Team members and account links</h2><p className="text-sm text-slate-600">Link only the correct existing sign-in account. No invitation or email is sent here. A person without a linked account remains pending.</p><label className="block text-sm">Person<select className={field} value={memberForm.id} disabled={busy} onChange={e=>memberEdit(members.find(m=>m.id===e.target.value))}><option value="">Add a new person</option>{members.filter(m=>m.member_key!=='gabriel').map(m=><option key={m.id} value={m.id}>{m.display_name}</option>)}</select></label><label className="block text-sm">Display name<input className={field} required maxLength={120} disabled={busy} value={memberForm.display_name} onChange={e=>setMemberForm({...memberForm,display_name:e.target.value})}/></label><label className="flex min-h-11 items-center gap-2 text-sm"><input type="checkbox" checked={memberForm.active} disabled={busy} onChange={e=>setMemberForm({...memberForm,active:e.target.checked})}/>Active and available for assignments</label><fieldset className="space-y-2"><legend className="mb-2 text-sm font-medium">Existing sign-in accounts</legend>{accounts.map(a=><label key={a.id} className="flex min-h-11 items-center gap-2 rounded-lg border p-3 text-sm"><input type="checkbox" disabled={busy||a.owner_account||Boolean(a.member_id&&a.member_id!==memberForm.id)} checked={memberForm.auth_user_ids.includes(a.id)} onChange={e=>setMemberForm({...memberForm,auth_user_ids:e.target.checked?[...memberForm.auth_user_ids,a.id]:memberForm.auth_user_ids.filter(id=>id!==a.id)})}/><span className="break-all">{a.full_name||a.email} · {a.email}{a.member_id&&a.member_id!==memberForm.id?' · already linked':''}</span></label>)}</fieldset><div className="flex flex-wrap gap-2"><button className={btn} disabled={busy}>{busy?'Saving...':'Save member'}</button><button type="button" className={btn} disabled={busy} onClick={()=>setTeamOpen(false)}>Cancel</button></div></form>}
   <p className="text-xs text-slate-500">Tasks are internal records. Status changes do not send messages, change appointments, configure computers, or place orders.</p>
  </>}
  {(creating||(selected&&edit))&&<div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4 sm:items-center" onClick={()=>{if(!busy){setCreating(false);setSelected(null);setEdit(null);}}}>
   <div className="w-full max-w-lg rounded-2xl bg-white p-5 shadow-xl" onClick={e=>e.stopPropagation()}>
    {creating&&<form onSubmit={create} className="space-y-4" aria-label="New task"><div className="flex items-center justify-between"><h2 className="text-lg font-semibold">New task</h2><button type="button" aria-label="Close" className="p-2" onClick={()=>setCreating(false)}><X className="h-4 w-4"/></button></div><label className="block text-sm">Lane<select className={field} required value={form.category} disabled={busy} onChange={e=>{setForm({...form,category:e.target.value});createKey.current=crypto.randomUUID();}}><option value="" disabled>Choose a lane</option>{BOARD_LANES.map(l=><option key={l.key} value={l.key}>{l.label}</option>)}</select></label><label className="block text-sm">Title<input autoFocus required maxLength={200} className={field} value={form.title} disabled={busy} onChange={e=>{setForm({...form,title:e.target.value});createKey.current=crypto.randomUUID();}}/></label><label className="block text-sm">Instructions<textarea maxLength={5000} rows={4} className={field} value={form.details} disabled={busy} onChange={e=>{setForm({...form,details:e.target.value});createKey.current=crypto.randomUUID();}}/></label>{owner&&<label className="block text-sm">Assign to<select className={field} value={form.assignee_member_id} required disabled={busy} onChange={e=>{setForm({...form,assignee_member_id:e.target.value});createKey.current=crypto.randomUUID();}}>{members.filter(m=>m.active).map(m=><option key={m.id} value={m.id}>{m.display_name}{m.pending_account?' - account pending':''}</option>)}</select></label>}<label className="block max-w-xs text-sm">Due date (optional)<input type="date" className={field} value={form.due_date} disabled={busy} onChange={e=>{setForm({...form,due_date:e.target.value});createKey.current=crypto.randomUUID();}}/></label><div className="flex gap-2"><button className={btn} disabled={busy||!form.title.trim()||!form.category}>{busy?'Saving...':'Create task'}</button><button type="button" className={btn} disabled={busy} onClick={()=>setCreating(false)}>Cancel</button></div></form>}
    {selected&&edit&&<form onSubmit={save} className="space-y-4" aria-label="Task details"><div className="flex items-center justify-between"><h2 className="text-lg font-semibold">Task details</h2><button type="button" aria-label="Close" className="p-2" onClick={()=>{setSelected(null);setEdit(null);}}><X className="h-4 w-4"/></button></div>{stale&&<p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">This task changed or moved to another list. Close it and open the current version before saving.</p>}
     {owner?<><label className="block text-sm">Title<input required maxLength={200} className={field} value={edit.title} disabled={busy||stale} onChange={e=>setEdit({...edit,title:e.target.value})}/></label><label className="block text-sm">Instructions<textarea rows={5} maxLength={5000} className={field} value={edit.details||''} disabled={busy||stale} onChange={e=>setEdit({...edit,details:e.target.value})}/></label><label className="block text-sm">Assign to<select className={field} value={edit.assignee_member_id} disabled={busy||stale} onChange={e=>setEdit({...edit,assignee_member_id:e.target.value})}>{members.filter(m=>m.active||m.id===edit.assignee_member_id).map(m=><option key={m.id} value={m.id}>{m.display_name}{m.pending_account?' - account pending':''}{m.active?'':' - inactive'}</option>)}</select></label><label className="block max-w-xs text-sm">Due date<input type="date" className={field} value={edit.due_date||''} disabled={busy||stale} onChange={e=>setEdit({...edit,due_date:e.target.value})}/></label></>:<><h3 className="text-lg font-semibold">{selected.title}</h3><p className="whitespace-pre-wrap break-words text-sm">{selected.details||'No additional instructions.'}</p>{selected.due_date&&<p className="text-sm">Due {selected.due_date}</p>}</>}
     <label className="block text-sm">Lane<select className={field} value={edit.category} disabled={busy||stale} onChange={e=>setEdit({...edit,category:e.target.value})}>{laneOptions.filter(l=>l.key||!laneKey(selected)).map(l=><option key={l.key||'none'} value={l.key}>{l.key?l.label:'Needs a category'}</option>)}</select></label>
     <label className="block text-sm">Status<select className={field} value={edit.status} disabled={busy||stale} onChange={e=>setEdit({...edit,status:e.target.value})}>{statuses.map(([key,label])=><option key={key} value={key}>{label}</option>)}</select></label><label className="block text-sm">Progress note<textarea rows={3} maxLength={3000} className={field} value={edit.progress_note||''} disabled={busy||stale} onChange={e=>setEdit({...edit,progress_note:e.target.value})}/></label>{selected.completed_at&&<p className="text-xs text-slate-500">Completed {fmt(selected.completed_at)}</p>}<div className="flex flex-wrap gap-2"><button className={btn} disabled={busy||stale}>{busy?'Saving...':'Save changes'}</button>{owner&&<button type="button" className={btn} disabled={busy||stale} onClick={()=>{if(window.confirm('Archive this task? It will leave the board, but its record will be retained.'))mutate({action:'archive',id:selected.id,expected_revision:selected.revision},'Task archived; its record was retained.');}}>Archive task</button>}</div>
    </form>}
   </div>
  </div>}
 </PageShell>;
}
