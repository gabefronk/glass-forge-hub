import test from 'node:test';
import assert from 'node:assert/strict';
import {buildJobReplyFacts} from './jobReplyContext.mjs';

const NOW='2026-09-13T15:00:00Z';
const entry=patch=>({source_key:'cal:e1',source_type:'calendar',matched_job_id:'j16',job_id:'j16',date:'2026-09-14',kind:'service_scheduled',category:'service',certainty:'scheduled_only',active:true,status:'scheduled',source_checked_at:NOW,...patch});
const prepared=patch=>({run_id:'run1',stale:false,status:'ready',context:{job_id:'j16',job_name:'Acme Pine Grove lot 16',generated_at:NOW,time_zone:'America/Denver',status:'ready',conflicts:[],evidence:[entry()],sources:{calendar:{source_type:'calendar',state:'current',available:true,complete:true,checked_at:NOW}},...patch}});
const build=(p=prepared(),conversation={job_id:'j16'},now=NOW)=>buildJobReplyFacts({conversation,prepared:p,now});

test('fresh exact job yields source-cited schedule facts without send authority',()=>{
  const r=build();assert.equal(r.facts.length,1);assert.match(r.facts[0],/service visit is scheduled/);assert.match(r.facts[0],/Source \[cal:e1\]/);assert.match(r.facts[0],/does not establish completion/);assert.equal(r.automatic_send_allowed,false);assert.equal(r.acknowledgment_allowed,true);
});
test('conversation must have exact job ID and prepared job must match',()=>{
  assert.equal(build(prepared(),{}).facts.length,0);assert.equal(build(prepared(),{job_id:'j17'}).notes[0].code,'prepared_job_mismatch');
});
test('row identity cannot contradict exact prepared job',()=>{
  for(const patch of [{matched_job_id:'j17'},{job_id:'j17'},{matched_job_id:undefined,job_id:undefined}])assert.equal(build(prepared({evidence:[entry(patch)]})).facts.length,0);
});
test('generation uses original collection timestamp, never fresh completed timestamp',()=>{
  const p=prepared({generated_at:'2026-09-01T00:00:00Z'});p.prepared_at=NOW;assert.equal(build(p).notes[0].code,'stale_job_generation');
  assert.equal(build(prepared({generated_at:null})).facts.length,0);assert.equal(build({...prepared(),stale:true}).facts.length,0);
});
test('future generation and malformed current time fail closed for facts',()=>{
  assert.equal(build(prepared({generated_at:'2026-10-01T00:00:00Z'})).facts.length,0);assert.equal(build(prepared(),{job_id:'j16'},'today').notes[0].code,'invalid_current_time');
});
test('job conflicts suppress facts but allow acknowledgment',()=>{
  for(const patch of [{conflicts:[{code:'conflicting_arrival_dates'}]},{status:'needs_review'},{counts:{conflicts:1}}]){
    const r=build(prepared(patch));assert.equal(r.facts.length,0);assert.equal(r.acknowledgment_allowed,true);assert.equal(r.notes[0].code,'job_conflicts');
  }
});
test('fresh global source cannot override stale row check',()=>{
  const r=build(prepared({evidence:[entry({source_checked_at:'2026-09-01T00:00:00Z'})]}));assert.equal(r.facts.length,0);assert.ok(r.notes.some(n=>n.code==='evidence_check_stale'));
});
test('missing row check may use genuine current source-wide check',()=>assert.equal(build(prepared({evidence:[entry({source_checked_at:null})]})).facts.length,1));
test('source stale, unavailable, incomplete or missing prevents its facts',()=>{
  for(const source of [undefined,{state:'stale',checked_at:NOW},{state:'current',checked_at:NOW,available:false},{state:'current',checked_at:NOW,complete:false}])assert.equal(build(prepared({sources:{calendar:source}})).facts.length,0);
});
test('one stale source does not block independent current-source facts',()=>{
  const r=build(prepared({evidence:[entry(),entry({source_key:'supplier:r1',source_type:'supplier',category:'arrival',certainty:'estimated'})]}));assert.equal(r.facts.length,1);assert.match(r.facts[0],/service visit/);assert.ok(r.omitted_count>0);
});
test('raw notes, access codes, prices, attachment names and phone numbers never enter facts',()=>{
  const secrets='Gate code 7189. Price $900. Call 555-888-7777.';
  const p=prepared({briefing:secrets,approved_facts:[secrets],evidence:[entry({text:secrets,attachments:[{name:secrets}],scope_notes:secrets}),entry({source_key:'note:n1',category:'note',text:secrets})]});
  const r=build(p);assert.equal(r.facts.length,1);assert.doesNotMatch(JSON.stringify(r),/7189|900|555-888|Gate code/);
});
test('estimated and confirmed arrival schedule wording remains distinct from delivered',()=>{
  let r=build(prepared({evidence:[entry({category:'arrival',certainty:'estimated'})]}));assert.match(r.facts[0],/estimated product arrival/);assert.match(r.facts[0],/not confirmation of arrival/);
  r=build(prepared({evidence:[entry({category:'arrival',certainty:'confirmed_schedule'})]}));assert.match(r.facts[0],/source labels the schedule confirmed/);
  for(const status of ['delivered','received','arrived'])assert.equal(build(prepared({evidence:[entry({category:'arrival',certainty:'confirmed_schedule',status})]})).facts.length,0);
});
test('unconfirmed arrival or inactive/cancelled/unverified occurrence does not become a reply fact',()=>{
  for(const patch of [{category:'arrival',certainty:'unconfirmed'},{active:false},{status:'cancelled'},{status:'superseded'},{status:'schedule_saved_cancellation_unverified'}])assert.equal(build(prepared({evidence:[entry(patch)]})).facts.length,0);
});
test('past ETAs and elapsed visits are excluded instead of implying completion',()=>{
  for(const patch of [{date:'2026-09-01',category:'arrival',certainty:'estimated'},{date:'2026-09-12'},{date:'2026-09-13T14:00:00Z'}])assert.equal(build(prepared({evidence:[entry(patch)]})).facts.length,0);
});
test('ongoing date-only spans honor exclusive end and maintain calendar day precision',()=>{
  let r=build(prepared({evidence:[entry({date:'2026-09-12',end_date:'2026-09-14',end_exclusive:true})]}));assert.equal(r.facts.length,1);assert.match(r.facts[0],/until before 2026-09-14/);assert.match(r.facts[0],/exact time not provided/);
  r=build(prepared({evidence:[entry({date:'2026-09-12',end_date:'2026-09-13',end_exclusive:true})]}));assert.equal(r.facts.length,0);
});
test('invalid and mixed-precision dates do not become facts',()=>{
  for(const patch of [{date:'2026-02-30'},{date:'2026-09-14T10:00:00'},{date:'2026-09-14',end_date:'2026-09-14T16:00:00Z'},{date:'2026-09-15',end_date:'2026-09-14'}])assert.equal(build(prepared({evidence:[entry(patch)]})).facts.length,0);
});
test('date-only Denver day does not shift to previous day',()=>{
  const r=build(prepared({evidence:[entry({date:'2026-09-13'})]}));assert.equal(r.facts.length,1);assert.match(r.facts[0],/2026-09-13 \(calendar date in America\/Denver/);
});
test('facts obey count, individual and total character bounds without cutting source citation',()=>{
  const rows=Array.from({length:60},(_,i)=>entry({source_key:'calendar:event'+i}));
  const r=build(prepared({evidence:rows}));assert.equal(r.facts.length,20);assert.ok(r.facts.every(f=>f.length<=800&&/checked .*\.$/.test(f)));assert.ok(r.facts.reduce((n,f)=>n+f.length,0)<=8000);assert.equal(r.omitted_count,40);
});
test('duplicate source keys produce one fact',()=>assert.equal(build(prepared({evidence:[entry(),entry()]})).facts.length,1));
test('routine factual omission leaves acknowledgment possible and no false send permission',()=>{
  const r=build(prepared({evidence:[]}));assert.equal(r.facts.length,0);assert.equal(r.acknowledgment_allowed,true);assert.equal(r.automatic_send_allowed,false);assert.equal(r.status,'no_verified_job_facts');
});
test('inputs are never mutated',()=>{
  const p=prepared(),copy=structuredClone(p);build(p);assert.deepEqual(p,copy);
});
