import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {webcrypto} from 'node:crypto';

const source=readFileSync(new URL('../base44/functions/messages-bridge/entry.ts',import.meta.url),'utf8')
 .replace(/^import \{createClientFromRequest\} from .*;\s*/,'')
 .replaceAll('export async function','async function').replaceAll('export function','function')
 .replace(/Deno\.serve\(createMessagesBridgeHandler\(\{getClient:createClientFromRequest\}\)\);\s*$/,'');
const context={Response,Request,crypto:webcrypto,fetch,console,TextEncoder,Uint8Array,Array,Set,Map,Date,JSON,Error,Number,String};
vm.runInNewContext(source+'\nthis.makeHandler=createMessagesBridgeHandler;',context);
const tables={};
const api={};
for(const name of ['Jobs','MessageConversation','MessageRecord','ContactJobLink','ContactDirectorySnapshot']){
 const rows=tables[name]=[];
 api[name]={list:async(sort,limit=100,skip=0)=>rows.slice(skip,skip+limit),filter:async(q,sort,limit=100)=>rows.filter(r=>Object.entries(q).every(([k,v])=>r[k]===v)).slice(0,limit),get:async id=>rows.find(r=>r.id===id),create:async row=>{const saved={id:row.id||`${name}-${rows.length}`,...row};rows.push(saved);return saved;}};
}
const handler=context.makeHandler({getClient:async()=>({auth:{me:async()=>({role:'admin',email:'gabefronk@gmail.com'})},asServiceRole:{entities:api}})});
const call=async()=>handler(new Request('https://test.invalid',{method:'POST',body:JSON.stringify({action:'job_threads',job_id:'job1'})}));

test('deployed worker excludes an unlinked group before reading its body',async()=>{
 await api.Jobs.create({id:'job1',canonical_name:'Test job'});
 await api.ContactDirectorySnapshot.create({directory_data:{contacts:[{key:'c1',phone_key:'8015550101'}]}});
 await api.ContactJobLink.create({contact_key:'c1',job_id:'job1'});
 await api.MessageConversation.create({conversation_key:'group',participants:['8015550101','8015559999'],title:'Unrelated group'});
 await api.MessageConversation.create({conversation_key:'direct',participants:['8015550101'],title:'Direct'});
 await api.MessageRecord.create({conversation_key:'group',text:'private group body'});
 await api.MessageRecord.create({conversation_key:'direct',text:'direct body'});
 const result=await call(),body=await result.json();
 assert.equal(result.status,200);
 assert.deepEqual(Array.from(body.threads,t=>t.conversation.conversation_key),['direct']);
 assert.equal(body.threads[0].messages[0].text,'direct body');
 assert.equal(JSON.stringify(body).includes('private group body'),false);
 assert.equal(JSON.stringify(body).includes('Unrelated group'),false);
});
