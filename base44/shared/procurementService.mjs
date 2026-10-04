import { fetchCompleteEntity } from './jobCatalog.js';
import { text, amount, budgetVersion, budgetRollup, activeBudgets, referenceConflicts, sameVendor, validMonth, validDate, estimatePatch, isLiveBudget } from './procurementCore.js';
import { unusedQuoteDeletionPatch } from './unusedQuoteDeletion.mjs';
import { procurementError as fail, requestKey, withProcurementLock } from './procurementLock.mjs';
import { assertOwner, getPurchasingJob, issuePurchaseOrder } from './purchaseOrderService.mjs';

const PO_STATES = ['issued', 'emailed', 'ordered', 'confirmed', 'received', 'cancelled'];
const PAYMENT_STATES = ['ordered', 'eta_set', 'ach_link_received', 'paid', 'reconciled'];
const stampHistory = (row, status, by, note, at) => [...(row.status_history || []), { status, at, by, note }];
async function saveCurrent(entity, row, expected, patch) {
  if (!expected || row.updated_date !== expected) throw fail(409, 'This record changed. Refresh before saving.');
  const result = await entity.updateMany({ id: row.id, updated_date: expected }, { $set: patch });
  if (result?.updated !== 1) throw fail(409, 'Another edit arrived. Reload before saving again.');
  return entity.get(row.id);
}
function reviewRequired(body) {
  if (body.review_confirmed !== true) throw fail(400, 'Confirm the reviewed change before saving.');
}
export async function estimatePreview(api, body) {
  const job = await getPurchasingJob(api, body.job_id);
  if (!validMonth(body.month)) throw fail(400, 'Choose the accounting month.');
  const [allBudgets, allCosts, snapshots] = await Promise.all([
    fetchCompleteEntity(api.JobBudgets), fetchCompleteEntity(api.JobCostInputs), fetchCompleteEntity(api.MonthCloseSnapshot),
  ]);
  const budgets = allBudgets.filter(b => b.job_id === job.id);
  const costs = allCosts.filter(c => c.job_id === job.id && c.month === body.month);
  if (costs.length > 1) throw fail(409, 'More than one cost record exists for this job and month. Reconcile before syncing.');
  const rollup = budgetRollup(budgets);
  const closed = snapshots.some(s => s.month === body.month);
  const existing = costs[0] || null;
  const version = JSON.stringify([job.id, body.month, rollup, existing?.id, existing?.updated_date, closed]);
  return { job, month: body.month, estimate: rollup, existing, closed, version };
}

export async function procurementAction(api, body, user, deps = {}) {
  assertOwner(user);
  const action = body.action || 'overview';
  const now = deps.now || (() => new Date().toISOString());
  if (action === 'issue_po') return issuePurchaseOrder(api, body, user, deps);
  if (action === 'invoice_preview') return estimatePreview(api, body);
  if (action === 'overview') {
    const [budgets, purchase_orders, vendor_orders, jobs] = await Promise.all([
      fetchCompleteEntity(api.JobBudgets), fetchCompleteEntity(api.PurchaseOrders),
      fetchCompleteEntity(api.VendorOrders), fetchCompleteEntity(api.Jobs),
    ]);
    return { budgets: budgets.filter(isLiveBudget), purchase_orders, vendor_orders, jobs, conflicts: referenceConflicts(purchase_orders, vendor_orders, jobs) };
  }
  reviewRequired(body);
  const key = requestKey(body.request_key);
  return withProcurementLock(api, key, async lock => {
    if (action === 'delete_unused_quote') {
      const [budgets, purchaseOrders, vendorOrders, costInputs, setupSheets] = await Promise.all([
        fetchCompleteEntity(api.JobBudgets), fetchCompleteEntity(api.PurchaseOrders),
        fetchCompleteEntity(api.VendorOrders), fetchCompleteEntity(api.JobCostInputs), fetchCompleteEntity(api.JobSetupSheets),
      ]);
      const row = budgets.find(b => b.id === text(body.budget_id));
      if (!row) throw fail(404, 'Quote not found.');
      if (!isLiveBudget(row)) return { ok: true, deleted: true, already_deleted: true, budget_id: row.id };
      const patch = unusedQuoteDeletionPatch(row, { budgets, purchaseOrders, vendorOrders, costInputs, setupSheets }, body, user.email, now());
      const updated = await saveCurrent(api.JobBudgets, row, row.updated_date, patch);
      if (isLiveBudget(updated)) throw fail(503, 'Quote removal could not be verified. Refresh before trying again.');
      return { ok: true, deleted: true, budget_id: updated.id, message: 'Unused quote deleted from the active list. Jobs, POs, invoices and Drive files were not changed.' };
    }
    if (action === 'budget_usage') {
      const all = await fetchCompleteEntity(api.JobBudgets);
      const row = all.find(b => b.id === body.budget_id);
      if (!row || !isLiveBudget(row)) throw fail(409, 'This quote is deleted or unavailable. Open the current quote instead.');
      if (!row.job_id) throw fail(400, 'Link this quote to its job before selecting its budget use.');
      await getPurchasingJob(api, row.job_id);
      if (body.budget_version !== budgetVersion(row)) throw fail(409, 'The quote changed. Review it again.');
      if (!['included', 'reference', 'draft'].includes(body.budget_usage)) throw fail(400, 'Choose included, reference, or draft.');
      const replaces = text(body.replaces_budget_id);
      if (replaces) {
        const target = all.find(b => b.id === replaces);
        if (!target || target.id === row.id || target.job_id !== row.job_id || body.budget_usage !== 'included') throw fail(400, 'A replacement must be a different quote on this same job.');
        const seen = new Set([row.id]);
        let cursor = target;
        while (cursor) {
          if (seen.has(cursor.id)) throw fail(409, 'Quote revision links would form a cycle.');
          seen.add(cursor.id); cursor = all.find(b => b.id === cursor.replaces_budget_id);
        }
        if (activeBudgets(all).some(b => b.id !== row.id && b.replaces_budget_id === replaces)) throw fail(409, 'Another active version already replaces that quote. Replace the current version instead.');
      }
      const patch = { budget_usage: body.budget_usage, replaces_budget_id: replaces };
      const updated = await saveCurrent(api.JobBudgets, row, row.updated_date, patch);
      return { ok: true, budget: updated, message: 'Scope selection saved. Original quote records and issued POs are unchanged.' };
    }
    if (action === 'po_status') {
      const row = await api.PurchaseOrders.get(text(body.po_id));
      if (!row || !PO_STATES.includes(body.status)) throw fail(400, 'Choose a valid PO and status.');
      if (row.status === 'cancelled' && body.status !== 'cancelled') throw fail(409, 'Cancelled POs remain in history. Prepare a new PO instead of reopening its number.');
      if (text(body.note).length < 3) throw fail(400, 'Add a note describing the status evidence.');
      const updated = await saveCurrent(api.PurchaseOrders, row, body.expected_updated_date, {
        status: body.status, status_history: stampHistory(row, body.status, user.email, text(body.note), now()),
      });
      return { ok: true, purchase_order: updated, message: 'Status recorded only. No order or email was sent.' };
    }
    if (action === 'save_supplier_order') {
      const job = await getPurchasingJob(api, body.job_id);
      const po = body.purchase_order_id ? await api.PurchaseOrders.get(text(body.purchase_order_id)) : null;
      const [pos, orders, jobs] = await Promise.all([fetchCompleteEntity(api.PurchaseOrders), fetchCompleteEntity(api.VendorOrders), fetchCompleteEntity(api.Jobs)]);
      if (!po || po.job_id !== job.id || po.status === 'cancelled') throw fail(409, 'Choose a non-cancelled PO on this job.');
      if (referenceConflicts(pos, orders, jobs).some(c => c.number === text(po.po_number).toUpperCase())) throw fail(409, 'This PO reference appears on conflicting jobs. Reconcile it before linking a supplier order.');
      const orderNumber = text(body.order_number);
      if (!orderNumber || orderNumber.length > 160) throw fail(400, 'Enter the supplier confirmation/order number.');
      const value = amount(body.amount);
      if (value === null || value < 0) throw fail(400, 'Enter the confirmed supplier amount.');
      if (text(body.eta_date) && !validDate(body.eta_date)) throw fail(400, 'Enter a valid ETA date.');
      if (text(body.received_date) && !validDate(body.received_date)) throw fail(400, 'Enter a valid received date.');
      let existing = body.order_id ? orders.find(o => o.id === body.order_id) : orders.find(o => o.request_key === key);
      if (body.order_id && !existing) throw fail(404, 'Supplier order not found.');
      if (existing && ((existing.job_id && existing.job_id !== job.id) || (existing.purchase_order_id && existing.purchase_order_id !== po.id))) throw fail(409, 'This supplier order belongs to a different job or PO. No links were changed.');
      const duplicate = orders.find(o => o.id !== existing?.id && text(o.order_number).toUpperCase() === orderNumber.toUpperCase() && sameVendor(o, po));
      if (duplicate) throw fail(409, 'That supplier confirmation already exists. Open its existing record instead.');
      const payload = {
        title: `${po.vendor} ${orderNumber} - ${po.po_number} ${job.canonical_name || ''}`,
        order_number: orderNumber, vendor: po.vendor, po_name: po.po_number,
        job_id: job.id, job_name: job.canonical_name || '', builder: job.builder || '',
        purchase_order_id: po.id, budget_id: po.budget_id || '', amount: value,
        eta_date: text(body.eta_date), eta_source: text(body.eta_date) ? 'owner reviewed supplier confirmation' : '',
        received_date: text(body.received_date), notes: text(body.notes).slice(0, 4000),
      };
      if (existing && !body.order_id) {
        if (Object.entries(payload).some(([k, v]) => (existing[k] ?? '') !== v)) throw fail(409, 'This save key already recorded different supplier details. Refresh.');
        return { ok: true, order: existing, duplicate: true };
      }
      if (existing) return { ok: true, order: await saveCurrent(api.VendorOrders, existing, body.expected_updated_date, payload) };
      try {
        const created = await api.VendorOrders.create({ ...payload, request_key: key, created_by_email: user.email,
          status: payload.eta_date ? 'eta_set' : 'ordered', status_history: [{ status: payload.eta_date ? 'eta_set' : 'ordered', at: now(), by: user.email, note: 'Supplier confirmation recorded by owner. No purchase submitted.' }],
        });
        return { ok: true, order: created };
      } catch {
        lock.holdForReview();
        throw fail(503, 'Supplier save outcome is uncertain. Refresh and reconcile before creating another record.', { uncertain: true });
      }
    }
    if (action === 'vendor_status') {
      const row = await api.VendorOrders.get(text(body.order_id));
      if (!row || !PAYMENT_STATES.includes(body.status)) throw fail(400, 'Invalid supplier order or payment status.');
      if (text(body.note).length < 3) throw fail(400, 'Enter the payment reference or reason for the change.');
      const patch = { status: body.status, status_history: stampHistory(row, body.status, user.email, text(body.note), now()) };
      if (body.status === 'paid') { patch.paid_at = now(); patch.paid_reference = text(body.note); }
      if (body.status === 'reconciled') { patch.reconciled_at = now(); patch.reconcile_note = text(body.note); }
      return { ok: true, order: await saveCurrent(api.VendorOrders, row, body.expected_updated_date, patch), message: 'Payment status recorded only. No money was sent.' };
    }
    if (action === 'sync_estimate') {
      const preview = await estimatePreview(api, body);
      if (preview.closed) throw fail(409, 'This accounting month is closed. Its records were not changed.');
      if (body.preview_version !== preview.version) throw fail(409, 'The estimate or accounting record changed. Preview again before syncing.');
      const patch = estimatePatch(preview.estimate, user.email, now());
      if (preview.existing) {
        const record = await saveCurrent(api.JobCostInputs, preview.existing, preview.existing.updated_date, patch);
        return { ok: true, cost_input_id: record.id, message: 'Estimate linked to invoicing. Recorded revenue, actual costs, invoices and payments are unchanged.' };
      }
      const routes = ['bfs_installed_sale', 'bfs_supply_ya_install', 'bfs_to_ya_turnkey', 'direct_manufacturer_turnkey'];
      if (!routes.includes(body.route)) throw fail(400, 'Choose the business route for the new accounting record.');
      try {
        const record = await api.JobCostInputs.create({ month: body.month, job_id: preview.job.id, job_name_norm: text(preview.job.canonical_name).toLowerCase(), route: body.route, ...patch });
        return { ok: true, cost_input_id: record.id, message: 'Estimate linked. No actual financial amounts were populated.' };
      } catch {
        lock.holdForReview();
        throw fail(503, 'Accounting link outcome is uncertain. Reconcile before adding another record.', { uncertain: true });
      }
    }
    throw fail(400, 'Unknown purchasing action.');
  }, deps);
}

export function createProcurementHandler(getClient, defaultAction = 'overview') {
  return async req => {
    try {
      const client = getClient(req);
      const user = await client.auth.me();
      assertOwner(user);
      const body = await req.json().catch(() => ({}));
      const result = await procurementAction(client.asServiceRole.entities, { ...body, action: body.action || defaultAction }, user);
      return Response.json(result, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      return Response.json({ error: error?.message || 'Purchasing request failed.', code: error?.code || '', existing_po_ids: error?.existing_po_ids || [] }, { status: error?.status || 500 });
    }
  };
}
