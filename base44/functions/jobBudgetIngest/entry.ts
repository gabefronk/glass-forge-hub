import { createClientFromRequest } from 'npm:@base44/sdk@0.8.46';
import { unzipSync, zipSync, strFromU8, strToU8 } from 'npm:fflate@0.8.3';
import { computeJobBudget } from '../../shared/jobBudgetMath.js';
import { parseAmscoQuoteText, normalizeVendorQuote, quoteMatchTokens } from '../../shared/vendorQuoteParse.js';
import { buildBudgetCsv, fillBudgetXlsx } from '../../shared/jobBudgetSheet.js';
import { BUDGET_TEMPLATE_XLSX_B64 } from '../../shared/jobBudgetTemplateXlsx.js';
import { normalizeCustomer } from '../../shared/jobIdentity.js';
import { denverDate } from '../../shared/billingCore.js';
import { fetchCompleteEntity, matchJobTokens } from '../../shared/jobCatalog.js';
import { validateLaborEntry, laborMargin, buildCostInputPatch, summarizeJobCosts } from '../../shared/jobLaborEntry.js';

// Job Budgets ingest.
// Gabriel drops one or more vendor quote PDFs on the Job Budgets page. For each:
//   1. Extract the quote (deterministic AMSCO parser when text is supplied, else LLM
//      against the PDF) -> normalized vendor quote.
//   2. Compute the cost basis + margins with the same math as his Window Budget Sheet
//      workbook (shared/jobBudgetMath.js, verified against the real template).
//   3. Match the quote to a Hub job (conservative: one confident match or needs_review).
//   4. File in Drive: find-or-create Glass Forge Jobs/<Builder>/<Job>, upload the quote
//      PDF, a filled copy of his workbook, and a CSV summary.
//   5. Create the JobBudgets record and, on a confident job match, upsert this month's
//      JobCostInputs so the Invoicing page profitability picks it up.
//
// Also owns VendorOrders (the unpaid-jobs tracker): upsert_order, advance_order_status
// and set_glass_eta. The glass-ETA chain (Steve text/email -> update -> notify) calls
// set_glass_eta; notification drafting is a separate step by design.

const DRIVE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const JOBS_ROOT_FOLDER = '1F_PgUPEuvyvzCk92tdaFiwioLSack4iS'; // Glass Forge Jobs / <Builder> / <Job>
const UNFILED_FOLDER_NAME = '_Unmatched Quote Drops';

const QUOTE_SCHEMA = {
  type: 'object',
  properties: {
    vendor: { type: ['string', 'null'] },
    manufacturer: { type: ['string', 'null'] },
    quote_number: { type: ['string', 'null'] },
    quote_name: { type: ['string', 'null'] },
    quoted_by: { type: ['string', 'null'] },
    bill_to: { type: ['string', 'null'] },
    ship_to: { type: ['string', 'null'] },
    builder: { type: ['string', 'null'], description: 'Builder/customer the job belongs to' },
    lot_or_address: { type: ['string', 'null'], description: 'Lot number or street address if printed' },
    openings_qty: { type: ['integer', 'null'], description: 'Total window/door/glass units across all lines' },
    material_true_cost: { type: ['number', 'null'], description: 'Dealer cost subtotal (what Glass Forge pays), before tax' },
    actual_total_sell: { type: ['number', 'null'], description: 'Customer TOTAL including tax (what the customer pays)' },
    customer_sub_total: { type: ['number', 'null'] },
    customer_tax: { type: ['number', 'null'] },
  },
};

const QUOTE_PROMPT = `You are reading a window/door/glass vendor quote PDF for a glazing contractor.
Extract the quote header and totals exactly as printed. The dealer cost subtotal is what the
contractor pays the vendor (may be labeled "Dealer Sub", dealer price, or net cost); the customer
TOTAL is the sell price including tax. Count every window, door and glass unit across lines for
openings_qty. Use null for anything not printed; never guess.`;

async function driveJson(token, url, init = {}) {
  const res = await fetch(url, { ...init, headers: { Authorization: 'Bearer ' + token, ...(init.headers || {}) } });
  const text = await res.text();
  if (!res.ok) throw new Error('Drive ' + res.status + ' ' + url.split('?')[0] + ': ' + text.slice(0, 300));
  return text ? JSON.parse(text) : {};
}

function cleanName(s, fallback) {
  const v = String(s || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim();
  return v || fallback;
}

async function ensureFolder(token, name, parentId) {
  const q = encodeURIComponent(`'${parentId}' in parents and mimeType='application/vnd.google-apps.folder' and name='${name.replace(/'/g, "\\'")}' and trashed=false`);
  const found = await driveJson(token, `${DRIVE}/files?q=${q}&fields=files(id,name)&pageSize=5`);
  if (found.files && found.files[0]) return found.files[0].id;
  const made = await driveJson(token, `${DRIVE}/files?fields=id,name`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, parents: [parentId], mimeType: 'application/vnd.google-apps.folder' }) });
  return made.id;
}

// Glass Forge Jobs / <Builder> / <Job> - find or create both levels.
async function ensureJobFolder(token, builderRaw, jobRaw, unmatched) {
  const builder = cleanName(builderRaw, 'Unknown Builder');
  const jobName = cleanName(jobRaw, 'Unnamed Job');
  const builderId = await ensureFolder(token, unmatched ? UNFILED_FOLDER_NAME : builder, JOBS_ROOT_FOLDER);
  const jobId = await ensureFolder(token, jobName, builderId);
  return { id: jobId, path: `Glass Forge Jobs/${unmatched ? UNFILED_FOLDER_NAME : builder}/${jobName}`, builder, jobName };
}

function concatBytes(parts) {
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

async function uploadFile(token, name, bytes, mimeType, parentId) {
  const boundary = 'gfhub' + crypto.randomUUID();
  const enc = new TextEncoder();
  const meta = JSON.stringify({ name, parents: [parentId], mimeType });
  const head = enc.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${mimeType}\r\n\r\n`);
  const tail = enc.encode(`\r\n--${boundary}--`);
  return driveJson(token, `${DRIVE_UPLOAD}/files?uploadType=multipart&fields=id,name`, {
    method: 'POST',
    headers: { 'Content-Type': 'multipart/related; boundary=' + boundary },
    body: concatBytes([head, bytes, tail]),
  });
}

// Conservative job match: link only when exactly one Jobs record lines up with the
// quote tokens; otherwise needs_review with the candidates. Nothing attaches on weak
// or split evidence (same rule as the rest of the Hub's job identity logic).
async function matchJob(db, quote, forcedJobId) {
  // Dropped from a job page: that job is the match, no guessing.
  if (forcedJobId) {
    const job = await db.Jobs.get(String(forcedJobId)).catch(() => null);
    if (!job) return { status: 'needs_review', reason: 'job not found', candidates: [] };
    return { status: 'matched', job_id: job.id, job_name: job.canonical_name || job.name || '', reason: 'chosen on the job page' };
  }
  const tokens = quoteMatchTokens(quote);
  if (!tokens.length) return { status: 'needs_review', reason: 'no usable match tokens on quote', candidates: [] };
  // Matching is a uniqueness decision. Never match against a partial catalog and
  // never convert a failed read into an apparently complete empty result.
  const jobs = await fetchCompleteEntity(db.Jobs);
  return matchJobTokens(jobs, tokens, normalizeCustomer);
}

async function processQuote(base44, db, core, accessToken, body, userEmail) {
  const { file_url, file_name, text } = body;
  if (!file_url && !text) return Response.json({ error: 'file_url (PDF) is required' }, { status: 400 });

  // 1. Extract.
  let quote = null;
  if (text) {
    const parsed = parseAmscoQuoteText(text);
    if (parsed) quote = normalizeVendorQuote(parsed);
  }
  if (!quote) {
    const extracted = await core.InvokeLLM({ prompt: QUOTE_PROMPT, response_json_schema: QUOTE_SCHEMA, file_urls: [file_url], add_context_from_internet: false });
    quote = normalizeVendorQuote(extracted || {});
  }
  if (!quote.material_true_cost && !quote.actual_total_sell) {
    return Response.json({ status: 'needs_review', reason: 'no cost or sell totals could be extracted from the PDF', quote }, { status: 200 });
  }

  // 2. Budget math (same as the workbook).
  const budget = computeJobBudget({
    material_true_cost: quote.material_true_cost,
    actual_total_sell: quote.actual_total_sell,
  });

  // 3. Job match.
  const match = await matchJob(db, quote, body.job_id);
  const matched = match.status === 'matched';
  const forcedJob = body.job_id && matched ? await db.Jobs.get(String(body.job_id)).catch(() => null) : null;
  const builder = (forcedJob && forcedJob.builder) || quote.builder || quote.bill_to || 'Unknown Builder';
  const jobName = matched ? match.job_name : (quote.quote_name || cleanName((file_name || 'quote').replace(/\.pdf$/i, ''), 'Unnamed Job'));

  // 4. Drive filing.
  const folder = await ensureJobFolder(accessToken, builder, jobName, !matched);
  let pdfBytes = null;
  if (file_url) {
    const res = await fetch(file_url);
    if (res.ok) pdfBytes = new Uint8Array(await res.arrayBuffer());
  }
  const stamp = denverDate();
  const base = cleanName(`${quote.quote_name || jobName} - ${quote.manufacturer || quote.vendor || 'vendor'} ${quote.quote_number || ''}`.trim(), 'quote');
  const quoteUp = pdfBytes ? await uploadFile(accessToken, `${base}.pdf`, pdfBytes, 'application/pdf', folder.id) : null;
  const xlsxBytes = fillBudgetXlsx(
    Uint8Array.from(atob(BUDGET_TEMPLATE_XLSX_B64), (c) => c.charCodeAt(0)),
    {
      sales_rep: quote.quoted_by || '', date_iso: stamp,
      builder, manufacturer: quote.manufacturer || quote.vendor || '',
      openings_qty: quote.openings_qty || null,
    },
    budget,
    { unzipSync, zipSync, strFromU8, strToU8 },
  );
  const xlsxUp = await uploadFile(accessToken, `Window Budget Sheet - ${base}.xlsx`, xlsxBytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', folder.id);
  const csvUp = await uploadFile(accessToken, `Window Budget Sheet - ${base}.csv`, strToU8(buildBudgetCsv({ quote, budget, fields: { builder, sales_rep: quote.quoted_by, date: stamp } })), 'text/csv', folder.id);

  // 5. Records.
  const title = `${quote.quote_name || jobName} (${quote.manufacturer || quote.vendor || 'vendor'}${quote.quote_number ? ' ' + quote.quote_number : ''})`;
  const record = await db.JobBudgets.create({
    title,
    status: matched ? 'filed' : 'needs_review',
    builder, job_name: jobName, job_id: matched ? match.job_id : undefined,
    job_match: match,
    manufacturer: quote.manufacturer || undefined, vendor: quote.vendor || undefined,
    quote_number: quote.quote_number || undefined, quote_name: quote.quote_name || undefined,
    quoted_by: quote.quoted_by || undefined, openings_qty: quote.openings_qty || undefined,
    quote,
    inputs: { material_true_cost: quote.material_true_cost, actual_total_sell: quote.actual_total_sell },
    computed: budget,
    source_pdf_url: file_url || undefined, source_pdf_name: file_name || undefined,
    drive_job_folder_id: folder.id, drive_job_folder_path: folder.path,
    drive_quote_file_id: quoteUp?.id, drive_budget_xlsx_file_id: xlsxUp?.id, drive_budget_csv_file_id: csvUp?.id,
    glass_eta_status: 'waiting',
    created_by_email: userEmail,
  });

  // Invoicing-page hook: this month's cost basis for the matched job.
  let costInput = null;
  if (matched) {
    const month = denverDate().slice(0, 7);
    const existing = await db.JobCostInputs.filter({ month, job_id: match.job_id }, '-created_date', 1).catch(() => []);
    const patch = {
      month, job_id: match.job_id, job_name_norm: normalizeCustomer(match.job_name || jobName),
      material_source: 'manual', quote_number: quote.quote_number || undefined,
      product_cost: quote.material_true_cost ?? undefined,
      product_sell: quote.actual_total_sell ?? undefined,
    };
    costInput = existing && existing[0]
      ? await db.JobCostInputs.update(existing[0].id, patch)
      : await db.JobCostInputs.create(patch);
  }

  return Response.json({
    status: record.status, budget_id: record.id, title,
    matched_job: matched ? { id: match.job_id, name: match.job_name } : null,
    match_reason: matched ? undefined : match.reason,
    computed: budget,
    drive: { folder_path: folder.path, folder_id: folder.id, quote_file_id: quoteUp?.id, budget_xlsx_file_id: xlsxUp?.id, budget_csv_file_id: csvUp?.id },
    cost_inputs_month: costInput ? denverDate().slice(0, 7) : null,
  });
}

function stampHistory(order, status, by, note) {
  const hist = Array.isArray(order?.status_history) ? [...order.status_history] : [];
  hist.push({ status, at: new Date().toISOString(), by: by || 'hub', note: note || '' });
  return hist.slice(-50);
}

export default async function jobBudgetIngest(req) {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me().catch(() => null);
  if (!user || (user.role !== 'admin' && user.role !== 'manager')) {
    return Response.json({ error: 'forbidden' }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const db = base44.asServiceRole.entities;
  const core = base44.asServiceRole.integrations.Core;
  const action = body.action || 'process';

  if (action === 'process') {
    const { accessToken } = await base44.asServiceRole.connectors.getConnection('googledrive');
    if (!accessToken) return Response.json({ error: 'googledrive connector is not connected' }, { status: 200 });
    return processQuote(base44, db, core, accessToken, body, user.email);
  }

  // --- Job page: quick labor entry + what the job's costs look like -----------

  if (action === 'job_costs') {
    const jobId = String(body.job_id || '').trim();
    if (!jobId) return Response.json({ error: 'job_id is required' }, { status: 400 });
    const [costInputs, budgets] = await Promise.all([
      db.JobCostInputs.filter({ job_id: jobId }, '-month', 5).catch(() => []),
      db.JobBudgets.filter({ job_id: jobId }, '-created_date', 1).catch(() => []),
    ]);
    // The newest month with numbers on it is the one the card shows.
    const costInput = (costInputs || []).find((c) => c.installation_revenue != null || c.actual_labor_cost != null) || (costInputs || [])[0] || null;
    return Response.json({ status: 'ok', ...summarizeJobCosts({ costInput, budget: (budgets || [])[0] || null }) });
  }

  if (action === 'set_labor') {
    const jobId = String(body.job_id || '').trim();
    if (!jobId) return Response.json({ error: 'job_id is required' }, { status: 400 });
    const job = await db.Jobs.get(jobId).catch(() => null);
    if (!job) return Response.json({ error: 'job not found' }, { status: 404 });
    const check = validateLaborEntry(body, { today: denverDate() });
    if (!check.ok) return Response.json({ error: 'invalid labor entry', fields: check.errors }, { status: 400 });
    const v = check.values;
    // One row per job and month; the quick entry updates the row it finds.
    const existing = (await db.JobCostInputs.filter({ job_id: jobId, month: v.month }, '-created_date', 1).catch(() => []))[0] || null;
    const patch = buildCostInputPatch(existing, v, { jobId, jobNameNorm: normalizeCustomer(job.canonical_name || job.name || '') });
    const row = existing ? await db.JobCostInputs.update(existing.id, patch) : await db.JobCostInputs.create(patch);
    const margin = laborMargin(row.installation_revenue, row.actual_labor_cost);
    return Response.json({ status: 'ok', cost_input_id: row.id, month: v.month, ...margin, ...summarizeJobCosts({ costInput: row, budget: null }) });
  }

  // --- VendorOrders: the unpaid-jobs tracker -------------------------------

  if (action === 'upsert_order') {
    const o = body.order || {};
    if (!o.order_number && !o.title) return Response.json({ error: 'order_number or title is required' }, { status: 400 });
    const existing = o.order_number
      ? await db.VendorOrders.filter({ order_number: o.order_number }, '-created_date', 1).catch(() => [])
      : [];
    const base = {
      title: o.title || `${o.vendor || 'Vendor'} ${o.order_number || ''}${o.po_name ? ' - ' + o.po_name : ''}`.trim(),
      order_number: o.order_number, vendor: o.vendor, po_name: o.po_name,
      billed_account: o.billed_account, amount: o.amount ?? undefined,
      payment_route: o.payment_route || 'unknown', ach_link: o.ach_link || undefined,
      payer: o.payer, job_id: o.job_id || undefined, budget_id: o.budget_id || undefined,
      job_name: o.job_name || undefined, builder: o.builder || undefined,
      eta_date: o.eta_date || undefined, eta_source: o.eta_source || undefined,
      notes: o.notes || undefined,
    };
    const clean = Object.fromEntries(Object.entries(base).filter(([, v]) => v !== undefined && v !== null && v !== ''));
    if (existing && existing[0]) {
      const updated = await db.VendorOrders.update(existing[0].id, clean);
      return Response.json({ status: 'updated', order_id: updated.id });
    }
    const created = await db.VendorOrders.create({
      ...clean,
      status: o.status || 'ordered',
      status_history: [{ status: o.status || 'ordered', at: new Date().toISOString(), by: user.email, note: o.note || 'order logged' }],
      created_by_email: user.email,
    });
    return Response.json({ status: 'created', order_id: created.id });
  }

  if (action === 'advance_order_status') {
    const order = body.order_id ? await db.VendorOrders.get(body.order_id).catch(() => null) : null;
    if (!order) return Response.json({ error: 'order not found' }, { status: 404 });
    const next = body.status;
    const chain = ['ordered', 'eta_set', 'ach_link_received', 'paid', 'reconciled'];
    if (!chain.includes(next)) return Response.json({ error: 'bad status' }, { status: 400 });
    const patch = {
      status: next,
      status_history: stampHistory(order, next, user.email, body.note),
    };
    if (next === 'ach_link_received' && body.ach_link) patch.ach_link = body.ach_link;
    if (next === 'paid') { patch.paid_at = new Date().toISOString(); if (body.paid_reference) patch.paid_reference = body.paid_reference; }
    if (next === 'reconciled') { patch.reconciled_at = new Date().toISOString(); if (body.reconcile_note) patch.reconcile_note = body.reconcile_note; }
    if (body.eta_date) patch.eta_date = body.eta_date;
    const updated = await db.VendorOrders.update(order.id, patch);
    return Response.json({ status: 'ok', order_id: updated.id, order_status: updated.status });
  }

  if (action === 'set_glass_eta') {
    // The Steve-ETA chain lands here: update the budget and any linked order. The
    // caller (page, agent, watcher) owns notifying Gabriel and drafting the customer
    // update - this function never messages anyone.
    const patch = {
      glass_eta_date: body.eta_date,
      glass_eta_status: body.ready ? 'ready' : 'eta_set',
      glass_eta_source: body.source || 'manual',
    };
    let budget = null;
    if (body.budget_id) budget = await db.JobBudgets.update(body.budget_id, patch).catch(() => null);
    let order = null;
    if (body.order_id) {
      const cur = await db.VendorOrders.get(body.order_id).catch(() => null);
      if (cur) {
        order = await db.VendorOrders.update(cur.id, {
          eta_date: body.eta_date,
          eta_source: body.source || 'manual',
          status: cur.status === 'ordered' ? 'eta_set' : cur.status,
          status_history: stampHistory(cur, 'eta_set', user.email, `ETA ${body.eta_date} (${body.source || 'manual'})`),
        });
      }
    }
    return Response.json({ status: 'ok', budget_id: budget?.id || null, order_id: order?.id || null });
  }

  return Response.json({ error: 'unknown action' }, { status: 400 });
}
