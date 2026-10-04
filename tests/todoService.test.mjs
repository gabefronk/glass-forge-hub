import test from 'node:test';
import assert from 'node:assert/strict';
import {createTodoHandler} from '../base44/shared/todoService.mjs';
import {isAgentCenterOwner} from '../src/lib/agentCenterAccess.js';

const users=[
 {id:'ga',email:'gabefronk@gmail.com',role:'admin',full_name:'Gabriel'},
 {id:'gw',email:'gabriel.fronk.wd@gmail.com',role:'admin',full_name:'Gabriel WD'},
 {id:'is',email:'iryedra@gmail.com',role:'admin',full_name:'Israel'},
 {id:'un',email:'unlinked@example.com',role:'admin',full_name:'Unlinked admin'},
 {id:'new',email:'future@example.com',role:'user',full_name:'Future crew'},
];
const baseMembers=[
 {id:'mg',member_key:'gabriel',display_name:'Gabriel',auth_user_ids:['ga','gw'],active:true,revision:0,management_lock:'',seed_state:'complete'},
 {id:'mi',member_key:'israel',display_name:'Israel',auth_user_ids:['is'],active:true,revision:0,management_lock:'',seed_state:'pending'},
 {id:'my',member_key:'yelian',display_name:'Yelian',auth_user_ids:[],active:true,revision:0,management_lock:'',seed_state:'pending'},
];
const task=(id,member='mg')=>({id,title:'Task '+id,details:'Instructions '+id,assignee_member_id:member,status:'open',progress_note:'',due_date:'',created_by_user_id:'ga',assigned_by_user_id:'ga',completed_at:'',completed_by_user_id:'',archived_at:'',revision:0,created_at:'2026-09-14T08:00:00.000Z',updated_at:'2026-09-14T08:00:00.000Z'});
const clone=v=>structuredClone(v);
function matches(row,q={}) {
 return Object.entries(q).every(([k,v])=>{
  if(k==='$or')return v.some(x=>matches(row,x));
  if(k==='$and')return v.every(x=>matches(row,x));
  const value=row[k];
  if(v&&typeof v==='object'&&!Array.isArray(v))return Object.entries(v).every(([op,arg])=>{
   if(op==='$in')return Array.isArray(value)?value.some(x=>arg.includes(x)):arg.includes(value);
   if(op==='$ne')return value!==arg;
   if(op==='$exists')return (value!==undefined)===arg;
   if(op==='$eq')return value===arg;
   if(op==='$nin')return Array.isArray(value)?value.every(x=>!arg.includes(x)):!arg.includes(value);
   if(op==='$gte')return value>=arg;
   if(op==='$lt')return value<arg;
   throw new Error('Unsupported mock operator '+op);
  });
  return Array.isArray(value)?value.includes(v):value===v||(v===null&&value===undefined);
 });
}
function harness(user=users[0],options={}) {
 const store={TeamMember:clone(options.members||baseMembers),TodoTask:clone(options.tasks||[task('g1'),task('g2'),task('i1','mi')]),User:clone(users),Jobs:clone(options.jobs||[]),CalendarEvents:clone(options.events||[])};
 const touches=[];let serial=0,clock='2026-09-14T09:00:00.000Z';
 const entity=name=>({
  list:async(sort='id',limit=500,skip=0)=>{touches.push(name+':list');return select(name,{},sort,limit,skip);},
  filter:async(q,sort='id',limit=500,skip=0)=>{touches.push(name+':filter');return select(name,q,sort,limit,skip);},
  get:async id=>{touches.push(name+':get');const row=store[name].find(x=>x.id===id);if(!row)throw new Error('not found');return clone(row);},
  create:async data=>{touches.push(name+':create');if(options.failCreate)throw new Error('simulated uncertain provider write');const row={...clone(data),id:'new'+(++serial)};store[name].push(row);return clone(row);},
  updateMany:async(q,update)=>{touches.push(name+':updateMany');let updated=0;for(const row of store[name])if(matches(row,q)){Object.assign(row,clone(update.$set||{}));for(const [k,v]of Object.entries(update.$inc||{}))row[k]=(row[k]||0)+v;updated++;}return {updated,has_more:false};},
 });
 function select(name,q,sort,limit,skip){const desc=String(sort).startsWith('-'),key=String(sort).replace(/^-/,'');return clone(store[name].filter(x=>matches(x,q)).sort((a,b)=>String(a[key]??'').localeCompare(String(b[key]??''))*(desc?-1:1)).slice(skip,skip+limit));}
 const api=Object.fromEntries(Object.keys(store).map(n=>[n,entity(n)]));
 const h=createTodoHandler({getClient:async()=>({auth:{me:async()=>clone(user)},asServiceRole:{entities:api}}),isOwner:isAgentCenterOwner,now:()=>clock,uuid:()=>`lock-${String(++serial).padStart(20,'0')}`});
 const call=async body=>{const r=await h(new Request('https://test.local/todos',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)}));return {status:r.status,body:await r.json(),headers:r.headers};};
 return {call,h,store,touches,setClock:v=>{clock=v;}};
}

test('anonymous rejected before entity reads',async()=>{const h=harness(null);const r=await h.call({action:'list'});assert.equal(r.status,401);assert.deepEqual(h.touches,[]);});
test('unlinked admin does not get owner access or task reads',async()=>{const h=harness(users[3]);const r=await h.call({action:'list',member_id:'all'});assert.equal(r.status,403);assert.ok(!h.touches.some(t=>t.startsWith('TodoTask:')));});
test('both Gabriel logins resolve one list and owner capability',async()=>{for(const u of users.slice(0,2)){const r=await harness(u).call({action:'list',member_id:'mine',offset:0});assert.equal(r.status,200);assert.equal(r.body.owner,true);assert.equal(r.body.member.id,'mg');assert.deepEqual(new Set(r.body.tasks.map(t=>t.id)),new Set(['g1','g2']));}});
test('Israel admin sees only his task and member, never account mappings',async()=>{const r=await harness(users[2]).call({action:'list',member_id:'mine',offset:0});assert.equal(r.status,200);assert.equal(r.body.owner,false);assert.deepEqual(r.body.tasks.map(t=>t.id),['i1']);assert.equal(r.body.members.length,1);assert.equal(r.body.members[0].id,'mi');assert.equal(r.body.members[0].auth_user_ids,undefined);assert.ok(!r.body.team_summary?.length);});
test('crew cannot request all or another person and cannot read another task id',async()=>{for(const m of ['all','mg','my']){const r=await harness(users[2]).call({action:'list',member_id:m});assert.equal(r.status,403);}assert.equal((await harness(users[2]).call({action:'get',id:'g1'})).status,404);});
test('owner team counts include pending Yelian with no tasks',async()=>{const r=await harness().call({action:'list',member_id:'all'});assert.equal(r.status,200);assert.equal(r.body.counts.total,3);const y=r.body.team_summary.find(m=>m.id==='my');assert.ok(y);assert.equal(y.counts.total,0);assert.equal(y.pending_account,true);});
test('inactive or multiply linked identities fail closed',async()=>{for(const mode of ['inactive','duplicate']){const m=clone(baseMembers);if(mode==='inactive')m[1].active=false;else m[2].auth_user_ids=['is'];const h=harness(users[2],{members:m});assert.ok([403,409,503].includes((await h.call({action:'list'})).status));assert.ok(!h.touches.some(t=>t.startsWith('TodoTask:')));}});
test('create self task defaults open and records actual actor',async()=>{const h=harness(users[2]);const r=await h.call({action:'create',title:'Own task',details:'Test',assignee_member_id:'mi',due_date:'',request_key:'request-create-self-0001'});assert.equal(r.status,200);assert.equal(r.body.task.status,'open');assert.equal(r.body.task.created_by_user_id,'is');assert.equal(r.body.task.assignee_member_id,'mi');});
test('crew cannot create for another person or inject actor/status',async()=>{const h=harness(users[2]);for(const extra of [{assignee_member_id:'mg'},{created_by_user_id:'ga'},{status:'done'}]){const r=await h.call({action:'create',title:'Bad',request_key:'request-injection-00001',...extra});assert.ok([400,403].includes(r.status));}assert.equal(h.store.TodoTask.length,3);});
test('owner assigns pending person without account or invitation',async()=>{const h=harness();const r=await h.call({action:'create',title:'Pending person task',details:'',assignee_member_id:'my',due_date:'',request_key:'request-pending-000001'});assert.equal(r.status,200);assert.equal(r.body.task.assignee_member_id,'my');assert.deepEqual(h.store.TeamMember.find(m=>m.id==='my').auth_user_ids,[]);});
test('create replay returns one original and changed payload conflicts',async()=>{const h=harness();const p={action:'create',title:'Unique',details:'',assignee_member_id:'mg',due_date:'',request_key:'request-idempotent-00001'};const a=await h.call(p),b=await h.call(p);assert.equal(a.status,200);assert.equal(b.status,200);assert.equal(a.body.task.id,b.body.task.id);assert.equal(h.store.TodoTask.length,4);assert.equal((await h.call({...p,title:'Different'})).status,409);});
test('invalid dates and blank titles cannot be saved',async()=>{const h=harness();for(const p of [{title:'',due_date:''},{title:'Valid',due_date:'2026-02-30'},{title:'Valid',due_date:'tomorrow'}])assert.equal((await h.call({action:'create',...p,request_key:'request-invalid-000001'})).status,400);assert.equal(h.store.TodoTask.length,3);});
test('crew status and note updates persist; completion and reopening are tracked',async()=>{const h=harness(users[2]);let r=await h.call({action:'update_task',id:'i1',expected_revision:0,patch:{status:'done',progress_note:'Finished'}});assert.equal(r.status,200);assert.equal(r.body.task.completed_by_user_id,'is');assert.equal(r.body.task.completed_at,'2026-09-14T09:00:00.000Z');const doneAt=r.body.task.completed_at;h.setClock('2026-09-14T09:10:00.000Z');r=await h.call({action:'update_task',id:'i1',expected_revision:1,patch:{progress_note:'Photo checked'}});assert.equal(r.status,200);assert.equal(r.body.task.completed_at,doneAt);r=await h.call({action:'update_task',id:'i1',expected_revision:2,patch:{status:'in_progress'}});assert.equal(r.status,200);assert.equal(r.body.task.completed_at,'');assert.equal(r.body.task.completed_by_user_id,'');assert.equal(h.store.TodoTask.find(t=>t.id==='i1').status,'in_progress');});
test('crew cannot edit scope, reassign, archive or mutate another task',async()=>{const h=harness(users[2]);for(const patch of [{title:'Changed'},{details:'Changed'},{due_date:'2026-10-01'},{assignee_member_id:'mg'},{created_by_user_id:'is'}])assert.ok([400,403].includes((await h.call({action:'update_task',id:'i1',expected_revision:0,patch})).status));assert.equal((await h.call({action:'archive',id:'i1',expected_revision:0})).status,403);assert.ok([403,404].includes((await h.call({action:'update_task',id:'g1',expected_revision:0,patch:{status:'done'}})).status));});
test('revision conflicts prevent overwrite',async()=>{const h=harness();assert.equal((await h.call({action:'update_task',id:'g1',expected_revision:0,patch:{status:'in_progress'}})).status,200);assert.equal((await h.call({action:'update_task',id:'g1',expected_revision:0,patch:{status:'done'}})).status,409);assert.equal(h.store.TodoTask.find(t=>t.id==='g1').status,'in_progress');});
test('concurrent writes cannot both accept one revision',async()=>{const h=harness();const p={action:'update_task',id:'g1',expected_revision:0,patch:{status:'in_progress'}};const r=await Promise.all([h.call(p),h.call(p)]);assert.equal(r.filter(x=>x.status===200).length,1);assert.equal(r.filter(x=>x.status===409).length,1);});
test('archive preserves record and excludes it from counts',async()=>{const h=harness();assert.equal((await h.call({action:'archive',id:'g1',expected_revision:0})).status,200);assert.equal(h.store.TodoTask.length,3);const r=await h.call({action:'list',member_id:'mine'});assert.equal(r.body.counts.total,1);});
test('owner reassigns same task, old assignee no longer has access',async()=>{const h=harness();const r=await h.call({action:'update_task',id:'i1',expected_revision:0,patch:{assignee_member_id:'my'}});assert.equal(r.status,200);assert.equal(r.body.task.id,'i1');assert.equal(h.store.TodoTask.length,3);const crew=harness(users[2],{tasks:h.store.TodoTask});assert.equal((await crew.call({action:'get',id:'i1'})).status,404);});
test('member management is Gabriel-only and prevents double-account linking',async()=>{assert.equal((await harness(users[2]).call({action:'account_options'})).status,403);const h=harness();const p={action:'manage_member',id:'my',display_name:'Yelian',active:true,auth_user_ids:['is'],revision:0,request_key:'member-link-request-0001'};assert.ok([400,409].includes((await h.call(p)).status));assert.equal((await h.call({...p,auth_user_ids:['new']})).status,200);assert.deepEqual(h.store.TeamMember.find(m=>m.id==='my').auth_user_ids,['new']);});
test('root profile and owner accounts cannot be relinked',async()=>{const h=harness();for(const p of [{id:'mg',auth_user_ids:[]},{id:'my',auth_user_ids:['ga']}])assert.ok([400,403,409].includes((await h.call({action:'manage_member',...p,display_name:'Wrong',active:true,revision:0,request_key:'member-protect-000001'})).status));assert.deepEqual(h.store.TeamMember.find(m=>m.id==='mg').auth_user_ids,['ga','gw']);});
test('member creation retries do not duplicate a person',async()=>{const h=harness();const p={action:'manage_member',id:'',display_name:'Future',active:true,auth_user_ids:['new'],revision:0,request_key:'member-create-request-0001'};const a=await h.call(p),b=await h.call(p);assert.equal(a.status,200);assert.equal(b.status,200);assert.equal(h.store.TeamMember.length,4);});
test('a held write lock blocks changes instead of guessing completion',async()=>{const m=clone(baseMembers);m[0].management_lock='unreconciled-operation';const h=harness(users[0],{members:m});assert.equal((await h.call({action:'create',title:'Blocked',request_key:'request-held-lock-0001'})).status,409);assert.equal(h.store.TodoTask.length,3);});
test('unexpected create failure retains a reconciliation lock',async()=>{const h=harness(users[0],{failCreate:true});assert.ok((await h.call({action:'create',title:'Uncertain',request_key:'request-uncertain-0001'})).status>=500);assert.ok(h.store.TeamMember[0].management_lock);});
test('HTTP methods, malformed JSON and no-store headers',async()=>{const h=harness();assert.equal((await h.h(new Request('https://test.local'))).status,405);assert.equal((await h.h(new Request('https://test.local',{method:'POST',body:'{'}))).status,400);const r=await h.call({action:'access'});assert.equal(r.status,200);assert.match(r.headers.get('Cache-Control'),/no-store/);});


test('personal planning fields are validated on create and update',async()=>{
 const h=harness(users[2]);const p={action:'create',title:'Plan',request_key:'planning',focus_date:'2026-10-04',waiting_on:'Supplier reply',follow_up_date:'2026-10-06'};
 const r=await h.call(p);assert.equal(r.status,200);assert.equal(r.body.task.waiting_on,'Supplier reply');
 for(const patch of [{focus_date:'2026-02-30'},{follow_up_date:'2026-02-29'},{waiting_on:'x'.repeat(301)},{job_id:{$ne:''}}])assert.equal((await h.call({action:'update_task',id:r.body.task.id,expected_revision:0,patch})).status,400);
 assert.equal(h.store.TodoTask.find(t=>t.id===r.body.task.id).revision,0);
 assert.equal((await h.call({action:'update_task',id:'i1',expected_revision:0,patch:{focus_date:'2028-02-29',waiting_on:'',follow_up_date:''}})).status,200);
});

test('self-created scope edits require current assignment; reassignment remains owner-only',async()=>{
 const h=harness(users[2],{tasks:[{...task('mine','mi'),created_by_user_id:'is'},{...task('away','mg'),created_by_user_id:'is'},task('assigned','mi')]});
 assert.equal((await h.call({action:'update_task',id:'mine',expected_revision:0,patch:{title:'Edited',details:'Own instructions',due_date:'2026-10-04'}})).status,200);
 assert.equal((await h.call({action:'update_task',id:'away',expected_revision:0,patch:{title:'Leak'}})).status,404);
 assert.equal((await h.call({action:'update_task',id:'assigned',expected_revision:0,patch:{title:'Changed'}})).status,403);
 assert.equal((await h.call({action:'update_task',id:'mine',expected_revision:1,patch:{focus_date:'2026-10-05',assignee_member_id:'mg'}})).status,403);
 assert.equal(h.store.TodoTask.find(t=>t.id==='mine').focus_date,undefined);
});

const jobsFixture=[{id:'ja',canonical_name:'Assigned',pm_member_key:'israel',stage:'install',secret:'private'},{id:'jb',canonical_name:'Task linked',pm_member_key:'gabriel',stage:'service'},{id:'jc',canonical_name:'Unrelated',pm_member_key:'other'},{id:'jd',canonical_name:'Near match',pm_member_key:'israel-other'}];
test('board jobs are exact-person or existing active task links; crew cannot bootstrap access',async()=>{
 const h=harness(users[2],{jobs:jobsFixture,tasks:[{...task('linked','mi'),job_id:'jb'},{...task('done','mi'),status:'done',job_id:'jc'},{...task('archived','mi'),archived_at:'2026-09-01',job_id:'jd'}]});
 const r=await h.call({action:'board'});assert.equal(r.status,200);assert.deepEqual(new Set(r.body.jobs.map(j=>j.id)),new Set(['ja','jb']));assert.deepEqual(Object.keys(r.body.jobs[0]).sort(),['canonical_name','id','stage']);
 for(const job_id of ['jc','jd','unknown'])assert.equal((await h.call({action:'create',title:'Unauthorized',job_id,request_key:'bad-link-'+job_id})).status,403);
 const made=await h.call({action:'create',title:'Allowed',job_id:'ja',request_key:'good-link'});assert.equal(made.status,200);
 assert.equal((await h.call({action:'update_task',id:made.body.task.id,expected_revision:0,patch:{job_id:'jc'}})).status,403);
 assert.equal((await h.call({action:'update_task',id:made.body.task.id,expected_revision:0,patch:{job_id:''}})).status,200);
 // Owner board only needs labels already linked to tasks; company lookup is searched on demand.
 assert.equal((await harness(users[0],{jobs:jobsFixture}).call({action:'board'})).body.jobs.length,0);
});

test('request keys are member-scoped and all new payload fields participate in replay',async()=>{
 const h=harness(users[2],{jobs:jobsFixture});const p={action:'create',title:'Replay',job_id:'ja',request_key:'same-key',focus_date:'2026-10-04',waiting_on:'Vendor',follow_up_date:'2026-10-05'};
 const a=await h.call(p);assert.equal(a.status,200);assert.equal((await h.call(p)).body.task.id,a.body.task.id);
 for(const extra of [{job_id:''},{focus_date:''},{waiting_on:'Someone else'},{follow_up_date:''}])assert.equal((await h.call({...p,...extra})).status,409);
 const owner=harness(users[0],{jobs:jobsFixture,tasks:h.store.TodoTask});const b=await owner.call({...p,assignee_member_id:'mg'});assert.equal(b.status,200);assert.equal(b.body.duplicate,undefined);assert.notEqual(b.body.task.request_key,a.body.task.request_key);
});

test('home context is personal even for owner and filters seven Denver dates and ignored visits',async()=>{
 const events=[{id:'v1',job_id:'ja',event_date:'2026-10-03',summary:'Visit'},{id:'v2',job_id:'ja',event_date:'2026-10-09',summary:'Last day'},{id:'v3',job_id:'ja',event_date:'2026-10-10',summary:'Too late'},{id:'v4',job_id:'ja',event_date:'2026-10-04',summary:'Renta'},{id:'v5',job_id:'ja',event_date:'2026-10-04',source_status:'cancelled'},{id:'v6',job_id:'ja',event_date:'2026-10-04',report_status:'rescheduled'},{id:'v7',job_id:'jc',event_date:'2026-10-04',summary:'Other job'},{id:'v8',job_id:'ja',event_date:'2026-10-02',summary:'Past'}];
 const h=harness(users[2],{jobs:jobsFixture,events});h.setClock('2026-10-04T01:00:00.000Z');const r=await h.call({action:'home_context',member_id:'mg'});assert.equal(r.status,200);assert.equal(r.body.today,'2026-10-03');assert.deepEqual(r.body.visits.map(v=>v.id),['v1','v2']);
 const owner=await harness(users[0],{jobs:jobsFixture}).call({action:'home_context'});assert.deepEqual(owner.body.jobs.map(j=>j.id),['jb']);
 for(const user of [null,users[3]]){const denied=harness(user,{jobs:jobsFixture,events});assert.ok((await denied.call({action:'home_context'})).status>=400);assert.ok(!denied.touches.some(t=>t.startsWith('Jobs:')||t.startsWith('CalendarEvents:')));}
});
