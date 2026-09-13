import { isCalendarDate, sourceFreshness } from './calendarCoverage.mjs';

export const REVIEW_VERSION = 'calendar-review-20260913-v1';
export const REVIEW_CALENDARS = ['UT DC Service', 'UT Window Install'];
const OWNERS = new Set(['gabefronk@gmail.com', 'gabriel.fronk.wd@gmail.com']);
export const isCalendarReviewOwner = user => user?.role === 'admin' && OWNERS.has(String(user.email || '').trim().toLowerCase());
const HASH = /^[a-f0-9]{64}$/;
const KEYS = ['schema_version','capture_key','package_sha256','calendar_name','captured_at','range_start','range_end','timezone','scope','complete','agenda_coverage_complete','selected_detail_coverage_complete','full_calendar_details_complete','source_manifest','selected_events','deferred_agenda','daily_coverage'];
const assert = (value, code) => { if (!value) throw new Error(code); };
export const calendarReviewContent = row => Object.fromEntries(KEYS.map(key => [key, row[key]]));
export const canonicalReviewJSON = value => JSON.stringify(value, (_, v) => v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).sort(([a],[b]) => a.localeCompare(b))) : v);
export async function calendarReviewHash(value) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonicalReviewJSON(value))))].map(b => b.toString(16).padStart(2,'0')).join('');
}
const validInstant = (v, now) => ['fresh','stale'].includes(sourceFreshness({observedAt:v,now,maxAgeHours:26}).status);
const slug = calendar => calendar === 'UT DC Service' ? 'service' : 'install';
const dayList = (start,end) => {
  assert(isCalendarDate(start) && isCalendarDate(end) && start <= end, 'invalid_range');
  const count = (Date.parse(end+'T12:00:00Z') - Date.parse(start+'T12:00:00Z'))/86400000+1;
  assert(count <= 93, 'range_exceeds_93_days');
  return Array.from({length:count},(_,i)=>new Date(Date.parse(start+'T12:00:00Z')+i*86400000).toISOString().slice(0,10));
};

/** Full-calendar completeness and candidate ownership are never promoted. */
export function validateCalendarReview(row, now) {
  assert(row?.schema_version === 1 && REVIEW_CALENDARS.includes(row.calendar_name), 'unsupported_capture');
  assert(HASH.test(row.package_sha256 || '') && row.capture_key === row.package_sha256+':'+slug(row.calendar_name), 'invalid_capture_identity');
  assert(row.timezone === 'America/Denver' && row.scope === 'selected_job_candidates', 'unsupported_scope');
  assert(row.complete === false && row.full_calendar_details_complete === false && row.agenda_coverage_complete === true && row.selected_detail_coverage_complete === true, 'scope_flags_invalid');
  assert(validInstant(row.captured_at,now), 'capture_time_invalid');
  const days = dayList(row.range_start,row.range_end), manifest = row.source_manifest;
  assert(manifest && manifest.calendar_name === row.calendar_name && manifest.timezone === row.timezone && manifest.range_start === row.range_start && manifest.range_end === row.range_end, 'manifest_identity_mismatch');
  assert(manifest.agenda_scan_last_observed_at === row.captured_at && validInstant(manifest.agenda_scan_first_observed_at,now) && Date.parse(manifest.agenda_scan_first_observed_at) <= Date.parse(row.captured_at), 'manifest_time_mismatch');
  assert(manifest.complete === false && manifest.full_calendar_details_complete === false && manifest.agenda_coverage_complete === true && manifest.selected_detail_coverage_complete === true && manifest.missing_selected_details === 0, 'manifest_scope_mismatch');
  assert(HASH.test(manifest.tracker_source?.sha256 || '') && validInstant(manifest.tracker_source.captured_at,now), 'tracker_receipt_missing');
  assert(Array.isArray(row.selected_events) && Array.isArray(row.deferred_agenda) && row.selected_events.length+row.deferred_agenda.length <= 2000, 'invalid_entries');
  assert(manifest.selected_detail_count === row.selected_events.length && manifest.deferred_agenda_count === row.deferred_agenda.length && manifest.agenda_event_count === row.selected_events.length+row.deferred_agenda.length, 'manifest_count_mismatch');
  const coverage = row.daily_coverage;
  assert(coverage && typeof coverage === 'object' && !Array.isArray(coverage) && Object.keys(coverage).sort().join('|') === days.join('|'), 'daily_coverage_missing');
  const seen = new Set();
  for (const [kind, entries] of [['selected',row.selected_events],['deferred',row.deferred_agenda]]) {
    assert(new TextEncoder().encode(JSON.stringify(entries)).length <= 100000, 'entry_field_exceeds_limit');
    for (const event of entries) {
      assert(event && isCalendarDate(event.event_date) && days.includes(event.event_date) && typeof event.job_name === 'string' && event.job_name.trim() && event.job_name.length <= 2000, 'event_identity_invalid');
      const key = event.source_occurrence_key;
      assert(typeof key === 'string' && key.length > 0 && key.length <= 500 && !/[\u0000-\u001f]/.test(key) && !seen.has(key), 'occurrence_key_duplicate_or_invalid');
      seen.add(key);
      assert(event.screening?.ownership_verified === false && !event.job_id, 'candidate_ownership_promoted');
      if (kind === 'selected') {
        assert(event.calendar_name === row.calendar_name && event.screening.capture_details === true, 'selected_scope_mismatch');
        assert(event.available_description_verified === true && event.source_date_labels_verified === true, 'unverified_selected_detail');
        assert(typeof event.scope_notes === 'string' && event.scope_notes.length <= 24000 && typeof event.address === 'string', 'event_detail_invalid');
        assert(validInstant(event.captured_at,now) && Date.parse(event.captured_at) >= Date.parse(manifest.agenda_scan_first_observed_at)-300000 && Date.parse(event.captured_at) <= Date.parse(row.captured_at)+300000, 'event_capture_time_invalid');
        assert(isCalendarDate(event.source_start_date) && isCalendarDate(event.source_end_date) && event.source_start_date <= event.event_date && event.event_date <= event.source_end_date, 'event_source_dates_invalid');
        assert(typeof event.all_day === 'boolean' && typeof event.multi_day === 'boolean' && event.multi_day === (event.source_start_date !== event.source_end_date), 'event_span_invalid');
        for (const field of ['start_time','end_time']) assert(typeof event[field] === 'string' && (event.all_day ? event[field] === '' : /^([01]\d|2[0-3]):[0-5]\d$/.test(event[field])), 'event_clock_invalid');
      } else assert(event.screening.capture_details === false, 'deferred_scope_mismatch');
    }
  }
  for (const date of days) {
    const d = coverage[date], selected = row.selected_events.filter(e=>e.event_date===date).length, deferred = row.deferred_agenda.filter(e=>e.event_date===date).length;
    assert(d?.agenda_complete === true && d.selected_details_complete === true && d.selected_entry_count === selected && d.selected_details_captured === selected && d.deferred_title_count === deferred && d.agenda_entry_count === selected+deferred, 'daily_partition_mismatch');
  }
  assert(new TextEncoder().encode(JSON.stringify(calendarReviewContent(row))).length <= 240000, 'capture_exceeds_limit');
  return row;
}

export async function makeCalendarReview({packageSha256, manifest, selectedEvents, deferredAgenda, dailyCoverage}, now) {
  const row = {schema_version:1,capture_key:packageSha256+':'+slug(manifest.calendar_name),package_sha256:packageSha256,
    calendar_name:manifest.calendar_name,captured_at:manifest.agenda_scan_last_observed_at,range_start:manifest.range_start,range_end:manifest.range_end,
    timezone:manifest.timezone,scope:'selected_job_candidates',complete:false,agenda_coverage_complete:true,selected_detail_coverage_complete:true,
    full_calendar_details_complete:false,source_manifest:structuredClone(manifest),selected_events:structuredClone(selectedEvents),
    deferred_agenda:structuredClone(deferredAgenda),daily_coverage:structuredClone(dailyCoverage)};
  validateCalendarReview(row,now);
  return {...row,content_sha256:await calendarReviewHash(calendarReviewContent(row)),status:'verified'};
}

export async function verifyCalendarReviews(rows, now) {
  const captures=[],rejected=[], keys=new Map();
  for (const row of rows) keys.set(row.capture_key,(keys.get(row.capture_key)||0)+1);
  for (const row of rows) {
    try {
      assert(row.status === 'verified', 'capture_not_verified');
      assert(keys.get(row.capture_key) === 1, 'duplicate_capture_identity');
      validateCalendarReview(row,now);
      assert(HASH.test(row.content_sha256||'') && await calendarReviewHash(calendarReviewContent(row)) === row.content_sha256, 'capture_content_hash_mismatch');
      captures.push(row);
    } catch(e) { rejected.push({id:row.id||null,capture_key:row.capture_key||null,reason:/^[a-z0-9_]+$/.test(e.message)?e.message:'capture_validation_failed'}); }
  }
  return {captures,rejected};
}

export async function importCalendarReview({api,user,record,now}) {
  assert(isCalendarReviewOwner(user),'owner_access_required');
  const result=await verifyCalendarReviews([record],now);
  assert(result.captures.length===1,result.rejected[0]?.reason||'invalid_capture');
  const existing=await api.entities.CalendarReviewCapture.filter({capture_key:record.capture_key},'id',2);
  assert(existing.length<=1,'duplicate_capture_identity');
  if(existing.length) {
    const checked=await verifyCalendarReviews(existing,now);
    assert(checked.captures.length===1 && existing[0].content_sha256===record.content_sha256,'existing_capture_differs');
    return {status:'already_imported',id:existing[0].id,selected:record.selected_events.length,deferred:record.deferred_agenda.length,full_calendar_details_complete:false};
  }
  const saved=await api.entities.CalendarReviewCapture.create({...calendarReviewContent(record),content_sha256:record.content_sha256,status:'verified'});
  const reread=await api.entities.CalendarReviewCapture.filter({capture_key:record.capture_key},'id',2);
  assert(reread.length===1 && (await verifyCalendarReviews(reread,now)).captures.length===1,'import_readback_failed');
  return {status:'imported',id:saved.id,selected:record.selected_events.length,deferred:record.deferred_agenda.length,full_calendar_details_complete:false};
}

const norm = value => String(value||'').normalize('NFKC').toLowerCase().replace(/[\u2010-\u2015]/g,'-').replace(/\s+/g,' ').trim();
export function calendarIdentityLabel(value) {
  let s=norm(value);
  for(let i=0;i<6;i++) { const next=s.replace(/^(?:(?:bb|ya|mds|w|i|s)\s*-\s*|#\d+\s*|\((?:l\.?\s*i\.?|\d+\s*techs?)\)\s*)/,''); if(next===s)break;s=next; }
  return s;
}
const words = value => calendarIdentityLabel(value).replace(/\b(?:homes?|lot)\b/g,' ').match(/[a-z0-9]+/g)?.sort().join('|')||'';
const oe = value => norm(value).replace(/^(\d{8})-\d{2}$/,'$1');
export function calendarEventIdentity(event,jobs) {
  const label=calendarIdentityLabel(event.job_name), notes=event.scope_notes||'';
  const po=[...new Set([...notes.matchAll(/\bP\.?\s*O\.?\s*(?:number|no\.?|#)?\s*[:=#-]\s*([0-9][A-Za-z0-9-]{2,40})/gi)].map(m=>norm(m[1])))];
  const oes=[...new Set([...notes.matchAll(/\bO\.?\s*E\.?\s*(?:number|no\.?|#)?\s*[:=#-]\s*(\d{8}(?:-\d{2})?)\b/gi)].map(m=>oe(m[1])))];
  const result={job_id:null,po_numbers:po,oe_numbers:oes,candidate_job_ids:[],reason:'no_exact_identity'};
  if(/\b\d+[a-z]?\s*(?:-|\/|,|&|and|through|to)\s*\d+[a-z]?\b/.test(label))return {...result,reason:'multiple_lots_or_units'};
  let candidates=jobs.filter(j=>[j.canonical_name,...(j.aliases||[])].some(n=>words(n)===words(label)));
  result.candidate_job_ids=candidates.map(j=>j.id);
  for(const [values,field,normalize] of [[po,'po_numbers',norm],[oes,'oe_numbers',oe]]) for(const value of values) {
    const known=jobs.filter(j=>(j[field]||[]).some(v=>normalize(v)===value));
    if(!known.length)return {...result,reason:'supplied_order_unknown'};
    candidates=candidates.filter(j=>known.some(k=>k.id===j.id));
    if(!candidates.length)return {...result,reason:'supplied_order_conflict'};
  }
  if(candidates.length!==1)return {...result,reason:candidates.length?'multiple_exact_jobs':'no_exact_identity'};
  return {...result,job_id:candidates[0].id,reason:'exact_calendar_identity'};
}

/** Selected captures never enter the legacy full-snapshot supersession graph. */
export function calendarReviewEvidence({captures=[],jobs=[],now}) {
  const evidence=[],source_status={},diagnostics=[];
  for(const calendar of REVIEW_CALENDARS) {
    const rows=captures.filter(c=>c.calendar_name===calendar).sort((a,b)=>Date.parse(b.captured_at)-Date.parse(a.captured_at));
    if(!rows.length)continue;
    const latest=rows[0],type=calendar==='UT DC Service'?'outlook_service_selected':'outlook_installation_selected';
    source_status[type]={available:true,complete:false,checked_at:latest.captured_at,range_start:latest.range_start,range_end:latest.range_end,
      selected_detail_coverage_complete:true,full_calendar_details_complete:false,agenda_event_count:latest.source_manifest.agenda_event_count,
      selected_detail_count:latest.selected_events.length,deferred_agenda_count:latest.deferred_agenda.length,tracker_source:latest.source_manifest.tracker_source};
    for(const capture of rows) {
      validateCalendarReview(capture,now);
      for(const event of capture.selected_events) {
        const identity=calendarEventIdentity(event,jobs), origin=capture.package_sha256+':'+slug(calendar)+':'+event.source_occurrence_key;
        const key='calendar_review:'+origin;
        const old=capture.capture_key!==latest.capture_key;
        if(!identity.job_id) {diagnostics.push({source_key:key,source_type:type,source_id:origin,job_name:event.job_name,reason:identity.reason,candidate_job_ids:identity.candidate_job_ids});continue;}
        evidence.push({source_key:key,source_type:type,source_id:origin,job_id:identity.job_id,
          job_name:event.job_name,address:event.address,po_numbers:identity.po_numbers,oe_numbers:identity.oe_numbers,
          date:event.event_date,end_date:event.event_date,end_exclusive:false,kind:old?'note':calendar==='UT DC Service'?'service_scheduled':'installation_scheduled',
          status:old?'historical_capture_unverified':'schedule_saved_cancellation_unverified',
          text:event.scope_notes+'\nCapture scope: selected job candidate; ownership not confirmed. Source title: '+event.job_name+
            '\nSource dates: '+event.source_start_date+' through '+event.source_end_date+' inclusive.'+
            (event.start_time?' Source time: '+event.start_time+'–'+event.end_time+' America/Denver.':' All-day agenda occurrence.')+
            '\nSelection tracker: '+capture.source_manifest.tracker_source.captured_at+'; current ownership and app append batches were not verified.'+
            (old?' Earlier separate capture; do not treat it as the current schedule.':''),
          source_checked_at:event.captured_at,source_updated_at:null,source_url:'https://glass-forge-hub.base44.app/calendar'});
      }
    }
  }
  return {evidence,source_status,diagnostics};
}
