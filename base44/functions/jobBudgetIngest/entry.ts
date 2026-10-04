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
import { validateBudgetInputs, newJobFromBudget, linkedBudgetPatch, sheetValuesFor } from '../../shared/jobBudgetReview.js';
import { budgetRollup, budgetVersion, estimatePatch, poRefs } from '../../shared/procurementCore.js';
import { withProcurementLock, procurementError } from '../../shared/procurementLock.mjs';
import { assertBudgetVersion, budgetInputPatch, rereadPatch } from '../../shared/budgetMutationPolicy.mjs';
import { QUOTE_SCHEMA, QUOTE_PROMPT, legacyTotals } from '../../shared/vendorQuoteSchema.js';
import { autofillBudget, budgetNameFor, fileNameHints, GLASS_LABOR_COST_EACH } from '../../shared/jobBudgetAutofill.js';

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
// After the drop (the review step, shared/jobBudgetReview.js):
//   set_inputs  type the yellow-cell numbers -> recompute, rewrite the sheet + CSV in
//               place, refresh JobCostInputs when the row has a job.
//   link_job    pick a Hub job (or create one from the quote) -> move the Drive files
//               into Glass Forge Jobs/<Builder>/<Job>, mark filed, upsert JobCostInputs.
//
// Also owns VendorOrders (the unpaid-jobs tracker): upsert_order, advance_order_status
// and set_glass_eta. The glass-ETA chain (Steve text/email -> update -> notify) calls
// set_glass_eta; notification drafting is a separate step by design.

const DRIVE = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const JOBS_ROOT_FOLDER = '1F_PgUPEuvyvzCk92tdaFiwioLSack4iS'; // Glass Forge Jobs / <Builder> / <Job>
const UNFILED_FOLDER_NAME = '_Unmatched Quote Drops';

async function extractQuote(core, { file_url, text }) {
  if (text) {
    const parsed = parseAmscoQuoteText(text);
    if (parsed) return normalizeVendorQuote(parsed);
  }
  const extracted = await core.InvokeLLM({ prompt: QUOTE_PROMPT, response_json_schema: QUOTE_SCHEMA, file_urls: [file_url], add_context_from_internet: false });
  return legacyTotals(normalizeVendorQuote(extracted || {}));
}

async function glassEach(db) {
  const s = (await db.AppSettings.list('-created_date', 1).catch(() => []))[0];
  const v = Number(s?.budget_glass_labor_each);
  return Number.isFinite(v) && v > 0 ? v : GLASS_LABOR_COST_EACH;
}

// What the drop filled, stored on the budget row so the Numbers editor can say where each
// number came from.
function autofillRecord(fill) {
  return {
    sources: fill.sources, notes: fill.notes, filled: fill.filled,
    install_material: fill.install_material,
    labor_lines: fill.labor.lines, labor_unpriced: fill.labor.unpriced, trip_minimum: fill.labor.trip_minimum || null,
    file_job_name: fill.hints.job_name || null, glass_only: !!fill.hints.glass_only,
    at: new Date().toISOString(),
  };
}

// Customer PO (YA-0007) -> the one job carrying it, directly or through a vendor order.
async function matchByPo(db, po) {
  const key = String(po || '').trim().toUpperCase();
  if (!key || /^(NONE|N\/A)$/.test(key)) return null;
  const [jobs, orders, pos] = await Promise.all([
    fetchCompleteEntity(db.Jobs), fetchCompleteEntity(db.VendorOrders), fetchCompleteEntity(db.PurchaseOrders),
  ]);
  const ids = new Set();
  for (const j of jobs) if (!j.is_sample && (j.po_numbers || []).some(p => String(p).trim().toUpperCase() === key)) ids.add(j.merged_into || j.id);
  for (const o of orders) if (o.job_id && (poRefs(o.po_name).includes(key) || String(o.po_name || '').trim().toUpperCase() === key)) ids.add(o.job_id);
  for (const p of pos) if (p.job_id && String(p.po_number || '').trim().toUpperCase() === key) ids.add(p.job_id);
  if (ids.size !== 1) return null;
  const job = jobs.find(j => j.id === [...ids][0] && !j.merged_into && !j.is_sample);
  return job ? { status: 'matched', job_id: job.id, job_name: job.canonical_name || job.name || '', reason: `unique customer PO ${key}` } : null;
}

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

// Replace a file's content in place (same id, same links). Falls back to a fresh upload
// when the id is gone (deleted or never created).
async function replaceOrUpload(token, fileId, name, bytes, mimeType, parentId) {
  if (fileId) {
    try {
      return await driveJson(token, `${DRIVE_UPLOAD}/files/${encodeURIComponent(fileId)}?uploadType=media&fields=id,name`, { method: 'PATCH', headers: { 'Content-Type': mimeType }, body: bytes });
    } catch (e) {
      if (!/Drive 404/.test(String(e?.message || ''))) throw e;
    }
  }
  return uploadFile(token, name, bytes, mimeType, parentId);
}

async function moveFile(token, fileId, toParentId) {
  if (!fileId) return null;
  const cur = await driveJson(token, `${DRIVE}/files/${encodeURIComponent(fileId)}?fields=id,parents`).catch(() => null);
  if (!cur) return null;
  const from = (cur.parents || []).join(',');
  if ((cur.parents || []).includes(toParentId)) return cur.id;
  const q = `addParents=${encodeURIComponent(toParentId)}${from ? `&removeParents=${encodeURIComponent(from)}` : ''}&fields=id,parents`;
  const moved = await driveJson(token, `${DRIVE}/files/${encodeURIComponent(fileId)}?${q}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  return moved.id;
}

// The filled workbook + CSV for a budget row, written over the existing Drive files.
async function writeBudgetSheets(token, record, budget, job, folderId) {
  const stamp = denverDate();
  const values = sheetValuesFor(record, job, stamp);
  const base = cleanName(`${record.quote_name || record.job_name || 'quote'} - ${record.manufacturer || record.vendor || 'vendor'} ${record.quote_number || ''}`.trim(), 'quote');
  const xlsxBytes = fillBudgetXlsx(Uint8Array.from(atob(BUDGET_TEMPLATE_XLSX_B64), (c) => c.charCodeAt(0)), values, budget, { unzipSync, zipSync, strFromU8, strToU8 });
  const csvBytes = strToU8(buildBudgetCsv({ quote: record.quote || {}, budget, fields: { builder: values.builder, sales_rep: values.sales_rep, date: stamp } }));
  const xlsxUp = await replaceOrUpload(token, record.drive_budget_xlsx_file_id, `Window Budget Sheet - ${base}.xlsx`, xlsxBytes, 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', folderId);
  const csvUp = await replaceOrUpload(token, record.drive_budget_csv_file_id, `Window Budget Sheet - ${base}.csv`, csvBytes, 'text/csv', folderId);
  return { drive_budget_xlsx_file_id: xlsxUp?.id, drive_budget_csv_file_id: csvUp?.id };
}

// This month's JobCostInputs row for the job, refreshed from ALL of the job's budgets (a
// base quote plus an add-on quote add up); `current` is the row being saved, with its new
// numbers, in place of whatever the database still holds for it.
async function upsertCostInputs(db, job, current) {
  const month = denverDate().slice(0, 7);
  const [allBudgets, allCosts, closed] = await Promise.all([
    fetchCompleteEntity(db.JobBudgets), fetchCompleteEntity(db.JobCostInputs), fetchCompleteEntity(db.MonthCloseSnapshot),
  ]);
  const siblings = allBudgets.filter(b => b.job_id === job.id && b.id !== current?.id);
  const estimate = budgetRollup(current ? [...siblings, current] : siblings);
  const matches = allCosts.filter(c => c.month === month && c.job_id === job.id);
  if (matches.length > 1) throw new Error('Multiple accounting records for this job/month require review.');
  const existing = matches[0];
  // Existing amounts are historical facts. Never copy whole-job sell into product revenue
  // or estimated labor into actual labor. First-time linking is an explicit reviewed step.
  if (!existing?.budget_snapshot || closed.some(s => s.month === month)) return { month, estimate, pending_review: true };
  const patch = estimatePatch(estimate, current?.numbers_reviewed_by || current?.created_by_email || 'budget workflow', new Date().toISOString());
  const result = await db.JobCostInputs.updateMany({ id: existing.id, updated_date: existing.updated_date }, { $set: patch });
  if (result.updated !== 1) throw new Error('The accounting record changed; refresh the estimate from Budget & Orders.');
  return { id: existing.id, month, estimate, estimates_only: true };
}

// The budget row's yellow-cell inputs as the math expects them (older rows only stored
// material cost + total sell).
function inputsOf(record) {
  const i = record.inputs || {};
  return {
    material_true_cost: i.material_true_cost ?? 0,
    labor_cost_sub_pay: i.labor_cost_sub_pay ?? 0,
    labor_sell_price: i.labor_sell_price ?? 0,
    additional_install_material: i.additional_install_material ?? 0,
    additional_equipment: i.additional_equipment ?? 0,
    actual_total_sell: i.actual_total_sell ?? 0,
  };
}

// Conservative job match: link only when exactly one Jobs record lines up with the
// quote tokens; otherwise needs_review with the candidates. Nothing attaches on weak
// or split evidence (same rule as the rest of the Hub's job identity logic).
async function matchJob(db, quote, forcedJobId) {
  // Dropped from a job page: that job is the match, no guessing.
  if (forcedJobId) {
    const job = await db.Jobs.get(String(forcedJobId)).catch(() => null);
    if (!job || job.merged_into || job.is_sample) throw procurementError(409, 'Choose the current existing job before uploading a quote.');
    return { status: 'matched', job_id: job.id, job_name: job.canonical_name || job.name || '', reason: 'chosen on the job page' };
  }
  const byPo = await matchByPo(db, quote.customer_po);
  if (byPo) return byPo;
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
  const quote = await extractQuote(core, { file_url, text });
  // The quote's own name when it has one; Gabe's file name ("JOB - SCOPE - BRAND.pdf") when
  // the quote only says CASH CUSTOMER.
  const hints = fileNameHints(file_name);
  const name = budgetNameFor(quote, hints);
  if (name) quote.quote_name = name;

  // 2. Autofill the sheet's yellow cells, then the workbook math.
  const fill = autofillBudget(quote, { fileName: file_name, glassEach: await glassEach(db) });
  if (!fill.inputs.material_true_cost && !fill.inputs.actual_total_sell) {
    return Response.json({ status: 'needs_review', reason: 'no cost or sell totals could be extracted from the PDF', quote, notes: fill.notes }, { status: 200 });
  }
  const budget = computeJobBudget(fill.inputs);

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
    inputs: fill.inputs,
    computed: budget,
    autofill: autofillRecord(fill),
    source_pdf_url: file_url || undefined, source_pdf_name: file_name || undefined,
    drive_job_folder_id: folder.id, drive_job_folder_path: folder.path,
    drive_quote_file_id: quoteUp?.id, drive_budget_xlsx_file_id: xlsxUp?.id, drive_budget_csv_file_id: csvUp?.id,
    glass_eta_status: 'waiting',
    created_by_email: userEmail,
  });

  // Invoicing-page hook: this month's cost basis for the matched job (summed with any
  // budget already on the job).
  let costInput = null;
  if (matched) {
    const job = forcedJob || await db.Jobs.get(match.job_id).catch(() => null) || { id: match.job_id, canonical_name: match.job_name || jobName };
    try { costInput = await upsertCostInputs(db, job, { ...record, inputs: inputsOf(record) }); } catch (_e) { costInput = null; }
  }

  return Response.json({
    status: record.status, budget_id: record.id, title,
    matched_job: matched ? { id: match.job_id, name: match.job_name } : null,
    match_reason: matched ? undefined : match.reason,
    computed: budget,
    inputs: fill.inputs, filled: fill.filled, notes: fill.notes,
    drive: { folder_path: folder.path, folder_id: folder.id, quote_file_id: quoteUp?.id, budget_xlsx_file_id: xlsxUp?.id, budget_csv_file_id: csvUp?.id },
    cost_inputs_month: costInput ? denverDate().slice(0, 7) : null,
  });
}

// Re-read a budget row's quote PDF and refill its numbers (rows dropped before autofill, or
// after the install sheet changes). Overwrites the row's inputs; keeps its job link and files.
async function refillBudget(base44, db, core, record, userEmail) {
  if (!record.source_pdf_url) return { error: 'this budget has no quote PDF to read' };
  const quote = await extractQuote(core, { file_url: record.source_pdf_url });
  const hints = fileNameHints(record.source_pdf_name);
  const name = budgetNameFor(quote, hints);
  if (name) quote.quote_name = name;
  const fill = autofillBudget(quote, { fileName: record.source_pdf_name, glassEach: await glassEach(db) });
  const budget = computeJobBudget(fill.inputs);
  const patch = {
    ...rereadPatch(record, quote, fill, new Date().toISOString(), userEmail), autofill: autofillRecord(fill),
    openings_qty: quote.openings_qty || record.openings_qty || undefined,
    quote_number: quote.quote_number || record.quote_number || undefined,
  };
  const warnings = [];
  const job = record.job_id ? await db.Jobs.get(record.job_id).catch(() => null) : null;
  if (!record.job_id) {
    patch.quote_name = quote.quote_name || undefined;
    patch.job_name = quote.quote_name || record.job_name;
    patch.title = `${quote.quote_name || record.job_name || 'Quote'} (${quote.manufacturer || quote.vendor || record.manufacturer || 'vendor'}${quote.quote_number ? ' ' + quote.quote_number : ''})`;
    const byPo = await matchByPo(db, quote.customer_po);
    if (byPo) patch.job_match = { ...(record.job_match || {}), po_suggestion: byPo };
  }
  try {
    const { accessToken } = await base44.asServiceRole.connectors.getConnection('googledrive');
    if (accessToken && record.drive_job_folder_id) Object.assign(patch, await writeBudgetSheets(accessToken, { ...record, ...patch }, budget, job, record.drive_job_folder_id));
  } catch (e) { warnings.push(`Drive sheet not rewritten: ${String(e?.message || e).slice(0, 200)}`); }
  const saved = await db.JobBudgets.updateMany({ id: record.id, updated_date: record.updated_date }, { $set: patch });
  if (saved.updated !== 1) throw procurementError(409, 'The budget changed during extraction. Reload before applying new values.');
  const updated = await db.JobBudgets.get(record.id);
  let costInput = null;
  if (job) { try { costInput = await upsertCostInputs(db, job, updated); } catch (e) { warnings.push(`Estimate link not refreshed: ${String(e?.message || e).slice(0, 200)}`); } }
  return { status: 'ok', budget_id: updated.id, budget: updated, inputs: fill.inputs, sources: fill.sources, notes: fill.notes, computed: budget, cost_input: costInput, warnings };
}

function stampHistory(order, status, by, note) {
  const hist = Array.isArray(order?.status_history) ? [...order.status_history] : [];
  hist.push({ status, at: new Date().toISOString(), by: by || 'hub', note: note || '' });
  return hist.slice(-50);
}

export default async function jobBudgetIngest(req) {
  try {
  const base44 = createClientFromRequest(req);
  const user = await base44.auth.me().catch(() => null);
  if (!user || (user.role !== 'admin' && user.role !== 'manager')) {
    return Response.json({ error: 'forbidden' }, { status: 403 });
  }
  const body = await req.json().catch(() => ({}));
  const db = base44.asServiceRole.entities;
  const core = base44.asServiceRole.integrations.Core;
  const action = body.action || 'process';
  const handle = async () => {

  if (action === 'process') {
    const { accessToken } = await base44.asServiceRole.connectors.getConnection('googledrive');
    if (!accessToken) return Response.json({ error: 'googledrive connector is not connected' }, { status: 200 });
    return processQuote(base44, db, core, accessToken, body, user.email);
  }

  // --- Review step on the Job Budgets page ------------------------------------

  if (action === 'set_inputs') {
    const record = body.budget_id ? await db.JobBudgets.get(String(body.budget_id)).catch(() => null) : null;
    if (!record) return Response.json({ error: 'budget not found' }, { status: 404 });
    const patch = budgetInputPatch(record, body, user.email, new Date().toISOString());
    const values = patch.inputs;
    const budget = patch.computed;
    const job = record.job_id ? await db.Jobs.get(record.job_id) : null;
    const saved = await db.JobBudgets.updateMany({ id: record.id, updated_date: record.updated_date }, { $set: patch });
    if (saved.updated !== 1) throw procurementError(409, 'The budget changed before save. Reload.');
    const warnings = [];
    try {
      const { accessToken } = await base44.asServiceRole.connectors.getConnection('googledrive');
      if (accessToken && record.drive_job_folder_id) Object.assign(patch, await writeBudgetSheets(accessToken, record, budget, job, record.drive_job_folder_id));
      else warnings.push('Drive sheet not rewritten: no folder on this budget.');
    } catch (e) { warnings.push(`Drive sheet not rewritten: ${String(e?.message || e).slice(0, 200)}`); }
    const filePatch = Object.fromEntries(Object.entries(patch).filter(([key]) => key.startsWith('drive_')));
    if (Object.keys(filePatch).length) await db.JobBudgets.update(record.id, filePatch);
    const updated = await db.JobBudgets.get(record.id);
    let costInput = null;
    if (job) { try { costInput = await upsertCostInputs(db, job, updated); } catch (e) { warnings.push(`Estimate link not refreshed: ${String(e?.message || e).slice(0, 200)}`); } }
    return Response.json({ status: 'ok', budget_id: updated.id, budget: updated, computed: budget, cost_input: costInput, warnings });
  }

  if (action === 'refill') {
    const record = body.budget_id ? await db.JobBudgets.get(String(body.budget_id)).catch(() => null) : null;
    if (!record) return Response.json({ error: 'budget not found' }, { status: 404 });
    assertBudgetVersion(record, body.expected_version);
    if (body.review_confirmed !== true) throw procurementError(400, 'Confirm replacing working inputs from the source PDF. Previous inputs remain in history.');
    const out = await refillBudget(base44, db, core, record, user.email);
    return Response.json(out, { status: out.error ? 400 : 200 });
  }

  // Dry run for a PDF URL: what the drop would fill, without filing anything.
  if (action === 'preview_fill') {
    if (!body.file_url) return Response.json({ error: 'file_url is required' }, { status: 400 });
    const quote = await extractQuote(core, { file_url: body.file_url, text: body.text });
    const hints = fileNameHints(body.file_name);
    const name = budgetNameFor(quote, hints);
    if (name) quote.quote_name = name;
    const fill = autofillBudget(quote, { fileName: body.file_name, glassEach: await glassEach(db) });
    const out = { quote, ...fill, computed: computeJobBudget(fill.inputs), po_match: await matchByPo(db, quote.customer_po) };
    console.log(JSON.stringify(out));
    return Response.json(out);
  }

  if (action === 'delete') {
    const record = body.budget_id ? await db.JobBudgets.get(String(body.budget_id)).catch(() => null) : null;
    if (!record) return Response.json({ error: 'budget not found' }, { status: 404 });
    return Response.json({ error: 'Budget history is preserved. Use Keep as reference in Budget & Orders to exclude a quote without deleting it.' }, { status: 409 });
  }

  if (action === 'link_job') {
    const record = body.budget_id ? await db.JobBudgets.get(String(body.budget_id)).catch(() => null) : null;
    if (!record) return Response.json({ error: 'budget not found' }, { status: 404 });
    assertBudgetVersion(record, body.expected_version);
    if (record.job_id && String(body.job_id || '') !== record.job_id) throw procurementError(409, 'This quote is already linked. Review existing PO and accounting links before moving it to another job.');
    let job = null;
    if (body.job_id) {
      job = await db.Jobs.get(String(body.job_id)).catch(() => null);
      if (!job) return Response.json({ error: 'job not found' }, { status: 404 });
    } else if (body.new_job) {
      let payload;
      try { payload = newJobFromBudget(record, body.new_job); } catch (e) { return Response.json({ error: String(e?.message || e) }, { status: 400 }); }
      // Never mint a duplicate: an existing job with the same name is the job.
      const same = await db.Jobs.filter({ canonical_name: payload.canonical_name }, '-created_date', 1).catch(() => []);
      job = (same && same[0]) || await db.Jobs.create(payload);
    } else {
      return Response.json({ error: 'job_id or new_job is required' }, { status: 400 });
    }
    if (job.merged_into || job.is_sample) throw procurementError(409, 'Select the current, non-sample job.');
    const warnings = [];
    let folder = { id: record.drive_job_folder_id, path: record.drive_job_folder_path };
    const budget = record.computed && Object.keys(record.computed).length ? record.computed : computeJobBudget(inputsOf(record));
    try {
      const { accessToken } = await base44.asServiceRole.connectors.getConnection('googledrive');
      if (accessToken) {
        folder = await ensureJobFolder(accessToken, job.builder || record.builder, job.canonical_name || job.name || record.job_name, false);
        for (const id of [record.drive_quote_file_id, record.drive_budget_xlsx_file_id, record.drive_budget_csv_file_id]) {
          try { await moveFile(accessToken, id, folder.id); } catch (e) { warnings.push(`Drive move failed: ${String(e?.message || e).slice(0, 160)}`); }
        }
        try { Object.assign(record, await writeBudgetSheets(accessToken, { ...record, ...linkedBudgetPatch(job, user.email, folder) }, budget, job, folder.id)); }
        catch (e) { warnings.push(`Drive sheet not rewritten: ${String(e?.message || e).slice(0, 160)}`); }
      } else warnings.push('Drive not connected: files stay where they are.');
    } catch (e) { warnings.push(`Drive: ${String(e?.message || e).slice(0, 160)}`); }
    const patch = { ...linkedBudgetPatch(job, user.email, folder), inputs: inputsOf(record), computed: budget, drive_budget_xlsx_file_id: record.drive_budget_xlsx_file_id, drive_budget_csv_file_id: record.drive_budget_csv_file_id,
      status: warnings.length ? 'needs_review' : 'filed',
      link_history: [...(record.link_history || []), { at: new Date().toISOString(), by: user.email, previous_job_id: record.job_id || '', job_id: job.id, warnings }],
    };
    const updated = await db.JobBudgets.update(record.id, patch);
    let costInput = null;
    try { costInput = await upsertCostInputs(db, job, { ...record, job_id: job.id, inputs: inputsOf(record) }); } catch (e) { warnings.push(`Cost inputs not updated: ${String(e?.message || e).slice(0, 160)}`); }
    return Response.json({ status: 'ok', budget_id: updated.id, job: { id: job.id, name: job.canonical_name || job.name || '' }, drive: { folder_id: folder.id, folder_path: folder.path }, cost_input: costInput, warnings });
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

  if (action === 'clear_labor') {
    // Undo a quick entry: the two labor numbers come off the row; the row itself goes only
    // when nothing else (product cost, overhead, route notes) was ever set on it.
    const jobId = String(body.job_id || '').trim();
    if (!jobId) return Response.json({ error: 'job_id is required' }, { status: 400 });
    const month = /^\d{4}-\d{2}$/.test(String(body.month || '')) ? String(body.month) : null;
    const rows = await db.JobCostInputs.filter(month ? { job_id: jobId, month } : { job_id: jobId }, '-month', 5).catch(() => []);
    const row = (rows || []).find((c) => c.installation_revenue != null || c.actual_labor_cost != null) || null;
    if (!row) return Response.json({ status: 'ok', cleared: false });
    const bare = ['product_cost', 'product_sell', 'installation_material_cost', 'allocated_overhead', 'worker_count', 'quote_request_id', 'quote_number'].every((k) => row[k] == null || row[k] === '');
    if (bare) await db.JobCostInputs.delete(row.id);
    else await db.JobCostInputs.update(row.id, { installation_revenue: null, actual_labor_cost: null, notes: '' });
    return Response.json({ status: 'ok', cleared: true, deleted: bare, cost_input_id: row.id });
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
  };
  if (['process', 'set_inputs', 'refill', 'link_job'].includes(action)) {
    return await withProcurementLock(db, String(body.request_key || crypto.randomUUID()), handle);
  }
  return await handle();
  } catch (error) {
    return Response.json({ error: String(error?.message || error), fields: error?.fields || [] }, { status: error?.status || 500 });
  }
}