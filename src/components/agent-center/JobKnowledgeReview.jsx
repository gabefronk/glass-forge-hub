import {useCallback,useEffect,useMemo,useRef,useState} from 'react';
import {Link} from 'react-router-dom';
import {RefreshCw} from 'lucide-react';
import {base44} from '@/api/base44Client';
import {useAuth} from '@/lib/AuthContext';
import {isAgentCenterOwner} from '@/lib/agentCenterAccess';

const PAGE_SIZE=50;
const control='inline-flex min-h-11 items-center justify-center gap-2 rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm font-medium focus:outline-none focus:ring-2 focus:ring-[#2A5EA8] disabled:cursor-not-allowed disabled:opacity-50';
const SOURCE_NAMES={calendar:'Saved calendar',live_google:'Google Calendar',live_probuild:'Live ProBuild',probuild_reports:'Field reports',probuild_library:'Report library',documents:'PDF documents',job_notes:'Job notes',service_requests:'Service requests',sales_tracker:'Sales Tracker',outlook_installation:'Window installation calendar',outlook_service:'Service calendar',tracker:'Sales Tracker',field_report:'Field reports',library_report:'Report library',document:'PDF documents',note:'Job notes'};
const SOURCE_ROWS={calendar:'calendar',live_google:'live_google',live_probuild:'live_probuild',probuild_reports:'field_reports',probuild_library:'library_reports',documents:'pdf_files',job_notes:'job_notes',service_requests:'service_cases',sales_tracker:'tracker_rows'};
const SOURCE_LINKS={calendar:'/calendar',live_google:'/calendar',outlook_installation:'/calendar',outlook_service:'/calendar',live_probuild:'/reports',probuild_reports:'/reports',field_report:'/reports',probuild_library:'/report-library',library_report:'/report-library',documents:'/report-library',document:'/report-library',sales_tracker:'/sales-tracker',tracker:'/sales-tracker',job_notes:'/jobs',note:'/jobs'};
const OWNERS={calendar_ops_lead:'Calendar team',field_reporting_lead:'Field reporting team',sales_order_lead:'Sales and orders team'};
const REASONS={
  no_exact_identity:['Job identity needed','Confirm the source job using its order number, address, or builder, subdivision and lot.'],
  multiple_exact_jobs:['More than one matching job','Compare the candidate jobs and their source references. A shared name alone cannot select a job.'],
  contradictory_identifiers:['Job references disagree','Check the source references before linking this record to a job.'],
  conflicting_fee_identity:['Existing job references disagree','Review the linked event or report and the existing job identity. Billing review remains separate.'],
  multiple_fee_jobs:['Source linked to multiple jobs','Confirm the source scope before selecting a job.'],
  multiple_lots_or_jobs:['More than one lot or job','Confirm whether this source covers a building, several lots, or one specific job.'],
  multi_lot_project_scope:['Project covers multiple lots','Keep the full project scope until individual job references are confirmed.'],
  unknown_explicit_job_id:['Linked job unavailable','Check the existing source link and the current job record.'],
  unmapped_project_requires_review:['Project needs a job link','Confirm this project’s job identity before using its records in a reply.'],
  address_disagrees_with_job:['Address does not match','Compare the source address with the candidate job.'],
  lot_disagrees_with_job:['Lot does not match','Compare the source lot with the candidate job.'],
  calendar_coverage_gap:['Calendar coverage is incomplete','Obtain a current capture covering the required dates. Missing events cannot be treated as an empty schedule.'],
  upstream_freshness_unverified:['Source check time is unavailable','Confirm when the source was last checked. A database update is not a source refresh.'],
  stale_arrival_source:['Arrival information needs updating','Get current supplier or order information before confirming a delivery date.'],
  live_source_incomplete:['Live source check did not finish','Review the source connection or import. Existing records retain their original check time.'],
  pdf_text_not_extracted:['PDF contents need processing','Read the document contents and confirm the job before using it as evidence.'],
  invalid_manifest:['Calendar import needs review','Check the capture’s date range, timezone and record count.'],
  cancellation_not_verified:['Cancellation status needs checking','Confirm the current source event before promising a visit.'],
  document_text_unavailable:['Document contents unavailable','Keep the file reference and obtain readable contents.'],
  conflicting_duplicate_same_revision:['Source versions disagree','Review both versions before using this information.'],
  conflicting_duplicate_without_revision:['Source revision missing','Confirm which version is current; both have been held for review.'],
};
const array=value=>Array.isArray(value)?value:[];
const label=value=>String(value||'Unknown').replaceAll('_',' ');
const safeText=value=>typeof value==='string'?value.replace(/https?:\/\/[^\s<>"']+/gi,'[link omitted]').replace(/\b(?:password|token|authorization|api[_ -]?key|secret)\s*[:=]\s*\S+/gi,'[private value omitted]').slice(0,240):'';
const count=value=>Number.isSafeInteger(value)&&value>=0?value.toLocaleString():'—';
const date=value=>{const ms=typeof value==='string'?Date.parse(value):NaN;return Number.isFinite(ms)?new Date(ms).toLocaleString('en-US',{timeZone:'America/Denver',dateStyle:'medium',timeStyle:'short'}):'Not verified';};
const safeId=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,160}$/.test(value)?value:null;
const reason=code=>REASONS[code]||[label(code),'Review this source and its job references before using it in a customer reply.'];
function freshness(source,now) {
  if(source.available===false)return {label:'Unavailable',tone:'bg-amber-50 text-amber-900'};
  const age=now-Date.parse(source.checked_at);
  if(!Number.isFinite(age)||age<0)return {label:'Check time unknown',tone:'bg-slate-100 text-slate-700'};
  if(age>26*3600000)return {label:'Needs updating',tone:'bg-amber-50 text-amber-900'};
  if(source.complete!==true)return {label:'Partial coverage',tone:'bg-amber-50 text-amber-900'};
  return {label:'Current within listed scope',tone:'bg-emerald-50 text-emerald-800'};
}

function ReviewRecord({record,index}) {
  const source=record.source_type||String(record.source_key||'').split(':')[0];
  const candidates=[...new Set(array(record.candidate_job_ids).map(safeId).filter(Boolean))];
  const [title,next]=reason(record.reason);
  const metadata=[['Project',safeId(record.project_id)],['Address',safeText(record.address)],['PO',array(record.po_numbers).map(safeText).filter(Boolean).join(', ')],['OE',array(record.oe_numbers).map(safeText).filter(Boolean).join(', ')]];
  return <li className="rounded-xl border border-slate-200 bg-white p-4">
    <div className="flex flex-wrap items-start justify-between gap-2"><div className="min-w-0"><p className="text-xs text-slate-500">{index}. {SOURCE_NAMES[source]||label(source)}</p><h4 className="mt-1 break-words text-sm font-semibold text-slate-900">{safeText(record.job_name)||'Job identity not supplied'}</h4></div><span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs text-amber-900">{title}</span></div>
    <p className="mt-2 text-sm text-slate-600">{next}</p>
    {record.identity_metadata_ambiguous&&<p className="mt-2 text-xs text-amber-900">More than one source record shares this reference. Identity details are withheld until it is reviewed.</p>}
    <dl className="mt-3 grid gap-x-5 gap-y-2 text-xs sm:grid-cols-2">{metadata.filter(([,value])=>value).map(([name,value])=><div key={name} className="min-w-0"><dt className="text-slate-500">{name}</dt><dd className="mt-0.5 break-words text-slate-800">{value}</dd></div>)}</dl>
    <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">{SOURCE_LINKS[source]&&<Link className="inline-flex min-h-10 items-center font-medium text-[#2A5EA8] underline" to={SOURCE_LINKS[source]}>Open source workspace</Link>}{candidates.slice(0,8).map((id,i)=><Link key={id} to={'/jobs/'+encodeURIComponent(id)} className="inline-flex min-h-10 items-center font-medium text-[#2A5EA8] underline">Compare candidate {i+1} <span className="ml-1 font-mono text-[10px] text-slate-500">({id.slice(-6)})</span></Link>)}</div>
    {candidates.length>8&&<p className="text-xs text-slate-500">Showing eight of {candidates.length} candidate jobs. This source needs a more specific identity.</p>}
  </li>;
}

export default function JobKnowledgeReview() {
  const {user}=useAuth(),owner=isAgentCenterOwner(user);
  const [status,setStatus]=useState(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
  const [reviewOpen,setReviewOpen]=useState(false),[page,setPage]=useState(null),[offset,setOffset]=useState(0),[pageBusy,setPageBusy]=useState(false),[pageError,setPageError]=useState('');
  const [checkedAt,setCheckedAt]=useState(null);
  const statusRequest=useRef(0),pageRequest=useRef(0),activeOwner=useRef(owner);
  activeOwner.current=owner;
  const currentRun=useMemo(()=>{
    if(status?.latest_complete?.status==='complete')return status.latest_complete;
    return [...array(status?.runs)].filter(run=>run.status==='complete').sort((a,b)=>String(b.started_at||'').localeCompare(String(a.started_at||'')))[0]||null;
  },[status]);
  const latestAttempt=[...array(status?.runs)].sort((a,b)=>String(b.started_at||'').localeCompare(String(a.started_at||'')))[0];
  const currentRunId=currentRun?.id;
  const checkStatus=useCallback(async()=>{
    if(!activeOwner.current)return;
    const request=++statusRequest.current;
    setBusy(true);setError('');
    try {
      const response=(await base44.functions.invoke('job-knowledge',{action:'status'})).data;
      if(!response||!Array.isArray(response.runs)||response.error)throw Error('Invalid status');
      if(activeOwner.current&&request===statusRequest.current){setStatus(response);setCheckedAt(Date.now());}
    }catch{if(activeOwner.current&&request===statusRequest.current)setError('Preparation status could not be checked. Previously displayed information may be out of date.');}
    finally{if(activeOwner.current&&request===statusRequest.current)setBusy(false);}
  },[]);
  const loadPage=useCallback(async nextOffset=>{
    if(!activeOwner.current||!currentRunId)return;
    const request=++pageRequest.current;
    setPageBusy(true);setPageError('');
    try {
      const response=(await base44.functions.invoke('job-knowledge',{action:'unassigned',offset:nextOffset})).data;
      if(!response||!Array.isArray(response.records)||!Number.isSafeInteger(response.total)||response.total<0||response.error)throw Error('Invalid review data');
      if(response.run_id!==currentRunId){
        if(activeOwner.current&&request===pageRequest.current){setPage(null);setPageError('A newer preparation is available. Check status to review the same preparation throughout.');}
        return;
      }
      if(activeOwner.current&&request===pageRequest.current){setPage(response);setOffset(nextOffset);}
    }catch{if(activeOwner.current&&request===pageRequest.current)setPageError('The review list could not load. Your source records are unchanged.');}
    finally{if(activeOwner.current&&request===pageRequest.current)setPageBusy(false);}
  },[currentRunId]);
  useEffect(()=>{
    if(owner)checkStatus();
    else {setStatus(null);setPage(null);setError('');setPageError('');setReviewOpen(false);setBusy(false);setPageBusy(false);}
    return()=>{statusRequest.current++;pageRequest.current++;};
  },[owner,checkStatus]);
  useEffect(()=>{pageRequest.current++;setPage(null);setOffset(0);setPageError('');if(reviewOpen&&owner&&currentRunId)loadPage(0);},[reviewOpen,owner,currentRunId,loadPage]);
  const groups=useMemo(()=>{
    const byOwner=new Map();
    for(const issue of array(currentRun?.issues)) {
      const team=issue.assigned_to||'owner_review';
      if(!byOwner.has(team))byOwner.set(team,[]);
      byOwner.get(team).push(issue);
    }
    return [...byOwner];
  },[currentRun]);
  if(!owner)return null;
  const now=Date.now(),sources=Object.entries(currentRun?.source_status||{}),counts=currentRun?.counts||{};
  const needsCheck=sources.filter(([,source])=>freshness(source,now).label!=='Current within listed scope').length;
  const attemptFailed=latestAttempt?.status==='failed',attemptRunning=latestAttempt?.status==='building';
  const age=now-Date.parse(currentRun?.started_at),preparationOld=!!currentRun&&(!Number.isFinite(age)||age<0||age>26*3600000);
  return <section id="job-preparation" aria-label="Job preparation review" className="rounded-2xl border border-[#DDE3EC] bg-white p-5 sm:p-6">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-lg font-semibold text-slate-900">Job preparation</h2><p className="mt-1 max-w-2xl text-sm text-slate-600">The assistant’s job context, source freshness and records awaiting a reliable job match.</p></div><button type="button" onClick={checkStatus} disabled={busy} className={control}><RefreshCw aria-hidden="true" className={'h-4 w-4 '+(busy?'animate-spin':'')}/>{busy?'Checking…':'Check status'}</button></div>
    {error&&<p role="alert" className="mt-4 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">{error}</p>}
    {attemptFailed&&<p role="status" className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">The latest preparation failed at {date(latestAttempt.completed_at)}. {currentRun?'The previous complete job briefs remain available.':'No complete preparation is available in this status response.'}</p>}
    {attemptRunning&&<p role="status" className="mt-4 rounded-xl bg-blue-50 p-3 text-sm text-blue-900">Preparation started {date(latestAttempt.started_at)}. Completed job briefs remain in use until it finishes.</p>}
    {!currentRun?<p className="mt-4 text-sm text-slate-500">{busy?'Checking the latest preparation…':status?'No complete job preparation was returned. Review the daily runs above for the last run.':'Status has not loaded.'}</p>:<>
      <div className="mt-5 grid grid-cols-2 gap-3 lg:grid-cols-4">{[[counts.jobs,'Jobs prepared'],[counts.accepted_evidence,'Linked records'],[currentRun.unassigned_count,'Unmatched records & checks'],[needsCheck,'Sources needing a check']].map(([value,title])=><div key={title} className="rounded-xl bg-slate-50 p-3"><p className="text-xl font-semibold text-slate-900">{count(value)}</p><p className="mt-1 text-xs text-slate-600">{title}</p></div>)}</div>
      <p className="mt-3 text-xs text-slate-500">Preparation completed {date(currentRun.completed_at)}. {checkedAt?'Status checked '+date(new Date(checkedAt).toISOString())+'. ':''}Times are Mountain Time.</p>
      {preparationOld&&<p className="mt-3 text-sm text-amber-900">The preparation needs updating. Its saved source facts retain their original dates.</p>}
      <details className="mt-5 border-t border-slate-200 pt-4"><summary className="cursor-pointer text-sm font-semibold text-slate-900">Source coverage <span className="ml-1 font-normal text-slate-500">({sources.length} sources)</span></summary><div className="mt-3 overflow-x-auto"><table className="w-full min-w-[520px] text-left text-xs"><caption className="sr-only">Source record counts, last check times, and covered dates</caption><thead><tr className="border-b text-slate-500"><th scope="col" className="py-2 pr-3 font-medium">Source</th><th scope="col" className="py-2 pr-3 font-medium">Records</th><th scope="col" className="py-2 pr-3 font-medium">Status</th><th scope="col" className="py-2 font-medium">Last source check / coverage</th></tr></thead><tbody>{sources.map(([key,source])=>{const state=freshness(source,now);return <tr key={key} className="border-b border-slate-100 align-top"><th scope="row" className="py-3 pr-3 font-medium">{SOURCE_NAMES[key]||label(key)}</th><td className="py-3 pr-3">{count(currentRun.source_counts?.[SOURCE_ROWS[key]])}</td><td className="py-3 pr-3"><span className={'inline-block rounded-full px-2 py-1 '+state.tone}>{state.label}</span></td><td className="py-3 text-slate-600">{date(source.checked_at)}{source.range_start&&source.range_end&&<p className="mt-1">{safeText(source.range_start)} through {safeText(source.range_end)}</p>}</td></tr>;})}</tbody></table></div></details>
      <details className="mt-4 border-t border-slate-200 pt-4"><summary className="cursor-pointer text-sm font-semibold text-slate-900">Open checks by team <span className="ml-1 font-normal text-slate-500">({array(currentRun.issues).length})</span></summary>{!groups.length?<p className="mt-3 text-sm text-slate-500">No preparation checks were recorded for this run.</p>:<div className="mt-3 grid gap-3 lg:grid-cols-2">{groups.map(([team,issues])=><section key={team} className="rounded-xl border border-slate-200 p-4"><h3 className="text-sm font-semibold">{OWNERS[team]||'Owner review'}</h3><ul className="mt-3 space-y-3">{issues.map((issue,i)=>{const [title,next]=reason(issue.code);return <li key={team+':'+issue.source+':'+issue.code+':'+i}><div className="flex flex-wrap justify-between gap-1 text-xs"><strong>{title}</strong>{Number.isSafeInteger(issue.count)&&<span className="text-slate-500">{count(issue.count)} records</span>}</div><p className="mt-1 text-xs text-slate-500">{SOURCE_NAMES[issue.source]||label(issue.source)}</p><p className="mt-1 text-xs leading-relaxed text-slate-600">{next}</p></li>;})}</ul></section>)}</div>}</details>
      <details open={reviewOpen} onToggle={event=>setReviewOpen(event.currentTarget.open)} className="mt-4 border-t border-slate-200 pt-4"><summary className="cursor-pointer text-sm font-semibold text-slate-900">Records and identity checks <span className="ml-1 font-normal text-slate-500">({count(currentRun.unassigned_count)})</span></summary><p className="mt-2 text-xs text-slate-600">Compare the source identity with candidate jobs. These records remain excluded from job briefs until their identity is resolved.</p>
        {pageError&&<p role="alert" className="mt-3 rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{pageError}</p>}
        {pageBusy&&!page&&<p role="status" className="mt-3 text-sm text-slate-500">Loading review records…</p>}
        {page&&<><ol className="mt-3 max-h-[560px] space-y-3 overflow-y-auto pr-1" aria-busy={pageBusy}>{page.records.map((record,i)=><ReviewRecord key={(record.source_key||'record')+':'+(offset+i)} record={record} index={offset+i+1}/>)}</ol>{!page.records.length&&<p className="mt-3 text-sm text-slate-500">{page.total===0?'No unmatched records in this preparation.':'No records were returned for this page. Check status and try again.'}</p>}<nav aria-label="Unmatched record pages" className="mt-3 flex flex-wrap items-center justify-between gap-3"><p className="text-xs text-slate-500">{page.records.length?`${offset+1}–${offset+page.records.length} of ${count(page.total)}`:page.total?'No rows on this page':'0 records'}</p><div className="flex gap-2"><button type="button" className={control} disabled={pageBusy||offset===0} onClick={()=>loadPage(Math.max(0,offset-PAGE_SIZE))}>Previous</button><button type="button" className={control} disabled={pageBusy||offset+PAGE_SIZE>=page.total} onClick={()=>loadPage(offset+PAGE_SIZE)}>Next</button></div></nav></>}
        {pageError&&!pageBusy&&<button type="button" className={control+' mt-3'} onClick={()=>loadPage(offset)}>Retry review list</button>}
      </details>
      <div className="mt-4 flex flex-wrap gap-4 border-t border-slate-200 pt-3"><Link to="/jobs" className="inline-flex min-h-10 items-center text-sm font-medium text-[#2A5EA8] underline">Open jobs and briefs</Link><Link to="/messages" className="inline-flex min-h-10 items-center text-sm font-medium text-[#2A5EA8] underline">Open messages</Link></div>
    </>}
  </section>;
}
