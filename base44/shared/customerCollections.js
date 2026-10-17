// Customer receipts only. Never supplier payments, prices or QuickBooks writes.
export const isEnrolled = r => r?.fee_type === 'profit_split' && !!r.customer_collection_state;
export const isCustomerUnpaid = r => isEnrolled(r) && r.customer_collection_state !== 'paid';
export const latestCompletion = notes => (notes || []).filter(n => ['complete', 'incomplete'].includes(n.completion))
  .sort((a,b) => String(b.created_date || b.note_date).localeCompare(String(a.created_date || a.note_date)) || String(b.id).localeCompare(String(a.id)))[0] || null;
export function validDay(day) {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const d = new Date(day + 'T12:00:00Z');
  return Number.isFinite(+d) && d.toISOString().slice(0,10) === day;
}
export function collectionPatch(row, body, { today, now, userId, completion, closedMonths = [] }) {
  if (row.fee_type !== 'profit_split' || !row.job_id) throw new Error('outside_job_required');
  if (row.updated_date !== body.expected_updated_date) throw new Error('changed_reload');
  if (row.billed_to_bfs || row.invoiced_to_ya) throw new Error('already_billed_review_required');
  if (closedMonths.includes(row.invoice_month)) throw new Error('source_month_closed');
  const state = row.customer_collection_state;
  const history = Array.isArray(row.customer_collection_history) ? row.customer_collection_history : [];
  if (history.length >= 200) throw new Error('history_review_required');
  let patch;
  if (body.action === 'enroll') {
    if (state || row.paid_to_ya || row.paid_date) throw new Error('existing_payment_or_enrollment');
    if (!completion || completion.job_id !== row.job_id || completion.completion !== 'complete') throw new Error('complete_report_required');
    patch = { customer_collection_state: 'awaiting_request', customer_completion_note_id: completion.id };
  } else if (body.action === 'prepare') {
    if (state !== 'awaiting_request' && state !== 'prepared') throw new Error('not_awaiting_request');
    if (!completion || completion.completion !== 'complete') throw new Error('work_not_complete');
    patch = { customer_collection_state: 'prepared', customer_request_prepared_at: now };
  } else if (body.action === 'paid') {
    if (!['awaiting_request', 'prepared'].includes(state)) throw new Error('not_awaiting_payment');
    if (!completion || completion.completion !== 'complete') throw new Error('work_not_complete');
    if (!validDay(body.received_date) || body.received_date > today) throw new Error('received_date_required');
    if (closedMonths.includes(body.received_date.slice(0,7))) throw new Error('received_month_closed');
    if (typeof body.reference !== 'string' || body.reference.trim().length < 3 || body.reference.length > 300) throw new Error('payment_reference_required');
    patch = { customer_collection_state: 'paid', paid_to_ya: true, paid_date: body.received_date,
      invoice_month: body.received_date.slice(0,7), customer_payment_reference: body.reference.trim(),
      customer_original_invoice_month: row.customer_original_invoice_month || row.invoice_month };
  } else throw new Error('unknown_action');
  return { ...patch, customer_collection_history: [...history, { action: body.action, at: now, by: userId,
    previous_state: state || null, previous_invoice_month: row.invoice_month,
    received_date: patch.paid_date || null, reference: patch.customer_payment_reference || null }] };
}
