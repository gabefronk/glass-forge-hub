import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createMessagesBridgeHandler} from '../base44/shared/messagesBridge.js';
if(!globalThis.crypto)globalThis.crypto=webcrypto;
const key='test-key-only-'.repeat(5);
const digest=async s=>Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))).toString('hex');
async function setup(){
 const tables={},api={};
 for(const name of ['MessageBridgeDevice','MessageConversation','MessageRecord','Jobs']){
  const rows=tables[name]=[];
  api[name]={filter:async(q={},sort,limit=100,skip=0)=>rows.filter(r=>Object.entries(q).every(([k,v])=>r[k]===v)).slice(skip,skip+limit),list:async()=>rows,get:async id=>rows.find(r=>r.id===id),create:async row=>{const r={id:name+'-'+rows.length,...structuredClone(row)};rows.push(r);return r},update:async(id,changes)=>{const row=rows.find(r=>r.id===id);Object.assign(row,structuredClone(changes));return row}};
 }
 await api.MessageBridgeDevice.create({device_id:'mac',token_hash:await digest(key),enabled:true,started_at:'2026-09-12T00:00:00.000Z'});
 let user={role:'admin',email:'gabefronk@gmail.com'};
 const handler=createMessagesBridgeHandler({getClient:async()=>({auth:{me:async()=>user},asServiceRole:{entities:api,integrations:{Core:{CreateFileSignedUrl:async()=>({signed_url:'https://private.test/file'})}}}}),fetchFile:async()=>new Response(new Uint8Array([1,2,3]))});
 const call=async(body,device=true,credential=key)=>handler(new Request('https://example.com',{method:'POST',headers:{'Content-Type':'application/json',...(device?{'x-glass-forge-key':credential}:{})},body:JSON.stringify(body)}));
 return {tables,api,call,setUser:u=>user=u};
}
const message={source_guid:'g1',source_chat_guid:'SMS;-;test',sent_at:'2026-09-12T12:00:00.000Z',direction:'incoming',text:'Plans attached',conversation_title:'Example customer',sender:'Example',attachments:[{guid:'a1',name:'plan.pdf'}]};
test('rejects anonymous, non-owner admin, invalid key, and device reading',async()=>{const s=await setup();s.setUser(null);assert.equal((await s.call({action:'inbox'},false)).status,403);s.setUser({role:'admin',email:'someone@example.com'});assert.equal((await s.call({action:'inbox'},false)).status,403);assert.equal((await s.call({action:'heartbeat'},true,'wrong')).status,401);assert.equal((await s.call({action:'inbox'})).status,403)});
test('retry and later message retain one conversation and linked job',async()=>{const s=await setup();let a=await (await s.call({action:'ingest',message})).json();assert.equal(a.ok,true);await s.api.MessageConversation.update(s.tables.MessageConversation[0].id,{job_id:'job1',job_name:'Real job'});await s.call({action:'ingest',message});await s.call({action:'ingest',message:{...message,source_guid:'g2',sent_at:'2026-09-12T13:00:00.000Z',text:'Follow-up'}});assert.equal(s.tables.MessageRecord.length,2);assert.equal(s.tables.MessageConversation.length,1);assert.equal(s.tables.MessageConversation[0].job_id,'job1');assert.equal(s.tables.MessageConversation[0].last_text,'Follow-up')});
test('historical import blocked; attachment private URI not exposed',async()=>{const s=await setup();assert.equal((await s.call({action:'ingest',message:{...message,sent_at:'2025-01-01T00:00:00Z'}})).status,400);const saved=await (await s.call({action:'ingest',message})).json();s.tables.MessageRecord[0].attachments[0].file_uri='private/file';const r=await(await s.call({action:'conversation',conversation_key:saved.conversation_key},false)).json();assert.equal(r.messages[0].attachments[0].file_uri,undefined);const inbox=await(await s.call({action:'inbox'},false)).json();assert.equal(inbox.devices[0].token_hash,undefined)});
test('disabled device cannot deliver',async()=>{const s=await setup();s.tables.MessageBridgeDevice[0].enabled=false;assert.equal((await s.call({action:'ingest',message})).status,401)});
test('every inbox action rejects anonymous, ordinary users, and other administrators',async()=>{
 const s=await setup();
 for(const user of [null,{role:'user',email:'gabefronk@gmail.com'},{role:'admin',email:'iryedra@gmail.com'},{role:'admin',email:'trevor.draney7@gmail.com'}]){
  s.setUser(user);
  for(const action of ['inbox','conversation','job_threads','jobs','link_job','mark_read','attachment','set_device','ingest','upload','heartbeat']){
   const r=await s.call({action,email:'gabefronk@gmail.com',role:'admin'},false);
   assert.equal(r.status,403,action);
   assert.match(r.headers.get('Cache-Control'),/no-store/);
  }
 }
 assert.equal(s.tables.MessageRecord.length,0);
});
test('both Gabriel accounts can read; relay credentials cannot read or change visibility',async()=>{
 const s=await setup();await s.call({action:'ingest',message});
 for(const email of ['gabefronk@gmail.com','gabriel.fronk.wd@gmail.com']){
  s.setUser({role:'admin',email});
  assert.equal((await s.call({action:'inbox'},false)).status,200);
 }
 for(const action of ['inbox','conversation','attachment','link_job','set_device'])assert.equal((await s.call({action})).status,403);
});
test('attachments return verified bytes without a transferable storage URL; unsent content stays hidden',async()=>{
 const s=await setup(),saved=await(await s.call({action:'ingest',message})).json();
 const m=s.tables.MessageRecord[0];m.attachments[0].file_uri='private/secret';
 const r=await s.call({action:'attachment',message_id:m.id,attachment_guid:'a1'},false),data=await r.json();
 assert.equal(r.status,200);assert.equal(data.base64,'AQID');assert.equal(data.size,3);assert.equal(data.sha256,await digest(String.fromCharCode(1,2,3)));
 assert.equal(data.url,undefined);assert.equal(data.file_uri,undefined);assert.match(r.headers.get('Cache-Control'),/no-store/);
 m.retracted_at='2026-09-12T14:00:00Z';
 assert.equal((await s.call({action:'attachment',message_id:m.id,attachment_guid:'a1'},false)).status,404);
 const convo=await(await s.call({action:'conversation',conversation_key:saved.conversation_key},false)).json();
 assert.equal(convo.messages[0].text,'');assert.deepEqual(convo.messages[0].attachments,[]);
});
