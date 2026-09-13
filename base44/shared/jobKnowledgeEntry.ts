import {createClientFromRequest} from 'npm:@base44/sdk@0.8.48';
import {isKnowledgeOwner,refreshJobKnowledge,readPreparedJob} from './jobKnowledgeService.mjs';
import {readKnowledgeTracker} from './jobKnowledgeRuntime.ts';
const reply=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'private, no-store'}});
Deno.serve(async req=>{
  if(req.method!=='POST')return reply({error:'Use POST.'},405);
  const client=createClientFromRequest(req),user=await client.auth.me().catch(()=>null);
  if(!isKnowledgeOwner(user))return reply({error:'Owner access required.'},403);
  try {
    const raw=await req.text();if(raw.length>4000)return reply({error:'Request too large.'},413);
    const input=JSON.parse(raw),api=client.asServiceRole;
    if(input.action==='refresh')return reply(await refreshJobKnowledge({api,readTracker:readKnowledgeTracker,force:input.force===true}));
    if(input.action==='get')return reply(await readPreparedJob(api,input.job_id));
    if(input.action==='status') {
      const rows=await api.entities.JobKnowledgeRun.list('-started_at',5);
      return reply({runs:rows.map(({unassigned,...r})=>({...r,unassigned_count:r.unassigned_count??unassigned?.length??0})),automatic_send_allowed:false});
    }
    if(input.action==='unassigned') {
      const run=(await api.entities.JobKnowledgeRun.filter({status:'complete'},'-completed_at',1))[0];
      const offset=Number.isSafeInteger(input.offset)&&input.offset>=0&&input.offset%50===0?input.offset:0;
      const chunk=run?(await api.entities.JobKnowledgeUnassigned.filter({run_id:run.id,chunk_index:Math.floor(offset/200)},'id',2)):[];
      if(chunk.length>1)return reply({error:'Ambiguous preparation chunk. Rebuild required.'},409);
      return reply({run_id:run?.id,records:(chunk[0]?.records||[]).slice(offset%200,offset%200+50),total:run?.unassigned_count||0});
    }
    return reply({error:'Unsupported action.'},400);
  } catch(error) {
    console.error('Job knowledge failed',error?.name||'Error');
    return reply({error:'Job information could not finish loading. The previous complete preparation is retained. No source records or messages were changed.'},500);
  }
});
