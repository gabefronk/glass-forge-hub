import { createJobIndex, matchJobEvidence } from './jobContextCore.mjs';
import { buildJobReplyFacts } from './jobReplyContext.mjs';

// Fast read-only lookup. This module never loads a workbook, source calendar,
// PDF, credentials, previous conversation state, or a model.
const text=v=>typeof v==='string'?v.trim():'';
const norm=v=>text(v).normalize('NFKC').toLowerCase().replace(/[\u2010-\u2015]/g,'-').replace(/\s+/g,' ');
const unique=values=>[...new Set(values)];
const keys=['job_id','job_name','builder','subdivision','lot','po','oe','project_id'];
const catalogKeys=['builder','subdivision','lot'];
const MAX_AGE=26*3600000;
function namesFor(query) {
  const {builder:b,subdivision:s,lot:l}=query;
  return [
    `${b} ${s} lot ${l}`,`${b} - ${s} lot ${l}`,`${b} - ${l} ${s}`,
    `${b} ${s} ${l}`,`${b} - ${s} - ${l}`,`${b} - ${s} #${l}`,`${b} - ${s} Lot #${l}`
  ];
}
function validInstant(value) {return typeof value==='string'&&/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)&&Number.isFinite(Date.parse(value));}

export function resolvePreparedJobQuery({query={},jobs=[],projectLinks=[],catalogComplete=true}={}) {
  const out={status:'needs_identity',job_id:null,candidate_job_ids:[],question:null,matched_by:[],automatic_send_allowed:false};
  const stop=(status,question,candidates=[])=>({...out,status,question,candidate_job_ids:unique(candidates).sort().slice(0,20),candidates_truncated:unique(candidates).length>20});
  if(!query||typeof query!=='object'||Array.isArray(query)||keys.some(k=>query[k]!==undefined&&(typeof query[k]!=='string'||query[k].length>200||/[\u0000-\u001f]/.test(query[k]))))return stop('needs_identity','Use plain job identity fields from the current request.');
  if(query.start_date||query.end_date)return stop('needs_review','This fast lookup supplies current upcoming facts. A requested historical or custom date range needs explicit review of the prepared job history; it will not be silently replaced with a different range.');
  if(catalogComplete!==true)return stop('source_unavailable','The job identity catalog is incomplete; complete its read before selecting a job.');
  const q=Object.fromEntries(keys.map(k=>[k,text(query[k])])), supplied=keys.filter(k=>q[k]);
  if(!supplied.length)return stop('needs_identity','Which exact job ID, job name, PO/OE, or builder, subdivision and lot is this for?');
  let index;try{index=createJobIndex({jobs,projectLinks});}catch{return stop('source_unavailable','The job identity catalog could not be validated.');}
  const constraints=[];
  const add=(kind,ids)=>{if(ids?.size){constraints.push([...ids]);out.matched_by.push(kind);return true;}return false;};
  if(q.job_id&&!add('job_id',index.byId.has(q.job_id)?new Set([q.job_id]):null))return stop('not_found','The supplied job ID does not exist in the current job catalog.');
  if(q.job_name&&!add('job_name',index.names.get(norm(q.job_name))))return stop('not_found','The supplied job name is not an exact canonical name or approved alias.');
  if(q.po&&!add('po',index.po.get(norm(q.po))))return stop('not_found','The supplied PO is not present exactly in the current job catalog; verify the order number.');
  if(q.oe&&!add('oe',index.oe.get(norm(q.oe))))return stop('not_found','The supplied OE is not present exactly in the current job catalog; verify the complete order number.');
  if(q.project_id&&!add('project_id',index.project.get(q.project_id)))return stop('not_found','The supplied project ID has no verified job association.');
  const partKeys=catalogKeys.filter(k=>q[k]);
  if(partKeys.length===3) {
    // Require an actual exact catalog name match; the core's hard-ID fallback
    // alone cannot confirm an arbitrary builder/community label.
    const named=unique(namesFor(q).flatMap(name=>[...(index.names.get(norm(name))||[])]));
    const structured=jobs.filter(j=>catalogKeys.every(k=>text(j[k])&&norm(j[k])===norm(q[k]))).map(j=>j.id||j.job_id);
    const ids=unique([...named,...structured]);
    if(!ids.length)return stop('not_found','The exact builder, subdivision and lot are not represented by a current canonical name or approved alias.');
    const multi=matchJobEvidence({job_name:`${q.builder} ${q.subdivision} lot ${q.lot}`},index);
    if(multi.reason==='multiple_lots_or_jobs')return stop('ambiguous','The request contains multiple lots; select one job.',ids);
    add('builder_subdivision_lot',new Set(ids));
  } else if(partKeys.length) {
    const completeFields=jobs.filter(j=>partKeys.every(k=>text(j[k])));
    // Do not parse a partial builder/lot out of free text or drop it because a PO
    // happens to match. Missing structured fields require a full identity.
    if(completeFields.length!==jobs.length)return stop('needs_identity','Provide builder, subdivision and lot together, or an exact job name, so every supplied identity can be verified.');
    const ids=completeFields.filter(j=>partKeys.every(k=>norm(j[k])===norm(q[k]))).map(j=>j.id||j.job_id);
    if(!ids.length)return stop('not_found','The supplied job identity fields do not match the current catalog.');
    add('structured_job_fields',new Set(ids));
  }
  if(!constraints.length)return stop('needs_identity','Provide one complete current job identity.');
  let candidates=constraints[0];for(const set of constraints.slice(1))candidates=candidates.filter(id=>set.includes(id));
  if(!candidates.length)return stop('conflict','The supplied job and order identifiers disagree. Verify the job and complete order number before continuing.',constraints.flat());
  if(candidates.length>1)return stop('ambiguous','More than one job matches exactly; provide the exact job ID or a distinguishing complete order number.',candidates);
  return {...out,status:'matched',job_id:candidates[0],candidate_job_ids:candidates,question:null};
}

export function buildPreparedJobLookup({query={},jobs=[],projectLinks=[],catalogComplete=true,prepared,now}={}) {
  const identity=resolvePreparedJobQuery({query,jobs,projectLinks,catalogComplete});
  const out={...identity,lookup_mode:'prepared_only',facts:[],references:[],source_freshness:[],owner_brief:'',run_id:null,automatic_send_allowed:false,source_records_changed:false,customer_answer_status:'draft_only'};
  if(identity.status!=='matched'){out.owner_brief=identity.question;return out;}
  if(!prepared?.context){out.status='not_prepared';out.question='No completed prepared context is available for this exact job. Run the preparation workflow; do not scan source systems silently during a reply.';out.owner_brief=out.question;return out;}
  if(prepared.context.job_id!==identity.job_id){out.status='needs_review';out.question='The supplied prepared context belongs to a different job; retrieve the exact selected job generation.';out.owner_brief=out.question;return out;}
  const verified=buildJobReplyFacts({conversation:{job_id:identity.job_id},prepared,now});
  out.run_id=verified.run_id;
  out.facts=verified.facts.slice(0,5);
  const keysForFacts=verified.source_keys.slice(0,5),byKey=new Map((prepared.context.evidence||[]).map(e=>[e.source_key,e]));
  out.references=keysForFacts.map(key=>{const e=byKey.get(key);return {source_key:key,source_type:e?.source_type||null,source_id:e?.source_id||null,date:e?.date||null,source_checked_at:e?.source_checked_at||prepared.context.sources?.[e?.source_type]?.checked_at||null};});
  out.source_freshness=Object.entries(prepared.context.sources||{}).slice(0,25).map(([type,s])=>{
    const age=validInstant(now)&&validInstant(s.checked_at)?Date.parse(now)-Date.parse(s.checked_at):null;
    const state=s.state==='current'&&(age===null||age<0||age>MAX_AGE)?age!==null&&age>=0?'stale':'unknown':s.state||'unknown';
    return {source_type:type,state,checked_at:s.checked_at||null,range_start:s.range_start||null,range_end:s.range_end||null,complete:s.complete??null};
  });
  out.source_freshness_truncated=Object.keys(prepared.context.sources||{}).length>25;
  out.gaps=verified.notes;
  out.facts_truncated=verified.facts.length>5;
  out.prepared_at=prepared.context.generated_at;
  if(!out.facts.length){out.status='needs_review';out.question=verified.notes[0]?.detail||'No current structured job facts are available.';}
  const warnings=out.source_freshness.filter(s=>s.state!=='current').map(s=>`${s.source_type}: ${s.state}`);
  // This is an owner-facing summary made from the same narrow facts. Raw cached
  // notes/PDF extractions/financial or access information are never re-exposed.
  out.owner_brief=[`Prepared job ${identity.job_id}.`,out.facts.length?out.facts.join('\n'):(out.question||''),warnings.length?'Source limitations: '+warnings.join('; '):'',out.facts_truncated?'Five facts shown; further prepared evidence remains in the owner job view.':'','No source systems were queried by this lookup and no message was sent.'].filter(Boolean).join('\n').slice(0,6000);
  return out;
}
