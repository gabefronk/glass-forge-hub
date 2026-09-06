import { createClientFromRequest } from "npm:@base44/sdk@0.8.46";
import { transport, execution } from "../../shared/windowQuoteAgentRuntime.js";
export default async function(req: Request) {
 const headers={"Content-Type":"application/json","Cache-Control":"no-store"};
 try {
  const client=createClientFromRequest(req); const user=await client.auth.me();
  if(user?.role!=="admin")return new Response('{"error":"Administrator access required"}',{status:403,headers});
  const body=await req.json(); if(body.action!=="inspect")return new Response('{"error":"Read-only diagnostics only"}',{status:400,headers});
  const rows=await client.asServiceRole.entities.QuoteRequests.filter({id:body.quote_id},undefined,1); const q=rows[0];
  if(!q)return new Response('{"error":"Quote not found"}',{status:404,headers});
  const id=q.agent_run?.conversation_id||"6a9db2ed143f8b28d5fbd6b3";
  const c=await transport.getConversation(id);
  return new Response(JSON.stringify({configured:execution.configured,quote_id:q.id,status:q.worker_status,phase:q.agent_run?.phase,recorded_conversation_id:q.agent_run?.conversation_id||"",provider_conversation_id:c.id,message_count:c.messages.length,message_summary:c.messages.map(m=>({id:m.id,role:m.role,dispatch:typeof m.content==="string"&&m.content.startsWith("[WindowQuote operation=")})),last_error:q.agent_run?.error_code,last_error_diagnostic:q.agent_run?.error_diagnostic}),{headers});
 } catch(e) {return new Response(JSON.stringify({error:"Agent connection diagnostic failed",code:e?.code||"INTERNAL",operation:e?.operation,status:e?.status,diagnostic:e?.diagnostic}),{status:503,headers});}
}
// Dispatch v6: guarded saved-checkpoint continuations, default off; explicit result dimensions.
