// Injectable handler for the private quote-ingest path on the Purchasing page.
// No SDK, no I/O beyond the injected adapter — tests mock every call. entry.ts
// builds the real adapter and wraps the result into a Response.
//
// Security model (owner-private quote PDFs):
//  1. Owner-ID auth BEFORE any file/entity/provider read. Admin role or email is
//     not enough; bound to the two immutable auth user ids (purchasingMoneyPure).
//  2. The source PDF is uploaded client-side via UploadPrivateFile → {file_uri},
//     an opaque private storage ref. NO public URL is ever created or persisted.
//  3. The handler signs the file_uri SERVER-SIDE (CreateFileSignedUrl, short TTL)
//     only when the reader needs to fetch. The signed URL is ephemeral, held in
//     memory for the fetch + reader call, then discarded. It is NEVER persisted,
//     logged, or returned by ingest/refresh. sign_source is the ONE owner-gated
//     explicit-click action that returns a short-lived signed URL to the owner.
//  4. No arbitrary URL fetch: the only fetch is the signed URL from this app's own
//     private storage. file_uri is validated (not an http/https URL, no traversal).
//  5. Strict payload: PDF magic bytes, 30 MB size cap, exact-id job/budget, sha256
//     idempotency (request_key). Fail closed on unknown; never auto-fabricate.
//  6. The saved source is the stable private ref (source_pdf_uri). Refresh re-signs
//     the private file, never a legacy public URL.
//
// The reader (InvokeLLM) runs server-side and receives the signed URL as a
// fetchable file_urls entry. The response returns the EXACT extracted source
// fields (price_levels, dealer_subtotal, net_total, customer_sub_total,
// customer_tax, customer_total) so the viewmodel can ground windows-incl-tax
// on printed evidence — no identity guess by name, no tax asserted without proof.
import { isPurchasingMoneyOwner, isEntityId, roundMoney } from './purchasingMoneyPure.js';
import { normalizeVendorQuote } from './vendorQuoteParse.js';
import { QUOTE_SCHEMA, QUOTE_PROMPT, legacyTotals } from './vendorQuoteSchema.js';
import { autofillBudget, budgetNameFor, fileNameHints } from './jobBudgetAutofill.js';
import { computeJobBudget } from './jobBudgetMath.js';

export const MAX_PDF_BYTES = 30 * 1024 * 1024;
export const READER_TTL = 300;      // signed URL lifetime for the reader fetch (server-only)
export const REVIEW_TTL = 60;       // signed URL lifetime for the owner review link (explicit click)

class SafeError extends Error { constructor(code) { super(code); this.code = code; } }
const fail = (code) => { throw new SafeError(code); };
const safeCode = (e, fallback) => (e instanceof SafeError ? e.code : fallback);

// Private storage ref — opaque, NOT a public URL. Reject http(s)://, protocol-relative,
// javascript:/data: URLs, whitespace, path traversal and oversized strings. The final
// authority is CreateFileSignedUrl, which only signs files in THIS app's private storage.
export function validateFileUri(v) {
  if (typeof v !== 'string') return false;
  const s = v.trim();
  if (!s || s.length > 512) return false;
  if (/\s/.test(s)) return false;
  if (/^(https?:|\/\/|javascript:|data:|file:)/i.test(s)) return false;
  if (s.includes('..')) return false;
  return true;
}

export function validateIngestBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'invalid_body' };
  const allowed = new Set(['action', 'file_uri', 'file_name', 'job_id', 'request_key']);
  for (const k of Object.keys(body)) if (!allowed.has(k)) return { error: 'unexpected_field', field: k };
  if (!validateFileUri(body.file_uri)) return { error: 'invalid_file_uri' };
  if (body.file_name != null && (typeof body.file_name !== 'string' || body.file_name.length > 256)) return { error: 'invalid_file_name' };
  if (body.request_key != null && (typeof body.request_key !== 'string' || body.request_key.length > 128)) return { error: 'invalid_request_key' };
  if (body.job_id != null && !isEntityId(String(body.job_id).trim())) return { error: 'invalid_job_id' };
  return { ok: true, file_uri: body.file_uri.trim(), file_name: body.file_name || '', job_id: body.job_id || null, request_key: body.request_key || '' };
}

export function validateRefreshBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'invalid_body' };
  const allowed = new Set(['action', 'budget_id', 'expected_version', 'review_confirmed']);
  for (const k of Object.keys(body)) if (!allowed.has(k)) return { error: 'unexpected_field', field: k };
  if (!isEntityId(String(body.budget_id || '').trim())) return { error: 'invalid_budget_id' };
  return { ok: true, budget_id: body.budget_id.trim(), expected_version: body.expected_version || null, review_confirmed: body.review_confirmed === true };
}

// Stream the signed URL with a hard size cap. Returns bytes + sha256, or throws.
async function fetchPdfBytes(adapter, signedUrl) {
  const res = await adapter.fetchBytes(signedUrl, MAX_PDF_BYTES + 1024);
  if (!res || !(res.bytes instanceof Uint8Array) || !res.size) fail('pdf_fetch_failed');
  if (res.size > MAX_PDF_BYTES) fail('pdf_too_large');
  const head = new TextDecoder().decode(res.bytes.subarray(0, 5));
  if (head !== '%PDF-') fail('not_a_pdf');
  return { bytes: res.bytes, size: res.size, sha256: res.sha256 || await adapter.sha256(res.bytes) };
}

// Idempotency: a request_key already used for the same source is a replay (return existing);
// the same key for a different source is a conflict. A duplicate sha256 (+ same job) is
// already saved. Never auto-fabricate; surface the existing record for the owner to open.
async function idempotencyCheck(adapter, { request_key, sha256, job_id }) {
  if (request_key) {
    const page = await adapter.budgetFilter({ request_key }, '-created_date', 2);
    const items = page?.items || [];
    if (items.length > 1) fail('request_key_ambiguous');
    if (items.length === 1) {
      const prior = items[0];
      if (prior.source_sha256 !== sha256) fail('request_key_conflict');
      if (job_id && prior.job_id && prior.job_id !== job_id) fail('request_key_conflict');
      return { replay: prior };
    }
  }
  const dupPage = await adapter.budgetFilter({ source_sha256: sha256 }, '-created_date', 2);
  const dup = (dupPage?.items || []).find((b) => String(b.job_id || '') === String(job_id || ''));
  if (dup?.deleted_at) fail('duplicate_deleted');
  if (dup) return { replay: dup };
  return { replay: null };
}

async function readQuote(adapter, signedUrl) {
  const raw = await adapter.invokeReader(signedUrl);
  if (!raw || typeof raw !== 'object') fail('reader_failed');
  return legacyTotals(normalizeVendorQuote(raw));
}

function budgetTitle(quote, jobName, fileName) {
  const name = quote.quote_name || jobName || cleanName((fileName || 'quote').replace(/\.pdf$/i, ''), 'Unnamed Job');
  const vendor = quote.manufacturer || quote.vendor || 'vendor';
  const num = quote.quote_number ? ' ' + quote.quote_number : '';
  return `${name} (${vendor}${num})`;
}
const cleanName = (s, fb) => String(s || '').replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || fb;

async function ingest(adapter, parsed, user) {
  const { file_uri, file_name, job_id, request_key } = parsed;

  // Forced job: validate exact id, not merged/sample, BEFORE signing.
  let forcedJob = null;
  if (job_id) {
    forcedJob = await adapter.jobsGet(job_id).catch(() => null);
    if (!forcedJob) fail('job_not_found');
    if (forcedJob.id !== job_id) fail('job_mismatch');
    if (forcedJob.merged_into) fail('job_merged');
    if (forcedJob.is_sample) fail('sample_job');
  }

  // Sign server-side (short TTL). The signed URL lives only in this scope.
  const { signed_url } = await adapter.signUrl(file_uri, READER_TTL);
  if (!signed_url) fail('sign_failed');

  const { bytes, sha256 } = await fetchPdfBytes(adapter, signed_url);

  const { replay } = await idempotencyCheck(adapter, { request_key, sha256, job_id });
  if (replay) return { status: replay.status, budget_id: replay.id, title: replay.title, duplicate: true, file_uri };

  const quote = await readQuote(adapter, signed_url);
  const hints = fileNameHints(file_name);
  const name = budgetNameFor(quote, hints);
  if (name) quote.quote_name = name;
  const fill = autofillBudget(quote, { fileName: file_name });
  if (!fill.inputs.material_true_cost && !fill.inputs.actual_total_sell) fill.notes.push('No cost or sell totals were extracted. Source saved as a draft; enter the missing numbers.');
  const budget = computeJobBudget(fill.inputs);
  const jobName = forcedJob ? (forcedJob.canonical_name || forcedJob.name || '') : (quote.quote_name || cleanName(file_name.replace(/\.pdf$/i, ''), 'Unnamed Job'));
  const title = budgetTitle(quote, jobName, file_name);

  const record = await adapter.budgetCreate({
    title, budget_usage: 'draft', status: forcedJob ? 'filed' : 'needs_review',
    source_pdf_uri: file_uri, source_pdf_name: file_name || undefined,
    source_sha256: sha256, request_key: request_key || undefined,
    job_id: forcedJob ? forcedJob.id : undefined, job_name: jobName || undefined,
    builder: forcedJob?.builder || quote.builder || quote.bill_to || undefined,
    manufacturer: quote.manufacturer || undefined, vendor: quote.vendor || undefined,
    quote_number: quote.quote_number || undefined, quote_name: quote.quote_name || undefined,
    quoted_by: quote.quoted_by || undefined, openings_qty: quote.openings_qty || undefined,
    quote, inputs: fill.inputs, computed: budget,
    autofill: { sources: fill.sources, notes: fill.notes, filled: fill.filled, at: new Date().toISOString() },
    glass_eta_status: 'waiting', created_by_email: user.email,
  });
  if (!record || !isEntityId(record.id)) fail('create_unverified');

  // Return EXACT source fields; never the signed URL or any public link.
  return {
    status: record.status, budget_id: record.id, title,
    quote, inputs: fill.inputs, computed: budget, notes: fill.notes, file_uri,
    next_step: 'Review the numbers, then include this scope in the job budget. No purchase or invoice was created.',
  };
}

async function refresh(adapter, parsed, user) {
  const { budget_id, expected_version, review_confirmed } = parsed;
  if (!review_confirmed) fail('confirm_refresh_required');
  const record = await adapter.budgetGet(budget_id).catch(() => null);
  if (!record) fail('budget_not_found');
  if (record.id !== budget_id) fail('budget_mismatch');
  if (expected_version && record.updated_date && record.updated_date !== expected_version) fail('budget_changed');
  if (!validateFileUri(record.source_pdf_uri)) fail('no_private_source');

  const { signed_url } = await adapter.signUrl(record.source_pdf_uri, READER_TTL);
  if (!signed_url) fail('sign_failed');
  const { sha256 } = await fetchPdfBytes(adapter, signed_url);
  if (record.source_sha256 && record.source_sha256 !== sha256) fail('source_changed');

  const quote = await readQuote(adapter, signed_url);
  const hints = fileNameHints(record.source_pdf_name);
  const name = budgetNameFor(quote, hints);
  if (name) quote.quote_name = name;
  const fill = autofillBudget(quote, { fileName: record.source_pdf_name });
  const budget = computeJobBudget(fill.inputs);
  const patch = {
    inputs: fill.inputs, computed: budget, quote,
    autofill: { sources: fill.sources, notes: fill.notes, filled: fill.filled, at: new Date().toISOString() },
    openings_qty: quote.openings_qty || record.openings_qty || undefined,
    quote_number: quote.quote_number || record.quote_number || undefined,
  };
  const updated = await adapter.budgetUpdate(budget_id, patch);
  if (!updated || updated.id !== budget_id) fail('update_unverified');
  return { status: 'ok', budget_id, quote, inputs: fill.inputs, computed: budget, notes: fill.notes, file_uri: record.source_pdf_uri };
}

async function signSource(adapter, parsed) {
  const { budget_id } = parsed;
  const record = await adapter.budgetGet(budget_id).catch(() => null);
  if (!record) fail('budget_not_found');
  if (record.id !== budget_id) fail('budget_mismatch');
  if (!validateFileUri(record.source_pdf_uri)) fail('no_private_source');
  const { signed_url } = await adapter.signUrl(record.source_pdf_uri, REVIEW_TTL);
  if (!signed_url) fail('sign_failed');
  return { signed_url, expires_in: REVIEW_TTL };
}

export async function handle(req, adapter) {
  // 1. Owner-ID auth BEFORE any file/entity/provider read.
  const user = await adapter.authMe().catch(() => null);
  if (!isPurchasingMoneyOwner(user)) return { status: 403, body: { error: 'forbidden' } };

  const body = await req.json().catch(() => null);
  const action = body?.action;

  if (action === 'ingest') {
    const parsed = validateIngestBody(body);
    if (!parsed.ok) return { status: 400, body: { error: parsed.error } };
    try {
      return { status: 200, body: await ingest(adapter, parsed, user) };
    } catch (e) {
      return { status: 500, body: { error: safeCode(e, 'ingest_failed') } };
    }
  }

  if (action === 'refresh') {
    const parsed = validateRefreshBody(body);
    if (!parsed.ok) return { status: 400, body: { error: parsed.error } };
    try {
      return { status: 200, body: await refresh(adapter, parsed, user) };
    } catch (e) {
      return { status: 500, body: { error: safeCode(e, 'refresh_failed') } };
    }
  }

  if (action === 'sign_source') {
    const parsed = validateRefreshBody(body);
    if (!parsed.ok) return { status: 400, body: { error: parsed.error } };
    try {
      return { status: 200, body: await signSource(adapter, parsed) };
    } catch (e) {
      return { status: 500, body: { error: safeCode(e, 'sign_failed') } };
    }
  }

  return { status: 400, body: { error: 'unknown_action' } };
}

export { QUOTE_SCHEMA, QUOTE_PROMPT, roundMoney };