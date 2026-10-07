// Injectable handler for the private quote-ingest path on the Purchasing page.
// No SDK, no I/O beyond the injected adapter; tests mock every call.
//
// Ownership (grounded on the SDK contract): UploadPrivateFileResult is only
// { file_uri } (no uploader metadata) and CreateFileSignedUrl signs ANY app private
// file. A caller-supplied file_uri therefore cannot be proven to belong to the
// caller, whatever its prefix. So this endpoint NEVER accepts or signs a
// caller-supplied ref. The owner sends the PDF bytes; after owner-id auth the
// server uploads them itself and records a server-only QuoteSourceReceipt
// (rls all false) binding file_uri ↔ owner id ↔ own sha256 ↔ job ↔ budget.
// Refresh and sign_source sign only the receipt's ref for that exact budget;
// the admin-mutable JobBudgets.source_pdf_uri / source_pdf_url are never read
// for signing and the private ref is never written to the budget or returned.
//
// Signed URLs live in memory for one fetch + one reader call. Every reader
// result, stored record and response passes scrubSigned (exact signed URL, its
// query-less base, and any credential-bearing URL). Errors are fixed codes.
// Refresh is a read-only staged preview: it never writes quote or owner inputs.
import { OWNER_IDS, isPurchasingMoneyOwner, isEntityId } from './purchasingMoneyPure.js';
import { readPage, SafeError } from './purchasingMoneyHandle.js';
import { normalizeVendorQuote } from './vendorQuoteParse.js';
import { QUOTE_SCHEMA, QUOTE_PROMPT, legacyTotals } from './vendorQuoteSchema.js';
import { autofillBudget, budgetNameFor, fileNameHints } from './jobBudgetAutofill.js';
import { computeJobBudget } from './jobBudgetMath.js';

export { QUOTE_SCHEMA, QUOTE_PROMPT };
// Same proven body ceiling the app already uses for base64 uploads (salesTrackerImport, 7,000,000 chars).
export const MAX_PDF_BYTES = 5 * 1024 * 1024;
export const MAX_BASE64_CHARS = 7000000;
export const READER_TTL = 300;
export const REVIEW_TTL = 60;
export const ALLOWED_PDF_TYPES = new Set(['', 'application/pdf', 'application/octet-stream']);

const fail = (code) => { throw new SafeError(code); };
const safeCode = (e, fallback) => (e instanceof SafeError ? e.code : fallback);
const jobKey = (v) => String(v || '');
const SHA_HEX = /^[a-f0-9]{64}$/;

// Sanity only (NOT a security boundary — the receipt is): refuse refs that look
// like URLs, carry query/fragment, whitespace, or raw/encoded traversal.
export function validStoredUri(v) {
  return typeof v === 'string' && v.length > 0 && v.length <= 1500 && !/\s|\?|#|\\/.test(v) &&
    !v.includes('..') && !/%2e|%2f|%5c|%00/i.test(v) && !/^[a-z][a-z0-9+.-]*:\/\//i.test(v);
}

const SIGNED_LIKE = /https?:\/\/[^\s"'<>]*[?&](sig|signature|token|x-amz-[a-z-]+|expires|se|sp|sv|st|key|policy|key-pair-id)=/i;
export function scrubSigned(value, secrets = [], depth = 0) {
  if (depth > 25) return null;
  if (typeof value === 'string') {
    return secrets.some((s) => s && value.includes(s)) || SIGNED_LIKE.test(value) ? '[redacted]' : value;
  }
  if (Array.isArray(value)) return value.map((v) => scrubSigned(v, secrets, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, scrubSigned(v, secrets, depth + 1)]));
  }
  return value;
}
export const secretsOf = (signed) => {
  const s = String(signed || '');
  const base = s.split('?')[0];
  return [s, base.length >= 16 ? base : ''].filter(Boolean);
};

export async function sha256Hex(bytes) {
  const d = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0')).join('');
}

const isPdf = (bytes) => bytes.length >= 5 && new TextDecoder().decode(bytes.subarray(0, 5)) === '%PDF-';

export function validateIngestBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'invalid_body' };
  const allowed = new Set(['action', 'file_name', 'file_type', 'file_base64', 'job_id', 'request_key']);
  for (const k of Object.keys(body)) if (!allowed.has(k)) return { error: 'unexpected_field' };
  const name = typeof body.file_name === 'string' ? body.file_name.trim() : '';
  if (!name || name.length > 256 || !/\.pdf$/i.test(name) || /[\\/]|\.\./.test(name)) return { error: 'invalid_file_name' };
  if (body.file_type != null && !ALLOWED_PDF_TYPES.has(String(body.file_type).toLowerCase())) return { error: 'unsupported_mime' };
  const b64 = body.file_base64;
  if (typeof b64 !== 'string' || !b64 || b64.length > MAX_BASE64_CHARS || b64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(b64)) return { error: 'invalid_file' };
  if (typeof body.request_key !== 'string' || !/^[A-Za-z0-9-]{8,128}$/.test(body.request_key)) return { error: 'invalid_request_key' };
  if (body.job_id != null && !isEntityId(body.job_id)) return { error: 'invalid_job_id' };
  let bytes;
  try { bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)); } catch { return { error: 'invalid_file' }; }
  if (!bytes.length) return { error: 'invalid_file' };
  if (bytes.length > MAX_PDF_BYTES) return { error: 'pdf_too_large' };
  if (!isPdf(bytes)) return { error: 'not_a_pdf' };
  return { ok: true, bytes, file_name: name, job_id: body.job_id || null, request_key: body.request_key };
}

export function validateBudgetBody(body, { refresh = false } = {}) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'invalid_body' };
  const allowed = new Set(refresh ? ['action', 'budget_id', 'expected_version', 'review_confirmed'] : ['action', 'budget_id']);
  for (const k of Object.keys(body)) if (!allowed.has(k)) return { error: 'unexpected_field' };
  if (!isEntityId(body.budget_id)) return { error: 'invalid_budget_id' };
  if (refresh) {
    if (typeof body.expected_version !== 'string' || !body.expected_version) return { error: 'expected_version_required' };
    if (body.review_confirmed !== true) return { error: 'confirm_refresh_required' };
  }
  return { ok: true, budget_id: body.budget_id, expected_version: body.expected_version || null };
}

// Strict SDK page contract: complete page, no truncation, exact ids, bounded.
async function rows(fn, query, limit) {
  const { items, next } = readPage(await fn(query, { sort: '-created_date', limit }), limit);
  if (next) fail('lookup_ambiguous');
  for (const r of items) if (!r || !isEntityId(r.id)) fail('lookup_invalid');
  return items;
}

async function fetchVerified(adapter, signedUrl, expectedSha) {
  const res = await adapter.fetchBytes(signedUrl, MAX_PDF_BYTES).catch(() => null);
  if (!res || res.error) fail(res?.error === 'pdf_too_large' ? 'pdf_too_large' : 'pdf_fetch_failed');
  if (!(res.bytes instanceof Uint8Array) || !res.bytes.length || res.bytes.length > MAX_PDF_BYTES) fail('pdf_fetch_failed');
  if (!ALLOWED_PDF_TYPES.has(String(res.contentType || '').split(';')[0].trim().toLowerCase())) fail('unsupported_mime');
  if (!isPdf(res.bytes)) fail('not_a_pdf');
  if (await sha256Hex(res.bytes) !== expectedSha) fail('source_changed');
}

async function signFor(adapter, uri, ttl) {
  const r = await adapter.signUrl(uri, ttl).catch(() => null);
  if (typeof r?.signed_url !== 'string' || !/^https:\/\//.test(r.signed_url)) fail('sign_failed');
  return r.signed_url;
}

async function readQuote(adapter, signedUrl) {
  const raw = await adapter.invokeReader(signedUrl).catch(() => null);
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) fail('reader_failed');
  return scrubSigned(legacyTotals(normalizeVendorQuote(scrubSigned(raw, secretsOf(signedUrl)))), secretsOf(signedUrl));
}

const summary = (b) => ({ status: b.status, budget_id: b.id, title: b.title });
const validReceipt = (r) => r && isEntityId(r.id) && OWNER_IDS.has(r.owner_user_id) && SHA_HEX.test(r.sha256 || '') && validStoredUri(r.file_uri);

async function bindReceipt(adapter, receipt, budgetId) {
  const r = await adapter.receiptUpdate(receipt.id, { budget_id: budgetId }).catch(() => null);
  if (!r || r.id !== receipt.id || r.budget_id !== budgetId) fail('receipt_bind_failed');
}

async function budgetByKey(adapter, p, sha) {
  const found = await rows(adapter.budgetFilter, { request_key: p.request_key }, 2);
  if (found.length > 1) fail('request_key_ambiguous');
  const b = found[0];
  if (b && (b.source_sha256 !== sha || jobKey(b.job_id) !== jobKey(p.job_id))) fail('request_key_conflict');
  return b || null;
}

async function ingest(adapter, p, user) {
  let job = null;
  if (p.job_id) {
    job = await adapter.jobsGet(p.job_id).catch(() => null);
    if (!job || job.id !== p.job_id) fail('job_not_found');
    if (job.merged_into) fail('job_merged');
    if (job.is_sample) fail('sample_job');
  }
  const sha = await sha256Hex(p.bytes);

  // Idempotency on the client-stable key. Same key + different bytes or job
  // (including an earlier unlinked/null job) always conflicts.
  const keyed = await rows(adapter.receiptFilter, { request_key: p.request_key }, 2);
  if (keyed.length > 1) fail('request_key_ambiguous');
  let receipt = keyed[0] || null;
  if (receipt) {
    if (!validReceipt(receipt) || receipt.sha256 !== sha || jobKey(receipt.job_id) !== jobKey(p.job_id)) fail('request_key_conflict');
    if (receipt.budget_id) {
      const b = await adapter.budgetGet(receipt.budget_id).catch(() => null);
      if (!b || b.id !== receipt.budget_id) fail('receipt_budget_missing');
      if (b.deleted_at) fail('receipt_budget_missing');
      if (b.source_sha256 !== receipt.sha256) fail('source_binding_mismatch');
      if (jobKey(b.job_id) !== jobKey(receipt.job_id)) fail('source_job_mismatch');
      return { ...summary(b), duplicate: true };
    }
    const prior = await budgetByKey(adapter, p, sha);
    if (prior) { await bindReceipt(adapter, receipt, prior.id); return { ...summary(prior), duplicate: true }; }
  } else {
    const same = (await rows(adapter.receiptFilter, { sha256: sha }, 50)).filter((r) => jobKey(r.job_id) === jobKey(p.job_id) && r.budget_id);
    if (same.length) {
      if (!validReceipt(same[0])) fail('source_binding_invalid');
      const b = await adapter.budgetGet(same[0].budget_id).catch(() => null);
      if (!b || b.id !== same[0].budget_id) fail('receipt_budget_missing');
      if (b.deleted_at) fail('duplicate_deleted');
      if (b.source_sha256 !== sha) fail('source_binding_mismatch');
      if (jobKey(b.job_id) !== jobKey(p.job_id)) fail('source_job_mismatch');
      return { ...summary(b), duplicate: true };
    }
    const up = await adapter.uploadPrivate(p.bytes, p.file_name).catch(() => null);
    if (!validStoredUri(up?.file_uri)) fail('upload_failed');
    try {
      receipt = await adapter.receiptCreate({
        file_uri: up.file_uri, owner_user_id: user.id, sha256: sha, size: p.bytes.length, file_name: p.file_name,
        request_key: p.request_key, job_id: p.job_id || '', budget_id: '', uploaded_at: new Date().toISOString(),
      });
    } catch {
      // Unknown outcome: one lookup by key before reporting. If the create
      // landed, use it (no re-upload); otherwise report unknown so the client
      // retries. A retry re-uploads and can orphan the first upload — a
      // documented race; no duplicate budget is ever created from it.
      const landed = await rows(adapter.receiptFilter, { request_key: p.request_key }, 2).catch(() => null);
      if (!landed || landed.length !== 1) fail('receipt_outcome_unknown');
      receipt = landed[0];
    }
    if (!validReceipt(receipt) || receipt.file_uri !== up.file_uri || receipt.sha256 !== sha || receipt.owner_user_id !== user.id) fail('receipt_unverified');
  }

  const signed = await signFor(adapter, receipt.file_uri, READER_TTL);
  await fetchVerified(adapter, signed, receipt.sha256);
  const quote = await readQuote(adapter, signed);
  const name = budgetNameFor(quote, fileNameHints(p.file_name));
  if (name) quote.quote_name = name;
  const fill = autofillBudget(quote, { fileName: p.file_name });
  const computed = computeJobBudget(fill.inputs);
  const jobName = job ? (job.canonical_name || '') : (quote.quote_name || p.file_name.replace(/\.pdf$/i, ''));
  const title = `${quote.quote_name || jobName} (${quote.manufacturer || quote.vendor || 'vendor'}${quote.quote_number ? ' ' + quote.quote_number : ''})`;
  const data = scrubSigned({
    title, budget_usage: 'draft', numbers_reviewed_at: '', status: job ? 'filed' : 'needs_review',
    source_pdf_name: p.file_name, source_sha256: sha, request_key: p.request_key,
    job_id: job ? job.id : undefined, job_name: jobName || undefined,
    builder: job?.builder || quote.builder || undefined, manufacturer: quote.manufacturer || undefined,
    vendor: quote.vendor || undefined, quote_number: quote.quote_number || undefined,
    quote_name: quote.quote_name || undefined, quoted_by: quote.quoted_by || undefined,
    openings_qty: quote.openings_qty || undefined, quote, inputs: fill.inputs, computed,
    autofill: { sources: fill.sources, notes: fill.notes, filled: fill.filled, at: new Date().toISOString() },
    created_by_email: user.email,
  }, secretsOf(signed));

  let budget;
  try {
    budget = await adapter.budgetCreate(data);
  } catch {
    // Unknown outcome: one lookup by key, never a second create.
    const saved = await budgetByKey(adapter, p, sha).catch(() => null);
    if (!saved) fail('create_outcome_unknown');
    await bindReceipt(adapter, receipt, saved.id);
    return { ...summary(saved), recovered: true };
  }
  if (!budget || !isEntityId(budget.id) || budget.source_sha256 !== sha) fail('create_unverified');
  await bindReceipt(adapter, receipt, budget.id);
  return { ...summary(budget), quote, inputs: fill.inputs, computed, notes: fill.notes };
}

// Fresh exact-id GET + the server-only receipt bound to that budget.
async function loadBound(adapter, budgetId) {
  const budget = await adapter.budgetGet(budgetId).catch(() => null);
  if (!budget || budget.id !== budgetId) fail('budget_not_found');
  if (budget.deleted_at) fail('budget_deleted');
  const bound = await rows(adapter.receiptFilter, { budget_id: budgetId }, 2);
  if (bound.length !== 1) fail(bound.length ? 'source_binding_ambiguous' : 'no_private_source');
  const receipt = bound[0];
  if (!validReceipt(receipt) || receipt.budget_id !== budgetId) fail('source_binding_invalid');
  if (receipt.sha256 !== budget.source_sha256) fail('source_binding_mismatch');
  if (receipt.job_id && receipt.job_id !== budget.job_id) fail('source_job_mismatch');
  return { budget, receipt };
}

const QUOTE_FIELDS = ['price_levels', 'vendor', 'manufacturer', 'bill_to', 'quote_number', 'net_total', 'dealer_subtotal', 'customer_sub_total', 'customer_tax', 'customer_total'];
const pickQuote = (q) => Object.fromEntries(QUOTE_FIELDS.map((k) => [k, q?.[k] ?? null]).concat([['line_count', Array.isArray(q?.lines) ? q.lines.length : 0]]));

async function refresh(adapter, p) {
  const { budget, receipt } = await loadBound(adapter, p.budget_id);
  if (budget.updated_date !== p.expected_version) fail('budget_changed');
  const signed = await signFor(adapter, receipt.file_uri, READER_TTL);
  await fetchVerified(adapter, signed, receipt.sha256);
  const quote = await readQuote(adapter, signed);
  // Staged only: nothing is written. Owner inputs and the saved quote are untouched.
  return { status: 'staged', budget_id: budget.id, expected_version: budget.updated_date, saved: pickQuote(budget.quote), staged: pickQuote(quote), writes: 0 };
}

async function signSource(adapter, p) {
  const { receipt } = await loadBound(adapter, p.budget_id);
  return { signed_url: await signFor(adapter, receipt.file_uri, REVIEW_TTL), expires_in: REVIEW_TTL };
}

export async function handle(req, adapter) {
  const user = await adapter.authMe().catch(() => null);
  if (!isPurchasingMoneyOwner(user)) return { status: 403, body: { error: 'forbidden' } };
  const body = await req.json().catch(() => null);
  const run = async (parsed, fn, fallback, scrub = true) => {
    if (!parsed.ok) return { status: 400, body: { error: parsed.error } };
    try { const out = await fn(parsed); return { status: 200, body: scrub ? scrubSigned(out) : out }; }
    catch (e) { const code = safeCode(e, fallback); return { status: /outcome_unknown$/.test(code) ? 503 : 500, body: { error: code } }; }
  };
  const action = body?.action;
  if (action === 'ingest') return run(validateIngestBody(body), (p) => ingest(adapter, p, user), 'ingest_failed');
  if (action === 'refresh') return run(validateBudgetBody(body, { refresh: true }), (p) => refresh(adapter, p), 'refresh_failed');
  // The explicit owner click is the only response that carries a (60s) signed URL.
  if (action === 'sign_source') return run(validateBudgetBody(body), (p) => signSource(adapter, p), 'sign_failed', false);
  return { status: 400, body: { error: 'unknown_action' } };
}