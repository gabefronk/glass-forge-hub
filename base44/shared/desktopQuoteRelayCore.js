import { createHash, randomUUID } from 'node:crypto';
export const INBOX = '1sRaRX-ezKQRiHjoR0d215kCcqk3ajE8O';
export const OUTPUTS = '1F_PgUPEuvyvzCk92tdaFiwioLSack4iS';
export const PLAYBOOKS = ['1X43D6bfTKdatjSEHS4cVeUj06PZaMUJN1rVcdK8mFcw','1muSZgsIHW6IuQpRYtVKE6FT3NUZIFC3GDC8wztYzGyk'];
export const HOSTS = {takeoff:'GAMING-PC',pella:'GabesGaming'};
export const digest = x => createHash('sha256').update(typeof x === 'string' ? x : JSON.stringify(x)).digest('hex');
export const initial = () => ({enabled:true,dispatch_enabled:false,workers:{},jobs:[],excluded:['19qLdIuTqMV7fauo98L1f4L4LkVL9Yjoz']});
export function assert(ok,message){if(!ok)throw new Error(message);}
const required = (x,name) => assert(typeof x==='string' && x.trim().length>0 && x.length<=1000,`Missing ${name}`);
export function enqueue(state,files,playbooks,now){
  for(const file of files){
    if(state.excluded.includes(file.id))continue;
    const key=file.id+':'+file.version;
    if(state.jobs.some(j=>j.source_key===key))continue;
    assert(state.jobs.length<150,'Queue limit reached; archive completed records');
    // A revision while an earlier native build exists must be reconciled by the owner.
    const previous=state.jobs.find(j=>j.source.id===file.id);
    state.jobs.push({id:randomUUID(),source_key:key,source:file,job_name:file.name.replace(/\.pdf$/i,''),stage:'takeoff',status:previous?'needs_input':'queued',questions:previous?['A prior revision exists. Reconcile before creating another quote.']:[],playbooks,created_at:now,updated_at:now,events:[],outputs:[],checkpoint:null});
  }
}
export function claim(state,role,requestId,now){
  const w=state.workers[role];
  assert(state.dispatch_enabled,'Dispatch disabled pending desktop verification');
  assert(w?.ready && Date.parse(now)-Date.parse(w.at)<90000,'Worker is not ready');
  const owned=state.jobs.find(j=>j.role===role && ['running','needs_input','failed'].includes(j.status));
  if(owned){assert(owned.claim_request===requestId,'An existing desktop run needs reconciliation');return owned;}
  const job=state.jobs.find(j=>j.status==='queued'&&j.stage===role);
  if(!job)return null;
  Object.assign(job,{role,status:'running',run_id:randomUUID(),claim_request:requestId,updated_at:now});
  return job;
}
export function ownedJob(state,role,id,run){
  const j=state.jobs.find(j=>j.id===id);
  assert(j&&j.role===role&&j.run_id===run&&j.status==='running','Assignment is no longer active');return j;
}
export function validateTakeoff(t,fileId){
  assert(t&&Array.isArray(t.lines)&&t.lines.length>0&&t.lines.length<=500,'Takeoff opening list required');
  assert(Array.isArray(t.questions),'Takeoff questions required');
  required(t.job_name,'job name');
  const marks=new Set();
  for(const l of t.lines){
    required(l.mark,'opening mark');assert(!marks.has(l.mark),'Duplicate opening mark');marks.add(l.mark);
    assert(Number.isInteger(l.qty)&&l.qty>0&&l.qty<=1000,'Invalid quantity');
    assert(Array.isArray(l.source_refs)&&l.source_refs.length>0&&l.source_refs.every(r=>r.file_id===fileId&&Number.isInteger(r.page)&&r.page>0),'Every line needs matching physical source pages');
    for(const k of ['width','height'])assert(l[k]==null||Number.isFinite(l[k])&&l[k]>0,'Invalid dimension');
  }
  return t;
}
export function readyForPella(t){
  const specs=['product_line','operation','handing','glass','interior','exterior','grilles','hardware','installation','dimension_basis'];
  return t.questions.length===0&&t.manufacturer==='Pella'&&t.lines.every(l=>
    Number.isFinite(l.width)&&l.width>0&&Number.isFinite(l.height)&&l.height>0&&
    ['call','frame','rough_opening'].includes(l.dimension_basis)&&l.unit_of_measure==='inches'&&
    specs.every(k=>typeof l[k]==='string'&&l[k].trim()&&!/^(unknown|tbd|unspecified)$/i.test(l[k]))&&
    typeof l.spec_evidence==='string'&&l.spec_evidence.trim());
}
export function report(state,role,body,now){
  const j=state.jobs.find(j=>j.id===body.job_id);assert(j,'Unknown job');required(body.event_id,'event id');
  const prior=j.events.find(e=>e.id===body.event_id),hash=digest(body);
  if(prior){assert(prior.digest===hash&&prior.role===role,'Event reused with changed content');return j;}
  ownedJob(state,role,body.job_id,body.run_id);
  if(body.kind==='checkpoint'){
    assert(body.checkpoint&&typeof body.checkpoint==='object','Checkpoint required');
    if(j.checkpoint?.quote_number)assert(body.checkpoint.quote_number===j.checkpoint.quote_number,'Quote identity cannot change');
    j.checkpoint=body.checkpoint;
  }else if(body.kind==='takeoff_complete'){
    assert(role==='takeoff','Wrong stage');j.takeoff=validateTakeoff(body.takeoff,j.source.id);
    j.job_name=j.takeoff.job_name;j.stage='pella';j.role=null;j.run_id=null;
    j.status=readyForPella(j.takeoff)?'queued':'needs_input';
    j.questions=j.status==='queued'?[]:[...j.takeoff.questions,'Complete missing Pella selections and measurement basis.'];
  }else if(body.kind==='failed'||body.kind==='needs_input'){
    assert(Array.isArray(body.questions)&&body.questions.length&&body.questions.every(q=>typeof q==='string'&&q.trim()),'Explain what is needed');
    j.status=body.kind;j.questions=body.questions;
  }else if(body.kind==='quote_saved'){
    assert(role==='pella'&&body.saved===true&&body.order_submitted===false,'Saved quote evidence required');
    required(body.quote_number,'quote number');
    assert(j.checkpoint?.quote_number===body.quote_number,'Checkpoint quote identity mismatch');
    assert(j.outputs.some(o=>o.mimeType==='application/pdf'&&o.verified),'A verified proposal PDF upload is required');
    j.status='done';j.quote_number=body.quote_number;j.total=body.total;j.completed_at=now;j.role=null;
  }else throw new Error('Unsupported event');
  j.updated_at=now;j.events.push({id:body.event_id,digest:hash,role,kind:body.kind,at:now});return j;
}

