import {QUEUE_VERSION,QUEUE_NAME,WORKER_ID,WORKER_SCOPE,checkState,taskSummary,enqueueState,workerTransition,ownerTransition,digest,fail} from './researchQueueCore.mjs';
const owners=new Set(['gabefronk@gmail.com','gabriel.fronk.wd@gmail.com']);
const isOwner=u=>u?.role==='admin'&&owners.has(String(u.email||'').toLowerCase().trim());
const reply=(body,status=200)=>Response.json({protocol_version:QUEUE_VERSION,...body},{status,headers:{'Cache-Control':'private, no-store','Vary':'Authorization, x-glass-forge-research-key'}});
const same=(a,b)=>{if(typeof a!=='string'||typeof b!=='string'||a.length!==64||b.length!==64)return false;let difference=0;for(let i=0;i<64;i++)difference|=a.charCodeAt(i)^b.charCodeAt(i);return difference===0;};
export function createResearchQueueHandler({getClient,makePacket,now=()=>new Date().toISOString(),uuid=()=>crypto.randomUUID()}){
  return async req=>{
    if(req.method!=='POST')return reply({error:'Use POST.'},405);
    try{
      const client=await getClient(req),db=client.asServiceRole.entities,key=req.headers.get('x-glass-forge-research-key');
      let device=null;
      if(key!==null){
        if(key.length<40||key.length>200)return reply({error:'Research worker authorization required.'},401);
        const devices=await db.ResearchWorkerDevice.filter({worker_id:WORKER_ID,scope:WORKER_SCOPE,enabled:true},'id',2);
        if(devices.length!==1||!same(devices[0].token_hash,await digest(key)))return reply({error:'Research worker authorization required.'},401);
        device=devices[0];
      }else if(!isOwner(await client.auth.me().catch(()=>null)))return reply({error:'Owner access required.'},403);
      const raw=await req.text();if(new TextEncoder().encode(raw).length>32000)return reply({error:'Request exceeds 32000 bytes.'},413);
      const input=JSON.parse(raw);if(!input||Array.isArray(input)||typeof input.action!=='string')return reply({error:'Invalid request.'},400);
      const allowed=device?['claim','heartbeat','complete','fail']:['status','enqueue','enqueue_canary','cancel','set_paused'];
      if(!allowed.includes(input.action))return reply({error:'Action is unavailable for this caller.'},403);
      const rows=await db.ResearchQueueState.filter({name:QUEUE_NAME},'id',2);
      if(rows.length!==1)return reply({error:'Research queue is not provisioned.'},503);
      const row=rows[0],state=checkState(row.state),at=now();
      if(!Number.isSafeInteger(row.state_version)||row.state_version<0)fail(503,'Queue revision requires review.');
      if(input.action==='status')return reply({ok:true,paused:state.paused,worker_id:WORKER_ID,last_worker_seen_at:state.last_worker_seen_at,active_task_id:state.active_task_id,capacity:20,retained_tasks:state.tasks.length,tasks:state.tasks.filter(t=>!input.job_id||t.packet.identity.job_id===input.job_id||t.packet.task_type==='synthetic_canary').map(taskSummary),automatic_send_allowed:false});
      let change;
      if(device)change=await workerTransition(state,input,at,uuid);
      else if(input.action==='enqueue'||input.action==='enqueue_canary')change=await enqueueState(state,await makePacket({client,input,now:at}),at,uuid);
      else change=ownerTransition(state,input,at);
      if(change.changed){
        if(new TextEncoder().encode(JSON.stringify(change.state)).length>850000)fail(409,'Retained queue data exceeds pilot capacity.');
        const written=await db.ResearchQueueState.updateMany({id:row.id,state_version:row.state_version},{$set:{state:change.state,state_version:row.state_version+1}});
        if(written.updated!==1)fail(409,'Queue changed; retry the same request identity.');
      }
      return reply(change.body);
    }catch(error){return reply({error:error.status?error.message:'Research queue could not complete this request. Retry the same identity after checking status.'},error.status||500);}
  };
}
