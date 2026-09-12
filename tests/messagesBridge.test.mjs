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
 const handler=createMessagesBridgeHandler({getClient:async()=>({auth:{me:async()=>user},asServiceRole:{entities:api}})});
 const call=async(body,device=true,credential=key)=>handler(new Request('https://example.com',{method:'POST',headers:{'Content-Type':'application/json',...(device?{'x-glass-forge-key':credential}:{})},body:JSON.stringify(body)}));
 return {tables,api,call,setUser:u=>user=u};
}
const message={source_guid:'g1',source_chat_guid:'SMS;-;test',sent_at:'2026-09-12T12:00:00.000Z',direction:'incoming',text:'Plans attached',conversation_title:'Example customer',sender:'Example',attachments:[{guid:'a1',name:'plan.pdf'}]};
test('rejects anonymous, non-owner admin, invalid key, and device reading',async()=>{const s=await setup();s.setUser(null);assert.equal((await s.call({action:'inbox'},false)).status,403);s.setUser({role:'admin',email:'someone@example.com'});assert.equal((await s.call({action:'inbox'},false)).status,403);assert.equal((await s.call({action:'heartbeat'},true,'wrong')).status,401);assert.equal((await s.call({action:'inbox'})).status,403)});
test('retry and later message retain one conversation and linked job',async()=>{const s=await setup();let a=await (await s.call({action:'ingest',message})).json();assert.equal(a.ok,true);await s.api.MessageConversation.update(s.tables.MessageConversation[0].id,{job_id:'job1',job_name:'Real job'});await s.call({action:'ingest',message});await s.call({action:'ingest',message:{...message,source_guid:'g2',sent_at:'2026-09-12T13:00:00.000Z',text:'Follow-up'}});assert.equal(s.tables.MessageRecord.length,2);assert.equal(s.tables.MessageConversation.length,1);assert.equal(s.tables.MessageConversation[0].job_id,'job1');assert.equal(s.tables.MessageConversation[0].last_text,'Follow-up')});
test('historical import blocked; attachment private URI not exposed',async()=>{const s=await setup();assert.equal((await s.call({action:'ingest',message:{...message,sent_at:'2025-01-01T00:00:00Z'}})).status,400);const saved=await (await s.call({action:'ingest',message})).json();s.tables.MessageRecord[0].attachments[0].file_uri='private/file';const r=await(await s.call({action:'conversation',conversation_key:saved.conversation_key},false)).json();assert.equal(r.messages[0].attachments[0].file_uri,undefined);const inbox=await(await s.call({action:'inbox'},false)).json();assert.equal(inbox.devices[0].token_hash,undefined)});
test('disabled device cannot deliver',async()=>{const s=await setup();s.tables.MessageBridgeDevice[0].enabled=false;assert.equal((await s.call({action:'ingest',message})).status,401)});
