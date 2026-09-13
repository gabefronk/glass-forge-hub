import test from 'node:test';
import assert from 'node:assert/strict';
import {adaptKnowledgeSources,collectKnowledgeSources,refreshJobKnowledge,readPreparedJob,allKnowledgeRows,isKnowledgeOwner} from '../shared/jobKnowledgeService.mjs';
import {buildJobReplyFacts} from './jobReplyContext.mjs';

const NOW='2026-09-13T15:00:00Z';
const JOBS=[{id:'j16',canonical_name:'Acme - Pine Grove lot 16',aliases:['Acme - 16 Pine Grove'],po_numbers:['0016'],oe_numbers:['OE16'],address:'16 Main St'}, {id:'j17',canonical_name:'Acme - Pine Grove lot 17',po_numbers:['0017'],oe_numbers:['OE17'],address:'17 Main St'}];
const data=patch=>({jobs:JOBS,calendar:[],reports:[],projects:[],libraryReports:[],files:[],links:[],notes:[],fees:[],snapshots:[],batches:[],tracker:null,trackerRows:[],serviceCases:[],libraryImport:null,...patch});
const event=patch=>({source_event_id:'event16',event_date:'2026-09-15',job_name:JOBS[0].canonical_name,scope_notes:'Service crew expected.',...patch});
const snap=patch=>({id:'s1',calendar_name:'UT DC Service',timezone:'America/Denver',captured_at:NOW,range_start:'2026-09-13',range_end:'2026-10-13',complete:true,events:[event()],event_count:1,...patch});
const adapt=patch=>adaptKnowledgeSources(data(patch),NOW);
const ctx=out=>out.contexts.find(c=>c.job_id==='j16');

function fakeApi(initial={},options={}) {
  const stores={},calls=[];let sequence=0;
  const names=['Jobs','CalendarEvents','FieldReports','FieldLibraryProject','FieldLibraryReport','FieldLibraryFile','ProbuildProjectLink','JobNotes','FeeLines','OutlookCalendarSnapshot','OutlookCalendarBatch','MessageServiceCase','SalesTrackerSnapshot','FieldLibraryImport','JobKnowledgeRun','JobKnowledge','JobKnowledgeUnassigned','AgentCenterEscalation','JobDocumentExtraction'];
  const entities=Object.fromEntries(names.map(name=>{
    stores[name]=structuredClone(initial[name]||[]);
    const filter=async(query={},sort='id',limit=500,skip=0,selected)=>{
      calls.push({name,method:'filter',query,sort,limit,skip,selected});
      let rows=stores[name].filter(r=>Object.entries(query).every(([k,v])=>r[k]===v));
      const direction=sort?.startsWith('-')?-1:1,field=sort?.replace(/^-/,'')||'id';
      rows=[...rows].sort((a,b)=>direction*String(a[field]??'').localeCompare(String(b[field]??''))).slice(skip,skip+limit);
      return rows.map(r=>selected?Object.fromEntries(selected.filter(k=>k in r).map(k=>[k,structuredClone(r[k])])):structuredClone(r));
    };
    const create=async row=>{calls.push({name,method:'create'});const saved={...structuredClone(row),id:`${name}-${++sequence}`};stores[name].push(saved);return structuredClone(saved);};
    return [name,{filter,list:(sort,limit,skip,selected)=>filter({},sort,limit,skip,selected),create,update:async(id,row)=>{calls.push({name,method:'update',id});const found=stores[name].find(r=>r.id===id);if(!found)throw Error('missing');Object.assign(found,structuredClone(row));return structuredClone(found);},bulkCreate:async rows=>{calls.push({name,method:'bulkCreate'});if(options.failChunk&&name==='JobKnowledgeUnassigned')throw Error('synthetic chunk failure');for(const row of rows)await create(options.wrongJob&&name==='JobKnowledge'?{...row,job_id:'wrong-'+row.job_id}:row);return rows;}}];
  }));
  return {entities,stores,calls};
}

test('owner gate requires both admin and exact approved account',()=>{
  assert.equal(isKnowledgeOwner({role:'admin',email:'gabefronk@gmail.com'}),true);
  assert.equal(isKnowledgeOwner({role:'manager',email:'gabefronk@gmail.com'}),false);
  assert.equal(isKnowledgeOwner({role:'admin',email:'other@example.test'}),false);
});
test('adapter retains date-only service as service, not arrival',()=>{
  const c=ctx(adapt({snapshots:[snap()]}));assert.equal(c.next_events.length,1);assert.equal(c.next_events[0].category,'service');assert.equal(c.next_arrivals.length,0);
  assert.equal(c.sources.outlook_service.state,'current');assert.equal(c.sources.outlook_service.complete,true);
});
test('snapshot timezone and exact event count validated before evidence accepted',()=>{
  for(const patch of [{timezone:'UTC'},{event_count:4},{events:[event({event_date:'2026-11-01'})]}]){
    const out=adapt({snapshots:[snap(patch)]});assert.equal(ctx(out).next_events.length,0);assert.ok(out.issues.some(i=>i.code==='invalid_manifest'));
  }
});
test('later complete empty capture suppresses old upcoming event while retaining historical reference',()=>{
  const c=ctx(adapt({snapshots:[snap({id:'old',captured_at:'2026-09-12T10:00:00Z'}),snap({id:'new',events:[],event_count:0})]}));
  assert.equal(c.next_events.length,0);assert.equal(c.evidence.length,1);assert.equal(c.evidence[0].status,'superseded');
});
test('rescheduled source event exposes only newer date as upcoming',()=>{
  const c=ctx(adapt({snapshots:[snap({id:'old',captured_at:'2026-09-12T10:00:00Z'}),snap({id:'new',events:[event({event_date:'2026-09-20'})]})]}));
  assert.equal(c.next_events.length,1);assert.equal(c.next_events[0].date,'2026-09-20');assert.equal(c.evidence_references.length,2);
});
test('later incomplete capture prevents old date being advertised as confirmed upcoming',()=>{
  const c=ctx(adapt({snapshots:[snap({id:'old',captured_at:'2026-09-12T10:00:00Z'}),snap({id:'partial',complete:false,events:[],event_count:0})]}));
  assert.equal(c.next_events.length,0);assert.equal(c.sources.outlook_service.state,'partial');
});
test('cancelled Outlook status survives adaptation',()=>{
  const c=ctx(adapt({snapshots:[snap({events:[event({status:'cancelled'})]})]}));assert.equal(c.next_events.length,0);assert.equal(c.evidence[0].status,'cancelled');
});
test('snapshot retains source local time in evidence and all-day exclusive end',()=>{
  let c=ctx(adapt({snapshots:[snap({events:[event({start_time:'09:30',end_time:'11:00'})]})]}));assert.match(c.evidence[0].text,/09:30 America\/Denver/);
  c=ctx(adapt({snapshots:[snap({events:[event({event_date:'2026-09-13',end_date:'2026-09-14'})]})]}));assert.equal(c.evidence[0].end_exclusive,true);
});
test('valid batch accepts partial chunks with nearby capture times instead of requiring exact capture equality',()=>{
  const chunk=snap({complete:false,captured_at:'2026-09-13T14:59:00Z'});
  const batch={id:'b1',calendar_name:chunk.calendar_name,timezone:chunk.timezone,captured_at:NOW,range_start:chunk.range_start,range_end:chunk.range_end,complete:true,snapshot_ids:['s1'],event_count:1};
  const c=ctx(adapt({snapshots:[chunk],batches:[batch]}));assert.equal(c.next_events.length,1);assert.equal(c.sources.outlook_service.complete,true);
});
test('Google database updated_date is not promoted to source revision or upstream check',()=>{
  const c=ctx(adapt({calendar:[{id:'g1',source:'google',job_id:'j16',event_date:'2026-09-14',job_name:JOBS[0].canonical_name,updated_date:NOW}]}));
  assert.equal(c.evidence[0].source_updated_at,null);assert.equal(c.sources.calendar.state,'unknown');
});
test('tracker PO conflicting with explicit lot is quarantined, never overwritten with canonical job',()=>{
  const out=adapt({tracker:{id:'t1',source_captured_at:NOW},trackerRows:[{source_sheet:'DAILY SALES',source_row:2,builder:'Acme',subdivision:'Pine Grove',lot:'17',po:'0016',arrival_date:'2026-09-20'}]});
  assert.equal(ctx(out).next_arrivals.length,0);assert.ok(out.unassigned.some(u=>u.reason==='lot_disagrees_with_job'));
});
test('tracker valid exact PO and lot yield estimate with source row and source timestamp',()=>{
  const c=ctx(adapt({tracker:{id:'t1',source_captured_at:NOW},trackerRows:[{source_sheet:'DAILY SALES',source_row:2,builder:'Acme',subdivision:'Pine Grove',lot:'16',po:'0016',arrival_date:'2026-09-20'}]}));
  assert.equal(c.next_arrivals.length,1);assert.equal(c.next_arrivals[0].certainty,'estimated');assert.match(c.next_arrivals[0].text,/row 2/);
});
test('document file never supplies extracted PDF content merely because it is stored',()=>{
  const c=ctx(adapt({links:[{project_id:'p16',job_id:'j16'}],files:[{id:'f1',source_project_id:'p16',mime_type:'application/pdf',status:'verified',name:'Inspection.pdf'}]}));
  assert.ok(c.gaps.some(g=>g.code==='document_text_unavailable'));assert.equal(c.latest_documents[0].text,'');
});
test('source pagination preserves all pages and rejects repeating IDs',async()=>{
  const rows=Array.from({length:1001},(_,i)=>({id:String(i)}));let calls=0;
  const result=await allKnowledgeRows({filter:async(_,__,limit,skip)=>{calls++;return rows.slice(skip,skip+limit);}},['id']);assert.equal(result.length,1001);assert.equal(calls,3);
  await assert.rejects(()=>allKnowledgeRows({filter:async()=>rows.slice(0,500)},['id']),/repeated/);
});
test('collector projects timezone fields required for coverage validation',async()=>{
  const api=fakeApi({Jobs:JOBS,OutlookCalendarSnapshot:[snap()]});const out=await collectKnowledgeSources(api,async()=>[],NOW);
  assert.equal(out.source_status.outlook_service.complete,true);
  for(const name of ['OutlookCalendarSnapshot','OutlookCalendarBatch'])assert.ok(api.calls.find(c=>c.name===name&&c.method==='filter').selected.includes('timezone'));
});
test('immutable generation writes all jobs, then records completion without modifying original sources',async()=>{
  const api=fakeApi({Jobs:JOBS,JobNotes:[{id:'n1',job_id:'j16',note_date:'2026-09-12',body:'Door inspected',updated_date:NOW}]});
  const out=await refreshJobKnowledge({api,readTracker:async()=>[],now:NOW,getNow:()=>NOW,force:true});assert.equal(out.status,'complete');
  assert.equal(api.stores.JobKnowledge.length,2);assert.equal(api.stores.JobKnowledgeRun[0].status,'complete');
  assert.ok(api.calls.filter(c=>['create','update','bulkCreate'].includes(c.method)).every(c=>['JobKnowledge','JobKnowledgeRun','JobKnowledgeUnassigned','AgentCenterEscalation'].includes(c.name)));
});
test('unassigned references persisted in complete chunks before publishing generation',async()=>{
  const calendar=Array.from({length:401},(_,i)=>({id:'g'+i,job_name:'Unknown '+i,event_date:'2026-09-14',source:'google'}));
  const api=fakeApi({Jobs:JOBS,CalendarEvents:calendar});await refreshJobKnowledge({api,readTracker:async()=>[],now:NOW,getNow:()=>NOW,force:true});
  assert.deepEqual(api.stores.JobKnowledgeUnassigned.map(c=>c.records.length),[200,200,1]);assert.equal(api.stores.JobKnowledgeRun[0].unassigned_count,401);assert.equal(api.stores.JobKnowledgeRun[0].unassigned_chunks,3);assert.equal(api.stores.JobKnowledgeRun[0].unassigned,undefined);
});
test('failed unmatched chunk prevents generation from becoming complete',async()=>{
  const previous={id:'previous',status:'complete',started_at:'2026-09-01T00:00:00Z',completed_at:'2026-09-01T01:00:00Z'};
  const api=fakeApi({Jobs:JOBS,JobKnowledgeRun:[previous],CalendarEvents:[{id:'g1',job_name:'Unknown',source:'google',event_date:'2026-09-14'}]},{failChunk:true});
  await assert.rejects(()=>refreshJobKnowledge({api,readTracker:async()=>[],now:NOW,getNow:()=>NOW,force:true}),/chunk failure/);
  assert.equal(api.stores.JobKnowledgeRun.find(r=>r.id!=='previous').status,'failed');assert.equal(api.stores.JobKnowledgeRun.find(r=>r.id==='previous').status,'complete');
});
test('mismatched persisted job ID set prevents generation completion despite equal row count',async()=>{
  const api=fakeApi({Jobs:JOBS},{wrongJob:true});await assert.rejects(()=>refreshJobKnowledge({api,readTracker:async()=>[],now:NOW,getNow:()=>NOW,force:true}),/job count mismatch/);assert.equal(api.stores.JobKnowledgeRun[0].status,'failed');
});
test('read chooses newest source generation even if older run finished later',async()=>{
  const old={id:'old',status:'complete',started_at:'2026-09-13T10:00:00Z',completed_at:'2026-09-13T14:00:00Z'}, newer={id:'new',status:'complete',started_at:'2026-09-13T11:00:00Z',completed_at:'2026-09-13T12:00:00Z'};
  const api=fakeApi({JobKnowledgeRun:[old,newer],JobKnowledge:[{id:'k1',run_id:'new',job_id:'j16',status:'ready',context:{status:'ready',briefing:'Prepared.',sources:{notes:{source_type:'notes',state:'current',checked_at:NOW}}}}]});
  const out=await readPreparedJob(api,'j16',NOW);assert.equal(out.run_id,'new');assert.equal(out.status,'ready');
});
test('read rechecks source freshness without mutating saved generation or claiming readiness',async()=>{
  const api=fakeApi({JobKnowledgeRun:[{id:'r1',status:'complete',started_at:NOW,completed_at:NOW}],JobKnowledge:[{id:'k1',run_id:'r1',job_id:'j16',status:'ready',context:{status:'ready',briefing:'Prepared.',sources:{notes:{source_type:'notes',state:'current',checked_at:NOW}}}}]});
  const out=await readPreparedJob(api,'j16','2026-09-15T15:00:00Z');assert.equal(out.stale,true);assert.equal(out.context.sources.notes.state,'stale');assert.equal(out.status,'incomplete');assert.match(out.context.briefing,/READ-TIME CHECK/);assert.equal(api.stores.JobKnowledge[0].context.sources.notes.state,'current');
});
test('read rejects duplicate prepared records instead of picking one',async()=>{
  const api=fakeApi({JobKnowledgeRun:[{id:'r1',status:'complete',started_at:NOW,completed_at:NOW}],JobKnowledge:[{id:'a',run_id:'r1',job_id:'j16'},{id:'b',run_id:'r1',job_id:'j16'}]});
  const out=await readPreparedJob(api,'j16',NOW);assert.equal(out.status,'missing_or_ambiguous');assert.equal(out.context,null);
});

const live=(patch={})=>({complete:true,checked_at:NOW,range_start:'2026-06-15',range_end:'2026-12-12',items:[],...patch});
const googleEvent=patch=>({google_event_id:'g16',job_name:JOBS[0].canonical_name,event_date:'2026-09-14',start_at:'2026-09-14T15:30:00Z',end_at:'2026-09-14T17:00:00Z',all_day:false,source_status:'confirmed',scope_notes:'Current source detail.',source_updated_at:NOW,...patch});
test('live Google replaces cache by exact Google ID, retains source instant, and does not freshen old cache',()=>{
  const out=adapt({calendar:[{id:'c16',google_event_id:'g16',source:'google',job_id:'j16',job_name:JOBS[0].canonical_name,event_date:'2026-09-15'},{id:'old',google_event_id:'old16',source:'google',job_id:'j16',job_name:JOBS[0].canonical_name,event_date:'2026-01-01'}],providerData:{calendar:live({items:[googleEvent()]}),probuild:live()}});
  const c=ctx(out),fresh=c.evidence.find(e=>e.source_type==='live_google'),old=c.evidence.find(e=>e.source_key==='calendar:old');
  assert.equal(fresh.date,'2026-09-14T15:30:00Z');assert.equal(fresh.end_date,'2026-09-14T17:00:00Z');assert.equal(fresh.date_info.precision,'instant');assert.equal(c.evidence.find(e=>e.source_key==='calendar:c16').status,'superseded');
  assert.equal(old.source_checked_at,null);assert.equal(c.sources.calendar.state,'unknown');assert.equal(c.sources.live_google.state,'current');assert.equal(c.next_events.length,1);
});
test('Google cancellation tombstone joins cached identity and invalidates upcoming copy',()=>{
  const c=ctx(adapt({calendar:[{id:'c16',google_event_id:'g16',source:'google',job_id:'j16',job_name:JOBS[0].canonical_name,event_date:'2026-09-15'}],providerData:{calendar:live({items:[googleEvent({job_name:'',event_date:null,start_at:null,end_at:null,deleted:true,source_status:'cancelled'})]}),probuild:live()}}));
  assert.equal(c.next_events.length,0);assert.equal(c.evidence.find(e=>e.source_type==='live_google').status,'cancelled');assert.equal(c.evidence.find(e=>e.source_type==='live_google').matched_job_id,'j16');
});
test('live updated job name contradicting cached hard identity is quarantined',()=>{
  const out=adapt({calendar:[{id:'c16',google_event_id:'g16',source:'google',job_id:'j16',job_name:JOBS[0].canonical_name,event_date:'2026-09-15'}],providerData:{calendar:live({items:[googleEvent({job_name:JOBS[1].canonical_name})]}),probuild:live()}});
  assert.equal(ctx(out).next_events.length,0);assert.ok(out.unassigned.some(u=>u.source_key==='live_google:g16'&&u.reason==='contradictory_identifiers'));
});
test('partial live read has no fresh watermark and does not infer disappearance from absent IDs',()=>{
  const out=adapt({calendar:[{id:'old',google_event_id:'old16',source:'google',job_id:'j16',job_name:JOBS[0].canonical_name,event_date:'2026-09-15'}],providerData:{calendar:live({complete:false,checked_at:NOW,error:'calendar_page_limit',items:[googleEvent()]}),probuild:live()}});
  const c=ctx(out);assert.equal(c.sources.live_google.checked_at,null);assert.equal(c.sources.live_google.state,'unknown');assert.notEqual(c.evidence.find(e=>e.source_key==='calendar:old').status,'superseded');assert.ok(out.issues.some(i=>i.source==='live_google'&&i.code==='live_source_incomplete'));
});
test('live ProBuild replaces matching cached ingests while old reports keep original age',()=>{
  const out=adapt({links:[{project_id:'p16',job_id:'j16'}],reports:[{id:'r1',post_id:'post1',project_id:'p16',job_name:JOBS[0].canonical_name,job_date:'2026-09-12',message:'Old report'},{id:'r2',post_id:'post2',project_id:'p16',job_name:JOBS[0].canonical_name,job_date:'2026-01-01',message:'Historical report'}],libraryReports:[{id:'lr1',source_post_id:'post1',source_project_id:'p16',project_name:JOBS[0].canonical_name,report_date:'2026-09-12',message:'Old library report',source_checked_at:'2026-09-01T00:00:00Z'}],providerData:{calendar:live(),probuild:live({range_start:'2026-08-14',range_end:'2026-09-13',items:[{project_id:'p16',post_id:'post1',job_name:JOBS[0].canonical_name,job_date:'2026-09-12',message:'Current edited report',source_updated_at:NOW}]})}});
  const c=ctx(out);assert.equal(c.evidence.find(e=>e.source_key==='field_report:r1').status,'superseded');assert.equal(c.evidence.find(e=>e.source_key==='library_report:lr1').status,'superseded');assert.equal(c.evidence.find(e=>e.source_key==='field_report:r2').source_checked_at,null);assert.equal(c.sources.probuild_reports.state,'unknown');assert.equal(c.sources.live_probuild.state,'current');assert.equal(c.latest_notes.filter(e=>e.text==='Current edited report').length,1);
});
test('deleted project tombstone invalidates cached reports and documents without deleting original data',()=>{
  const input=data({links:[{project_id:'p16',job_id:'j16'}],reports:[{id:'r1',post_id:'post1',project_id:'p16',job_name:JOBS[0].canonical_name,job_date:'2026-09-12',message:'Old report'}],files:[{id:'f1',source_project_id:'p16',source_post_id:'post1',name:'Report.pdf',mime_type:'application/pdf'}],providerData:{calendar:live(),probuild:live({deleted_projects:[{project_id:'p16',deleted:true}]})}}),copy=structuredClone(input);
  const c=ctx(adaptKnowledgeSources(input,NOW));assert.equal(c.latest_notes.length,0);assert.equal(c.latest_documents.length,0);assert.ok(c.evidence.every(e=>e.status==='deleted'));assert.deepEqual(input,copy);
});
test('one provider failure keeps independent live and saved-source evidence available',()=>{
  const c=ctx(adapt({notes:[{id:'n16',job_id:'j16',note_date:'2026-09-12',body:'Internal note'}],providerData:{calendar:live({items:[googleEvent()]}),probuild:{complete:false,items:[],error:'probuild_auth_failed'}}}));
  assert.equal(c.sources.live_google.state,'current');assert.equal(c.sources.live_probuild.state,'unavailable');assert.equal(c.latest_notes.length,1);assert.equal(c.next_events.length,1);
});
test('provider callback invoked once after stored reads, and completion clock verifies later watermark',async()=>{
  const api=fakeApi({Jobs:JOBS});let calls=0;const end='2026-09-13T15:00:20Z';
  const out=await collectKnowledgeSources(api,async()=>[],NOW,async()=>{calls++;assert.ok(api.calls.some(c=>c.name==='Jobs'));return {calendar:live({checked_at:end,items:[googleEvent()]}),probuild:live({checked_at:end})};},()=>end);
  assert.equal(calls,1);assert.equal(ctx(out).generated_at,'2026-09-13T15:00:20.000Z');assert.equal(ctx(out).sources.live_google.state,'current');
});
test('provider callback rejection cannot discard successfully read notes or fail generation',async()=>{
  const api=fakeApi({Jobs:JOBS,JobNotes:[{id:'n1',job_id:'j16',note_date:'2026-09-12',body:'Existing note'}]});let calls=0;
  const out=await refreshJobKnowledge({api,readTracker:async()=>[],readProviders:async()=>{calls++;throw Error('sensitive provider credentials');},now:NOW,getNow:()=>NOW,force:true});
  assert.equal(out.status,'complete');assert.equal(calls,1);const c=api.stores.JobKnowledge.find(j=>j.job_id==='j16').context;assert.equal(c.latest_notes.length,1);assert.doesNotMatch(JSON.stringify(api.stores.JobKnowledgeRun),/sensitive provider credentials/);
});
test('unassigned rows preserve identity metadata for owner resolution but omit text and URLs',()=>{
  const out=adapt({calendar:[{id:'unknown',source:'google',job_name:'Unknown subdivision lot 88',address:'88 Main St',po_number:'PO88',oe_number:'OE88',event_date:'2026-09-14',scope_notes:'Private access code 7654'}]});
  const u=out.unassigned.find(u=>u.source_key==='calendar:unknown');assert.equal(u.source_id,'unknown');assert.equal(u.job_name,'Unknown subdivision lot 88');assert.equal(u.address,'88 Main St');assert.deepEqual(u.po_numbers,['PO88']);assert.deepEqual(u.oe_numbers,['OE88']);assert.doesNotMatch(JSON.stringify(u),/7654|scope_notes|source_url/);
});

const fee=patch=>({id:'fee16',job_id:'j16',job_name_raw:JOBS[0].canonical_name,match_confidence:'high',calendar_event_id:'g16',probuild_post_id:'post16',probuild_project_id:'p16',...patch});
const hash='a'.repeat(64);
const pdfFile=patch=>({id:'pdf16',source_key:'file:pdf16',source_project_id:'p16',source_post_id:'post16',name:'Report.pdf',mime_type:'application/pdf',status:'verified',sha256:hash,...patch});
const extraction=patch=>({id:'extract16',extraction_key:'pdf16:'+hash,file_id:'pdf16',sha256:hash,source_project_id:'p16',source_post_id:'post16',status:'extracted_needs_review',checked_at:NOW,result:{document_type:'quote',job_identifiers:[{type:'lot',value:'17',source_quote:'Lot 17',page:1}],dated_statements:[{date_text:'September 20, 2026',normalized_date:'2026-09-20',meaning:'estimated_arrival',source_quote:'Estimated arrival September 20, 2026',page:1,uncertainty:'Quote not ordered'}],summary:'Quote not ordered; price is $750.'},...patch});
const docInput=patch=>({links:[{project_id:'p16',job_id:'j16'}],libraryReports:[{id:'report16',source_post_id:'post16',source_project_id:'p16',project_name:JOBS[0].canonical_name,report_date:'2026-09-12',message:'Report',source_checked_at:NOW}],files:[pdfFile()],extractions:[extraction()],...patch});
test('validated high-confidence fee identity can link a source even when its billing line needs review',()=>{
  const out=adapt({fees:[fee({needs_review:true})],calendar:[{id:'calendar16',google_event_id:'g16',source:'google',event_date:'2026-09-14',job_name:'Service visit'}]});
  assert.equal(ctx(out).evidence.length,1);assert.equal(ctx(out).evidence[0].matched_job_id,'j16');assert.equal(out.source_counts.trusted_calendar_links,1);
});
test('low-confidence or mismatched high-confidence fee cannot manufacture a source mapping',()=>{
  for(const patch of [{match_confidence:'medium'},{job_name_raw:JOBS[1].canonical_name}]){
    const out=adapt({fees:[fee(patch)],calendar:[{id:'calendar16',google_event_id:'g16',source:'google',event_date:'2026-09-14',job_name:'Service visit'}]});assert.equal(ctx(out).evidence.length,0);
  }
});
test('trusted fee project link resolves duplicate exact names without overriding an existing contrary project link',()=>{
  const duplicateJobs=[...JOBS,{id:'duplicate16',canonical_name:JOBS[0].canonical_name}];
  let out=adapt({jobs:duplicateJobs,fees:[fee()],projects:[{id:'project16',source_project_id:'p16',name:JOBS[0].canonical_name}],reports:[{id:'report16',post_id:'other-post',project_id:'p16',job_name:JOBS[0].canonical_name,job_date:'2026-09-12',message:'Report'}]});
  assert.equal(out.source_counts.trusted_project_links,1);assert.equal(ctx(out).evidence.length,1);
  out=adapt({fees:[fee()],links:[{project_id:'p16',job_id:'j17'}],projects:[{id:'project16',source_project_id:'p16',name:JOBS[0].canonical_name}],reports:[{id:'report16',post_id:'post16',project_id:'p16',job_name:JOBS[0].canonical_name,job_date:'2026-09-12',message:'Report'}]});
  assert.equal(out.source_counts.trusted_project_links,0);assert.ok(out.unassigned.some(u=>u.reason==='existing_project_link_conflict'));assert.equal(ctx(out).evidence.length,0);
});
test('owner extraction preserves original file hash binding and unreviewed status without promoting identifiers or dates',()=>{
  const out=adapt(docInput()),c=ctx(out),x=c.evidence.find(e=>e.source_type==='document_extractions');
  assert.equal(x.matched_job_id,'j16');assert.equal(x.status,'extracted_needs_review');assert.equal(x.category,'document');assert.equal(x.date,'2026-09-12');assert.match(x.text,/UNREVIEWED PDF EXTRACTION/);assert.match(x.text,/Lot 17/);assert.match(x.text,/Quote not ordered/);assert.equal(c.next_arrivals.length,0);assert.equal(c.next_events.length,0);assert.ok(c.gaps.some(g=>g.code==='document_extraction_needs_review'));assert.equal(out.source_counts.indexed_document_extractions,1);
  assert.equal(c.evidence.find(e=>e.source_key==='document:pdf16').attachments[0].text_extracted,true);assert.ok(!out.issues.some(i=>i.code==='pdf_text_not_extracted'));
});
test('extracted notes and prices never enter customer reply facts',()=>{
  const context=ctx(adapt(docInput()));const r=buildJobReplyFacts({conversation:{job_id:'j16'},prepared:{context,run_id:'run16'},now:NOW});
  assert.equal(r.facts.length,0);assert.doesNotMatch(JSON.stringify(r.facts),/750|Quote not ordered|September 20/);
});
test('changed hash, unavailable file and source identity changes reject extraction and preserve file evidence',()=>{
  for(const [patch,reason] of [[{files:[pdfFile({sha256:'b'.repeat(64)})]},'extraction_source_hash_changed'],[{files:[pdfFile({source_deleted:true})]},'extraction_source_unavailable'],[{extractions:[extraction({source_project_id:'p17'})]},'extraction_source_identity_changed']]){
    const out=adapt(docInput(patch));assert.equal(ctx(out).evidence.filter(e=>e.source_type==='document_extractions').length,0);assert.ok(out.unassigned.some(u=>u.reason===reason));assert.equal(out.source_counts.indexed_document_extractions,0);
  }
});
test('deleted project tombstone cannot be reactivated by an otherwise valid PDF extraction',()=>{
  const out=adapt(docInput({providerData:{calendar:live(),probuild:live({deleted_projects:[{project_id:'p16',deleted:true}]})}}));
  assert.equal(ctx(out).latest_documents.length,0);assert.ok(out.unassigned.some(u=>u.reason==='extraction_source_unavailable'));
});
test('unvalidated extraction shape and duplicate extracts are quarantined instead of silently selected',()=>{
  let out=adapt(docInput({extractions:[extraction({result:{summary:'bad'}})]}));assert.ok(out.unassigned.some(u=>u.reason==='extraction_schema_invalid'));
  out=adapt(docInput({extractions:[extraction(),extraction({id:'extract16-second'})]}));assert.equal(out.source_counts.indexed_document_extractions,0);assert.equal(out.unassigned.filter(u=>u.reason==='duplicate_extraction_requires_review').length,2);
});
test('collector queries only review-pending extraction records and projects hash/identity fields',async()=>{
  const api=fakeApi({Jobs:JOBS,FeeLines:[fee()],FieldLibraryFile:[pdfFile()],ProbuildProjectLink:[{id:'link16',project_id:'p16',job_id:'j16'}],JobDocumentExtraction:[extraction(),extraction({id:'failed',status:'failed',result:null})]});
  const out=await collectKnowledgeSources(api,async()=>[],NOW);assert.equal(out.source_counts.document_extractions,1);
  const ext=api.calls.find(c=>c.name==='JobDocumentExtraction'&&c.method==='filter');assert.deepEqual(ext.query,{status:'extracted_needs_review'});assert.ok(ext.selected.includes('sha256'));
  const fees=api.calls.find(c=>c.name==='FeeLines'&&c.method==='filter');for(const field of ['probuild_project_id','job_name_raw','job_name_norm'])assert.ok(fees.selected.includes(field));
  assert.ok(api.calls.find(c=>c.name==='FieldLibraryFile'&&c.method==='filter').selected.includes('sha256'));
});
test('completed preparation resolves only absent generated job-information issues',async()=>{
  const api=fakeApi({Jobs:JOBS,AgentCenterEscalation:[{id:'generated',department:'Job information',escalation_key:'job_knowledge:fixed_source:fixed_issue',status:'needs_owner_decision'},{id:'manual',department:'Job information',escalation_key:'owner:follow_up',status:'needs_owner_decision'},{id:'other_department',department:'Other',escalation_key:'job_knowledge:fixed_source:fixed_issue',status:'needs_owner_decision'}]});
  const result=await refreshJobKnowledge({api,readTracker:async()=>[],now:NOW,getNow:()=>NOW,force:true});
  const stale=api.stores.AgentCenterEscalation.find(e=>e.id==='generated');assert.equal(stale.status,'answered');assert.match(stale.resolution,new RegExp(result.run_id));assert.equal(stale.resolved_at,NOW);
  assert.equal(api.stores.AgentCenterEscalation.find(e=>e.id==='manual').status,'needs_owner_decision');assert.equal(api.stores.AgentCenterEscalation.find(e=>e.id==='other_department').status,'needs_owner_decision');
});
test('recurring issue reopens after absence while a continuously dismissed issue stays dismissed',async()=>{
  const key='job_knowledge:calendar:upstream_freshness_unverified';
  for(const continued of [false,true]){
    const api=fakeApi({Jobs:JOBS,JobKnowledgeRun:[{id:'prev',status:'complete',started_at:'2026-09-12T15:00:00Z',completed_at:'2026-09-12T15:01:00Z',issues:continued?[{source:'calendar',code:'upstream_freshness_unverified'}]:[]}],AgentCenterEscalation:[{id:'old',department:'Job information',escalation_key:key,status:'dismissed',resolved_at:'2026-09-12T16:00:00Z',resolution:'Owner reviewed'}]});
    await refreshJobKnowledge({api,readTracker:async()=>[],now:NOW,getNow:()=>NOW,force:true});const issue=api.stores.AgentCenterEscalation.find(e=>e.id==='old');
    assert.equal(issue.status,continued?'dismissed':'needs_owner_decision');assert.equal(issue.resolution,continued?'Owner reviewed':'');
  }
});
