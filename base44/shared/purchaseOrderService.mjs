import { fetchCompleteEntity } from './jobCatalog.js';
import { text, amount, activeBudgets, budgetVersion, budgetFigures, sameVendor, nextPurchaseOrderNumber } from './procurementCore.js';
import { procurementError as fail, requestKey, withProcurementLock } from './procurementLock.mjs';

export const isProcurementOwner = user => user?.role === 'admin' && ['gabefronk@gmail.com', 'gabriel.fronk.wd@gmail.com'].includes(text(user.email).toLowerCase());
export function assertOwner(user) {
  if (!isProcurementOwner(user)) throw fail(user ? 403 : 401, 'Purchasing changes are owner-only.');
}
const cleanField = (value, max = 300) => {
  const out = text(value);
  if (out.length > max || /[\u0000-\u0008]/.test(out)) throw fail(400, 'A purchasing field is too long or invalid.');
  return out;
};
export async function getPurchasingJob(api, jobId) {
  if (!text(jobId)) throw fail(400, 'Select an existing job first.');
  const job = await api.Jobs.get(text(jobId));
  if (!job || job.merged_into || job.is_sample) throw fail(409, 'Select the current, non-sample job. Existing jobs were not changed.');
  return job;
}

async function appendPoToJob(api, row) {
  try {
    await api.Jobs.updateMany({ id: row.job_id }, { $addToSet: { po_numbers: row.po_number } });
    const fresh = await api.Jobs.get(row.job_id);
    return { ok: Array.isArray(fresh?.po_numbers) && fresh.po_numbers.includes(row.po_number) };
  } catch (error) {
    return { ok: false, error: 'The PO exists, but its job reference could not be confirmed. Retry the same request; do not issue a second PO.' };
  }
}

export async function issuePurchaseOrder(api, body, user, deps = {}) {
  assertOwner(user);
  const key = requestKey(body.request_key);
  if (body.review_confirmed !== true) throw fail(400, 'Review the supplier, scope, amount and job before issuing.');
  if (body.status && body.status !== 'issued') throw fail(400, 'New POs start as issued. Supplier confirmation is recorded separately.');
  const payable = amount(body.amount_dealer);
  const customer = amount(body.amount_customer);
  if (payable === null || payable < 0 || (payable === 0 && body.zero_amount_confirmed !== true)) throw fail(400, 'Enter the reviewed supplier payable, including any applicable tax and freight.');
  if (text(body.amount_customer) && (customer === null || customer < 0)) throw fail(400, 'The optional customer amount must be a valid nonnegative amount for this PO scope.');
  const payload = {
    job_id: cleanField(body.job_id, 100), budget_id: cleanField(body.budget_id, 100),
    vendor: cleanField(body.vendor), vendor_quote_ref: cleanField(body.vendor_quote_ref),
    amount_dealer: payable, amount_customer: customer,
    notes: cleanField(body.notes, 4000), additional_order_reason: cleanField(body.additional_order_reason, 1000),
    setup_sheet_id: cleanField(body.setup_sheet_id, 100),
  };
  if (!payload.vendor || !payload.vendor_quote_ref) throw fail(400, 'Supplier and quote/reference are required.');
  const fingerprint = JSON.stringify(payload);
  const now = deps.now || (() => new Date().toISOString());
  const findExisting = async () => {
    const rows = await api.PurchaseOrders.filter({ request_key: key }, 'id', 2);
    if (rows.length > 1) throw fail(409, 'More than one PO has this request key; reconcile before issuing.');
    const row = rows[0];
    if (row && row.request_fingerprint !== fingerprint) throw fail(409, 'This request already issued a different PO. Refresh and start a new order explicitly.');
    return row;
  };
  const retry = await findExisting();
  if (retry) return { ...retry, duplicate: true, job_update: await appendPoToJob(api, retry) };

  return withProcurementLock(api, key, async lock => {
    // Recheck after acquiring the lock; a previous caller may have just finished.
    const existingRetry = await findExisting();
    if (existingRetry) return { ...existingRetry, duplicate: true, job_update: await appendPoToJob(api, existingRetry) };
    const job = await getPurchasingJob(api, payload.job_id);
    const [pos, vendorOrders, jobs, budgets] = await Promise.all([
      fetchCompleteEntity(api.PurchaseOrders), fetchCompleteEntity(api.VendorOrders),
      fetchCompleteEntity(api.Jobs), fetchCompleteEntity(api.JobBudgets),
    ]);
    let budget = null;
    if (payload.budget_id) {
      budget = budgets.find(b => b.id === payload.budget_id);
      if (!budget || budget.job_id !== job.id) throw fail(409, 'The source quote is not attached to this job.');
      if (budgetVersion(budget) !== body.budget_version) throw fail(409, 'The budget changed. Reopen it and review the PO again.');
      if (!activeBudgets(budgets.filter(b => b.job_id === job.id)).some(b => b.id === budget.id)) throw fail(409, 'This quote is a draft, reference, or replaced version. Include the correct scope before ordering.');
      if (!budgetFigures(budget).ready) throw fail(409, 'Review and save the budget numbers first.');
      if (text(budget.quote_number).toUpperCase() !== payload.vendor_quote_ref.toUpperCase()) throw fail(409, 'The PO quote reference must match its selected source quote.');
    }
    const duplicates = pos.filter(po => po.status !== 'cancelled' && po.job_id === job.id && (
      (budget && po.budget_id === budget.id) ||
      (text(po.vendor_quote_ref).toUpperCase() === payload.vendor_quote_ref.toUpperCase() && sameVendor(po, { vendor: payload.vendor, manufacturer: budget?.manufacturer }))
    ));
    if (duplicates.length && payload.additional_order_reason.length < 10) throw fail(409, `This scope already has ${duplicates.map(p => p.po_number).join(', ')}. Open the existing PO, or state why another order is required.`, { code: 'duplicate_scope', existing_po_ids: duplicates.map(p => p.id) });
    let setup = null;
    if (payload.setup_sheet_id) {
      const sheets = (await fetchCompleteEntity(api.JobSetupSheets)).filter(s => s.job_id === job.id && s.status === 'approved' && text(s.approver_name) && text(s.approved_date));
      if (sheets.length !== 1 || sheets[0].id !== payload.setup_sheet_id) throw fail(409, 'Approved setup context is missing or ambiguous. Review the setup sheet.');
      setup = sheets[0];
    }
    const po_number = nextPurchaseOrderNumber(pos, vendorOrders, jobs, budgets, lock.row.last_number);
    if (text(body.po_number) && text(body.po_number).toUpperCase() !== po_number) throw fail(409, 'The next PO number changed. Refresh and review again.');
    await lock.reserveNumber(Number(po_number.slice(3)));
    const stamp = now();
    const row = {
      po_number, status: 'issued', job_id: job.id, job_name: job.canonical_name || job.name || '',
      builder: job.builder || '', customer_name: job.customer_name || '', vendor: payload.vendor,
      vendor_quote_ref: payload.vendor_quote_ref, amount_dealer: payable,
      ...(customer !== null ? { amount_customer: customer } : {}),
      notes: payload.notes, additional_order_reason: payload.additional_order_reason,
      created_by_email: user.email, owner_reviewed_at: stamp, request_key: key, request_fingerprint: fingerprint,
      status_history: [{ status: 'issued', at: stamp, by: user.email, note: 'Reviewed and issued in Hub. Not sent to supplier.' }],
      ...(budget ? { budget_id: budget.id, budget_snapshot: { id: budget.id, title: budget.title, quote_number: budget.quote_number, source_version: budgetVersion(budget), inputs: budget.inputs, computed: budget.computed, reviewed_at: stamp } } : {}),
      ...(setup ? { setup_sheet_id: setup.id, setup_sheet_approver_name: setup.approver_name, setup_sheet_approved_date: setup.approved_date } : {}),
    };
    let created;
    try { created = await api.PurchaseOrders.create(row); }
    catch {
      try { created = await findExisting(); } catch { /* Preserve the lock below. */ }
      if (!created) {
        lock.holdForReview();
        throw fail(503, 'PO save outcome is uncertain. Purchasing is locked for reconciliation; do not issue another order.', { uncertain: true });
      }
    }
    return { ...created, job_update: await appendPoToJob(api, created) };
  }, deps);
}
