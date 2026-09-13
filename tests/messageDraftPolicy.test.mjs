import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {MESSAGE_DRAFT_POLICY_VERSION as VERSION, MESSAGE_DRAFT_GUIDANCE as GUIDANCE} from '../base44/shared/messageDraftPolicy.mjs';
import {buildReplyRequest} from '../base44/shared/replyPlanner.mjs';
import {createMessageAssistantHandler,validateAnalysis} from '../base44/shared/messageAssistant.js';

const now='2026-09-13T20:00:00.000Z';
const scope={conversation_key:'synthetic-thread',source_chat_guid:'iMessage;-;+13035550123',participants:['+13035550123']};
const messages=[{source_guid:'synthetic-request',conversation_key:scope.conversation_key,direction:'incoming',text:'Lot 42 patio door sticks.',sent_at:'2026-09-13T19:59:00.000Z',attachments:[]}];
const job={id:'synthetic-job',name:'Sample Builder / Sample Community / lot 42',builder_key:'sample',groups:[{lot:'42'}]};
const result={is_service_request:true,source_request_guid:'synthetic-request',summary:'Reported patio door issue.',customer_name:'',job_id:job.id,job_reason:'Exact lot.',issues:['Patio door sticks'],source_message_guids:['synthetic-request'],photo_guids:[],acknowledgment_already_sent:false,ack_evidence_guid:'',missing_info:[],service_text:'Can you take a look at the patio door at Sample Community lot 42?',reply_text:"Thanks, I'll get this over to service.",};
function preview(facts=[],extra={}){
 return buildReplyRequest({conversation:scope,policy:{...scope,goal:'Prepare a concise reply for review.',style_examples:[],approved_facts:facts},messages,now,observed_at:now,...extra});
}
test('owner policy is part of the trusted runtime prompt, not supplied by incoming text',()=>{
 const built=preview();
 assert.ok(built.request.prompt.includes(GUIDANCE));
 const payload=JSON.parse(built.request.prompt.split('\n--- BEGIN SCOPED INPUT ---\n')[1].split('\n--- END SCOPED INPUT ---')[0]);
 assert.equal(payload.scoped_policy.drafting_policy_version,VERSION);
 assert.equal(built.context.send_enabled,false);
 assert.equal(built.context.preview_only,true);
 assert.ok(!GUIDANCE.includes('Deer Water')&&!GUIDANCE.includes('Ryan')&&!GUIDANCE.includes('sharepoint.com'));
});
test('case facts cannot carry into a new preview and missing attachments stay gated',()=>{
 const first=preview(['Private synthetic quote fact: SAMPLE-ONLY-A.']);
 assert.ok(first.request.prompt.includes('SAMPLE-ONLY-A'));
 assert.ok(!preview().request.prompt.includes('SAMPLE-ONLY-A'));
 const attachmentOnly=preview([],{messages:[{...messages[0],text:'',attachments:[{guid:'card',name:'homeowner.vcf'}]}]});
 assert.equal(attachmentOnly.request,null);
 assert.equal(attachmentOnly.preflight_plan.decision,'owner_needed');
});
test('unambiguous job reference needs no street address, while wrong lot still fails',()=>{
 const valid=validateAnalysis(result,{messages,jobs:[job],historyComplete:true});
 assert.deepEqual(valid.missing_info,[]);
 assert.equal(valid.drafting_policy_version,VERSION);
 const conflict=validateAnalysis(result,{messages,jobs:[{...job,name:'Sample Community lot 43',groups:[{lot:'43'}]}],historyComplete:true});
 assert.equal(conflict.service_text,'');
 assert.equal(conflict.job,null);
});
function fixture(modelResult=result){
 const oldDigest=createHash('sha256').update('assistant-v2:'+JSON.stringify(messages.map(m=>[m.source_guid,m.text,m.edited_at,m.attachments?.map(a=>[a.guid,a.status])]))).digest('hex');
 const stored=[{id:'old',case_key:'old-key',conversation_key:scope.conversation_key,source_digest:oldDigest,result:{reply_text:'Old style'}}];
 const calls={prompts:[],writes:0};
 const api={
  MessageConversation:{filter:async()=>[{...scope,device_id:'synthetic-device'}]},
  MessageRecord:{filter:async()=>messages},
  MessageAssistantCapture:{filter:async()=>[{history_complete:true}]},
  MessageServiceCase:{
   filter:async q=>stored.filter(row=>Object.entries(q).every(([k,v])=>row[k]===v)),
   create:async row=>{calls.writes++;const saved={...row,id:'new'};stored.push(saved);return saved;},
   update:async()=>{throw Error('Unexpected update');},
  },
 };
 const client={auth:{me:async()=>({role:'admin',email:'gabefronk@gmail.com'})},asServiceRole:{entities:api,integrations:{Core:{InvokeLLM:async req=>{calls.prompts.push(req.prompt);return modelResult;}}}}};
 const handler=createMessageAssistantHandler({getClient:async()=>client,loadDirectory:async()=>({source:'synthetic',contacts:[{name:'Synthetic Contact',phone_key:scope.participants[0],builder:'Sample',builder_key:'sample',job_ids:[]}],jobs:[job]}),now:()=>new Date(now)});
 const run=async()=>{const response=await handler(new Request('https://test.invalid',{method:'POST',body:JSON.stringify({action:'analyze',conversation_key:scope.conversation_key})}));assert.equal(response.status,200);return response.json();};
 return {calls,stored,run};
}
test('service path consumes policy and replaces old policy cache without adding send capability',async()=>{
 const {calls,run}=fixture();
 const fresh=await run();
 assert.equal(calls.prompts.length,1);
 assert.ok(calls.prompts[0].includes(GUIDANCE));
 assert.equal(fresh.case.result.drafting_policy_version,VERSION);
 assert.equal(fresh.case.result.draft_only,true);
 const cached=await run();
 assert.equal(cached.cached,true);
 assert.equal(calls.prompts.length,1);
 assert.equal(calls.writes,1);
});
test('document-only classification remains outside service cases',async()=>{
 const {run,calls}=fixture({...result,is_service_request:false,summary:'Document request needs the document workflow.'});
 const response=await run();
 assert.equal(response.no_service_request,true);
 assert.equal(response.drafting_policy_version,VERSION);
 assert.equal(calls.writes,0);
});
