// Idempotent draft-budget save for the New Job wizard.
//
// Each wizard session has a stable id stored on the budget as request_key.
// Before every create the saver reads for an exact (job_id + request_key) match
// and adopts it instead of creating. A create that fails with anything other
// than a verified pre-write rejection is an UNKNOWN outcome: the key is locked
// to read-only reconciliation for the rest of the session. An empty read does
// not unlock it (reads can lag), so no second create is ever sent for that key.
//
// Limitation: JobBudgets has no unique index on request_key, so two different
// browsers racing the same key between read and create could still both write.
import { isVerifiedRejection, createErrorMessage } from "@/lib/createOutcome";

export const wizardRequestKey = (wizardId) => `new-job-wizard:${wizardId}`;

const FALLBACK = "The budget could not be saved.";
const UNKNOWN = "The save result is unknown. Check the job's budgets before adding one by hand.";

async function findExact(api, jobId, requestKey) {
  const page = await api.filter({ job_id: jobId, request_key: requestKey }, { limit: 10 });
  const rows = Array.isArray(page) ? page : page?.items || [];
  return rows.filter((r) => r && r.job_id === jobId && r.request_key === requestKey && !r.deleted_at);
}

const fromRows = (rows) => {
  if (rows.length > 1) return { state: "conflict", ids: rows.map((r) => r.id) };
  if (rows.length === 1) return { state: "saved", budget: rows[0], adopted: true };
  return null;
};

export function createWizardBudgetSaver({ api, getUser, isOwner }) {
  let busy = false;
  const unknownKeys = new Set(); // keys whose create outcome is unknown: read-only from here on
  return async function save({ jobId, requestKey, payload }) {
    if (busy) return { state: "busy" };
    busy = true;
    try {
      const user = await getUser().catch(() => null);
      if (!isOwner(user)) return { state: "not_allowed" };
      if (!jobId || !requestKey) return { state: "failed", error: "Missing job or wizard id." };
      const lockKey = `${jobId}|${requestKey}`;
      let rows;
      try { rows = await findExact(api, jobId, requestKey); }
      catch (e) {
        // No create was sent by this call; only a prior unknown create keeps it read-only.
        return unknownKeys.has(lockKey)
          ? { state: "uncertain", error: createErrorMessage(e, UNKNOWN) }
          : { state: "failed", error: createErrorMessage(e, FALLBACK) };
      }
      const known = fromRows(rows);
      if (known) return known;
      if (unknownKeys.has(lockKey)) return { state: "uncertain", error: UNKNOWN };
      try {
        const budget = await api.create({ ...payload, job_id: jobId, request_key: requestKey });
        return { state: "saved", budget };
      } catch (createErr) {
        if (isVerifiedRejection(createErr)) return { state: "failed", error: createErrorMessage(createErr, FALLBACK) };
        unknownKeys.add(lockKey);
        try { rows = await findExact(api, jobId, requestKey); } catch { rows = []; }
        return fromRows(rows) || { state: "uncertain", error: createErrorMessage(createErr, UNKNOWN) };
      }
    } finally {
      busy = false;
    }
  };
}