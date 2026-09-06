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
  const raw=await transport.listConversations();
  const shape=Array.isArray(raw)?"array":Object.keys(raw||{});
  const candidates=Array.isArray(raw)?raw:Array.isArray(raw?.conversations)?raw.conversations:Array.isArray(raw?.data)?raw.data:[];
  const matching=candidates.filter(c=>c.metadata?.window_quote?.quote_id===q.id).map(c=>({id:c.id,keys:Object.keys(c),app_id:c.app_id,metadata:c.metadata,message_count:c.messages?.length}));
  return new Response(JSON.stringify({configured:execution.configured,quote_id:q.id,status:q.worker_status,phase:q.agent_run?.phase,recorded_conversation_id:q.agent_run?.conversation_id||"",collection_shape:shape,matching}),{headers});
 } catch(e) {return new Response(JSON.stringify({error:"Agent connection diagnostic failed",code:e?.code||"INTERNAL",operation:e?.operation,status:e?.status,diagnostic:e?.diagnostic}),{status:503,headers});}
}

// Edge fetch uses manual redirect handling.
