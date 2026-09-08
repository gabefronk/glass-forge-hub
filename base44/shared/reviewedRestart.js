// Only the guarded server retry action writes this private record. Request
// source/settings flags are never restart authority.
const stable = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item) ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const id = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,160}$/.test(value);
const native = value => value && typeof value === 'object' && Object.entries(value).some(([key, item]) => (/^native_quote_(id|number|url)$/.test(key) && !!item) || item && typeof item === 'object' && native(item));

export async function reviewedRestartAllowsHistory(q, hash) {
  const review = q?.reviewed_restart, history = q?.history;
  if (review?.version !== 1 || !id(review.attempt_id) || !id(review.retry_id) || review.quote_id !== q.id || review.input_revision !== q.input_revision
    || !Number.isSafeInteger(review.from_revision) || review.from_revision < 1 || review.from_revision >= q.input_revision
    || !Array.isArray(history) || !Number.isSafeInteger(review.history_count) || review.history_count < 1 || review.history_count > history.length
    || !/^[a-f0-9]{64}$/.test(review.history_hash || '')) return false;
  const archive = history[review.history_count - 1];
  if (archive?.reason !== 'reviewed_failed_restart' || archive.attempt_id !== review.attempt_id || archive.retry_id !== review.retry_id
    || archive.revision !== review.from_revision || archive.next_revision !== review.from_revision + 1 || archive.worker_status !== 'failed'
    || archive.prior_operation?.phase !== 'completed' || archive.prior_operation?.terminal_status !== 'failed'
    || archive.prior_operation?.input_revision !== review.from_revision || archive.checkpoint?.native_quote_id !== review.previous_native_quote_id) return false;
  if (await hash(stable(history.slice(0, review.history_count))) !== review.history_hash) return false;
  // A later native attempt can never borrow an older approval.
  return !history.slice(review.history_count).some(item => native(item) || ['running', 'failed', 'ready'].includes(item?.worker_status));
}

export async function advanceReviewedRestart(q, inputRevision, hash) {
  if (inputRevision !== q.input_revision + 1 || q.checkpoint && Object.keys(q.checkpoint).length || q.result || q.job_id || q.accepted_revision || q.sales_status === 'won'
    || q.agent_run && q.agent_run.phase !== 'prepared' || !['draft', 'needs_details'].includes(q.worker_status)
    || !await reviewedRestartAllowsHistory(q, hash)) return {};
  return { reviewed_restart: { ...q.reviewed_restart, input_revision: inputRevision } };
}
