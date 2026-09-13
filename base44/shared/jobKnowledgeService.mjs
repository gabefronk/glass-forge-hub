import { buildJobContexts, createJobIndex, matchJobEvidence } from './jobContextCore.mjs';
import { assessCalendarCoverage, denverCalendarDate, isCalendarDate, sourceFreshness } from './calendarCoverage.mjs';
import { buildTrustedSourceLinks } from './trustedSourceLinks.mjs';
import { validateJobDocumentResult } from './jobDocumentExtraction.mjs';

// Only generated knowledge records are written. Original jobs, reports, calendars,
// fees, quotes and message read states remain authoritative and unchanged.
const OWNERS = new Set(['gabefronk@gmail.com','gabriel.fronk.wd@gmail.com']);
export const isKnowledgeOwner = user => user?.role === 'admin' && OWNERS.has(String(user.email || '').trim().toLowerCase());
const fields = s => s.split(',');
const dayPlus = (day,n) => new Date(Date.parse(day+'T12:00:00Z')+n*86400000).toISOString().slice(0,10);
const asText = v => typeof v === 'string' ? v : '';
const latest = rows => [...rows].sort((a,b)=>String(b.captured_at||b.source_captured_at||'').localeCompare(String(a.captured_at||a.source_captured_at||'')))[0];
export async function allKnowledgeRows(entity, selected, query = {}) {
  const result=[], seen=new Set();
  for(let skip=0;skip<50000;skip+=500) {
    const page=await entity.filter(query,'id',500,skip,selected);
    if(!Array.isArray(page)) throw Error('Invalid source page');
    for(const row of page) { if(!row.id||seen.has(row.id)) throw Error('Source pagination repeated or missing IDs'); seen.add(row.id); result.push(row); }
    if(page.length<500)return result;
  }
  throw Error('Source pagination exceeded safe limit; no complete generation published');
}
const warning = (source,code,detail,assigned_to) => ({source,code,detail,assigned_to,status:'needs_review'});
function calendarCandidates(relevant,manifests,now) {
  const valid=s=>s?.timezone==='America/Denver'&&isCalendarDate(s.range_start)&&isCalendarDate(s.range_end)&&s.range_start<=s.range_end&&Array.isArray(s.events)&&Number.isInteger(s.event_count)&&s.events.length===s.event_count&&s.events.every(e=>e&&isCalendarDate(e.event_date)&&e.event_date>=s.range_start&&e.event_date<=s.range_end)&&['fresh','stale'].includes(sourceFreshness({observedAt:s.captured_at,now,maxAgeHours:26}).status);
  const good=relevant.filter(valid), byId=new Map(good.map(s=>[s.id,s]));
  const candidates=good.map(s=>({...s,complete:s.complete===true,is_batch:false}));
  let invalid=good.length!==relevant.length;
  for(const b of manifests) {
    const ids=b.snapshot_ids||[],parts=ids.map(id=>byId.get(id));
    if(b.timezone!=='America/Denver'||!isCalendarDate(b.range_start)||!isCalendarDate(b.range_end)||b.range_start>b.range_end||!['fresh','stale'].includes(sourceFreshness({observedAt:b.captured_at,now,maxAgeHours:26}).status)||!ids.length||new Set(ids).size!==ids.length||parts.some(p=>!p||p.calendar_name!==b.calendar_name||p.range_start<b.range_start||p.range_end>b.range_end||Date.parse(p.captured_at)>Date.parse(b.captured_at)+300000||Date.parse(b.captured_at)-Date.parse(p.captured_at)>26*3600000)||parts.reduce((n,p)=>n+(p?.events?.length||0),0)!==b.event_count) {invalid=true;continue;}
    candidates.push({...b,complete:b.complete===true,is_batch:true,events:parts.flatMap(p=>p.events)});
  }
  return {candidates,invalid};
}
function mergeLiveEvidence({data,evidence,sourceStatus,issues,calendarJob,reportJob,now}) {
  if(!data.providerData)return {calendar:0,probuild:0};
  const {calendar=[],reports=[],libraryReports=[],files=[]}=data;
  const providers=data.providerData;
  const scope=(raw,type,assigned)=> {
    const value=raw&&typeof raw==='object'?raw:{};
    const items=Array.isArray(value.items)?value.items:[];
    const validCheck=typeof value.checked_at==='string'&&/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value.checked_at)&&Number.isFinite(Date.parse(value.checked_at));
    const complete=value.complete===true&&validCheck&&isCalendarDate(value.range_start)&&isCalendarDate(value.range_end)&&value.range_start<=value.range_end;
    sourceStatus[type]={available:items.length>0||complete,complete,checked_at:complete?value.checked_at:null,range_start:value.range_start,range_end:value.range_end};
    if(!complete)issues.push(warning(type,'live_source_incomplete','The live source read was unavailable, partial, or outside a verified scope. Cached job evidence remains available with its original freshness. '+(/^[a-z0-9_,]{1,200}$/i.test(value.error||'')?value.error:''),assigned));
    return {...value,items,complete,checked_at:complete?value.checked_at:null};
  };
  const google=scope(providers.calendar,'live_google','calendar_ops_lead');
  const probuild=scope(providers.probuild,'live_probuild','field_reporting_lead');
  const key=(project,post)=>String(project||'')+'\u0000'+String(post||'');
  const deletedProjects=new Set((Array.isArray(probuild.deleted_projects)?probuild.deleted_projects:[]).filter(p=>p?.deleted===true&&p.project_id).map(p=>String(p.project_id)));
  const postsById=new Map();
  for(const p of probuild.items)if(p?.post_id&&p.project_id)postsById.set(key(p.project_id,p.post_id),p);
  const postFor=(project,post)=>postsById.get(key(project,post));
  const googleById=new Map();
  for(const g of google.items)if(g?.google_event_id)googleById.set(String(g.google_event_id),g);
  const cachedGoogle=new Map(calendar.map(e=>[e.id,e]));
  const cachedReports=new Map(reports.map(e=>[e.id,e]));
  const cachedLibrary=new Map(libraryReports.map(e=>[e.id,e]));
  const cachedFiles=new Map(files.map(e=>[e.id,e]));
  for(const e of evidence) {
    const cached=e.source_type==='calendar'?cachedGoogle.get(e.source_id):e.source_type==='probuild_reports'?cachedReports.get(e.source_key.slice('field_report:'.length)):e.source_type==='probuild_library'?cachedLibrary.get(e.source_key.slice('library_report:'.length)):e.source_type==='documents'?cachedFiles.get(e.source_id):null;
    if(!cached)continue;
    if(e.source_type==='calendar'&&googleById.has(String(cached.google_event_id))) {e.status='superseded';continue;}
    const project=cached.project_id||cached.source_project_id,post=cached.post_id||cached.source_post_id;
    if(deletedProjects.has(String(project)))e.status='deleted';
    else if(postFor(project,post))e.status=e.source_type==='documents'?(postFor(project,post).deleted?'deleted':e.status):'superseded';
  }
  for(const g of google.items) {
    if(!g?.google_event_id)continue;
    const cached=calendar.filter(e=>String(e.google_event_id)===String(g.google_event_id));
    const one=values=>{const found=[...new Set(values.filter(Boolean))];return found.length===1?found[0]:null;};
    const jobs=[...new Set([...cached.map(e=>e.job_id),calendarJob(g.google_event_id)].filter(Boolean))];
    const deleted=g.deleted===true||g.source_status==='cancelled';
    evidence.push({source_key:'live_google:'+g.google_event_id,source_type:'live_google',source_id:String(g.google_event_id),
      job_id:jobs.length===1?jobs[0]:null,multi_job:jobs.length>1,
      job_name:g.job_name||one(cached.map(e=>e.job_name)),address:g.address||one(cached.map(e=>e.address)),
      po_numbers:[...new Set(cached.map(e=>e.po_number).filter(Boolean))],oe_numbers:[...new Set(cached.map(e=>e.oe_number).filter(Boolean))],
      date:g.start_at||g.event_date||one(cached.map(e=>e.event_date)),end_date:g.start_at?g.end_at:(g.all_day?g.end_date:null),end_exclusive:g.all_day===true,
      kind:'calendar_event',status:deleted?'cancelled':g.source_status||'unverified',text:g.scope_notes||'',
      source_updated_at:g.source_updated_at,source_checked_at:google.checked_at,
      source_url:'https://glass-forge-hub.base44.app/calendar'});
  }
  for(const p of probuild.items) {
    if(!p?.post_id||!p.project_id)continue;
    const cached=[...reports.filter(r=>r.post_id===p.post_id&&r.project_id===p.project_id),...libraryReports.filter(r=>r.source_post_id===p.post_id&&r.source_project_id===p.project_id)];
    const names=[...new Set(cached.map(r=>r.job_name||r.project_name).filter(Boolean))];
    evidence.push({source_key:'live_probuild:'+p.project_id+':'+p.post_id,source_type:'live_probuild',source_id:p.project_id+':'+p.post_id,
      project_id:p.project_id,job_id:reportJob(p.post_id),job_name:p.job_name||(names.length===1?names[0]:null),date:p.job_date||p.created_at||cached[0]?.job_date||cached[0]?.report_date,
      kind:'field_report',status:p.deleted||deletedProjects.has(String(p.project_id))?'deleted':'recorded',text:p.message||'',
      source_updated_at:p.source_updated_at||p.created_at,source_checked_at:probuild.checked_at,
      attachments:[],source_url:'https://glass-forge-hub.base44.app/reports'});
  }
  if(deletedProjects.size)issues.push(warning('live_probuild','deleted_projects','Live ProBuild reports '+deletedProjects.size+' deleted projects. Their cached report/document evidence remains in history and is excluded from current notes.','field_reporting_lead'));
  return {calendar:google.items.length,probuild:probuild.items.length};
}
function addDocumentExtractions({data,evidence,sourceStatus,issues,reportJob}) {
  const extractions=Array.isArray(data.extractions)?data.extractions:[],filesById=new Map(data.files.map(f=>[f.id,f]));
  const candidates=new Map(), rejected=[];let indexed=0;
  const reject=(x,reason)=>rejected.push({source_key:'document_extraction:'+x.id,source_type:'document_extractions',source_id:x.id,file_id:x.file_id,reason,candidate_job_ids:[]});
  for(const x of extractions) {
    if(x.status!=='extracted_needs_review')continue;
    const file=filesById.get(x.file_id),base=evidence.find(e=>e.source_key==='document:'+x.file_id);
    if(!file||!base||file.source_deleted||file.status!=='verified'||base.status==='deleted') {reject(x,'extraction_source_unavailable');continue;}
    if(!/^[a-f0-9]{64}$/i.test(file.sha256||'')||!/^[a-f0-9]{64}$/i.test(x.sha256||'')||file.sha256.toLowerCase()!==x.sha256.toLowerCase()||(x.extraction_key&&x.extraction_key!==file.id+':'+file.sha256.toLowerCase())) {reject(x,'extraction_source_hash_changed');continue;}
    if((x.source_project_id&&x.source_project_id!==file.source_project_id)||(x.source_post_id&&x.source_post_id!==file.source_post_id)) {reject(x,'extraction_source_identity_changed');continue;}
    let result;try{result=validateJobDocumentResult(x.result);}catch{reject(x,'extraction_schema_invalid');continue;}
    if(!candidates.has(file.id))candidates.set(file.id,[]);candidates.get(file.id).push({record:x,file,base,result});
  }
  for(const rows of candidates.values()) {
    if(rows.length!==1) {for(const row of rows)reject(row.record,'duplicate_extraction_requires_review');continue;}
    const {record:x,file,base,result}=rows[0];
    const labels=result.job_identifiers.map(i=>`${i.type}: ${i.value}; page ${i.page}; quotation: ${i.source_quote}`).join('\n');
    const dates=result.dated_statements.map(d=>`${d.meaning}: ${d.date_text}${d.normalized_date?' ['+d.normalized_date+']':''}; page ${d.page}; quotation: ${d.source_quote}${d.uncertainty?'; uncertainty: '+d.uncertainty:''}`).join('\n');
    const text='UNREVIEWED PDF EXTRACTION — OWNER REFERENCE ONLY. This model-generated extraction must be checked against the original PDF; no extracted identifier or date is promoted to a job mapping, product arrival, service schedule, or customer reply fact.\nDocument type: '+result.document_type+'\nSummary: '+result.summary+'\nUnreviewed identifiers:\n'+labels+'\nUnreviewed dated statements:\n'+dates;
    // Keep the original file reference while making the distinct extraction and
    // review state visible. Its generated statements never become typed dates.
    base.text='Unreviewed PDF extraction is available at [document_extraction:'+x.id+']. Review the original PDF before relying on its statements.';
    base.attachments=base.attachments.map(a=>({...a,text_extracted:true}));
    for(const report of evidence.filter(e=>e.source_type==='probuild_library'))for(const a of report.attachments||[])if(a.id===file.id)a.text_extracted=true;
    evidence.push({source_key:'document_extraction:'+x.id,source_type:'document_extractions',source_id:x.id,
      project_id:file.source_project_id,job_id:reportJob(file.source_post_id),job_name:base.job_name,date:base.date,
      kind:'document',status:'extracted_needs_review',text,source_updated_at:x.checked_at,source_checked_at:base.source_checked_at,
      attachments:[{id:file.id,name:file.name,mime_type:file.mime_type,status:'extracted_needs_review',text_extracted:true}],
      source_url:'https://glass-forge-hub.base44.app/report-library'});
    indexed++;
  }
  if(extractions.length)sourceStatus.document_extractions={available:indexed>0,complete:false};
  if(indexed)issues.push(warning('document_extractions','pdf_extraction_needs_review',indexed+' PDF extractions are indexed as owner-only references. Their identifiers and dates have not been approved for automated job updates or customer replies.','field_reporting_lead'));
  return {received:extractions.length,indexed,rejected};
}
export function adaptKnowledgeSources(data,now,generatedAt=now) {
  const {jobs,calendar,reports,projects,libraryReports,files,links,notes,fees,snapshots,batches,tracker,trackerRows,serviceCases,libraryImport}=data;
  const issues=[], evidence=[];
  const trusted=buildTrustedSourceLinks({jobs,fees,projects,links});
  const calendarJob=trusted.calendar_job, reportJob=trusted.post_job;
  const projectLinks=[...links,...projects.filter(p=>p.job_id&&!p.source_deleted).map(p=>({project_id:p.source_project_id,job_id:p.job_id})),...trusted.project_links];
  const bareIndex=createJobIndex({jobs,projectLinks});
  const alreadyMappedProjects=new Set(projectLinks.filter(p=>p.project_id&&p.job_id&&p.source_deleted!==true&&p.enabled!==false).map(p=>p.project_id));
  // A unique exact source name can suggest the existing canonical association;
  // it is evidence-local only and never rewrites the job or ProBuild project.
  for(const p of projects.filter(p=>!p.job_id&&!p.source_deleted&&!alreadyMappedProjects.has(p.source_project_id))) {
    const m=matchJobEvidence({job_name:p.name},bareIndex);
    if(m.status==='matched')projectLinks.push({project_id:p.source_project_id,job_id:m.job_id});
  }
  const index=createJobIndex({jobs,projectLinks});
  for(const e of calendar)evidence.push({source_key:'calendar:'+e.id,source_type:'calendar',source_id:e.id,
    job_id:e.job_id||calendarJob(e.google_event_id)||null,job_name:e.job_name,address:e.address,
    po_numbers:[e.po_number].filter(Boolean),oe_numbers:[e.oe_number].filter(Boolean),
    date:e.event_date,end_date:e.end_date,end_exclusive:e.source==='google'&&!e.start_time,
    kind:'calendar_event',status:e.source_status||'scheduled',text:(e.scope_notes||'')+(e.start_time?'\nSource start time: '+e.start_time+' America/Denver; timing retained as source text.':'')+(e.end_time?' End time: '+e.end_time+'.':''),
    source_updated_at:e.source==='app'?e.updated_date:null,source_checked_at:e.source==='app'?now:null,
    source_url:'https://glass-forge-hub.base44.app/calendar'});
  const libraryIds=new Set(libraryReports.map(r=>r.source_post_id));
  for(const r of reports) {
    // Keep both ingests if their contents differ; shared origin is reconciled by
    // the core using actual source revision, never an arbitrary database write.
    evidence.push({source_key:'field_report:'+r.id,source_type:'probuild_reports',source_id:r.post_id||r.id,
      job_id:reportJob(r.post_id),job_name:r.job_name,project_id:r.project_id,date:r.job_date,
      kind:'field_report',text:r.message||'',source_checked_at:null,
      attachments:[],source_url:'https://glass-forge-hub.base44.app/reports'});
  }
  const fileByKey=new Map(files.map(f=>[f.source_key,f]));
  for(const r of libraryReports) {
    evidence.push({source_key:'library_report:'+r.id,source_type:'probuild_library',source_id:r.source_post_id||r.id,
      job_id:reportJob(r.source_post_id),job_name:r.project_name,project_id:r.source_project_id,
      date:r.report_date||r.source_created_at,kind:'field_report',status:r.source_deleted?'deleted':'recorded',
      text:r.message||'',source_checked_at:r.source_checked_at,source_updated_at:r.source_created_at,
      attachments:(r.attachments||[]).map(a=>{const f=fileByKey.get(a.source_key);return {id:f?.id||a.id,name:f?.name||a.name,mime_type:f?.mime_type||a.mime_type,status:f?.status||'unverified',text_extracted:false};}),
      source_url:'https://glass-forge-hub.base44.app/report-library'});
  }
  const reportByPost=new Map(libraryReports.map(r=>[r.source_post_id,r]));
  for(const f of files)if(f.mime_type==='application/pdf'||/\.pdf$/i.test(f.name||'')) {
    const r=reportByPost.get(f.source_post_id);
    evidence.push({source_key:'document:'+f.id,source_type:'documents',source_id:f.id,project_id:f.source_project_id,
      job_name:r?.project_name,job_id:reportJob(f.source_post_id),date:r?.report_date,kind:'document',text:'',
      status:f.source_deleted?'deleted':f.status,source_checked_at:r?.source_checked_at,
      attachments:[{id:f.id,name:f.name,mime_type:f.mime_type,status:f.status,text_extracted:false}],
      source_url:'https://glass-forge-hub.base44.app/report-library'});
  }
  for(const n of notes)evidence.push({source_key:'note:'+n.id,source_type:'job_notes',source_id:n.id,job_id:n.job_id,date:n.note_date,
    kind:'note',text:n.body,source_updated_at:n.updated_date,source_checked_at:now});
  for(const c of serviceCases) {
    const jobId=c.result?.job?.id;
    if(!jobId)continue;
    evidence.push({source_key:'service_case:'+c.id,source_type:'service_requests',source_id:c.id,job_id:jobId,date:c.updated_date,
      kind:'note',status:c.status||'draft',text:'Service request ('+(c.status||'draft')+'). Review the service case before scheduling; a draft is not a confirmed visit.',
      source_checked_at:now,source_url:'https://glass-forge-hub.base44.app/messages?view=assistant'});
  }
  const sourceStatus={
    calendar:{available:true,complete:true},
    probuild_reports:{available:true,complete:true},
    probuild_library:{available:!!libraryImport,complete:libraryImport?.source_complete===true,checked_at:libraryImport?.source_complete?libraryImport.checked_at:null},
    documents:{available:true,complete:false,checked_at:libraryImport?.source_complete?libraryImport.checked_at:null},
    job_notes:{available:true,complete:true,checked_at:now},service_requests:{available:true,complete:true,checked_at:now},
    sales_tracker:{available:!!tracker,complete:!!tracker,checked_at:tracker?.source_captured_at},
  };
  issues.push(warning('calendar','upstream_freshness_unverified','Calendar rows are present, but the source check watermark is unavailable. Database update time does not establish source freshness.','calendar_ops_lead'));
  issues.push(warning('probuild_reports','upstream_freshness_unverified','Recent reports are present; this ingest does not expose a complete-source check watermark.','field_reporting_lead'));
  const pdfCount=files.filter(f=>f.mime_type==='application/pdf'||/\.pdf$/i.test(f.name||'')).length;
  if(pdfCount)issues.push(warning('documents','pdf_text_not_extracted',pdfCount+' PDF references indexed. Content requires extraction and source review; filenames are not evidence of order or delivery status.','field_reporting_lead'));
  const today=denverCalendarDate(now),rangeEnd=dayPlus(today,30);
  for(const [calendarName,type,kind] of [['UT Window Install','outlook_installation','installation_scheduled'],['UT DC Service','outlook_service','service_scheduled']]) {
    const relevant=snapshots.filter(s=>s.calendar_name===calendarName), manifests=batches.filter(b=>b.calendar_name===calendarName);
    const coverage=assessCalendarCoverage({calendarName,snapshots:relevant,batches:manifests,rangeStart:today,rangeEnd,now,maxAgeHours:26});
    const {candidates,invalid}=calendarCandidates(relevant,manifests,now);
    if(invalid)issues.push(warning(type,'invalid_manifest','A saved calendar capture or batch is inconsistent; excluded.','calendar_ops_lead'));
    // All complete snapshots retain historical evidence. Later source captures
    // supersede the same occurrence only when the source ID is stable.
    for(const s of candidates.filter(c=>c.complete))for(const [i,e] of s.events.entries()) {
      const winner=candidates.filter(c=>c.range_start<=e.event_date&&c.range_end>=e.event_date).sort((a,b)=>Date.parse(b.captured_at)-Date.parse(a.captured_at)||Number(b.is_batch)-Number(a.is_batch))[0];
      // A newer complete capture omitting an old occurrence is not evidence that it
      // remains scheduled. A newer incomplete capture also cannot confirm it.
      const superseded=winner&&(Date.parse(winner.captured_at)>Date.parse(s.captured_at)||(!winner.complete&&winner.captured_at===s.captured_at));
      evidence.push({source_key:type+':'+s.id+':'+i,source_type:type,
      source_id:e.source_occurrence_key||(e.source_event_id?e.source_event_id+':'+e.event_date:s.id+':'+i),job_id:e.job_id,job_name:e.job_name,address:e.address,
      date:e.event_date,end_date:e.end_date,end_exclusive:!e.start_time,kind,status:superseded?'superseded':e.source_status||e.status||(e.is_cancelled||e.isCancelled?'cancelled':'schedule_saved_cancellation_unverified'),text:(e.scope_notes||'')+(e.start_time?'\nSource start time: '+e.start_time+' America/Denver; timing retained as source text.':'')+(e.end_time?' End time: '+e.end_time+'.':''),
      po_numbers:[e.po_number].filter(Boolean),oe_numbers:[e.oe_number].filter(Boolean),
      source_checked_at:s.captured_at,source_updated_at:s.captured_at,source_url:'https://glass-forge-hub.base44.app/calendar'});
    }
    const selected=latest(candidates);
    sourceStatus[type]={available:candidates.length>0,complete:coverage.coverage_complete,checked_at:selected?.captured_at,range_start:selected?.range_start,range_end:selected?.range_end,coverage};
    if(!coverage.fresh_complete)issues.push(warning(type,'calendar_coverage_gap','Upcoming 31 days are not completely covered by a fresh capture. Last capture: '+(selected?.captured_at||'none')+'.','calendar_ops_lead'));
    issues.push(warning(type,'cancellation_not_verified','Saved Outlook events do not establish current cancellation status. Confirm before promising a visit.','calendar_ops_lead'));
  }
  for(const r of trackerRows) {
    const label=[r.builder,r.subdivision,'lot '+r.lot].filter(Boolean).join(' ');
    const variants=[label,r.builder+' - '+r.lot+' '+r.subdivision,r.builder+' '+r.subdivision+' '+r.lot,r.builder+' - '+r.subdivision+' - '+r.lot];
    const matched=variants.map(job_name=>matchJobEvidence({job_name,po_numbers:[r.po].filter(Boolean),oe_numbers:[r.oe].filter(Boolean)},index));
    const ids=[...new Set(matched.filter(m=>m.status==='matched'&&matchJobEvidence({job_id:m.job_id,job_name:label,po_numbers:[r.po].filter(Boolean),oe_numbers:[r.oe].filter(Boolean)},index).status==='matched').map(m=>m.job_id))];
    evidence.push({source_key:'tracker:'+tracker.id+':'+r.source_row,source_type:'sales_tracker',source_id:tracker.id+':'+r.source_row,
      job_id:ids.length===1?ids[0]:null,job_name:label,
      po_numbers:[r.po].filter(Boolean),oe_numbers:[r.oe].filter(Boolean),date:r.arrival_date||r.order_date,
      kind:r.arrival_date?'estimated_arrival':'note',status:'saved_tracker_estimate',
      text:'Sales Tracker '+r.source_sheet+' row '+r.source_row+(r.arrival_date?' — estimated arrival '+r.arrival_date:' — no arrival date recorded')+'. '+asText(r.notes),
      source_checked_at:tracker.source_captured_at,source_url:'https://glass-forge-hub.base44.app/sales-tracker'});
  }
  if(!tracker||Date.parse(now)-Date.parse(tracker.source_captured_at)>26*3600000)issues.push(warning('sales_tracker','stale_arrival_source','Arrival dates come from '+(tracker?.source_captured_at||'no validated snapshot')+'. Obtain a current Sales Tracker; do not confirm delivery from this copy.','sales_order_lead'));
  const liveCounts=mergeLiveEvidence({data,evidence,sourceStatus,issues,calendarJob,reportJob,now});
  const documentExtraction=addDocumentExtractions({data,evidence,sourceStatus,issues,reportJob});
  const missingTextIssue=issues.findIndex(i=>i.source==='documents'&&i.code==='pdf_text_not_extracted');
  if(missingTextIssue>=0) {
    const missing=pdfCount-documentExtraction.indexed;
    if(missing===0)issues.splice(missingTextIssue,1);
    else issues[missingTextIssue].detail=missing+' PDF references have no current validated extraction. '+documentExtraction.indexed+' separate extractions are available for owner review; none approve shipment or service dates.';
  }
  const result=buildJobContexts({jobs,evidence,projectLinks,sourceStatus,now:generatedAt,maxEvidencePerJob:200});
  const evidenceByKey=new Map();
  for(const e of evidence) {if(!evidenceByKey.has(e.source_key))evidenceByKey.set(e.source_key,[]);evidenceByKey.get(e.source_key).push(e);}
  const identityText=v=>asText(v).replace(/https?:\/\/[^\s<>"']+/gi,'[link omitted]').slice(0,2000);
  result.unassigned=result.unassigned.map(u=>{
    const rows=evidenceByKey.get(u.source_key)||[];
    if(rows.length!==1)return {...u,identity_metadata_ambiguous:rows.length>1};
    const e=rows[0];
    return {...u,source_type:e.source_type,source_id:e.source_id,job_name:identityText(e.job_name)||null,project_id:identityText(e.project_id)||null,address:identityText(e.address)||null,po_numbers:(e.po_numbers||[]).map(identityText),oe_numbers:(e.oe_numbers||[]).map(identityText)};
  });
  result.unassigned.push(...documentExtraction.rejected,...trusted.diagnostics.map(d=>({source_key:'identity:'+d.source_type+':'+d.source_id,source_type:'identity_'+d.source_type,source_id:d.source_id,reason:d.reason,candidate_job_ids:d.candidate_job_ids,fee_ids:d.fee_ids,details:d.details||[]})));
  result.counts.identity_link_diagnostics=trusted.diagnostics.length;
  result.counts.extraction_rejections=documentExtraction.rejected.length;
  result.counts.unassigned_records=result.unassigned.length;
  for(const context of result.contexts) {
    const unreviewed=context.evidence.filter(e=>e.source_type==='document_extractions');
    for(const e of unreviewed)context.gaps.push({code:'document_extraction_needs_review',source_key:e.source_key,detail:'Extracted document statements are for owner review only; no job identity or operational date has been promoted.',severity:'warning'});
    if(unreviewed.length){context.counts.gaps=context.gaps.length;if(context.status==='ready')context.status='incomplete';context.briefing+='\nUnreviewed PDF extractions are owner references only; never use them as approved reply facts.';}
  }
  const groups=new Map();
  for(const u of result.unassigned) { const key=((u.source_key||'').startsWith('identity:')?u.source_type:(u.source_key||'unknown').split(':')[0])+':'+u.reason; if(!groups.has(key))groups.set(key,{count:0,examples:[]}); const g=groups.get(key);g.count++;if(g.examples.length<10)g.examples.push(u); }
  for(const [key,g] of groups)issues.push({...warning(key.split(':')[0],key.split(':').slice(1).join(':'),g.count+' source records were not assigned safely; some may be non-job events.',/^(?:document|document_extraction|field_report|library_report|live_probuild|identity_probuild_project|identity_probuild_post):/.test(key)?'field_reporting_lead':key.startsWith('tracker:')?'sales_order_lead':'calendar_ops_lead'),count:g.count,examples:g.examples});
  return {...result,source_status:sourceStatus,issues,source_counts:{jobs:jobs.length,calendar:calendar.length,field_reports:reports.length,library_projects:projects.length,library_reports:libraryReports.length,files:files.length,pdf_files:pdfCount,job_notes:notes.length,tracker_rows:trackerRows.length,service_cases:serviceCases.length,live_google:liveCounts.calendar,live_probuild:liveCounts.probuild,document_extractions:documentExtraction.received,indexed_document_extractions:documentExtraction.indexed,rejected_document_extractions:documentExtraction.rejected.length,trusted_project_links:trusted.counts.project_links,trusted_calendar_links:trusted.counts.calendar_links,trusted_post_links:trusted.counts.post_links,trusted_identity_diagnostics:trusted.diagnostics.length,duplicate_report_origins:[...libraryIds].filter(id=>reports.some(r=>r.post_id===id)).length}};
}

export async function collectKnowledgeSources(api,readTracker,now,providerData,getNow) {
  const definitions={
    jobs:['Jobs','id,canonical_name,aliases,po_numbers,oe_numbers,address,builder'],
    calendar:['CalendarEvents','id,job_id,job_name,address,source,source_status,event_date,start_time,end_time,end_date,scope_notes,po_number,oe_number,google_event_id,updated_date'],
    reports:['FieldReports','id,post_id,project_id,job_name,job_date,message,attachment_count'],
    projects:['FieldLibraryProject','id,source_project_id,name,job_id,source_deleted,source_checked_at'],
    libraryReports:['FieldLibraryReport','id,source_post_id,source_project_id,project_name,report_date,source_created_at,source_deleted,message,source_checked_at,attachments'],
    files:['FieldLibraryFile','id,source_key,source_project_id,source_post_id,name,mime_type,status,source_deleted,verified_at,sha256'],
    extractions:['JobDocumentExtraction','id,extraction_key,file_id,sha256,source_project_id,source_post_id,status,checked_at,result',{status:'extracted_needs_review'}],
    links:['ProbuildProjectLink','id,project_id,job_id,job_name'],notes:['JobNotes','id,job_id,note_date,body,updated_date'],
    fees:['FeeLines','id,job_id,calendar_event_id,probuild_post_id,probuild_project_id,job_name_raw,job_name_norm,needs_review,match_confidence,superseded_by'],
    snapshots:['OutlookCalendarSnapshot','id,calendar_name,captured_at,range_start,range_end,timezone,complete,events,event_count'],
    batches:['OutlookCalendarBatch','id,calendar_name,captured_at,range_start,range_end,timezone,complete,snapshot_ids,event_count'],
    serviceCases:['MessageServiceCase','id,status,result,updated_date'],
  };
  const data={},entries=Object.entries(definitions);let cursor=0;
  await Promise.all(Array.from({length:3},async()=>{for(;;){const item=entries[cursor++];if(!item)return;const [key,[entity,selected,query={}]]=item;data[key]=await allKnowledgeRows(api.entities[entity],fields(selected),query);}}));
  data.tracker=(await api.entities.SalesTrackerSnapshot.filter({status:'validated'},'-source_captured_at',1))[0]||null;
  data.libraryImport=(await api.entities.FieldLibraryImport.list('-created_date',1,0,fields('id,checked_at,source_complete,files_complete')))[0]||null;
  data.trackerRows=[];
  if(data.tracker) data.trackerRows=await readTracker(data.tracker,api);
  if(typeof providerData==='function') {
    try {data.providerData=await providerData();}
    catch {data.providerData={calendar:{items:[],complete:false,error:'provider_read_failed'},probuild:{items:[],complete:false,error:'provider_read_failed'}};}
  } else data.providerData=providerData;
  const generatedAt=typeof getNow==='function'?getNow():now;
  return adaptKnowledgeSources(data,now,generatedAt);
}

export async function refreshJobKnowledge({api,readTracker,readProviders,now=new Date().toISOString(),getNow=()=>new Date().toISOString(),force=false}) {
  const active=(await api.entities.JobKnowledgeRun.filter({status:'building'},'-started_at',1))[0];
  if(active&&Date.parse(now)-Date.parse(active.started_at)<15*60000)return {status:'busy',run_id:active.id};
  const previous=(await api.entities.JobKnowledgeRun.filter({status:'complete'},'-started_at',1))[0];
  if(!force&&previous&&Date.parse(now)-Date.parse(previous.completed_at)<30*60000)return {status:'recent',run_id:previous.id,counts:previous.counts};
  const run=await api.entities.JobKnowledgeRun.create({status:'building',started_at:now,automatic_send_allowed:false});
  try {
    const result=await collectKnowledgeSources(api,readTracker,now,readProviders,getNow);
    // A new immutable generation becomes visible only after every job is stored.
    // A failed build leaves the previous complete generation available and stale.
    const records=result.contexts.map(context=>({run_id:run.id,job_id:context.job_id,job_name:context.job_name,status:context.status,generated_at:context.generated_at,briefing:context.briefing,context}));
    for(let i=0;i<records.length;i+=25)await api.entities.JobKnowledge.bulkCreate(records.slice(i,i+25));
    const unassignedChunks=[];
    for(let i=0;i<result.unassigned.length;i+=200)unassignedChunks.push({run_id:run.id,chunk_index:i/200,records:result.unassigned.slice(i,i+200)});
    for(let i=0;i<unassignedChunks.length;i+=10)await api.entities.JobKnowledgeUnassigned.bulkCreate(unassignedChunks.slice(i,i+10));
    const persisted=await allKnowledgeRows(api.entities.JobKnowledge,['id','job_id'],{run_id:run.id});
    const expectedJobs=new Set(records.map(r=>r.job_id));
    if(persisted.length!==records.length||new Set(persisted.map(r=>r.job_id)).size!==records.length||persisted.some(r=>!expectedJobs.has(r.job_id)))throw Error('Prepared job count mismatch');
    const savedChunks=await allKnowledgeRows(api.entities.JobKnowledgeUnassigned,['id','chunk_index','records'],{run_id:run.id});
    if(savedChunks.length!==unassignedChunks.length||new Set(savedChunks.map(c=>c.chunk_index)).size!==unassignedChunks.length||savedChunks.some(c=>!Number.isInteger(c.chunk_index)||c.chunk_index<0||c.chunk_index>=unassignedChunks.length||JSON.stringify(c.records)!==JSON.stringify(unassignedChunks[c.chunk_index].records)))throw Error('Prepared unassigned source references mismatch');
    const completed_at=getNow();
    await api.entities.JobKnowledgeRun.update(run.id,{status:'complete',completed_at,counts:result.counts,source_counts:result.source_counts,source_status:result.source_status,issues:result.issues,unassigned_count:result.unassigned.length,unassigned_chunks:unassignedChunks.length,automatic_send_allowed:false});
    // One persistent exception per type, updated instead of texting repeatedly.
    let notification_error=false;
    try { const activeKeys=new Set(),previousKeys=new Set((previous?.issues||[]).map(i=>'job_knowledge:'+i.source+':'+i.code));
    for(const issue of result.issues) {
      const key='job_knowledge:'+issue.source+':'+issue.code;
      activeKeys.add(key);
      const old=(await api.entities.AgentCenterEscalation.filter({escalation_key:key},'-created_date',1))[0];
      const continued=previousKeys.has(key),preserveClosed=old&&['answered','dismissed'].includes(old.status)&&(continued||!previous);
      const row={escalation_key:key,agent_id:issue.assigned_to,department:'Job information',title:'Job data: '+issue.code.replaceAll('_',' '),context:issue.detail,status:preserveClosed?old.status:'needs_owner_decision',created_at:old?.created_at||now,...(preserveClosed?{}:{resolved_at:null,resolution:''})};
      if(old)await api.entities.AgentCenterEscalation.update(old.id,row);else await api.entities.AgentCenterEscalation.create(row);
    }
    const existing=await allKnowledgeRows(api.entities.AgentCenterEscalation,['id','escalation_key','status'],{department:'Job information'});
    for(const item of existing)if(typeof item.escalation_key==='string'&&item.escalation_key.startsWith('job_knowledge:')&&!activeKeys.has(item.escalation_key)&&item.status==='needs_owner_decision') {
      await api.entities.AgentCenterEscalation.update(item.id,{status:'answered',resolved_at:getNow(),resolution:'No longer present in completed preparation '+run.id+'.'});
    }
    }catch{notification_error=true;}
    return {status:'complete',run_id:run.id,counts:result.counts,source_counts:result.source_counts,issues:result.issues.length,notification_error,automatic_send_allowed:false};
  }catch(error){await api.entities.JobKnowledgeRun.update(run.id,{status:'failed',completed_at:new Date().toISOString(),error:'Job preparation failed. The previous complete generation is retained; source records were not changed.'}).catch(()=>{});throw error;}
}

export async function readPreparedJob(api,jobId,now=new Date().toISOString()) {
  if(typeof jobId!=='string'||!/^[A-Za-z0-9_-]{1,160}$/.test(jobId))throw Error('Invalid job ID');
  const run=(await api.entities.JobKnowledgeRun.filter({status:'complete'},'-started_at',1))[0];
  if(!run)return {context:null,status:'not_prepared',automatic_send_allowed:false};
  const rows=await api.entities.JobKnowledge.filter({run_id:run.id,job_id:jobId},'-created_date',2);
  if(rows.length!==1)return {context:null,status:'missing_or_ambiguous',run_id:run.id,automatic_send_allowed:false};
  const age=Date.parse(now)-Date.parse(run.started_at),stale=!Number.isFinite(age)||age<0||age>26*3600000;
  const context=structuredClone(rows[0].context);
  // Re-evaluate source age at read time. A cached 'current' label must not remain
  // current for days merely because the expensive aggregation was precomputed.
  if(context?.sources)for(const source of Object.values(context.sources)) {
    const elapsed=Date.parse(now)-Date.parse(source.checked_at);
    source.age_hours=Number.isFinite(elapsed)?Math.round(elapsed/36000)/100:null;
    if(source.state==='current'&&(!Number.isFinite(elapsed)||elapsed<0||elapsed>26*3600000))source.state=Number.isFinite(elapsed)&&elapsed>=0?'stale':'unknown';
  }
  const staleSources=Object.values(context?.sources||{}).filter(s=>s.state!=='current');
  if(stale||staleSources.length) {
    context.briefing='READ-TIME CHECK: '+(stale?'Prepared job context is stale. ':'')+staleSources.map(s=>s.source_type+' is '+s.state).join('; ')+'. Verify relevant source details before a customer commitment.\n'+(context.briefing||'');
    if(context.status!=='needs_review')context.status='incomplete';
  }
  return {context,status:context.status||rows[0].status,run_id:run.id,prepared_at:run.completed_at,stale,automatic_send_allowed:false};
}
