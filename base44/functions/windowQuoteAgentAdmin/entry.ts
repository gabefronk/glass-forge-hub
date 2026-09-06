import { createClientFromRequest } from "npm:@base44/sdk@0.8.46";
import { transport, execution } from "../../shared/windowQuoteAgentRuntime.js";
export default async function(req: Request) {
 const headers={"Content-Type":"application/json","Cache-Control":"no-store"};
 try {
  const client=createClientFromRequest(req); const user=await client.auth.me();
  if(user?.role!=="admin")return new Response('{"error":"Administrator access required"}',{status:403,headers});
  const body=await req.json(); if(!["inspect","probe_create","probe_send"].includes(body.action))return new Response('{"error":"Read-only diagnostics only"}',{status:400,headers});
  const rows=await client.asServiceRole.entities.QuoteRequests.filter({id:body.quote_id},undefined,1); const q=rows[0];
  if(!q)return new Response('{"error":"Quote not found"}',{status:404,headers});
  if(body.action==="probe_send") {
   const conversationId="6a9da9cd0b2daadbdcf8534d";
   const c={quote_id:q.id,input_revision:q.input_revision,operation_id:"diagnostic-transport-"+q.agent_run.operation_id};
   const out=await transport.sendMessage({conversationId,correlation:c,content:"Transport diagnostic only. Reply with TRANSPORT_ACK and the names of your available browser tools. Do not browse, call backend functions, edit records, or quote windows."});
   return new Response(JSON.stringify({accepted:out.accepted,conversation_id:out.conversation_id,response_type:typeof out.provider_response,response_keys:out.provider_response&&typeof out.provider_response==="object"?Object.keys(out.provider_response):[],response_summary:typeof out.provider_response==="string"?out.provider_response.slice(0,1000):out.provider_response?.content||null}),{headers});
  }
  if(body.action==="probe_create") {
   try { const c=await transport.createConversation({quote_id:q.id,input_revision:q.input_revision,operation_id:q.agent_run.operation_id}); return new Response(JSON.stringify({created:{id:c.id,metadata:c.metadata,message_count:c.messages.length,created_date:c.created_date}}),{headers}); }
   catch(e) {return new Response(JSON.stringify({code:e?.code,operation:e?.operation,observed_conversation:e?.observed_conversation||null}),{headers});}
  }
  const raw=await transport.listConversations();
  const shape=Array.isArray(raw)?"array":Object.keys(raw||{});
  const candidates=Array.isArray(raw)?raw:Array.isArray(raw?.conversations)?raw.conversations:Array.isArray(raw?.data)?raw.data:[];
  const matching=candidates.filter(c=>c.metadata?.window_quote?.quote_id===q.id).map(c=>({id:c.id,keys:Object.keys(c),app_id:c.app_id,metadata:c.metadata,message_count:c.messages?.length}));
  return new Response(JSON.stringify({configured:execution.configured,quote_id:q.id,status:q.worker_status,phase:q.agent_run?.phase,recorded_conversation_id:q.agent_run?.conversation_id||"",collection_shape:shape,collection_summary:candidates.map(c=>({id:c.id,keys:Object.keys(c),metadata:c.metadata,message_count:c.messages?.length})),last_error:q.agent_run?.error_code,last_error_diagnostic:q.agent_run?.error_diagnostic,matching}),{headers});
 } catch(e) {return new Response(JSON.stringify({error:"Agent connection diagnostic failed",code:e?.code||"INTERNAL",operation:e?.operation,status:e?.status,diagnostic:e?.diagnostic}),{status:503,headers});}
}
