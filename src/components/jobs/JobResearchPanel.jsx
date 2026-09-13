import {useEffect,useRef,useState} from 'react';
import {base44} from '@/api/base44Client';

const PURPOSES=[['documents','Plans or documents'],['eta','Product arrival estimate'],['installation_schedule','Installation schedule'],['service_schedule','Service schedule'],['service_issue','Service history'],['missing_parts','Missing parts'],['completion','Work completion'],['referral','Homeowner referral'],['technical_question','Product or technical documents'],['site_clarification','Site details']];
const readable=s=>String(s||'').replaceAll('_',' ');
export default function JobResearchPanel({jobId}) {
  const [purpose,setPurpose]=useState('documents'),[filename,setFilename]=useState(''),[start,setStart]=useState(''),[end,setEnd]=useState('');
  const [packet,setPacket]=useState(null),[busy,setBusy]=useState(false),[notice,setNotice]=useState('');
  const revision=useRef(0);
  useEffect(()=>{revision.current++;setPacket(null);setBusy(false);setNotice('');setFilename('');setStart('');setEnd('');return()=>{revision.current++;};},[jobId]);
  const invalidate=()=>{revision.current++;setPacket(null);setBusy(false);setNotice('');};
  const plan=async e=>{
    e.preventDefault();const attempt=++revision.current;setBusy(true);setNotice('');setPacket(null);
    if(!!start!==!!end){setNotice('Choose both dates, or leave both blank.');setBusy(false);return;}
    const research={purpose,...(filename.trim()?{requested_filename:filename.trim()}:{}),...(start&&end?{start_date:start,end_date:end}:{})};
    try{const r=(await base44.functions.invoke('job-knowledge',{action:'plan_research',query:{job_id:jobId},research})).data;
      if(attempt===revision.current){if(!r?.research_plan?.version)throw new Error('Missing plan');setPacket(r.research_plan);}
    }catch{if(attempt===revision.current)setNotice('The source-check plan could not load. Your saved job information is unchanged.');}
    finally{if(attempt===revision.current)setBusy(false);}
  };
  const copy=async()=>{const attempt=revision.current;try{await navigator.clipboard.writeText(JSON.stringify(packet,null,2));if(attempt===revision.current)setNotice('Copied for the Mac task. Nothing has been dispatched.');}catch{if(attempt===revision.current)setNotice('Copy is unavailable. The full handoff is shown below.');}};
  return <details className="mt-4 border-t border-slate-200 pt-3">
    <summary className="cursor-pointer text-sm font-medium text-slate-800">Plan a source check</summary>
    <p className="mt-2 text-sm text-slate-600">Use saved job information first, then identify what the Mac and iPad still need to find.</p>
    <form onSubmit={plan} className="mt-3 space-y-3">
      <label className="block text-sm">What do you need?<select className="mt-1 block w-full rounded-lg border p-2" value={purpose} onChange={e=>{invalidate();setPurpose(e.target.value);setFilename('');}}>{PURPOSES.map(([v,t])=><option key={v} value={v}>{t}</option>)}</select></label>
      {purpose==='documents'&&<label className="block text-sm">Exact filename, if known<input className="mt-1 block w-full rounded-lg border p-2" maxLength={250} value={filename} onChange={e=>{invalidate();setFilename(e.target.value);}}/></label>}
      <div className="grid gap-3 sm:grid-cols-2"><label className="text-sm">Search from, optional<input className="mt-1 block w-full rounded-lg border p-2" type="date" value={start} onChange={e=>{invalidate();setStart(e.target.value);}}/></label><label className="text-sm">Search through, optional<input className="mt-1 block w-full rounded-lg border p-2" type="date" value={end} min={start||undefined} onChange={e=>{invalidate();setEnd(e.target.value);}}/></label></div>
      <p className="text-xs text-slate-500">Dates narrow calendar and email searches. Older job documents can still be relevant; their revision needs verification.</p>
      <button type="submit" disabled={busy} className="rounded-lg bg-teal-900 px-3 py-2 text-sm text-white disabled:opacity-50">{busy?'Checking prepared sources…':'Build lookup plan'}</button>
    </form>
    {notice&&<p role="status" className="mt-3 text-sm text-slate-600">{notice}</p>}
    {packet&&<div className="mt-4 rounded-xl bg-slate-50 p-4 text-sm">
      <h3 className="font-semibold">{packet.reply_ready?'Prepared facts available':packet.status==='blocked'?'This lookup needs clarification':'Ready for Mac review'}</h3>
      {packet.identity?.canonical_name&&<p className="mt-1">{packet.identity.canonical_name}</p>}
      <p className="mt-2 text-slate-600">{readable(packet.reason)}</p>
      {!!packet.verified_facts?.length&&<ul className="mt-3 list-disc space-y-2 pl-5">{packet.verified_facts.map((f,i)=><li key={i}>{f}</li>)}</ul>}
      {!!packet.steps?.length&&<ol className="mt-3 list-decimal space-y-3 pl-5">{packet.steps.map(s=><li key={s.step}><strong>{s.app}</strong><p>{s.question}</p><p className="mt-1 text-xs text-slate-500">{s.when}</p></li>)}</ol>}
      <p className="mt-3 text-xs text-slate-600">This prepares a manual handoff. It does not search the iPad or send messages. Use the approved Outlook session already open on the iPad.</p>
      {packet.dedupe_key&&<button type="button" onClick={copy} className="mt-3 rounded-lg border border-slate-300 bg-white px-3 py-2">Copy handoff for Mac</button>}
      <details className="mt-3"><summary className="cursor-pointer text-xs">Full source-check handoff</summary><pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words text-xs">{JSON.stringify(packet,null,2)}</pre></details>
    </div>}
  </details>;
}
