/** Owner-reviewed reply preview facts only. Never grants send or financial authority. */
const MAX_AGE = 26 * 3600000;
const MAX_FACTS = 20;
const MAX_FACT_LENGTH = 800;
const MAX_TOTAL_LENGTH = 8000;
const BAD_STATUS = /^(cancelled|canceled|deleted|source_deleted|superseded|rescheduled|completed|complete|arrived|received|delivered)$/i;
const str = v => typeof v === 'string' ? v.trim() : '';
const identifier = v => /^[A-Za-z0-9_-]{1,160}$/.test(str(v));
const sourceKey = v => str(v).length > 0 && str(v).length <= 300 && !/[\r\n\u0000-\u001f]/.test(v);
function validDay(v) { return /^\d{4}-\d{2}-\d{2}$/.test(v||'') && Number.isFinite(Date.parse(v+'T12:00:00Z')) && new Date(v+'T12:00:00Z').toISOString().slice(0,10)===v; }
function instant(v) {
  if(typeof v!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:\d{2})$/i.test(v)||!validDay(v.slice(0,10)))return null;
  const ms=Date.parse(v);return Number.isFinite(ms)?ms:null;
}
function localDay(ms,zone) {
  const parts=new Intl.DateTimeFormat('en-CA',{timeZone:zone,year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(new Date(ms));
  const field=k=>parts.find(p=>p.type===k).value;return `${field('year')}-${field('month')}-${field('day')}`;
}
function recent(timestamp,nowMs) { const ms=instant(timestamp);return ms!==null&&ms<=nowMs&&nowMs-ms<=MAX_AGE; }
function normalizeDate(value,zone) {
  if(validDay(value))return {value,day:value,precision:'day',ms:null};
  const ms=instant(value);return ms===null?null:{value,day:localDay(ms,zone),precision:'instant',ms};
}
function factFor(e,jobName,jobId,checked,nowMs,today,zone) {
  if(!e||e.active!==true||!sourceKey(e.source_key)||!identifier(e.matched_job_id||e.job_id)||(e.matched_job_id||e.job_id)!==jobId||(e.job_id&&e.job_id!==jobId))return null;
  if(BAD_STATUS.test(str(e.status))||/cancellation_unverified|unverified|unknown|tentative/i.test(str(e.status)))return null;
  const category=e.category,certainty=e.certainty;
  if(category==='arrival'&&!['estimated','confirmed_schedule'].includes(certainty))return null;
  if(!['arrival','service','installation','event'].includes(category))return null;
  if(category!=='arrival'&&certainty!=='scheduled_only')return null;
  const start=normalizeDate(e.date,zone),end=e.end_date?normalizeDate(e.end_date,zone):null;
  if(!start||(e.end_date&&!end)||(end&&end.precision!==start.precision))return null;
  if(end&&(end.day<start.day||(start.ms!==null&&end.ms<start.ms)||(e.end_exclusive&&end.value<=start.value)))return null;
  // Elapsed estimates or visits need a source status update; the agent must not
  // turn an old scheduled date into an assertion about completion or arrival.
  if(category==='arrival') { if(start.day<today||(start.ms!==null&&start.ms<nowMs))return null; }
  else if(start.precision==='instant') { if((end?.ms??start.ms)<nowMs)return null; }
  else if(end) { if(e.end_exclusive?end.day<=today:end.day<today)return null; }
  else if(start.day<today)return null;
  let dateLabel=start.value;
  if(end)dateLabel+=e.end_exclusive?' until before '+end.value:' through '+end.value;
  if(start.precision==='day')dateLabel+=' (calendar date in '+zone+'; exact time not provided)';
  let statement;
  if(category==='arrival')statement=certainty==='estimated'?'An estimated product arrival is listed for '+dateLabel+'. This is an estimate, not confirmation of arrival.':'Product arrival is scheduled for '+dateLabel+'. The source labels the schedule confirmed; this does not establish that products have arrived.';
  else statement=({service:'A service visit',installation:'Installation',event:'A calendar event'})[category]+' is scheduled for '+dateLabel+'. A schedule does not establish completion.';
  return `Job ${jobName} [${jobId}]: ${statement} Source [${e.source_key}], checked ${checked}.`;
}

export function buildJobReplyFacts({conversation,prepared,now}={}) {
  const result={facts:[],job_id:null,run_id:null,notes:[],status:'no_verified_job_facts',acknowledgment_allowed:true,automatic_send_allowed:false,source_keys:[],checked_at:null,omitted_count:0};
  const stop=(code,detail)=>{result.notes.push({code,detail});return result;};
  const nowMs=instant(now);
  if(nowMs===null)return stop('invalid_current_time','A valid current timestamp is required to verify job facts.');
  result.checked_at=now;
  const jobId=str(conversation?.job_id),context=prepared?.context;
  if(!identifier(jobId))return stop('conversation_job_not_bound','Associate this conversation with one exact job before using job facts.');
  result.job_id=jobId;
  if(!context||context.job_id!==jobId)return stop('prepared_job_mismatch','Prepared context must match the conversation’s exact job ID.');
  if(!identifier(prepared.run_id))return stop('missing_generation_reference','A persisted generation reference is required.');
  result.run_id=prepared.run_id;
  if(prepared.stale===true||!recent(context.generated_at,nowMs))return stop('stale_job_generation','The job preparation is older than 26 hours or its collection timestamp is unverified.');
  if(context.status==='needs_review'||(Array.isArray(context.conflicts)&&context.conflicts.length)||(context.counts?.conflicts>0))return stop('job_conflicts','Resolve conflicting job identity or arrival evidence before providing job facts.');
  const name=str(context.job_name);
  if(!name||name.length>200||/[\r\n\u0000-\u001f]/.test(name))return stop('invalid_job_label','The canonical job label needs review.');
  const zone=str(context.time_zone)||'America/Denver';
  let today;try{today=localDay(nowMs,zone);}catch{return stop('invalid_job_timezone','The prepared job time zone needs review.');}
  if(!Array.isArray(context.evidence))return stop('no_hydrated_evidence','Prepared source evidence is missing.');
  const seen=new Set(),notes=new Set();let length=0;
  const note=(code,detail)=>{if(!notes.has(code)){notes.add(code);result.notes.push({code,detail});}};
  for(const e of context.evidence) {
    if(!['arrival','service','installation','event'].includes(e?.category))continue;
    const source=context.sources?.[e.source_type];
    if(!source||source.state!=='current'||source.available===false||source.complete===false) {
      result.omitted_count++;note('source_not_current','Some job sources are missing, stale, incomplete, or unavailable. Their facts were omitted.');continue;
    }
    // Never allow a fresh source-wide check to override an explicitly stale row.
    const checked=str(e.source_checked_at)||str(source.checked_at);
    if(!recent(checked,nowMs)) {result.omitted_count++;note('evidence_check_stale','Some source records have no recent upstream check. Their facts were omitted.');continue;}
    const fact=factFor(e,name,jobId,checked,nowMs,today,zone);
    if(!fact) {result.omitted_count++;note('source_fact_requires_review','Some schedule or arrival entries need current status, date, or identity verification.');continue;}
    if(seen.has(e.source_key))continue;
    if(fact.length>MAX_FACT_LENGTH||result.facts.length>=MAX_FACTS||length+fact.length>MAX_TOTAL_LENGTH) {result.omitted_count++;note('fact_limit','Only the bounded set of structured job facts is included; request specific source details if needed.');continue;}
    seen.add(e.source_key);result.facts.push(fact);result.source_keys.push(e.source_key);length+=fact.length;
  }
  if(result.facts.length)result.status='verified_structured_facts';
  else note('no_current_reply_facts','No current structured facts are available. The assistant may acknowledge the request or ask for details without inventing a job answer.');
  return result;
}
