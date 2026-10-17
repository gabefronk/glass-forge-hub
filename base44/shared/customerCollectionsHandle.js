import { isPurchasingMoneyOwner, isEntityId } from './purchasingMoneyPure.js';
import { readPage } from './purchasingMoneyHandle.js';
import { collectionPatch, latestCompletion, isEnrolled } from './customerCollections.js';
async function all(read) {
  const rows = [], seen = new Set(); let cursor = null;
  for (let i=0; i<200; i++) {
    const {items,next} = readPage(await read({limit:500, ...(cursor ? {cursor} : {})}),500);
    rows.push(...items); if (!next) return rows;
    if (seen.has(next)) throw new Error('cursor_repeated'); seen.add(next); cursor=next;
  }
  throw new Error('incomplete_read');
}
export async function handle(req, a) {
  const user = await a.authMe().catch(()=>null);
  if (!isPurchasingMoneyOwner(user)) return {status:403,body:{error:'forbidden'}};
  const b = await req.json().catch(()=>null);
  const allowed = new Set(['action','line_id','expected_updated_date','review_confirmed','received_date','reference']);
  if (!b || Object.keys(b).some(k=>!allowed.has(k))) return {status:400,body:{error:'invalid_body'}};
  try {
    if (b.action === 'list') {
      const [lines,notes,jobs] = await Promise.all([all(a.linesList),all(a.notesList),all(a.jobsList)]);
      const live = new Map(jobs.filter(j=>!j.merged_into && !j.is_sample).map(j=>[j.id,j]));
      const groups = new Map();
      for (const r of lines.filter(r=>r.fee_type==='profit_split' && live.has(r.job_id) && !r.superseded_by)) {
        if (!groups.has(r.job_id)) groups.set(r.job_id,[]); groups.get(r.job_id).push(r);
      }
      const items=[];
      for (const [id, rows] of groups) {
        const completion=latestCompletion(notes.filter(n=>n.job_id===id));
        if (!rows.some(isEnrolled) && completion?.completion!=='complete') continue;
        for (const row of rows) items.push({line:row,job_name:live.get(id).canonical_name,
          completion, ambiguous:rows.length!==1});
      }
      return {status:200,body:{items}};
    }
    if (!['enroll','prepare','paid'].includes(b.action) || !isEntityId(b.line_id) || b.review_confirmed!==true || typeof b.expected_updated_date!=='string') throw new Error('review_required');
    const row=await a.lineGet(b.line_id), job=await a.jobGet(row.job_id);
    if (!job || job.id!==row.job_id || job.merged_into || job.is_sample) throw new Error('job_changed');
    const [notes, lines, closed] = await Promise.all([all(o=>a.notesFilter({job_id:row.job_id},o)),
      all(o=>a.linesFilter({job_id:row.job_id},o)),all(a.closedList)]);
    const eligible=lines.filter(r=>r.fee_type==='profit_split' && !r.superseded_by);
    if (eligible.length!==1 || eligible[0].id!==row.id) throw new Error('multiple_job_lines_review_required');
    const completion=latestCompletion(notes);
    const current=await a.lineGet(row.id), freshJob=await a.jobGet(row.job_id);
    if (!freshJob || freshJob.merged_into || freshJob.is_sample || current.job_id!==row.job_id) throw new Error('job_changed');
    const now=a.now(),today=new Intl.DateTimeFormat('en-CA',{timeZone:'America/Denver',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date(now));
    const patch=collectionPatch(current,b,{now,today,userId:user.id,completion,closedMonths:closed.map(s=>s.month)});
    await a.lineUpdate(row.id,patch);
    const saved=await a.lineGet(row.id);
    if (saved.job_id!==row.job_id || Object.entries(patch).some(([k,v])=>JSON.stringify(saved[k])!==JSON.stringify(v))) throw new Error('readback_failed_reload_before_retry');
    return {status:200,body:{line:saved,quickbooks_sent:false}};
  } catch(e) {
    const safe=new Set(['outside_job_required','changed_reload','already_billed_review_required','source_month_closed','history_review_required','existing_payment_or_enrollment','complete_report_required','not_awaiting_request','work_not_complete','not_awaiting_payment','received_date_required','receipt_predates_completion_review_required','received_month_closed','payment_reference_required','unknown_action','review_required','job_changed','multiple_job_lines_review_required','readback_failed_reload_before_retry']);
    return {status:409,body:{error:safe.has(e.message)?e.message:'collection_unavailable_reload'}};
  }
}
