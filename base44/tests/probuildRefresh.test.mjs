import test from 'node:test';
import assert from 'node:assert/strict';
import {createProbuildRefreshHandler} from '../shared/probuildRefresh.js';

function fixture(){
 let time=Date.parse('2026-09-13T19:00:00Z'),seq=0,sourceFailures=0,writeFailures=0,copyFailures=0,role='admin',email='gabefronk@gmail.com';
 const store={ProbuildRefreshRun:[],ProbuildSourceRevision:[],FieldLibraryProject:[],FieldLibraryReport:[],FieldLibraryFile:[]};
 const clone=x=>structuredClone(x);
 const entities=Object.fromEntries(Object.entries(store).map(([name,rows])=>[name,{
  async filter(query={},sort,limit=500,skip=0){return clone(rows.filter(r=>Object.entries(query).every(([k,v])=>r[k]===v)).slice(skip,skip+limit));},
  async list(){return clone(rows.slice().reverse());},async get(id){return clone(rows.find(r=>r.id===id));},
  async create(row){if(name==='FieldLibraryFile'&&writeFailures-->0)throw Error('private diagnostic');const r={...clone(row),id:'id'+(++seq)};rows.push(r);return clone(r);},
  async update(id,patch){const r=rows.find(r=>r.id===id);if(!r)throw Error('missing');Object.assign(r,clone(patch));return clone(r);}
 }]));
 const client={auth:{me:async()=>({role,email})},asServiceRole:{entities:new Proxy(entities,{get(o,key){if(!(key in o))throw Error('unauthorized entity '+String(key));return o[key];}})}};
 const projects={project1:{name:'Fixture project',createdAt:'2026-09-12T12:00:00Z'}};
 const posts={post1:{createdAt:'2026-09-12T13:00:00Z',message:'Source notes',attachments:{asset1:{type:'photo',generation:'123',fileMetadata:{sizeInBytes:5}}}}};
 const calls=[];
 const handler=createProbuildRefreshHandler({getClient:async()=>client,getToken:async()=>'test-only',now:()=>new Date(time),copyFile:async(req,id)=>{
  if(copyFailures-->0)throw Error('sensitive URL omitted');await entities.FieldLibraryFile.update(id,{status:'verified',file_uri:'private:fixture',sha256:'a'.repeat(64),size:5,verified_at:new Date(time).toISOString()});return {ok:true};
 },fetchImpl:async(url,options)=>{
  calls.push({method:options?.method||'GET',url:String(url)});
  if(sourceFailures-->0)return new Response('{}',{status:503});
  if(String(url).includes('firebasestorage'))return new Response('x',{status:206,headers:{'content-range':'bytes 0-0/5','content-type':'image/jpeg'}});
  const path=new URL(url).pathname;
  if(path.endsWith('/projects.json'))return Response.json(projects);
  if(path.endsWith('/projects/project1.json'))return Response.json(projects.project1);
  if(path.endsWith('/posts/project1.json'))return Response.json(posts);
  if(path.endsWith('/posts/project1/post1.json'))return Response.json(posts.post1);
  throw Error('unexpected source path');
 }});
 const call=async input=>{const res=await handler(new Request('https://example.invalid/worker',{method:'POST',body:JSON.stringify(input)}));return {status:res.status,...await res.json()};};
 const start=()=>call({action:'start',request_key:'repair_20260913',targets:[{project_id:'project1',post_ids:['post1']}]});
 const next=run=>call({action:'next',run_id:run.id,cursor:run.cursor,phase:run.phase});
 return {store,entities,projects,posts,calls,call,start,next,advance:ms=>time+=ms,sourceFail:n=>sourceFailures=n,writeFail:n=>writeFailures=n,copyFail:n=>copyFailures=n,auth:(r,e=email)=>{role=r;email=e;}};
}

test('owner authorization precedes source and entity actions',async()=>{
 const f=fixture();f.auth('manager');assert.equal((await f.start()).status,403);f.auth('admin','someone@example.com');assert.equal((await f.start()).status,403);assert.equal(f.calls.length,0);assert.equal(f.store.ProbuildRefreshRun.length,0);
});
test('client source targets are checked against accessible inventory',async()=>{
 const f=fixture();const r=await f.call({action:'start',request_key:'a',targets:[{project_id:'unknown',post_ids:['post1']}]});assert.equal(r.status,403);assert.equal(f.store.ProbuildRefreshRun.length,0);
});
test('bounded target validation rejects broad and invalid input',async()=>{
 const f=fixture();assert.equal((await f.call({action:'start',request_key:'a',targets:[{project_id:'../private',post_ids:['post1']}]})).status,400);assert.equal(f.calls.length,0);
});
test('repeated start resumes same durable run',async()=>{
 const f=fixture();const a=await f.start(),b=await f.start();assert.equal(a.run.id,b.run.id);assert.equal(b.resumed,true);assert.equal(f.store.ProbuildRefreshRun.length,1);
});
test('imports reports/assets only and completes after receipt verification',async()=>{
 const f=fixture();let r=await f.start();r=await f.next(r.run);assert.equal(r.run.source_complete,true);assert.equal(r.run.writes_complete,true);assert.equal(r.run.assets_complete,false);assert.equal(f.store.FieldLibraryReport.length,1);assert.equal(f.store.FieldLibraryFile.length,1);assert.equal(r.run.results[0].created,1);assert.equal(r.run.current_plan,undefined);r=await f.next(r.run);assert.equal(r.run.status,'files');r=await f.next(r.run);assert.equal(r.run.status,'complete');assert.equal(r.run.counts.verified_assets,1);assert.equal(r.run.history_complete,false);assert.ok(f.calls.every(c=>c.method==='GET'));const count=f.calls.length;assert.equal((await f.next(r.run)).run.status,'complete');assert.equal(f.calls.length,count);
});
test('source failure retains cursor and bounds retries with backoff',async()=>{
 const f=fixture();let r=await f.start();f.sourceFail(4);r=await f.next(r.run);assert.equal(r.run.cursor,0);assert.equal(r.run.status,'retry_wait');assert.equal(r.run.source_complete,false);assert.equal((await f.next(r.run)).status,429);f.advance(30001);r=await f.next(r.run);assert.equal(r.run.attempts,2);f.advance(120001);r=await f.next(r.run);assert.equal(r.run.status,'failed');assert.equal(r.run.cursor,0);assert.equal(r.run.errors.length,3);assert.equal((await f.next(r.run)).run.errors.length,3);
});
test('partial write retries reuse immutable plan, counts and source revisions',async()=>{
 const f=fixture();let r=await f.start();f.writeFail(1);r=await f.next(r.run);assert.equal(r.run.cursor,0);assert.equal(f.store.FieldLibraryReport.length,1);assert.ok(f.store.ProbuildRefreshRun[0].current_plan);const revisions=f.store.ProbuildSourceRevision.length;f.advance(30001);r=await f.next(r.run);assert.equal(r.run.results[0].created,1);assert.equal(f.store.FieldLibraryReport.length,1);assert.equal(f.store.FieldLibraryFile.length,1);assert.equal(f.store.ProbuildSourceRevision.length,revisions);
});
test('edited/deleted posts preserve prior source revision and explicit job link',async()=>{
 const f=fixture();let r=await f.start();r=await f.next(r.run);const project=f.store.FieldLibraryProject[0];project.job_id='existing_job';project.job_name='Existing job';const oldHash=f.store.FieldLibraryReport[0].source_hash;f.posts.post1.message='Edited';f.posts.post1.deletedAt='2026-09-13T18:00:00Z';r=await f.call({action:'start',request_key:'second',targets:[{project_id:'project1',post_ids:['post1']}]});r=await f.next(r.run);assert.equal(r.run.results[0].edited,1);assert.equal(r.run.results[0].deleted,1);assert.equal(f.store.FieldLibraryReport[0].source_deleted,true);assert.equal(project.job_id,'existing_job');assert.ok(f.store.ProbuildSourceRevision.some(x=>x.source_hash===oldHash));assert.equal(f.store.FieldLibraryFile[0].source_deleted,true);
});
test('absent target preserves previous records and stays incomplete',async()=>{
 const f=fixture();let r=await f.start();delete f.posts.post1;r=await f.next(r.run);assert.equal(r.error,'requested_post_absent_review_required');assert.equal(r.run.source_complete,false);assert.equal(r.run.cursor,0);assert.equal(f.store.FieldLibraryProject.length,0);
});
test('failed asset transfer retains report progress and private receipt',async()=>{
 const f=fixture();let r=await f.start();r=await f.next(r.run);f.copyFail(1);r=await f.next(r.run);assert.equal(r.run.status,'retry_wait');assert.equal(r.run.phase,'files');assert.equal(r.run.cursor,0);assert.equal(r.run.source_complete,true);assert.equal(r.run.assets_complete,false);assert.equal(r.error,'refresh_step_failed');assert.ok(!JSON.stringify(r).includes('sensitive'));f.advance(30001);r=await f.next(r.run);r=await f.next(r.run);assert.equal(r.run.status,'complete');
});
test('stale next requests do not repeat completed project writes',async()=>{
 const f=fixture();const r=await f.start();await f.next(r.run);const replay=await f.next(r.run);assert.equal(replay.stale_request,true);assert.equal(f.store.FieldLibraryReport.length,1);
});
test('source probe verifies provider generation and returns no URLs',async()=>{
 const f=fixture();let r=await f.start();r=await f.next(r.run);r=await f.next(r.run);const file=f.store.FieldLibraryFile[0];const probe=await f.call({action:'probe_file',file_id:file.id});assert.equal(probe.matches_stored,true);assert.equal(probe.source_bytes,5);assert.ok(!JSON.stringify(probe).includes('https://'));f.posts.post1.attachments.asset1.generation='changed';assert.equal((await f.call({action:'probe_file',file_id:file.id})).status,409);
});


import {createProbuildControlHandler} from '../shared/probuildControl.js';

function scanFixture(count=31){
 let time=Date.parse('2026-09-13T19:00:00Z'),seq=0,failIds=new Set();const scans=[],reads=[];
 const projects=Object.fromEntries(Array.from({length:count},(_,i)=>['p'+i,{name:'Project '+i}]));
 const clone=x=>structuredClone(x);
 const handler=createProbuildControlHandler({getClient:async()=>({auth:{me:async()=>({role:'admin',email:'gabefronk@gmail.com'})},asServiceRole:{entities:{ProbuildReportScan:{
  async create(row){const value={...clone(row),id:'scan'+(++seq)};scans.push(value);return clone(value);},
  async get(id){return clone(scans.find(r=>r.id===id));},async update(id,patch){const value=scans.find(r=>r.id===id);Object.assign(value,clone(patch));return clone(value);}
 }}}}),getToken:async()=>'scanFixture',now:()=>new Date(time),fetchImpl:async(url)=>{
  const path=new URL(url).pathname;if(path.endsWith('/projects.json'))return Response.json(projects);
  const pid=/\/posts\/(p\d+)\.json$/.exec(path)?.[1];if(!pid)throw Error('unexpected path');reads.push(pid);
  if(failIds.has(pid))return new Response('{}',{status:503});return Response.json({post1:{createdAt:'2026-09-12T13:00:00Z',message:'scanFixture',attachments:{}}});
 }});
 const call=async input=>{const res=await handler(new Request('https://scanFixture.invalid',{method:'POST',body:JSON.stringify(input)}));return {status:res.status,...await res.json()};};
 const start=()=>call({action:'daily',start_date:'2026-09-12'});const next=r=>call({action:'daily_next',scan_id:r.scan_id,offset:r.next_offset});
 return {scans,reads,start,next,advance:ms=>time+=ms,fail:ids=>failIds=new Set(ids)};
}
test('failed page keeps cursor and earlier successful page without false finish',async()=>{
 const f=scanFixture();let r=await f.start();r=await f.next(r);assert.equal(r.next_offset,30);assert.equal(r.posts.length,30);f.fail(['p30']);r=await f.next(r);assert.equal(r.status,502);assert.equal(r.next_offset,30);assert.equal(r.posts.length,30);assert.equal(r.finished,false);assert.equal(r.coverage.complete,false);assert.equal(f.scans[0].error_history.length,1);assert.equal((await f.next(r)).status,429);f.fail([]);f.advance(30001);r=await f.next(r);assert.equal(r.next_offset,31);assert.equal(r.posts.length,31);assert.equal(r.finished,true);assert.equal(r.coverage.complete,true);assert.equal(f.scans[0].error_history.length,1);const readCount=f.reads.length;await f.next(r);assert.equal(f.reads.length,readCount);
});
test('legacy record without retry fields gains bounded retry state',async()=>{
 const f=scanFixture(1);let r=await f.start();f.fail(['p0']);r=await f.next(r);f.advance(30001);r=await f.next(r);f.advance(120001);r=await f.next(r);assert.equal(r.status,409);assert.equal(r.next_offset,0);assert.equal(r.finished,false);assert.equal(f.scans[0].retry_state.exhausted,true);const reads=f.reads.length;await f.next(r);assert.equal(f.reads.length,reads);
});
test('previously finished legacy scan with failures retries only failed projects',async()=>{
 const f=scanFixture(2);let r=await f.start();Object.assign(f.scans[0],{cursor:2,finished:true,errors:[{project_id:'p1',project_name:'Project 1'}],posts:[{project_id:'p0',post_id:'post1',created_at:'2026-09-12T13:00:00Z',attachments:[]}]});r={...r,next_offset:2};r=await f.next(r);assert.equal(r.coverage.complete,true);assert.equal(r.posts.length,2);assert.deepEqual(f.reads,['p1']);
});
test('sanitized error history is bounded',async()=>{
 const f=scanFixture(1);let r=await f.start();f.scans[0].error_history=Array.from({length:100},()=>({code:'previous'}));f.fail(['p0']);r=await f.next(r);assert.equal(f.scans[0].error_history.length,100);assert.ok(!JSON.stringify(f.scans[0].error_history).includes('https://'));assert.equal(r.finished,false);
});

