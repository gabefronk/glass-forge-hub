// Called only after a NEW explicit completion report is saved. No historical sweep.
// Never blocks a saved report and never changes supplier or pricing fields.
export async function enqueueCustomerCollection(api, {jobId,note,now}) {
  if (note?.completion!=='complete' || note.job_id!==jobId) return {state:'not_complete'};
  const job=await api.Jobs.get(jobId);
  if (!job || job.merged_into || job.is_sample) return {state:'job_review'};
  const rows=await api.FeeLines.filter({job_id:jobId,fee_type:'profit_split'},'-created_date',2,0);
  if (!Array.isArray(rows) || rows.length!==1) return {state:'line_review'};
  const r=rows[0];
  if (r.customer_collection_state) return {state:r.customer_collection_state};
  if (r.paid_to_ya || r.paid_date || r.billed_to_bfs || r.invoiced_to_ya || r.superseded_by) return {state:'existing_accounting_review'};
  const closed=await api.MonthCloseSnapshot.filter({month:r.invoice_month},'-created_date',2,0);
  if (!Array.isArray(closed) || closed.length) return {state:'source_month_closed_review'};
  const fresh=await api.FeeLines.get(r.id);
  if (fresh.updated_date!==r.updated_date || fresh.job_id!==jobId) return {state:'changed_review'};
  await api.FeeLines.update(r.id,{customer_collection_state:'awaiting_request',customer_completion_note_id:note.id,
    customer_collection_history:[{action:'complete_report',at:now,note_id:note.id,previous_invoice_month:r.invoice_month}]});
  const saved=await api.FeeLines.get(r.id);
  if (saved.customer_collection_state!=='awaiting_request' || saved.customer_completion_note_id!==note.id) return {state:'readback_review'};
  return {state:'awaiting_request'};
}
