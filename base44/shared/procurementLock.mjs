// A pre-created singleton serializes purchasing writes across function instances.
// No time-based lock stealing: an uncertain financial write requires reconciliation.
export function procurementError(status, message, detail = {}) {
  return Object.assign(new Error(message), { status, ...detail });
}
export const requestKey = value => {
  if (typeof value !== 'string' || !/^[A-Za-z0-9:_-]{8,160}$/.test(value)) throw procurementError(400, 'A valid request key is required.');
  return value;
};
export async function withProcurementLock(api, key, work, { uuid = () => crypto.randomUUID(), now = () => new Date().toISOString() } = {}) {
  const rows = await api.ProcurementControl.filter({ key: 'global' }, 'id', 2);
  if (rows.length !== 1) throw procurementError(503, 'Purchasing control needs initialization or review. No records changed.');
  const row = rows[0];
  if (row.lock_token) throw procurementError(409, 'Another purchasing save is running, or an earlier save needs reconciliation. Refresh before trying again.');
  const token = uuid();
  const acquired = await api.ProcurementControl.updateMany(
    { id: row.id, revision: row.revision, lock_token: '' },
    { $set: { lock_token: token, request_key: key, locked_at: now() }, $inc: { revision: 1 } },
  );
  if (acquired?.updated !== 1) throw procurementError(409, 'Another purchasing save started. Refresh and retry.');
  let uncertain = false;
  try {
    return await work({
      row,
      reserveNumber: async number => {
        const result = await api.ProcurementControl.updateMany({ id: row.id, lock_token: token }, { $set: { last_number: number } });
        if (result?.updated !== 1) throw procurementError(409, 'PO number could not be reserved. Nothing was issued.');
      },
      holdForReview: () => { uncertain = true; },
    });
  } catch (error) {
    if (error?.uncertain) uncertain = true;
    throw error;
  } finally {
    if (!uncertain) {
      const released = await api.ProcurementControl.updateMany(
        { id: row.id, lock_token: token },
        { $set: { lock_token: '', request_key: '', locked_at: '' }, $inc: { revision: 1 } },
      );
      if (released?.updated !== 1) throw procurementError(503, 'The save may have completed, but its lock needs review. Refresh; do not create a second order.');
    }
  }
}
