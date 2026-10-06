// Idempotent draft-budget save for the New Job wizard.
//
// Each wizard session has a stable id stored on the budget as request_key.
// Before every create the saver reads for an exact (job_id + request_key) match
// and adopts it instead of creating. After a create error it re-reads: a found
// record is adopted (lost response), a proven-absent read allows a later retry,
// and an unreadable state is "uncertain" — the next attempt reconciles again and
// never creates until a read proves the draft is absent.
//
// Limitation: JobBudgets has no unique index on request_key, so two different
// browsers racing the same key between read and create could still both write.
// One wizard id lives in one tab's state, so that needs a copied session.

export const wizardRequestKey = (wizardId) => `new-job-wizard:${wizardId}`;

const errMsg = (e) => e?.response?.data?.error || e?.message || "The budget could not be saved.";

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
  return async function save({ jobId, requestKey, payload }) {
    if (busy) return { state: "busy" };
    busy = true;
    try {
      const user = await getUser().catch(() => null);
      if (!isOwner(user)) return { state: "not_allowed" };
      if (!jobId || !requestKey) return { state: "failed", error: "Missing job or wizard id." };
      let rows;
      try { rows = await findExact(api, jobId, requestKey); }
      catch (e) { return { state: "uncertain", error: errMsg(e) }; }
      const known = fromRows(rows);
      if (known) return known;
      try {
        const budget = await api.create({ ...payload, job_id: jobId, request_key: requestKey });
        return { state: "saved", budget };
      } catch (createErr) {
        try { rows = await findExact(api, jobId, requestKey); }
        catch { return { state: "uncertain", error: errMsg(createErr) }; }
        return fromRows(rows) || { state: "failed", error: errMsg(createErr) };
      }
    } finally {
      busy = false;
    }
  };
}