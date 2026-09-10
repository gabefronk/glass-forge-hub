import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAgentInventory, createAgentCenterHandler, isAgentCenterOwner } from '../shared/agentCenter.js';
import { isAgentCenterOwner as uiOwner } from '../../src/lib/agentCenterAccess.js';
const now=new Date('2026-09-10T12:00:00Z');
test('only the actual owner with administrator role is allowed; frontend and backend agree',()=>{
 for(const [user,allowed] of [[null,false],[{email:'gabefronk@gmail.com',role:'user'},false],[{email:'iryedra@gmail.com',role:'admin'},false],[{email:'other@example.com',role:'admin'},false],[{email:'gabefronk@gmail.com',role:'admin'},true]]){
  assert.equal(isAgentCenterOwner(user),allowed);assert.equal(uiOwner(user),allowed);
 }
});
test('inventory uses real check-ins, stale status and manual labels without leaking pairing credentials',()=>{
 const workers=[
  {id:'one',name:'Pricing runner',enabled:true,last_seen_at:'2026-09-10T11:59:00Z',runner_presence:{runner_status:'attention'},token_hash:'SECRET_HASH',busy_token:'SECRET_TOKEN'},
  {id:'two',name:'Stale runner',enabled:true,last_seen_at:'2026-09-09T11:59:00Z',active_quote_id:'quote-123'},
  {id:'three',name:'Disabled runner',enabled:false,last_seen_at:'2026-09-10T11:59:00Z'},
  {id:'four',name:'Future runner',enabled:true,last_seen_at:'2027-09-10T11:59:00Z'}
 ];
 const list=buildAgentInventory({workers,now});
 assert.equal(list.find(x=>x.id==='worker:one').status,'Needs attention');
 assert.equal(list.find(x=>x.id==='worker:two').status,'Check-in stale');
 assert.equal(list.find(x=>x.id==='worker:three').status,'Disabled');
 assert.equal(list.find(x=>x.id==='worker:four').status,'Check-in stale');
 assert.equal(list.find(x=>x.id==='mac_manager').connection,'manual');
 assert.equal(list.find(x=>x.id==='codex_development').updated_at,null);
 assert.ok(!JSON.stringify(list).includes('SECRET'));
 assert.ok(list.every(x=>!x.allowed_actions.some(action=>/restart|dispatch|delete/i.test(action))));
});
function harness(user={email:'gabefronk@gmail.com',role:'admin'}){
 const rows=[];let calls=0,creates=0;
 const entities={QuoteWorkers:{list:async()=>{calls++;return[];},filter:async()=>[]},
  SalesTrackerSnapshot:{filter:async()=>[]},
  AgentCenterEntry:{list:async()=>rows,filter:async q=>rows.filter(r=>r.request_key===q.request_key),create:async row=>{creates++;const result={...row,id:'entry-'+creates};rows.push(result);return result;}}};
 const handler=createAgentCenterHandler({getClient:async()=>({auth:{me:async()=>user},asServiceRole:{entities}}),now:()=>now});
 const call=async body=>{const r=await handler(new Request('https://example.test',{method:'POST',body:JSON.stringify(body)}));return {status:r.status,body:await r.json()};};
 return {call,rows,counts:()=>({calls,creates})};
}
const note={action:'entry',target_id:'mac_manager',kind:'request',title:'Review captured rows',body:'Review the sales delta for distinct lots.',request_key:'request-test-123456789'};
test('a non-owner admin cannot read inventory or save private entries',async()=>{
 const h=harness({role:'admin',email:'iryedra@gmail.com'});
 assert.equal((await h.call({action:'inventory'})).status,403);assert.equal((await h.call(note)).status,403);
 assert.deepEqual(h.counts(),{calls:0,creates:0});
});
test('owner request is stored privately and explicitly not dispatched; retries do not add another entry',async()=>{
 const h=harness();const first=await h.call(note);
 assert.equal(first.status,200);assert.equal(first.body.entry.status,'saved_for_manual_review');assert.match(first.body.delivery,/Not dispatched/);
 const repeat=await h.call(note);assert.equal(repeat.body.unchanged,true);assert.equal(h.counts().creates,1);
 const conflict=await h.call({...note,body:'Changed text'});assert.equal(conflict.status,409);
 const inventory=await h.call({action:'inventory'});assert.equal(inventory.body.dispatch_enabled,false);assert.equal(inventory.body.entries.length,1);
});
test('unsupported actions, unknown workspaces and oversized entries cannot write',async()=>{
 const h=harness();
 for(const body of [{action:'dispatch'},{...note,target_id:'worker:unregistered'},{...note,target_id:'unrecognized'},{...note,title:'x'.repeat(161)},{...note,body:'x'.repeat(5001)}]){
  assert.equal((await h.call(body)).status,400);
 }
 assert.equal(h.counts().creates,0);
});
