// Pure request mapping only. Inputs come from the exact-job prepared lookup; no I/O or transport.
export const RESEARCH_PLAN_VERSION = 'job-research-20260913-v1';
export const RESEARCH_PURPOSES = Object.freeze(['eta','installation_schedule','service_schedule','service_issue','missing_parts','documents','referral','completion','technical_question','site_clarification']);
const QUERY_KEYS = ['job_id','job_name','builder','subdivision','lot','po','oe','project_id'];
const SOURCE_TYPES = new Set(['sales_tracker','calendar','live_google','outlook_installation','outlook_service','outlook_installation_selected','outlook_service_selected','probuild_reports','probuild_library','live_probuild','documents','document_extractions','job_notes','service_requests']);
const AGE = 26 * 3600000, DAY = 86400000;
const own = (o,k) => Object.prototype.hasOwnProperty.call(o,k);
const plain = o => !!o && typeof o === 'object' && !Array.isArray(o) && [Object.prototype,null].includes(Object.getPrototypeOf(o));
const clean = (v,max=200) => typeof v === 'string' && v.length <= max && !/[\u0000-\u001f\u007f]/u.test(v);
const sensitive = v => /https?:\/\/|\b(?:password|passcode|access.token|api.key|client.secret|verification.code)\b|[\w.+-]+@[\w.-]+\.[a-z]{2,}|\+[1-9]\d{9,14}/i.test(v);
const selector = (v,max=200) => clean(v,max) && !sensitive(v);
const id = v => typeof v === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(v);
const refKey = v => clean(v,300) && !!v.trim() && !sensitive(v);
const freeze = v => { if(v && typeof v==='object' && !Object.isFrozen(v)){Object.values(v).forEach(freeze);Object.freeze(v);}return v; };
function day(v) { return typeof v==='string' && /^\d{4}-\d{2}-\d{2}$/.test(v) && Number.isFinite(Date.parse(v+'T12:00:00Z')) && new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v; }
function instant(v) {
  if(typeof v!=='string')return null;
  const m=/^(\d{4}-\d{2}-\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,3})?(Z|[+-](\d{2}):(\d{2}))$/.exec(v);
  if(!m||!day(m[1])||+m[2]>23||+m[3]>59||+m[4]>59||+(m[6]||0)>23||+(m[7]||0)>59)return null;
  const n=Date.parse(v);return Number.isFinite(n)?n:null;
}
const fresh = (v,now) => { const n=instant(v);return n!==null && n<=now && now-n<=AGE; };
const norm = v => String(v||'').normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');
function denverDay(ms) { const p=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Denver',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(ms));return ['year','month','day'].map(k=>p.find(x=>x.type===k).value).join('-'); }
// FNV-1a 128-bit fingerprint is for request deduplication only, never evidence integrity/authentication.
function fingerprint(value) { let h=0x6c62272e07bb014262b821756295c58dn;for(const b of new TextEncoder().encode(JSON.stringify(value)))h=BigInt.asUintN(128,(h^BigInt(b))*0x1000000000000000000013bn);return h.toString(16).padStart(32,'0'); }
function dates(research,now) {
  const today=denverDay(now), explicit=own(research,'start_date')||own(research,'end_date');
  if(research.time_zone!==undefined&&research.time_zone!=='America/Denver')return null;
  if(!explicit&&!['eta','installation_schedule','service_schedule'].includes(research.purpose))return research.mode&&research.mode!=='current_revision'?null:{mode:'current_revision',start_date:null,end_date:null,time_zone:'America/Denver',bounds:null,explicit:false,applicability:'source_revision',document_date_filter:false};
  const start=explicit?research.start_date:today, end=explicit?research.end_date:new Date(Date.parse(today+'T12:00:00Z')+13*DAY).toISOString().slice(0,10);
  if(!day(start)||!day(end)||start>end||Date.parse(end)-Date.parse(start)>92*DAY)return null;
  const mode=end<today?'historical':start<today?'mixed':'current';
  if(research.mode!==undefined&&research.mode!==mode)return null;
  return {mode,start_date:start,end_date:end,time_zone:'America/Denver',bounds:'inclusive',explicit,applicability:'activity_window',document_date_filter:false};
}
const ROUTES = {
  base44_cached:{source:'base44_cached',app:'Glass Forge',route:'prepared_job_references'},
  google_calendar:{source:'google_calendar',app:'Google Calendar',route:'existing_base44_direct_reader'},
  probuild:{source:'probuild',app:'ProBuild',route:'existing_base44_direct_reader'},
  onedrive:{source:'onedrive',app:'OneDrive',route:'mac_wired_ipad_existing_native_session'},
  teams:{source:'teams',app:'OneDrive (company Teams library)',route:'mac_wired_ipad_existing_native_session'},
  outlook:{source:'outlook',app:'Outlook',route:'mac_wired_ipad_existing_native_session'}
};
const STEPS = {
  eta:['base44_cached','probuild','outlook'], installation_schedule:['base44_cached','google_calendar','outlook'],
  service_schedule:['base44_cached','google_calendar','probuild','outlook'], service_issue:['base44_cached','probuild','onedrive','teams','outlook'],
  missing_parts:['base44_cached','probuild','onedrive','teams','outlook'], documents:['base44_cached','probuild','onedrive','teams','outlook'],
  referral:['base44_cached','google_calendar','probuild','onedrive','teams','outlook'], completion:['base44_cached','probuild','google_calendar','outlook'],
  technical_question:['base44_cached','probuild','onedrive','teams','outlook'], site_clarification:['base44_cached','probuild','outlook']
};
const QUESTIONS = {
  eta:'Verify the exact order or component arrival estimate and distinguish it from delivery or crew arrival.',
  installation_schedule:'Verify the current installation date, scope and cancellation status for this job.',
  service_schedule:'Verify the current service visit date, scope and cancellation status for this job.',
  service_issue:'Verify the reported issue, exact component and relevant service history without inferring diagnosis or warranty.',
  missing_parts:'Verify the missing component against the exact order and current source; do not infer availability.',
  documents:'Find the requested document for this exact job and lot, verify its contents, revision and page coverage.',
  referral:'Gather the exact referred job's existing context and prepare a private owner question about the referral. Do not infer a complaint, warranty or requested action from a contact card.',
  completion:'Verify reported work against the requested component and distinguish scheduled, reported and independently confirmed completion.',
  technical_question:'Locate the exact relevant source document and page; leave unsupported technical interpretation for owner review.',
  site_clarification:'Verify only the missing site or component identity detail within this exact job; omit unrelated access information.'
};
const PERMISSIONS = freeze({research_mapping_only:true,dispatch:false,sends:false,read_state_changes:false,record_changes:false,permissions_changes:false,new_sessions:false,credentials:false,microsoft_web_or_oauth:false});
// Documentation for a future reviewed evidence exchange only; no result validation/import exists here.
export const RESEARCH_RESULT_SCHEMA = freeze({
  type:'object',additionalProperties:false,required:['dedupe_key','job_id','identity','purpose','date_scope','source','app','observed_at','search_coverage','findings','action_receipt'],
  properties:{
    dedupe_key:{type:'string'},job_id:{type:['string','null']},identity:{type:'object',description:'Echo every requested job/order/lot constraint; provisional identity stays unbound.'},purpose:{enum:RESEARCH_PURPOSES},date_scope:{type:'object',description:'Echo exact requested range, timezone and current/historical/mixed mode.'},
    source:{enum:Object.keys(ROUTES)},app:{type:'string'},observed_at:{type:'string',format:'date-time'},
    search_coverage:{type:'object',additionalProperties:false,required:['scope','complete','truncated','searched_locations','gaps'],properties:{scope:{const:'selected_job'},complete:{type:'boolean'},truncated:{type:'boolean'},searched_locations:{type:'array',items:{type:'string'}},gaps:{type:'array',items:{type:'string'}}}},
    findings:{type:'array',maxItems:20,items:{type:'object',required:['source_reference','path','page','revision','source_date','observed_at','sha256','verification_state'],properties:{source_reference:{type:'string'},path:{type:['string','null'],description:'Exact verified file path or source locator, no credential-bearing URL.'},page:{type:['integer','null'],minimum:1},revision:{type:['string','null']},source_date:{type:['string','null']},observed_at:{type:'string',format:'date-time'},sha256:{type:['string','null'],pattern:'^[a-f0-9]{64}$'},verification_state:{const:'needs_review'}}}},
    action_receipt:{type:'object',required:['sends','read_state_changes','record_changes'],properties:{sends:{const:0},read_state_changes:{const:0},record_changes:{const:0}}}
  }
});
function approvedEvidence(lookup,scope,dateScope,now) {
  const rows=Array.isArray(lookup.source_freshness)?lookup.source_freshness:[], types=new Map();
  for(const r of rows.slice(0,25))if(plain(r)&&SOURCE_TYPES.has(r.source_type))types.set(r.source_type,types.has(r.source_type)?null:r);
  const checks=[...types].filter(([,s])=>s).map(([source_type,s])=>({source_type,state:s.state==='current'&&fresh(s.checked_at,now)&&s.complete===true?'current':'needs_review',checked_at:instant(s.checked_at)!==null?s.checked_at:null,range_start:day(s.range_start)?s.range_start:null,range_end:day(s.range_end)?s.range_end:null}));
  const refs=Array.isArray(lookup.references)?lookup.references:[], facts=Array.isArray(lookup.facts)?lookup.facts:[], accepted=[];
  const preparedCurrent=id(lookup.run_id)&&fresh(lookup.prepared_at,now)&&lookup.stale!==true;
  for(let i=0;i<Math.min(refs.length,facts.length,5);i++) {
    const r=refs[i], fact=facts[i];
    if(!plain(r)||!refKey(r.source_key)||!refKey(r.source_id)||!SOURCE_TYPES.has(r.source_type)||!clean(fact,1000)||sensitive(fact))continue;
    if(refs.filter(v=>v?.source_key===r.source_key).length!==1)continue;
    const source=checks.find(s=>s.source_type===r.source_type),date=day(r.date)?r.date:instant(r.date)!==null?denverDay(Date.parse(r.date)):null;
    const sameOrder=['po','oe'].every(k=>!scope[k]||Array.isArray(r[k+'_numbers'])&&r[k+'_numbers'].some(v=>norm(v)===norm(scope[k])));
    const marker=` [${scope.job_id}]: `,suffix=` Source [${r.source_key}], checked ${r.source_checked_at}.`;
    if(!fact.startsWith('Job ')||!fact.includes(marker)||!fact.endsWith(suffix))continue;
    const body=fact.slice(fact.indexOf(marker)+marker.length,-suffix.length);
    const category=/^(?:An estimated product arrival is listed|Product arrival is scheduled) for /.test(body)?'eta':/^Installation is scheduled for /.test(body)?'installation_schedule':/^A service visit is scheduled for /.test(body)?'service_schedule':null;
    const sourceAllowed=category==='eta'?['sales_tracker','live_probuild','probuild_library']:category==='installation_schedule'?['calendar','live_google','outlook_installation']:['calendar','live_google','outlook_service'];
    const label=r.date+(day(r.date)?' (calendar date in America/Denver; exact time not provided)':'');
    const approvedBodies=[`An estimated product arrival is listed for ${label}. This is an estimate, not confirmation of arrival.`,`Product arrival is scheduled for ${label}. The source labels the schedule confirmed; this does not establish that products have arrived.`,`Installation is scheduled for ${label}. A schedule does not establish completion.`,`A service visit is scheduled for ${label}. A schedule does not establish completion.`];
    if(!category||!approvedBodies.includes(body)||!sourceAllowed.includes(r.source_type)||!date||!preparedCurrent||!sameOrder||source?.state!=='current'||!fresh(r.source_checked_at,now))continue;
    if(dateScope.mode!=='current'||date<dateScope.start_date||date>dateScope.end_date||(instant(r.date)!==null&&Date.parse(r.date)<now))continue;
    if((source.range_start&&dateScope.start_date<source.range_start)||(source.range_end&&dateScope.end_date>source.range_end))continue;
    accepted.push({category,fact,reference:{source_key:r.source_key,source_type:r.source_type,source_id:r.source_id,date:r.date,source_checked_at:r.source_checked_at}});
  }
  return {accepted,checks,unknown_sources_omitted:rows.some(s=>!SOURCE_TYPES.has(s?.source_type))};
}
export function buildJobResearchPlan({query={},lookup={},research={},now}={}) {
  const result={version:RESEARCH_PLAN_VERSION,status:'blocked',reason:null,dedupe_key:null,purpose:null,identity:null,date_scope:null,prepared_run_id:null,verified_facts:[],source_references:[],source_checks:[],steps:[],reply_ready:false,manual_handoff:false,dispatch:false,dispatched:false,automatic_send_allowed:false,auto_attach_to_job:false,batching:{scope:'one_exact_job_or_provisional_triplet',max_parallel_ipad_tasks:1,reuse_verified_library_result:true},permissions:PERMISSIONS,result_packet_schema:RESEARCH_RESULT_SCHEMA,result_packet_schema_status:'documentation_only_no_importer'};
  const stop=reason=>freeze({...result,reason});
  const clock=instant(now);if(clock===null)return stop('invalid_current_time');
  if(!plain(query)||!plain(lookup)||!plain(research))return stop('invalid_input');
  if(own(query,'start_date')||own(query,'end_date'))return stop('research_dates_must_be_separate');
  if(QUERY_KEYS.some(k=>query[k]!==undefined&&!selector(query[k])))return stop('invalid_identity_selector');
  const q=Object.fromEntries(QUERY_KEYS.filter(k=>typeof query[k]==='string'&&query[k].trim()).map(k=>[k,query[k].trim()]));
  if(!Object.keys(q).length)return stop('missing_requested_identity');
  if((q.lot&&!/^\d{1,6}[a-z]?$/i.test(q.lot))||/\blots?\s*#?\s*\d+[a-z]?\s*(?:-|\/|,|&|and|through|to)\s*\d+/i.test(q.job_name||''))return stop('multiple_or_invalid_lots');
  if(['po','oe','job_id','project_id'].some(k=>q[k]&&!/^[A-Za-z0-9_-]+$/.test(q[k])))return stop('invalid_exact_identifier');
  if(!RESEARCH_PURPOSES.includes(research.purpose))return stop('unsupported_research_purpose');
  if(research.requested_filename!==undefined&&(!selector(research.requested_filename,250)||/[\\/]/.test(research.requested_filename)))return stop('invalid_document_selector');
  const dateScope=dates(research,clock);if(!dateScope)return stop('invalid_research_date_scope');
  result.purpose=research.purpose;result.date_scope=dateScope;
  const provisional=lookup.status==='not_found'&&q.builder&&q.subdivision&&q.lot&&!q.job_id&&!q.po&&!q.oe&&!q.project_id&&!q.job_name;
  if(!provisional&&!['matched','needs_review','not_prepared'].includes(lookup.status))return stop('job_identity_requires_review');
  if(!provisional&&(!id(lookup.job_id)||(q.job_id&&q.job_id!==lookup.job_id)||(Array.isArray(lookup.candidate_job_ids)&&(lookup.candidate_job_ids.length!==1||lookup.candidate_job_ids[0]!==lookup.job_id))))return stop('job_identity_mismatch');
  if(lookup.job_name!==undefined&&!selector(lookup.job_name))return stop('invalid_canonical_name');
  const identity={job_id:provisional?null:lookup.job_id,canonical_name:provisional?null:lookup.job_name||null,verification:provisional?'provisional_lookup_only':'exact_prepared_lookup',supplied_constraints:q};
  result.identity=identity;
  const evidence=provisional?{accepted:[],checks:[],unknown_sources_omitted:false}:approvedEvidence(lookup,{...q,job_id:lookup.job_id},dateScope,clock);
  result.prepared_run_id=!provisional&&id(lookup.run_id)?lookup.run_id:null;
  result.source_checks=evidence.checks;result.unknown_sources_omitted=evidence.unknown_sources_omitted;
  result.verified_facts=evidence.accepted.map(x=>x.fact);result.source_references=evidence.accepted.map(x=>x.reference);
  const selectors={...q,...(identity.canonical_name?{canonical_name:identity.canonical_name}:{}),...(research.requested_filename?{requested_filename:research.requested_filename}:{})};
  result.dedupe_key=RESEARCH_PLAN_VERSION+':'+fingerprint([identity,result.prepared_run_id,research.purpose,dateScope,selectors,result.source_references]);
  const matching=evidence.accepted.filter(e=>e.category===research.purpose);
  if(lookup.status==='matched'&&matching.length&&!lookup.facts_truncated&&!lookup.source_freshness_truncated) {
    return freeze({...result,status:'ready_from_prepared',reason:'current_matching_typed_facts',reply_ready:true,verified_facts:matching.map(e=>e.fact),source_references:matching.map(e=>e.reference)});
  }
  const routes=provisional?STEPS[research.purpose].filter(s=>!['google_calendar','probuild'].includes(s)):STEPS[research.purpose];
  result.steps=routes.map((source,i)=>({step:i+1,...ROUTES[source],question:QUESTIONS[research.purpose],untrusted_selectors:{...selectors},job_id:identity.job_id,date_scope:dateScope,document_date_filter:false,requires_explicit_mail_period:source==='outlook'&&dateScope.mode==='current_revision',when:source==='teams'?'Reuse the prior OneDrive library result; search separately only in a different verified company Teams library location.':i?'Only if earlier scoped checks leave this question unresolved.':'Review the exact cached job or provisional catalog identity first.',stop_conditions:['Use one iPad surface serially; this packet does not spawn workers or dispatch research.','Stop on conflicting identity, unavailable existing session, or any required read-state change.','Mail searches require a bounded relevant period; document searches preserve older files and verify current revision.','Do not broaden the account, participants, lot, order, source permissions or requested date scope.','Return evidence for review; no sending, authentication, dispatch or source edits.']}));
  return freeze({...result,status:provisional?'provisional_lookup':'research_needed',reason:provisional?'no_exact_catalog_match_is_not_proof_of_absence':'specific_current_evidence_required',manual_handoff:true});
}
