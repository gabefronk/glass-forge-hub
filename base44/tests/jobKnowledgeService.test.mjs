import test from 'node:test';
import assert from 'node:assert/strict';
import {adaptKnowledgeSources,collectKnowledgeSources,refreshJobKnowledge,readPreparedJob,allKnowledgeRows,isKnowledgeOwner} from '../shared/jobKnowledgeService.mjs';

const NOW='2026-09-13T15:00:00Z';
const JOBS=[{id:'j16',canonical_name:'Acme - Pine Grove lot 16',aliases:['Acme - 16 Pine Grove'],po_numbers:['0016'],oe_numbers:['OE16'],address:'16 Main St'}, {id:'j17',canonical_name:'Acme - Pine Grove lot 17',po_numbers:['0017'],oe_numbers:['OE17'],address:'17 Main St'}];
const data=patch=>({jobs:JOBS,calendar:[],reports:[],projects:[],libraryReports:[],files:[],links:[],notes:[],fees:[],snapshots:[],batches:[],tracker:null,trackerRows:[],serviceCases:[],libraryImport:null,...patch});
const event=patch=>({source_event_id:'event16',event_date:'2026-09-15',job_name:JOBS[0].canonical_name,scope_notes:'Service crew expected.',...patch});
const snap=patch=>({id:'s1',calendar_name:'UT DC Service',timezone:'America/Denver',captured_at:NOW,range_start:'2026-09-13',range_end:'2026-10-13',complete:true,events:[event()],event_count:1,...patch});
const adapt=patch=>adaptKnowledgeSources(data(patch),NOW);
const ctx=out=>out.contexts.find(c=>c.job_id==='j16');

function fakeApi(initial={},options={}) {
  const stores={},calls=[];let sequence=0;
  const names=['Jobs','CalendarEvents','FieldReports','FieldLibraryProject','FieldLibraryReport','FieldLibraryFile','ProbuildProjectLink','JobNotes','FeeLines','OutlookCalendarSnapshot','OutlookCalendarBatch','MessageServiceCase','SalesTrackerSnapshot','FieldLibraryImport','JobKnowledgeRun','JobKnowledge','JobKnowledgeUnassigned','AgentCenterEscalation'];
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
  const out=await refreshJobKnowledge({api,readTracker:async()=>[],now:NOW,force:true});assert.equal(out.status,'complete');
  assert.equal(api.stores.JobKnowledge.length,2);assert.equal(api.stores.JobKnowledgeRun[0].status,'complete');
  assert.ok(api.calls.filter(c=>['create','update','bulkCreate'].includes(c.method)).every(c=>['JobKnowledge','JobKnowledgeRun','JobKnowledgeUnassigned','AgentCenterEscalation'].includes(c.name)));
});
test('unassigned references persisted in complete chunks before publishing generation',async()=>{
  const calendar=Array.from({length:401},(_,i)=>({id:'g'+i,job_name:'Unknown '+i,event_date:'2026-09-14',source:'google'}));
  const api=fakeApi({Jobs:JOBS,CalendarEvents:calendar});await refreshJobKnowledge({api,readTracker:async()=>[],now:NOW,force:true});
  assert.deepEqual(api.stores.JobKnowledgeUnassigned.map(c=>c.records.length),[200,200,1]);assert.equal(api.stores.JobKnowledgeRun[0].unassigned_count,401);assert.equal(api.stores.JobKnowledgeRun[0].unassigned_chunks,3);assert.equal(api.stores.JobKnowledgeRun[0].unassigned,undefined);
});
test('failed unmatched chunk prevents generation from becoming complete',async()=>{
  const previous={id:'previous',status:'complete',started_at:'2026-09-01T00:00:00Z',completed_at:'2026-09-01T01:00:00Z'};
  const api=fakeApi({Jobs:JOBS,JobKnowledgeRun:[previous],CalendarEvents:[{id:'g1',job_name:'Unknown',source:'google',event_date:'2026-09-14'}]},{failChunk:true});
  await assert.rejects(()=>refreshJobKnowledge({api,readTracker:async()=>[],now:NOW,force:true}),/chunk failure/);
  assert.equal(api.stores.JobKnowledgeRun.find(r=>r.id!=='previous').status,'failed');assert.equal(api.stores.JobKnowledgeRun.find(r=>r.id==='previous').status,'complete');
});
test('mismatched persisted job ID set prevents generation completion despite equal row count',async()=>{
  const api=fakeApi({Jobs:JOBS},{wrongJob:true});await assert.rejects(()=>refreshJobKnowledge({api,readTracker:async()=>[],now:NOW,force:true}),/job count mismatch/);assert.equal(api.stores.JobKnowledgeRun[0].status,'failed');
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
