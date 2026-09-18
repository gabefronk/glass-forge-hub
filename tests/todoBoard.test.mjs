import test from 'node:test';
import assert from 'node:assert/strict';
import {createTodoHandler} from '../base44/shared/todoService.mjs';
import {isAgentCenterOwner} from '../src/lib/agentCenterAccess.js';
import {BOARD_LANES,buildBoard,dueState,isStale,laneKey,laneLabel,sortByUrgency} from '../src/lib/todoBoard.js';

const TODAY='2026-09-18';

// ---------- Board logic (src/lib/todoBoard.js) ----------

test('board has exactly the four required lanes in order',()=>{
 assert.deepEqual(BOARD_LANES.map(l=>l.label),['Quote Requests','Odd End Items','Orders to Place','Follow-ups']);
 assert.deepEqual(BOARD_LANES.map(l=>l.key),['quote_request','odd_end','order','follow_up']);
});

test('due state boundaries use calendar days',()=>{
 const t=due=>({status:'open',due_date:due});
 assert.equal(dueState(t('2026-09-17'),TODAY),'overdue');
 assert.equal(dueState(t('2026-09-18'),TODAY),'today');
 assert.equal(dueState(t('2026-09-21'),TODAY),'soon');
 assert.equal(dueState(t('2026-09-22'),TODAY),'later');
 assert.equal(dueState(t(''),TODAY),'none');
 assert.equal(dueState(t('not-a-date'),TODAY),'none');
});

test('open undated tasks waiting a week are flagged; urgent or in-progress ones are not',()=>{
 assert.equal(isStale({status:'open',created_at:'2026-09-11T10:00:00.000Z'},TODAY),true);
 assert.equal(isStale({status:'open',created_at:'2026-09-12T10:00:00.000Z'},TODAY),false);
 assert.equal(isStale({status:'in_progress',created_at:'2026-08-01T10:00:00.000Z'},TODAY),false);
 assert.equal(isStale({status:'open',due_date:'2026-09-10',created_at:'2026-08-01T10:00:00.000Z'},TODAY),false); // overdue is shown as overdue instead
});

test('lanes sort most urgent first: overdue, today, soon, in progress, then oldest',()=>{
 const tasks=[
  {id:'later',status:'open',due_date:'2026-10-30',created_at:'2026-09-01'},
  {id:'old',status:'open',created_at:'2026-08-01'},
  {id:'new',status:'open',created_at:'2026-09-17'},
  {id:'wip',status:'in_progress',created_at:'2026-09-17'},
  {id:'today',status:'open',due_date:TODAY,created_at:'2026-09-17'},
  {id:'overdue',status:'open',due_date:'2026-09-01',created_at:'2026-09-17'},
  {id:'soon',status:'open',due_date:'2026-09-20',created_at:'2026-09-17'},
 ];
 assert.deepEqual(sortByUrgency(tasks,TODAY).map(t=>t.id),['overdue','today','soon','later','wip','old','new']);
});

test('buildBoard groups by lane, surfaces uncategorized tasks, and counts what needs attention',()=>{
 const tasks=[
  {id:'q',status:'open',category:'quote_request',due_date:'2026-09-01',created_at:'2026-09-01'},
  {id:'o',status:'in_progress',category:'order',created_at:'2026-09-17'},
  {id:'legacy',status:'open',created_at:'2026-08-01'},                 // created before categories
  {id:'weird',status:'open',category:'bogus',created_at:'2026-09-18'}, // unknown value is not hidden
  {id:'d',status:'done',category:'follow_up',created_at:'2026-09-01'},
 ];
 const b=buildBoard(tasks,TODAY);
 assert.deepEqual(b.lanes.map(l=>l.tasks.map(t=>t.id)),[['q'],[],['o'],[]]);
 assert.deepEqual(b.uncategorized.tasks.map(t=>t.id),['legacy','weird']);
 assert.equal(b.lanes[0].overdue,1);
 assert.deepEqual(b.summary,{total:4,overdue:1,dueToday:0,inProgress:1,stale:1});
 assert.equal(buildBoard(tasks.filter(t=>t.category==='order'),TODAY).uncategorized,null);
 assert.equal(laneKey({category:'bogus'}),'');
 assert.equal(laneLabel('order'),'Orders to Place');
 assert.equal(laneLabel(''),'Needs a category');
});

// ---------- Service (base44/shared/todoService.mjs) ----------

const members=[
 {id:'mg',member_key:'gabriel',display_name:'Gabriel',auth_user_ids:['ga'],active:true,revision:0,management_lock:'',seed_state:'complete'},
 {id:'mi',member_key:'israel',display_name:'Israel',auth_user_ids:['is'],active:true,revision:0,management_lock:'',seed_state:'pending'},
];
const users={ga:{id:'ga',email:'gabefronk@gmail.com',role:'admin'},is:{id:'is',email:'iryedra@gmail.com',role:'admin'}};
const task=(id,extra={})=>({id,title:'Task '+id,details:'',assignee_member_id:'mg',status:'open',progress_note:'',due_date:'',created_by_user_id:'ga',assigned_by_user_id:'ga',completed_at:'',completed_by_user_id:'',archived_at:'',revision:0,created_at:'2026-09-14T08:00:00.000Z',updated_at:'2026-09-14T08:00:00.000Z',...extra});
function harness(user,tasks){
 const store={TeamMember:structuredClone(members),TodoTask:structuredClone(tasks),User:Object.values(users)};let serial=0;
 const matches=(row,q)=>Object.entries(q).every(([k,v])=>row[k]===v||(v===''&&row[k]===undefined));
 const select=(name,q,sort,limit)=>{const desc=String(sort).startsWith('-'),key=String(sort).replace(/^-/,'');return structuredClone(store[name].filter(r=>matches(r,q)).sort((a,b)=>String(a[key]??'').localeCompare(String(b[key]??''))*(desc?-1:1)).slice(0,limit));};
 const entity=name=>({
  list:async(sort,limit)=>select(name,{},sort,limit),
  filter:async(q,sort,limit)=>select(name,q,sort,limit),
  get:async id=>{const r=store[name].find(x=>x.id===id);if(!r)throw new Error('nf');return structuredClone(r);},
  create:async d=>{const r={...structuredClone(d),id:'new'+(++serial)};store[name].push(r);return structuredClone(r);},
  updateMany:async(q,u)=>{let updated=0;for(const r of store[name])if(matches(r,q)){Object.assign(r,u.$set||{});for(const[k,v]of Object.entries(u.$inc||{}))r[k]=(r[k]||0)+v;updated++;}return {updated};},
 });
 const api=Object.fromEntries(Object.keys(store).map(n=>[n,entity(n)]));
 const h=createTodoHandler({getClient:async()=>({auth:{me:async()=>user},asServiceRole:{entities:api}}),isOwner:isAgentCenterOwner,now:()=>'2026-09-18T12:00:00.000Z',uuid:()=>'u'+(++serial)});
 return {store,call:async body=>{const r=await h(new Request('https://t/todos',{method:'POST',body:JSON.stringify(body)}));return {status:r.status,body:await r.json()};}};
}

test('board returns every active task (no 100-task page) plus recent done, oldest first',async()=>{
 const many=Array.from({length:130},(_,i)=>task('t'+String(i).padStart(3,'0'),{created_at:`2026-09-14T08:${String(i%60).padStart(2,'0')}:00.000Z`}));
 const h=harness(users.ga,[...many,task('wip',{status:'in_progress'}),task('fin',{status:'done',completed_at:'2026-09-17T10:00:00.000Z'}),task('arch',{archived_at:'2026-09-15'})]);
 const r=await h.call({action:'board',member_id:'mine'});
 assert.equal(r.status,200);
 assert.equal(r.body.tasks.length,131);
 assert.deepEqual(r.body.recent_done.map(t=>t.id),['fin']);
 assert.deepEqual(r.body.counts,{open:130,in_progress:1,recent_done:1});
 assert.equal(r.body.truncated,false);
 assert.ok(!r.body.tasks.some(t=>t.id==='arch'));
});

test('board keeps the same privacy rules as the list',async()=>{
 const h=harness(users.is,[task('g1'),task('i1',{assignee_member_id:'mi'})]);
 assert.deepEqual((await h.call({action:'board'})).body.tasks.map(t=>t.id),['i1']);
 for(const member_id of ['all','mg'])assert.equal((await h.call({action:'board',member_id})).status,403);
 const owner=await harness(users.ga,[task('g1'),task('i1',{assignee_member_id:'mi'})]).call({action:'board',member_id:'all'});
 assert.equal(owner.body.tasks.length,2);assert.ok(owner.body.team_summary.find(m=>m.id==='mi'));
});

test('tasks are created in a lane; invalid lanes are rejected; legacy tasks stay visible',async()=>{
 const h=harness(users.ga,[task('legacy')]);
 const r=await h.call({action:'create',title:'Order 3 IGUs',category:'order',request_key:'create-order-0001'});
 assert.equal(r.status,200);assert.equal(r.body.task.category,'order');
 assert.equal((await h.call({action:'create',title:'Bad',category:'misc',request_key:'create-bad-0001'})).status,400);
 const noLane=await h.call({action:'create',title:'Plain',request_key:'create-plain-0001'});
 assert.equal(noLane.body.task.category,'');
 const board=await h.call({action:'board'});
 assert.deepEqual(board.body.tasks.map(t=>t.id).sort(),['legacy',r.body.task.id,noLane.body.task.id].sort());
});

test('create replay with a different lane is a conflict, same lane is idempotent',async()=>{
 const h=harness(users.ga,[]);
 const p={action:'create',title:'Call Laird super',category:'follow_up',request_key:'create-follow-0001'};
 const a=await h.call(p),b=await h.call(p);
 assert.equal(a.body.task.id,b.body.task.id);assert.equal(h.store.TodoTask.length,1);
 assert.equal((await h.call({...p,category:'order'})).status,409);
});

test('crew can move their own task between lanes but not edit scope',async()=>{
 const h=harness(users.is,[task('i1',{assignee_member_id:'mi'})]);
 const r=await h.call({action:'update_task',id:'i1',expected_revision:0,patch:{category:'odd_end'}});
 assert.equal(r.status,200);assert.equal(h.store.TodoTask[0].category,'odd_end');assert.equal(h.store.TodoTask[0].revision,1);
 assert.equal((await h.call({action:'update_task',id:'i1',expected_revision:1,patch:{category:'nope'}})).status,400);
 assert.equal((await h.call({action:'update_task',id:'i1',expected_revision:1,patch:{title:'Changed'}})).status,403);
});
