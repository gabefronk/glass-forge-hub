import test from 'node:test';
import assert from 'node:assert/strict';
import {createProbuildControlHandler,normalizePost,validateRange,boundedBytes,hash,TEAM} from '../base44/shared/probuildControl.js';

const project={name:'Builder 12 Meadow',description:'Original notes',createdBy:'crew',users:{crew:{addedAt:'date'}},lastModifiedAt:'2026-09-11T21:00:00Z'};
const post={createdAt:'2026-09-12T01:00:00Z',message:'Original work notes',attachments:{a1:{type:'photo',generation:'123',imageMetadata:{width:20,height:10}}}};
function fixture({owner=true,storageStatus=200,providerStatus=200,contended=false}={}) {
 const rows={},calls=[];
 const entities=new Proxy({}, {get(_,name){rows[name] ||= [];return {
  filter:async(q={},sort,limit=500,skip=0)=>rows[name].filter(x=>Object.entries(q).every(([k,v])=>x[k]===v)).slice(skip,skip+limit),
  get:async id=>rows[name].find(x=>x.id===id),
  create:async value=>{const row={id:name+'_'+(rows[name].length+1),...value};rows[name].push(row);return row;},
  update:async(id,value)=>{const row=rows[name].find(x=>x.id===id);Object.assign(row,value);return row;}
 };}});
 const client={auth:{me:async()=>owner===true?{role:'admin',email:'gabefronk@gmail.com'}:owner===false?{role:'manager',email:'other@example.test'}:owner},asServiceRole:{entities,integrations:{Core:{UploadPrivateFile:async()=>({file_uri:'private/test'}),CreateFileSignedUrl:async()=>({signed_url:'https://example.test/signed'})}}}};
 const fetchImpl=async(url,options={})=>{
  calls.push({url,options});const u=new URL(url);
  if(u.hostname==='firebasestorage.googleapis.com')return new Response(new Uint8Array([255,216,255,217]),{status:storageStatus,headers:{'content-type':'image/jpeg'}});
  if(providerStatus!==200)return new Response('{}',{status:providerStatus});
  if(options.method==='PUT')return new Response('{}',{status:contended?412:200});
  if(u.pathname.endsWith('/projects.json'))return Response.json({p1:project,p2:{name:'Other project'},p3:{name:'Deleted',deletedAt:'date'}});
  if(u.pathname.endsWith('/projects/p1.json'))return Response.json(project,{headers:{etag:'"version-1"'}});
  if(u.pathname.endsWith('/posts/p1.json'))return Response.json({s1:post,s2:{...post,deletedAt:'date'}});
  if(u.pathname.endsWith('/posts/p1/s1.json'))return Response.json(post);
  if(u.pathname.endsWith('/posts.json'))return Response.json({p1:{s1:post,s2:{...post,deletedAt:'date'}},p3:{s3:post}});
  return Response.json(null);
 };
 const handler=createProbuildControlHandler({getClient:async()=>client,getToken:async()=>'test-token',fetchImpl,now:()=>new Date('2026-09-12T18:00:00Z')});
 const invoke=async(input,headers={})=>{const r=await handler(new Request('https://example.test/api',{method:'POST',headers,body:JSON.stringify(input)}));return {status:r.status,data:await r.json()};};
 return {invoke,rows,calls};
}
test('normalizes keyed photo metadata and Mountain dates without guessing URLs',()=>{
 const p=normalizePost({id:'p1',name:'Meadow'},'s1',post);assert.equal(p.date,'2026-09-11');assert.equal(p.attachments[0].generation,'123');assert.equal(p.attachments[0].width,20);assert.equal(p.attachments[0].url,undefined);
});
test('rejects invalid dates and overly broad daily exports',()=>{
 for(const d of ['2026-99-22','2026-02-30','',null])assert.throws(()=>validateRange(d,d),/valid date/);
 assert.throws(()=>validateRange('2026-01-01','2026-03-01'));assert.deepEqual(validateRange('2026-09-11','2026-09-12'),{start:'2026-09-11',end:'2026-09-12'});
});
test('blocks non-owner and disabled device access before touching ProBuild',async()=>{
 const f=fixture({owner:false});assert.equal((await f.invoke({action:'projects'})).status,403);assert.equal(f.calls.length,0);
 assert.equal((await f.invoke({action:'projects'},{'x-glass-forge-control-key':'x'.repeat(48)})).status,401);assert.equal(f.calls.length,0);
});
test('paired device keys authenticate independently of browser sessions',async()=>{
 const f=fixture({owner:false}),key='x'.repeat(48);f.rows.ProbuildControlDevice=[{token_hash:await hash(key),enabled:true}];
 const r=await f.invoke({action:'projects'},{'x-glass-forge-control-key':key});assert.equal(r.status,200);assert.equal(r.data.projects.length,2);assert.equal(JSON.stringify(r.data).includes('test-token'),false);
});
test('daily export checks all accessible projects and excludes deleted content',async()=>{
 const f=fixture(),scan=await f.invoke({action:'daily',start_date:'2026-09-11'}),r=await f.invoke({action:'daily_next',scan_id:scan.data.scan_id,offset:0});assert.equal(r.status,200);assert.equal(r.data.coverage.accessible_projects,2);assert.equal(r.data.coverage.complete,true);assert.equal(r.data.posts.length,1);assert.equal(r.data.coverage.attachment_count,1);assert.equal(f.calls.length,3);
});
test('upstream failure never claims a complete or empty daily report',async()=>{
 const r=await fixture({providerStatus:503}).invoke({action:'daily',start_date:'2026-09-11'});assert.equal(r.status,502);assert.equal(r.data.coverage,undefined);
});
test('photo retrieval uses verified project/post/attachment and matching generation',async()=>{
 const f=fixture(),r=await f.invoke({action:'photo_bytes',project_id:'p1',post_id:'s1',attachment_id:'a1',generation:'123'});assert.equal(r.status,200);assert.equal(r.data.size,4);assert.equal(r.data.mime_type,'image/jpeg');
 const storage=f.calls.find(c=>c.url.includes('firebasestorage'));assert.equal(decodeURIComponent(new URL(storage.url).pathname),`/v0/b/probuild-prod.appspot.com/o/teams/${TEAM}/posts/p1/s1/attachments/a1`);assert.equal(storage.options.headers.Authorization,'Firebase test-token');
 assert.equal((await f.invoke({action:'photo',project_id:'p1',post_id:'s1',attachment_id:'a1',generation:'stale'})).status,409);
 assert.equal((await f.invoke({action:'photo',project_id:'../other',post_id:'s1',attachment_id:'a1'})).status,400);
});
test('private photo cache reuses source identity and omits private URI',async()=>{
 const f=fixture(),input={action:'photo',project_id:'p1',post_id:'s1',attachment_id:'a1'};
 const first=await f.invoke(input),second=await f.invoke(input);assert.equal(first.status,200);assert.equal(second.data.asset_id,first.data.asset_id);assert.equal(f.rows.ProbuildAsset.length,1);assert.equal(f.calls.filter(c=>c.url.includes('firebasestorage')).length,1);assert.equal(first.data.file_uri,undefined);
});
test('project edit preview never writes and apply preserves unrelated fields',async()=>{
 const f=fixture(),version=await hash(JSON.stringify([project.name,project.description]));const input={action:'edit_project',project_id:'p1',expected_version:version,patch:{description:'Revised notes'}};
 assert.equal((await f.invoke(input)).data.preview,true);assert.equal(f.calls.some(c=>c.options.method==='PUT'),false);
 assert.equal((await f.invoke({...input,apply:true})).data.saved,true);const saved=JSON.parse(f.calls.find(c=>c.options.method==='PUT').options.body);assert.deepEqual(saved.users,project.users);assert.equal(saved.createdBy,'crew');assert.equal(saved.description,'Revised notes');
 assert.equal((await f.invoke({...input,patch:{deletedAt:'now'},apply:true})).status,400);
});
test('stale edits and concurrent provider changes are rejected',async()=>{
 const input={action:'edit_project',project_id:'p1',expected_version:'stale',patch:{name:'New name'},apply:true};
 assert.equal((await fixture().invoke(input)).status,409);
 input.expected_version=await hash(JSON.stringify([project.name,project.description]));assert.equal((await fixture({contended:true}).invoke(input)).status,409);
});
test('report draft keeps source notes, excludes duplicate selections and leaves billing untouched',async()=>{
 const f=fixture(),ref={project_id:'p1',post_id:'s1'},r=await f.invoke({action:'save_report',title:'Field update',report_date:'2026-09-11',posts:[ref,ref],notes:'Owner summary'});
 assert.equal(r.status,200);assert.equal(r.data.report.posts.length,1);assert.equal(r.data.report.posts[0].message,post.message);assert.equal(r.data.report.notes,'Owner summary');assert.equal(f.rows.FeeLines,undefined);assert.equal(f.calls.some(c=>c.options.method==='PUT'),false);
});
test('message photos remain private and retracted messages cannot enter reports',async()=>{
 const f=fixture();f.rows.MessageRecord=[{id:'m1',retracted_at:'date',attachments:[{guid:'a',file_uri:'private/test'}]}];
 assert.equal((await f.invoke({action:'message_photo',message_id:'m1',attachment_guid:'a'})).status,404);
 assert.equal((await f.invoke({action:'save_report',title:'Draft',report_date:'2026-09-11',message_ids:['m1']})).status,409);
});
test('oversized streamed responses stop at the transfer limit',async()=>{
 await assert.rejects(()=>boundedBytes(new Response(new Uint8Array(10)),5),/too large/);
});
test('private message actions reject other admins and forged owner fields',async()=>{
 for(const owner of [null,{role:'admin',email:'iryedra@gmail.com'},{role:'admin',email:'trevor.draney7@gmail.com'},{role:'user',email:'gabefronk@gmail.com'}]){
  const f=fixture({owner});
  for(const action of ['message_sources','message_photo','report','reports','save_report'])assert.equal((await f.invoke({action,email:'gabefronk@gmail.com',role:'admin',message_ids:['m1']})).status,403);
  assert.equal(f.calls.length,0);
 }
});
test('general control key cannot read texts, message photos, or reports containing texts',async()=>{
 const f=fixture({owner:false}),key='private-denial-test-'.repeat(3),headers={'x-glass-forge-control-key':key};
 f.rows.ProbuildControlDevice=[{token_hash:await hash(key),enabled:true}];
 f.rows.ProbuildReportDraft=[{id:'private1',title:'Private message report',messages:[{message:'PRIVATE SENTINEL'}]},{id:'public1',title:'ProBuild only',messages:[]}];
 for(const action of ['message_sources','message_photo'])assert.equal((await f.invoke({action},headers)).status,403);
 assert.equal((await f.invoke({action:'save_report',message_ids:['m1']},headers)).status,403);
 assert.equal((await f.invoke({action:'report',report_id:'private1'},headers)).status,403);
 const list=await f.invoke({action:'reports'},headers);assert.equal(list.status,200);assert.deepEqual(list.data.reports.map(r=>r.id),['public1']);
 assert.equal((await f.invoke({action:'report',report_id:'public1'},headers)).status,200);
 assert.equal((await f.invoke({action:'save_report',report_id:'private1',title:'Overwrite attempt',report_date:'2026-09-12',notes:'Must not replace private content'},headers)).status,403);
 assert.equal(f.rows.ProbuildReportDraft[0].messages[0].message,'PRIVATE SENTINEL');
 assert.equal(f.calls.length,0);
});
test('work owner can access private report and photo without exposing storage URLs',async()=>{
 const f=fixture({owner:{role:'admin',email:'gabriel.fronk.wd@gmail.com'}});
 f.rows.ProbuildReportDraft=[{id:'private1',messages:[{message:'Owner text'}]}];
 f.rows.MessageRecord=[{id:'m1',attachments:[{guid:'a',file_uri:'private/secret',name:'photo.jpg',mime_type:'image/jpeg'}]}];
 assert.equal((await f.invoke({action:'report',report_id:'private1'})).status,200);
 const r=await f.invoke({action:'message_photo',message_id:'m1',attachment_guid:'a'});
 assert.equal(r.status,200);assert.ok(r.data.base64);assert.equal(r.data.url,undefined);assert.equal(r.data.file_uri,undefined);
});
