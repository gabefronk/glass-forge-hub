// Create-visit request lifecycle, outside React so it can be exercised directly.
// The modal holds one controller and only renders what it returns.
//
// - Synchronous double-submit guard (set before the first await).
// - The complete reviewed payload is frozen to storage and read back BEFORE the
//   call; a failed write or malformed stored record stops with nothing sent.
// - The sent payload is always the stored one, so a retry after reload is
//   byte-equivalent even if the job's props changed since review.
// - Results carry the captured user/job key; the caller ignores results whose key
//   no longer matches what is on screen.
import { readFrozen, writeFrozen, clearFrozen, decideCreateOutcome, safeError } from './jobCalendarShared.js';
import { validateReviewed } from './jobCalendarValidate.js';

export function createVisitController({ store, invoke }) {
  let inflight = false;

  async function run(userId, jobId, reviewed) {
    if (inflight) return { ignored: true };
    inflight = true;
    const key = `${userId}:${jobId}`;
    const stop = (step, code) => ({ key, sent: false, step, error: safeError(code) });
    try {
      if (!store) return stop('review', 'lock_failed');
      const cur = readFrozen(store, userId, jobId);
      if (cur.state === 'damaged') return stop('damaged', 'damaged');
      let stored = cur.state === 'locked' ? cur : null;
      if (!stored) {
        if (!reviewed) return stop('form', 'invalid_payload');
        if (!validateReviewed(reviewed, { ownerId: userId }).ok || reviewed.job_id !== jobId) return stop('review', 'invalid_payload');
        if (!writeFrozen(store, userId, jobId, { v: 1, status: 'creating', priorUnknown: false, payload: reviewed })) return stop('review', 'lock_failed');
        stored = readFrozen(store, userId, jobId);
        if (stored.state !== 'locked') return stop('review', 'lock_failed');
      }
      const record = stored.record;
      const payload = record.payload;
      let d = null;
      try { d = (await invoke('jobCalendar', { action: 'create', payload }))?.data ?? null; } catch { d = null; }
      const out = decideCreateOutcome(d, { priorUnknown: record.priorUnknown });
      if (out.release) clearFrozen(store, userId, jobId);
      else if (!record.priorUnknown) writeFrozen(store, userId, jobId, { ...record, priorUnknown: true });
      return { key, sent: true, payload, ...out };
    } finally {
      inflight = false;
    }
  }

  return {
    load: (userId, jobId) => (store ? readFrozen(store, userId, jobId) : { state: 'none' }),
    submit: (userId, jobId, reviewed) => run(userId, jobId, reviewed),
    retry: (userId, jobId) => run(userId, jobId, null),
    discardDamaged: (userId, jobId) => {
      if (store && readFrozen(store, userId, jobId).state === 'damaged') clearFrozen(store, userId, jobId);
    },
    isInflight: () => inflight,
  };
}