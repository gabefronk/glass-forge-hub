// Versioned singleton queue. All results remain untrusted owner-review drafts.
export const QUEUE_VERSION='research-queue-20260913-v1';
export const QUEUE_NAME='glass-forge-hermes-v1';
export const WORKER_ID='gaming-pc-hermes';
export const WORKER_SCOPE='draft_research_queue';
export const MAX_TASKS=20;
const LEASE=180000,DEADLINE=1200000;
const TERMINAL=new Set(['review_ready','failed','cancelled']);
export function fail(status,message){throw Object.assign(new Error(message),{status});}
export const stable=v=>v===null||typeof v!=='object'?JSON.stringify(v):Array.isArray(v)?'['+v.map(stable).join(',')+']':'{'+Object.keys(v).sort().map(k=>JSON.stringify(k)+':'+stable(v[k])).join(',')+'}';
export const digest=async v=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(typeof v==='string'?v:stable(v)))),b=>b.toString(16).padStart(2,'0')).join('');
export function text(v,n=200){if(typeof v!=='string'||v.length>n||/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v))fail(400,'Invalid text field.');return v;}
const key=v=>{text(v,180);if(!/^[A-Za-z0-9:_-]+$/.test(v))fail(400,'Invalid identifier.');return v;};
const at=n=>new Date(n).toISOString();
export function initialState(){return {protocol_version:QUEUE_VERSION,paused:true,tasks:[],active_task_id:null,worker_id:WORKER_ID,last_worker_seen_at:null};}
export function checkState(s){
  if(!s||s.protocol_version!==QUEUE_VERSION||!Array.isArray(s.tasks)||s.tasks.length>MAX_TASKS||s.worker_id!==WORKER_ID||new Set(s.tasks.map(t=>t.task_id)).size!==s.tasks.length||new Set(s.tasks.map(t=>t.request_key)).size!==s.tasks.length)fail(503,'Research queue needs operator review.');
  const active=s.tasks.filter(t=>t.status==='claimed'||t.status==='cancel_requested');
  if(active.length>1||(active.length===0&&s.active_task_id!==null)||(active.length===1&&s.active_task_id!==active[0].task_id))fail(503,'Research queue needs operator review.');
  return s;
}
export const taskSummary=t=>({task_id:t.task_id,request_key:t.request_key,job_id:t.packet?.identity?.job_id,job_name:t.packet?.identity?.canonical_name,purpose:t.packet?.purpose,status:t.status,created_at:t.created_at,updated_at:t.updated_at,lease_expires_at:t.lease_expires_at||null,local_job_id:t.result?.local_job_id||null,result:t.result||null,error:t.error||null});
const assignment=t=>({task_id:t.task_id,request_key:t.request_key,claim_id:t.claim_id,payload_sha256:t.payload_sha256,lease_expires_at:t.lease_expires_at,max_runtime_seconds:900,max_turns:40,packet:t.packet});
const bound=(s,input)=>{const t=s.tasks.find(t=>t.task_id===key(input.task_id));if(!t)fail(404,'Task not found.');if(t.worker_id!==WORKER_ID||t.claim_id!==input.claim_id||t.payload_sha256!==input.payload_sha256)fail(409,'Task assignment changed; reconcile the existing attempt.');return t;};
const leaseValid=(t,n)=>n<Date.parse(t.lease_expires_at)&&n<Date.parse(t.deadline_at);
function validateResult(raw,task){
  if(!raw||Array.isArray(raw)||Object.keys(raw).some(k=>!['status','summary','draft_reply','missing_sources','cited_source_keys','actions','local_job_id','model'].includes(k)))fail(400,'Unexpected result fields.');
  if(new TextEncoder().encode(stable(raw)).length>16000)fail(413,'Result exceeds 16000 bytes.');
  if(!['draft_ready','needs_sources'].includes(raw.status))fail(400,'Results must be review drafts or source gaps.');
  for(const [k,n] of [['summary',4000],['draft_reply',2000],['local_job_id',100],['model',100]])text(raw[k],n);
  if(!raw.summary.trim()||!raw.local_job_id||!raw.model)fail(400,'Result identity and summary required.');
  if(!Array.isArray(raw.missing_sources)||raw.missing_sources.length>12||!Array.isArray(raw.cited_source_keys)||raw.cited_source_keys.length>20)fail(400,'Invalid result lists.');
  raw.missing_sources.forEach(s=>text(s,400));raw.cited_source_keys.forEach(s=>text(s,300));
  const allowed=new Set(task.packet.source_references.map(r=>r.source_key));
  if(raw.cited_source_keys.some(k=>!allowed.has(k)))fail(400,'A citation was not supplied in this task.');
  if(!raw.actions||Object.keys(raw.actions).sort().join(',')!=='external_lookups,messages_sent,source_records_changed'||Object.values(raw.actions).some(v=>v!==0))fail(400,'This worker can only review supplied sources.');
  if(raw.status==='draft_ready'&&(!raw.cited_source_keys.length||!task.packet.verified_facts.length))fail(400,'Draft requires supplied evidence.');
  if(raw.status==='needs_sources'&&raw.draft_reply.trim())fail(400,'Missing-source results must leave the customer draft empty.');
  return structuredClone(raw);
}
export async function enqueueState(original,packet,now,uuid){
  const s=structuredClone(checkState(original)),n=Date.parse(now);if(!Number.isFinite(n))fail(500,'Invalid clock.');
  if(!packet?.identity?.job_id||packet.capabilities?.supplied_sources_only!==true)fail(400,'An exact prepared job is required.');
  const detached=structuredClone(packet);
  const payload_sha256=await digest(detached),request_key=await digest({protocol:QUEUE_VERSION,plan_key:detached.plan_key,payload_sha256});
  const existing=s.tasks.find(t=>t.request_key===request_key);if(existing)return {state:s,changed:false,body:{ok:true,duplicate:true,task:taskSummary(existing)}};
  if(s.tasks.length>=MAX_TASKS)fail(409,'Pilot queue is full; retained results need operator review.');
  const task={task_id:uuid(),request_key,payload_sha256,packet:detached,status:'queued',created_at:now,updated_at:now,worker_id:WORKER_ID,claim_id:null,claim_request_id:null,lease_expires_at:null,deadline_at:null,result:null,result_hash:null,error:null};
  s.tasks.push(task);return {state:s,changed:true,body:{ok:true,duplicate:false,task:taskSummary(task)}};
}
export async function workerTransition(original,input,now,uuid){
  const s=structuredClone(checkState(original)),n=Date.parse(now);if(!Number.isFinite(n))fail(500,'Invalid clock.');
  if(input.worker_id!==WORKER_ID)fail(403,'Worker identity mismatch.');
  const done=(body,changed=true)=>({state:s,changed,body:{ok:true,...body}});
  s.last_worker_seen_at=now;
  if(input.action==='claim'){
    key(input.request_id);
    const replay=s.tasks.find(t=>t.claim_request_id===input.request_id);
    if(replay){if(replay.status==='claimed'&&leaseValid(replay,n))return done({task:assignment(replay),replayed:true});return done({task:null,replay_status:replay.status,retry_after_seconds:30});}
    if(s.paused)return done({task:null,paused:true,retry_after_seconds:30});
    if(s.active_task_id)return done({task:null,active_task_id:s.active_task_id,retry_after_seconds:30});
    const t=s.tasks.find(t=>t.status==='queued');if(!t)return done({task:null,retry_after_seconds:30});
    t.status='claimed';t.claim_id=uuid();t.claim_request_id=input.request_id;t.claimed_at=now;t.lease_expires_at=at(n+LEASE);t.deadline_at=at(n+DEADLINE);t.updated_at=now;s.active_task_id=t.task_id;
    return done({task:assignment(t)});
  }
  if(input.action==='heartbeat'&&!input.task_id)return done({paused:s.paused,active_task_id:s.active_task_id});
  const t=bound(s,input);
  if(input.action==='heartbeat'){
    if(t.status==='cancel_requested'||t.status==='cancelled')return done({task_id:t.task_id,status:t.status,cancel_requested:true,lease_expires_at:t.lease_expires_at});
    if(t.status!=='claimed'||!leaseValid(t,n))fail(409,'Assignment expired or ended; stop and reconcile.');
    t.lease_expires_at=at(Math.min(n+LEASE,Date.parse(t.deadline_at)));t.updated_at=now;
    return done({task_id:t.task_id,status:t.status,cancel_requested:false,lease_expires_at:t.lease_expires_at});
  }
  if(input.action==='complete'){
    const result=validateResult(input.result,t),result_hash=await digest(result);
    if(t.status==='review_ready'){if(t.result_hash!==result_hash)fail(409,'Conflicting result retry.');return done({task_id:t.task_id,status:t.status,result_sha256:result_hash,duplicate:true});}
    if(t.status!=='claimed'||!leaseValid(t,n))fail(409,'Completion blocked by cancellation or expired assignment.');
    t.result=result;t.result_hash=result_hash;t.status='review_ready';t.updated_at=now;t.finished_at=now;s.active_task_id=null;
    return done({task_id:t.task_id,status:t.status,result_sha256:result_hash,duplicate:false});
  }
  if(input.action==='fail'){
    if(!['needs_sources','local_capacity','local_runtime','invalid_result','cancelled','lease_expired'].includes(input.error_code))fail(400,'Unknown failure code.');
    const detail=text(input.detail,500),error={code:input.error_code,detail};
    if(TERMINAL.has(t.status)){if(stable(t.error)!==stable(error))fail(409,'Assignment already ended differently.');return done({task_id:t.task_id,status:t.status,duplicate:true});}
    if(!['claimed','cancel_requested'].includes(t.status))fail(409,'Assignment is not active.');
    t.status=t.status==='cancel_requested'||input.error_code==='cancelled'?'cancelled':'failed';t.error=error;t.updated_at=now;t.finished_at=now;s.active_task_id=null;
    return done({task_id:t.task_id,status:t.status});
  }
  fail(403,'Worker action unavailable.');
}
export function ownerTransition(original,input,now){
  const s=structuredClone(checkState(original));
  if(input.action==='set_paused'){if(typeof input.paused!=='boolean')fail(400,'Paused must be boolean.');s.paused=input.paused;return {state:s,changed:true,body:{ok:true,paused:s.paused}};}
  if(input.action==='cancel'){
    const t=s.tasks.find(t=>t.task_id===key(input.task_id));if(!t)fail(404,'Task not found.');
    if(TERMINAL.has(t.status))return {state:s,changed:false,body:{ok:true,task:taskSummary(t),already_terminal:true}};
    t.status=t.status==='queued'?'cancelled':'cancel_requested';t.updated_at=now;
    return {state:s,changed:true,body:{ok:true,task:taskSummary(t),local_stop_verified:t.status==='cancelled'}};
  }
  fail(400,'Owner action unavailable.');
}
