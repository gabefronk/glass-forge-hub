import {computeLaborAmt, extractLaborAmount, denverDate, isIgnoredWorkItem} from './billingCore.js';

// Calendar descriptions often append old service tickets. Only the current block
// can authorize this visit; all original text remains available as evidence.
export const currentServiceScope = text => String(text || '').split(/\n\s*[_=]{8,}[^\n]*(?:\n|$)/)[0];
export const isSalesTrackerOnlyEvent = e => /Sales Tracker DAILY SALES row\s+\d+/i.test(e?.scope_notes || e?.calendar_note_text || e?.note_text || '');
const serviceWords = /\b(?:service|warranty|wty|investigat\w*|adjust\w*|repair\w*|replac\w*|re.?glaz\w*|glass\s+(?:unit|install)|leak\s+diagnos\w*)\b/i;
const freeWords = /\bno[ -]?charge\b|\bnot\s+billable\b/i;
const sheetrockOnly = text => /\b(?:sheetrock|srw)\b/i.test(text) && !/\b(?:except|chargeable|repair|replace|extra\s+(?:charge|labor))\b/i.test(text);
const hasPost = r => !!r.probuild_post_id;
const result = (kind, reason, extra={}) => ({kind,reason,hidden:['ignored','scheduled','tracker_only','logistics','no_charge'].includes(kind),...extra});
export function assessBillingLine(row, event, today=denverDate()) {
  if (isIgnoredWorkItem(row)) return result('ignored','Non-work reminder.');
  // Preserve owner decisions and billing history; these are never automatically repriced.
  if (row.billed_to_bfs || row.manually_adjusted || row.source==='sheet-import') return result('preserved','Existing billed, imported invoice, or owner-adjusted record.');
  const name=String(row.job_name_raw||event?.job_name||'');
  const scope=currentServiceScope(event?.scope_notes || row.calendar_note_text || (row.source==='calendar'?row.note_text:''));
  const report=String(row.probuild_note_text || (row.source==='probuild'?row.note_text:'') || '');
  const text=[name,scope,report].join('\n');
  const labor=computeLaborAmt(row),approved=extractLaborAmount(scope);
  const sourceDate=event?.event_date||row.job_date;
  const reported=hasPost(row)||event?.report_status==='ok';
  if (isSalesTrackerOnlyEvent(event||row) && !hasPost(row) && !(labor>0) && row.fee_type!=='profit_split')
    return result('tracker_only','Sales order/arrival only; no evidence of YA installation or a YA sales fee.');
  if (sourceDate>today || row.job_date>today) return reported && hasPost(row)
    ? result('review','Calendar moved after a work report. Confirm the actual completed visit and billing date.')
    : result('scheduled','Future work stays on the job/calendar until completed.');
  if (event?.source_status==='cancelled'||event?.report_status==='rescheduled') return reported
    ? result('review','Cancelled or rescheduled calendar conflicts with a work report. Verify the completed visit before billing.')
    : result('scheduled','Cancelled or rescheduled visit; no completed work established.');
  const free=freeWords.test(scope||report),sheetrock=sheetrockOnly(scope||report);
  if ((free||sheetrock) && !(approved>0)) {
    if(labor>0)return result('review','No-charge/included-work instructions conflict with recorded labor. Confirm who pays YA; do not assume a customer charge.');
    return result('no_charge',sheetrock?'Sheetrock window visit is included; no separate labor charge stated.':'Explicit no-charge visit; no separate installer payment authorized.');
  }
  const service=serviceWords.test(text)||/\bchargeable\b|\bpunch\s*list\b|\b(?:screen|hardware)s?\b/i.test(scope);
  const logistics=!service && /\b(?:pick[ -]?up|will[ -]?call|rough openings?|ro check|send\s+coi|certificate\s+of\s+insurance)\b/i.test(name+'\n'+scope);
  const arrivalOnly=!service && /\b(?:del(?:ivery)?\s+to\s+bfs|arrival:)\b/i.test(scope);
  if(!(labor>0)&&row.fee_type!=='profit_split'&&(logistics||arrivalOnly))
    return result('logistics','Pickup, measurement or material-arrival reminder; no separate YA labor or sales fee stated.');
  if (service && !(labor>0)) return result('review',
    /\bchargeable\b/i.test(scope)
      ? 'Chargeable service has no labor amount. Israel needs to record total man-hours/material rate or an approved labor price; do not use the product quote as labor.'
      : 'Service work has no labor amount or explicit no-charge decision. Confirm Israel’s hours/material rate, approved labor price, or included callback.');
  if (!(labor>0) && row.fee_type!=='profit_split' && reported) return result('review','Work was reported without a separate labor charge. Confirm it is covered by the original install, or record the additional hours/material rate or approved price.');
  return result('standard',free&&approved>0?'Customer no-charge; installer labor is explicitly authorized.':'', {customer_no_charge:free&&approved>0});
}

// Identity matching only. A shared builder/job name never assigns unrelated service visits.
export function withBillingAudit(rows, events=[], today=denverDate()) {
  const byEvent=new Map(),byPost=new Map();
  for(const e of events||[]) {
    if(e.google_event_id)byEvent.set(e.google_event_id,e);
    for(const p of e.matched_post_ids||[]){if(!byPost.has(p))byPost.set(p,[]);byPost.get(p).push(e);}
  }
  return rows.map(row=>{
    let event=byEvent.get(row.calendar_event_id);
    if(!event&&row.probuild_post_id){
      const candidates=(byPost.get(row.probuild_post_id)||[]).filter(e=>Math.abs(Date.parse(e.event_date)-Date.parse(row.job_date))<=3*86400000);
      if(candidates.length===1)event=candidates[0];
    }
    const covered = row.source === "probuild" && !row.calendar_event_id && computeLaborAmt(row) === 0 && event && rows.some(c => c.calendar_event_id === event.google_event_id && computeLaborAmt(c)>0 && c.billable !== false);
    const audit=covered ? result("standard","Work report accompanies the calendar labor line.") : assessBillingLine(row,event,today);
    return {...row,_billing_hidden:audit.hidden,_billing_kind:audit.kind,
      _billing_review:audit.kind==='review'?audit.reason:null,
      _billing_note:audit.reason,_customer_no_charge:!!audit.customer_no_charge};
  });
}
