// Mocked tests for the private quote-ingest handler. No SDK, no real file
// upload, no provider calls, no production record writes. Every adapter call
// is a mock. Proves: owner-ID auth before reads, private ref persisted (no
// public URL), signed URL server-only (never in ingest/refresh response),
// sign_source owner-only short TTL, PDF/size limits, idempotency, refresh
// re-signs the private ref, no arbitrary URL fetch, exact source fields returned.
import test from 'node:test';
import assert from 'node:assert/strict';
import { handle, validateFileUri, validateIngestBody, validateRefreshBody } from '../base44/shared/purchasingQuoteIngestHandle.js';

const OWNER = { id: '6a7f0d834a5f825c724273ea', role: 'admin', email: 'gabefronk@gmail.com' };
const JOB = 'aaaaaaaaaaaaaaaaaaaaaaaa';
const BUDGET = 'bbbbbbbbbbbbbbbbbbbbbbbb';
const FILE_URI = 'private://gf-quote/abc123';
const SIGNED = 'https://signed.example/short-lived';
const PDF_BYTES = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x0a, ...Array(100).fill(0x41)]);
const SHA = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', PDF_BYTES)), (b) => b.toString(16).padStart(2, '0')).join('');
const req = (body) => ({ json: async () => body });

// A normalized single-price supplier quote (Taira-shaped): exact source fields.
const READER_QUOTE = {
  vendor: 'Nu Vista Sales', manufacturer: 'Nu Vista', quote_number: 'Q1', quote_name: 'Taira',
  price_levels: 'single', net_total: 126085.15, customer_sub_total: 126085.15, customer_tax: 5989.04, customer_total: 132074.19,
  openings_qty: 14, lines: [],
};
// A dealer+customer quote (AV24-shaped): exact source fields, dual price.
const READER_QUOTE_DUAL = {
  vendor: 'Amsco', manufacturer: 'Amsco', quote_number: '3517590', quote_name: 'AV24',
  price_levels: 'dealer_and_customer', dealer_subtotal: 869.20, customer_sub_total: 869.20, customer_tax: 64.76, customer_total: 933.96,
  openings_qty: 1, lines: [],
};

function mock(stubs = {}) {
  const calls = { signUrl: [], fetchBytes: [], invokeReader: [], budgetCreate: [], budgetGet: [], budgetUpdate: [], budgetFilter: [], jobsGet: [] };
  const rec = (k, fn) => (...a) => { calls[k].push(a); return fn(...a); };
  return {
    calls,
    authMe: () => (stubs.authMe ? stubs.authMe() : Promise.resolve(OWNER)),
    signUrl: rec('signUrl', stubs.signUrl || (() => Promise.resolve({ signed_url: SIGNED }))),
    fetchBytes: rec('fetchBytes', stubs.fetchBytes || (() => Promise.resolve({ bytes: PDF_BYTES, size: PDF_BYTES.length, sha256: SHA }))),
    invokeReader: rec('invokeReader', stubs.invokeReader || (() => Promise.resolve(stubs.readerQuote || READER_QUOTE))),
    budgetCreate: rec('budgetCreate', stubs.budgetCreate || ((d) => Promise.resolve({ id: BUDGET, ...d }))),
    budgetGet: rec('budgetGet', stubs.budgetGet || ((id) => Promise.resolve(stubs.budgetRecord || { id, source_pdf_uri: FILE_URI, source_sha256: SHA }))),
    budgetUpdate: rec('budgetUpdate', stubs.budgetUpdate || ((id, p) => Promise.resolve({ id, ...p }))),
    budgetFilter: rec('budgetFilter', stubs.budgetFilter || (() => Promise.resolve({ items: [], next_cursor: null, has_more: false }))),
    jobsGet: rec('jobsGet', stubs.jobsGet || ((id) => Promise.resolve({ id, canonical_name: 'Taira' }))),
    sha256: () => SHA,
  };
}
const noReads = (a) => Object.values(a.calls).every((c) => c.length === 0);

test('validateFileUri: rejects public URLs, traversal, whitespace; accepts opaque private ref', () => {
  assert.ok(validateFileUri(FILE_URI));
  assert.ok(!validateFileUri('https://media.base44.com/x'));
  assert.ok(!validateFileUri('http://evil.com/x'));
  assert.ok(!validateFileUri('//evil.com'));
  assert.ok(!validateFileUri('javascript:alert(1)'));
  assert.ok(!validateFileUri('data:application/pdf,x'));
  assert.ok(!validateFileUri('private/../other'));
  assert.ok(!validateFileUri('has space'));
  assert.ok(!validateFileUri(''));
  assert.ok(!validateFileUri(null));
  assert.ok(!validateFileUri('x'.repeat(600)));
});

test('auth: non-owner (wrong id / null) → 403 before any read (ingest, refresh, sign_source)', async () => {
  for (const user of [{ id: 'ffffffffffffffffffffffff', role: 'admin' }, null]) {
    for (const body of [
      { action: 'ingest', file_uri: FILE_URI, file_name: 'x.pdf' },
      { action: 'refresh', budget_id: BUDGET, review_confirmed: true },
      { action: 'sign_source', budget_id: BUDGET },
    ]) {
      const a = mock({ authMe: () => Promise.resolve(user) });
      const r = await handle(req(body), a);
      assert.equal(r.status, 403);
      assert.ok(noReads(a));
    }
  }
});

test('ingest: owner 200, persists source_pdf_uri (private ref), never source_pdf_url or signed_url', async () => {
  const a = mock();
  const r = await handle(req({ action: 'ingest', file_uri: FILE_URI, file_name: 'Taira.pdf', request_key: 'rk1' }), a);
  assert.equal(r.status, 200);
  assert.equal(a.calls.signUrl.length, 1);
  assert.deepEqual(a.calls.signUrl[0], [FILE_URI, 300]);
  assert.equal(a.calls.budgetCreate.length, 1);
  const created = a.calls.budgetCreate[0][0];
  assert.equal(created.source_pdf_uri, FILE_URI);
  assert.equal(created.source_pdf_url, undefined);
  assert.equal(created.source_sha256, SHA);
  assert.equal(created.request_key, 'rk1');
  // Response returns exact source fields; never the signed URL.
  assert.equal(r.body.signed_url, undefined);
  assert.equal(r.body.file_uri, FILE_URI);
  assert.equal(r.body.quote.price_levels, 'single');
  assert.equal(r.body.quote.net_total, 126085.15);
  assert.equal(r.body.quote.customer_tax, 5989.04);
  assert.equal(r.body.quote.customer_total, 132074.19);
});

test('ingest: AV24 dealer+customer quote returns exact dual-price source fields (no identity guess by name)', async () => {
  const a = mock({ readerQuote: READER_QUOTE_DUAL });
  const r = await handle(req({ action: 'ingest', file_uri: FILE_URI, file_name: 'AV24.pdf' }), a);
  assert.equal(r.status, 200);
  assert.equal(r.body.quote.price_levels, 'dealer_and_customer');
  assert.equal(r.body.quote.dealer_subtotal, 869.20);
  assert.equal(r.body.quote.customer_tax, 64.76);
  assert.equal(r.body.quote.customer_total, 933.96);
});

test('ingest: signed URL is server-only — fetchBytes and reader receive it, response never does', async () => {
  const a = mock();
  const r = await handle(req({ action: 'ingest', file_uri: FILE_URI, file_name: 'x.pdf' }), a);
  assert.equal(a.calls.fetchBytes[0][0], SIGNED);
  assert.equal(a.calls.invokeReader[0][0], SIGNED);
  assert.equal(r.body.signed_url, undefined);
});

test('ingest: no arbitrary URL fetch — only the signed URL from CreateFileSignedUrl is fetched', async () => {
  const a = mock();
  await handle(req({ action: 'ingest', file_uri: FILE_URI, file_name: 'x.pdf' }), a);
  assert.equal(a.calls.fetchBytes.length, 1);
  assert.equal(a.calls.fetchBytes[0][0], SIGNED);
});

test('ingest: invalid file_uri (public URL) → 400 before any read', async () => {
  const a = mock();
  const r = await handle(req({ action: 'ingest', file_uri: 'https://evil.com/x.pdf', file_name: 'x.pdf' }), a);
  assert.equal(r.status, 400);
  assert.ok(noReads(a));
});

test('ingest: not a PDF / too large / fetch fail → fail closed, no record written', async () => {
  const notPdf = new Uint8Array(Array(50).fill(0x41));
  for (const [name, stub, code] of [
    ['not a pdf', { fetchBytes: () => Promise.resolve({ bytes: notPdf, size: notPdf.length, sha256: 'x' }) }, 'not_a_pdf'],
    ['too large', { fetchBytes: () => Promise.resolve({ bytes: new Uint8Array(31 * 1024 * 1024), size: 31 * 1024 * 1024, sha256: 'x' }) }, 'pdf_too_large'],
    ['fetch failed', { fetchBytes: () => Promise.resolve(null) }, 'pdf_fetch_failed'],
  ]) {
    const a = mock(stub);
    const r = await handle(req({ action: 'ingest', file_uri: FILE_URI, file_name: 'x.pdf' }), a);
    assert.equal(r.body.error, code);
    assert.equal(a.calls.budgetCreate.length, 0);
  }
});

test('ingest: idempotent — same request_key + sha256 returns existing, no duplicate write', async () => {
  const a = mock({ budgetFilter: (q) => Promise.resolve({ items: [{ id: BUDGET, source_sha256: SHA, status: 'needs_review', title: 'Taira' }], next_cursor: null, has_more: false }) });
  const r = await handle(req({ action: 'ingest', file_uri: FILE_URI, file_name: 'Taira.pdf', request_key: 'rk1' }), a);
  assert.equal(r.status, 200);
  assert.equal(r.body.duplicate, true);
  assert.equal(r.body.budget_id, BUDGET);
  assert.equal(a.calls.budgetCreate.length, 0);
});

test('ingest: same request_key different sha256 → conflict, no write', async () => {
  const a = mock({ budgetFilter: () => Promise.resolve({ items: [{ id: BUDGET, source_sha256: 'other', status: 'needs_review' }], next_cursor: null, has_more: false }) });
  const r = await handle(req({ action: 'ingest', file_uri: FILE_URI, file_name: 'x.pdf', request_key: 'rk1' }), a);
  assert.equal(r.body.error, 'request_key_conflict');
  assert.equal(a.calls.budgetCreate.length, 0);
});

test('ingest: forced job_id validated (exact id, not merged/sample) before signing', async () => {
  for (const [name, job, code] of [
    ['not found', () => null, 'job_not_found'],
    ['merged', () => ({ id: JOB, merged_into: 'x' }), 'job_merged'],
    ['sample', () => ({ id: JOB, is_sample: true }), 'sample_job'],
  ]) {
    const a = mock({ jobsGet: () => Promise.resolve(job()) });
    const r = await handle(req({ action: 'ingest', file_uri: FILE_URI, file_name: 'x.pdf', job_id: JOB }), a);
    assert.equal(r.body.error, code);
    assert.equal(a.calls.signUrl.length, 0);
  }
});

test('refresh: re-signs the private ref (not a public URL), updates budget, never returns signed_url', async () => {
  const a = mock({ budgetRecord: { id: BUDGET, source_pdf_uri: FILE_URI, source_sha256: SHA, source_pdf_name: 'Taira.pdf' } });
  const r = await handle(req({ action: 'refresh', budget_id: BUDGET, review_confirmed: true }), a);
  assert.equal(r.status, 200);
  assert.equal(a.calls.signUrl[0][0], FILE_URI);
  assert.equal(a.calls.budgetUpdate.length, 1);
  assert.equal(r.body.signed_url, undefined);
  assert.equal(r.body.file_uri, FILE_URI);
});

test('refresh: without confirm → 400, no sign/read', async () => {
  const a = mock();
  const r = await handle(req({ action: 'refresh', budget_id: BUDGET }), a);
  assert.equal(r.status, 400);
  assert.equal(a.calls.signUrl.length, 0);
});

test('refresh: source changed (sha256 mismatch) → fail closed, no update', async () => {
  const a = mock({ budgetRecord: { id: BUDGET, source_pdf_uri: FILE_URI, source_sha256: 'different', source_pdf_name: 'x.pdf' } });
  const r = await handle(req({ action: 'refresh', budget_id: BUDGET, review_confirmed: true }), a);
  assert.equal(r.body.error, 'source_changed');
  assert.equal(a.calls.budgetUpdate.length, 0);
});

test('refresh: budget with no private source (legacy public URL only) → no_private_source', async () => {
  const a = mock({ budgetRecord: { id: BUDGET, source_pdf_uri: undefined, source_pdf_url: 'https://old.public/x.pdf', source_sha256: SHA } });
  const r = await handle(req({ action: 'refresh', budget_id: BUDGET, review_confirmed: true }), a);
  assert.equal(r.body.error, 'no_private_source');
  assert.equal(a.calls.signUrl.length, 0);
});

test('sign_source: owner-only, returns short-TTL signed URL (explicit click), 60s', async () => {
  const a = mock({ budgetRecord: { id: BUDGET, source_pdf_uri: FILE_URI, source_sha256: SHA } });
  const r = await handle(req({ action: 'sign_source', budget_id: BUDGET }), a);
  assert.equal(r.status, 200);
  assert.equal(r.body.signed_url, SIGNED);
  assert.equal(r.body.expires_in, 60);
  assert.equal(a.calls.signUrl[0], [FILE_URI, 60]);
});

test('sign_source: non-owner → 403 before any read', async () => {
  const a = mock({ authMe: () => Promise.resolve({ id: 'ffffffffffffffffffffffff', role: 'admin' }) });
  const r = await handle(req({ action: 'sign_source', budget_id: BUDGET }), a);
  assert.equal(r.status, 403);
  assert.ok(noReads(a));
});

test('raw SDK error text is never returned — generic codes only', async () => {
  const a = mock({ signUrl: () => Promise.reject(new Error('internal storage secret')) });
  const r = await handle(req({ action: 'ingest', file_uri: FILE_URI, file_name: 'x.pdf' }), a);
  assert.equal(r.status, 500);
  assert.equal(r.body.error, 'ingest_failed');
  assert.ok(!JSON.stringify(r.body).includes('internal storage secret'));
});

test('unknown action → 400, no reads', async () => {
  const a = mock();
  assert.equal((await handle(req({ action: 'nope' }), a)).status, 400);
  assert.ok(noReads(a));
});

test('no production record writes: budgetCreate is mocked and never hits the SDK', async () => {
  let created = 0;
  const a = mock({ budgetCreate: () => { created++; return Promise.resolve({ id: BUDGET }); } });
  await handle(req({ action: 'ingest', file_uri: FILE_URI, file_name: 'x.pdf' }), a);
  assert.equal(created, 1); // mock counted it, no real write
});