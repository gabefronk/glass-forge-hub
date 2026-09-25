import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';
import { fetchAllPages } from '../../shared/pagination.ts';

// Issue a YA Windows and Doors purchase order number.
//   1. Scan every existing PurchaseOrders po_number, take the highest YA-#### suffix, +1,
//      zero-padded to 4 (YA-0001 when none exist). Existing POs are never reused or renumbered;
//      cancelled POs keep their number.
//   2. Create the PurchaseOrders row (status defaults to issued).
//   3. When job_id is given, append the new number to that Jobs record's po_numbers
//      (read-modify-write, existing entries preserved). oe_numbers is never touched.
// Optional guard: pass po_number to assert the number you expect to be issued; a mismatch
// returns po_number_mismatch and creates nothing.
// Returns the created PurchaseOrders row.

const PREFIX = 'YA-';
const STATUSES = ['issued', 'emailed', 'ordered', 'confirmed', 'received', 'cancelled'];
const TEXT_FIELDS = ['builder', 'customer_name', 'vendor', 'vendor_quote_ref', 'order_email_ref', 'notes'];

const clean = (v) => (v === null || v === undefined ? '' : String(v).trim());

function toAmount(v) {
  if (v === null || v === undefined || v === '') return undefined;
  const n = Number(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
}

function nextPoNumber(rows) {
  let max = 0;
  for (const r of rows || []) {
    const m = /^YA-(\d+)$/i.exec(clean(r?.po_number));
    if (m) max = Math.max(max, Number(m[1]));
  }
  return PREFIX + String(max + 1).padStart(4, '0');
}

export default async function(req) {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });
    const OWNER_EMAILS = ['gabefronk@gmail.com', 'gabriel.fronk.wd@gmail.com'];
    const callerEmail = String(user.email || '').trim().toLowerCase();
    if (user.role !== 'admin' || !OWNER_EMAILS.includes(callerEmail)) {
      return Response.json({ error: 'forbidden: purchase orders are owner-only' }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const api = base44.asServiceRole.entities;

    const status = clean(body.status) || 'issued';
    if (!STATUSES.includes(status)) return Response.json({ error: 'invalid_status', status }, { status: 200 });

    const amount_dealer = toAmount(body.amount_dealer);
    const amount_customer = toAmount(body.amount_customer);
    if (Number.isNaN(amount_dealer) || Number.isNaN(amount_customer)) {
      return Response.json({ error: 'invalid_amount' }, { status: 200 });
    }

    const jobId = clean(body.job_id);
    // A PO always belongs to a real job: no job_id, no number. Guards against
    // burning sequence numbers on empty/accidental calls.
    if (!jobId) return Response.json({ error: 'job_id_required' }, { status: 400 });
    const job = await api.Jobs.get(jobId).catch(() => null);
    if (!job) return Response.json({ error: 'job_not_found', job_id: jobId }, { status: 200 });

    // Optional setup context is never inferred from whole-job pricing. Claims of an
    // approved sheet fail closed; manual issuance does not depend on that entity.
    let setupSheet = null;
    if (clean(body.setup_sheet_id)) {
      if (body.review_confirmed !== true) return Response.json({ error: 'owner_review_required' }, { status: 400 });
      let sheets;
      try { sheets = await fetchAllPages(api.JobSetupSheets, 'created_date'); }
      catch { return Response.json({ error: 'setup_sheet_unavailable' }, { status: 200 }); }
      const approvedSheets = sheets.filter((sheet) =>
        clean(sheet?.job_id) === jobId &&
        clean(sheet?.status).toLowerCase() === 'approved' &&
        clean(sheet?.approver_name) &&
        clean(sheet?.approved_date)
      );
      if (approvedSheets.length !== 1) {
        return Response.json({ error: approvedSheets.length > 1 ? 'ambiguous_setup_sheet' : 'approved_setup_sheet_required' }, { status: 200 });
      }
      setupSheet = approvedSheets[0];
      if (clean(body.setup_sheet_id) !== clean(setupSheet.id)) {
        return Response.json({ error: 'setup_sheet_changed' }, { status: 200 });
      }
    }

    const existing = await fetchAllPages(api.PurchaseOrders, 'created_date');
    const po_number = nextPoNumber(existing);
    const expected = clean(body.po_number).toUpperCase();
    if (expected && expected !== po_number) {
      return Response.json({ error: 'po_number_mismatch', expected, next: po_number }, { status: 200 });
    }

    const row = { po_number, status, created_by_email: user.email || '' };
    if (setupSheet) Object.assign(row, {
      setup_sheet_id: clean(setupSheet.id),
      setup_sheet_approver_name: clean(setupSheet.approver_name),
      setup_sheet_approved_date: clean(setupSheet.approved_date),
      owner_reviewed_at: new Date().toISOString(),
    });
    for (const f of TEXT_FIELDS) {
      const v = clean(body[f]);
      if (v) row[f] = v;
    }
    row.job_id = jobId;
    row.job_name = clean(job.canonical_name) || clean(job.name); // Current Jobs record is authoritative; sheet labels may be stale.
    if (!row.builder && job.builder) row.builder = job.builder;
    if (!row.customer_name && job.customer_name) row.customer_name = job.customer_name;
    if (amount_dealer !== undefined) row.amount_dealer = amount_dealer;
    if (amount_customer !== undefined) row.amount_customer = amount_customer;

    const created = await api.PurchaseOrders.create(row);

    // Re-read right before writing so a concurrent edit to the job's PO list is not lost.
    const fresh = (await api.Jobs.get(jobId).catch(() => null)) || job;
    const current = Array.isArray(fresh.po_numbers) ? fresh.po_numbers : [];
    let job_update = null;
    if (current.includes(po_number)) {
      job_update = { ok: true, already_present: true };
    } else {
      try {
        await api.Jobs.update(jobId, { po_numbers: [...current, po_number] });
        job_update = { ok: true };
      } catch (e) {
        // The PO exists either way; surface the link failure instead of hiding it.
        job_update = { ok: false, error: String(e?.message || e) };
      }
    }

    return Response.json({ ...created, job_update });
  } catch (error) {
    return Response.json({ error: String(error?.message || error) }, { status: 500 });
  }
}
