// Mocked tests for the private quote-ingest handler. No SDK, no uploads, no
// provider calls, no record writes: every adapter method is an in-memory mock.
import test from 'node:test';
import assert from 'node:assert/strict';
import { handle, scrubSigned, validStoredUri, sha256Hex, REVIEW_TTL } from '../base44/shared/purchasingQuoteIngestHandle.js';

const OWNER = { id: '6a7f0d834a5f825c724273ea', email: 'o@x.com' };
const OTHER_ADMIN = { id: 'aaaaaaaaaaaaaaaaaaaaaaaa', role: 'admin', email: 'a@x.com' };
const JOB = 'b'.repeat(24), JOB2 = 'c'.repeat(24), BUDGET = 'd'.repeat(24), RECEIPT = 'e'.repeat(24);
const SIGNED = 'https://storage.example.com/private/app/quote.pdf?X-Amz-Signature=abc&Expires=99';
const URI = 'private/app/quote-1.pdf';
const PDF = new TextEncoder().encode('%PDF-1.7 test quote');
const B64 = Buffer.from(PDF).toString('base64');
const KEY = 'key-12345678';
const page = (items) => ({ items, next_cursor: null, has_more: false });
const req = (body) => ({ json: async () => body });
const ingestBody = (over = {}) => ({ action: 'ingest', file_name: 'q.pdf', file_type: 'application/pdf', file_base64: B64, request_key: KEY, job_id: JOB, ...over });

function mock(over = {}) {
  const calls = [];
  const log = (name, fn) => async (...a) => { calls.push(name); return fn(...a); };
  const store = { receipts: [], budgets: [] };
  const base = {
    authMe: async () => OWNER,
    jobsGet: async (id) => ({ id, canonical_name: 'Job A' }),
    budgetGet: async (id) => store.budgets.find((b) => b.id === id) || null,
    budgetCreate: async (d) => { const b = { ...d, id: BUDGET, updated_date: 'v1' }; store.budgets.push(b); return b; },
    budgetFilter: async () => page([]),
    receiptFilter: async () => page([]),
    receiptCreate: async (d) => { const r = { ...d, id: RECEIPT }; store.receipts.push(r); return r; },
    receiptUpdate: async (id, p) => ({ ...store.receipts.find((r) => r.id === id), ...p }),
    uploadPrivate: async () => ({ file_uri: URI }),
    signUrl: async () => ({ signed_url: SIGNED }),
    fetchBytes: async () => ({ bytes: PDF, contentType: 'application/pdf' }),
    invokeReader: async () => ({ vendor: 'AMSCO', quote_number: 'Q1', notes: `see ${SIGNED}`, raw_source: { link: SIGNED.split('?')[0], other: 'https://cdn.x.com/f?sig=zzz' } }),
    budgetUpdate: async (id, p) => { const b = store.budgets.find((x) => x.id === id); Object.assign(b, p); return { ...b }; },
  };
  const merged = { ...base, ...over };
  const adapter = Object.fromEntries(Object.entries(merged).map(([k, fn]) => [k, log(k, fn)]));
  return { adapter, calls, store };
}
const noLeak = (v) => { const s = JSON.stringify(v); assert.ok(!s.includes(SIGNED) && !s.includes(SIGNED.split('?')[0]) && !s.includes('sig=zzz') && !s.includes(URI), s.slice(0, 300)); };

test('auth: non-owner admin and auth failure → 403 before any other call', async () => {
  for (const authMe of [async () => OTHER_ADMIN, async () => null, async () => { throw new Error('x'); }]) {
    const { adapter, calls } = mock({ authMe });
    const r = await handle(req(ingestBody()), adapter);
    assert.equal(r.status, 403);
    assert.deepEqual(calls, ['authMe']);
  }
});

test('payload: no caller file refs/URLs (SSRF), strict keys, name/mime/base64/magic/size/key/job checks → 400 with no reads', async () => {
  const bad = [
    { file_uri: URI }, { url: 'https://evil/x.pdf' }, { file_name: 'q.exe' }, { file_name: '../q.pdf' }, { file_type: 'text/html' },
    { file_base64: 'not base64!' }, { file_base64: Buffer.from('hello').toString('base64') }, { file_base64: 'A'.repeat(7000004) },
    { request_key: 'short' }, { request_key: undefined }, { job_id: 'Job A' },
  ];
  for (const over of bad) {
    const { adapter, calls } = mock();
    const r = await handle(req(ingestBody(over)), adapter);
    assert.equal(r.status, 400, JSON.stringify(Object.keys(over)));
    assert.deepEqual(calls, ['authMe']);
  }
});

test('ingest: server uploads, binds owner receipt with own sha, stores no ref/signed URL anywhere', async () => {
  const { adapter, calls, store } = mock();
  const r = await handle(req(ingestBody()), adapter);
  assert.equal(r.status, 200);
  assert.equal(calls.filter((c) => c === 'uploadPrivate').length, 1);
  const rec = store.receipts[0];
  assert.equal(rec.owner_user_id, OWNER.id);
  assert.equal(rec.sha256, await sha256Hex(PDF));
  assert.equal(rec.file_uri, URI);
  assert.equal(store.budgets[0].source_pdf_uri, undefined);
  assert.equal(store.budgets[0].source_pdf_url, undefined);
  noLeak(store.budgets[0]);
  noLeak(r.body);
});

test('idempotency: same key + same bytes + same job replays without upload', async () => {
  const sha = await sha256Hex(PDF);
  const { adapter, calls } = mock({
    receiptFilter: async () => page([{ id: RECEIPT, owner_user_id: OWNER.id, sha256: sha, file_uri: URI, job_id: JOB, budget_id: BUDGET }]),
    budgetGet: async () => ({ id: BUDGET, title: 'T', status: 'filed', source_sha256: sha, job_id: JOB }),
  });
  const r = await handle(req(ingestBody()), adapter);
  assert.equal(r.body.duplicate, true);
  assert.ok(!calls.includes('uploadPrivate') && !calls.includes('signUrl'));
});

test('idempotency: same key + same sha but different job (incl prior null) → conflict, no upload', async () => {
  const sha = await sha256Hex(PDF);
  for (const [prior, now] of [[JOB2, JOB], ['', JOB], [JOB, undefined]]) {
    const { adapter, calls } = mock({ receiptFilter: async () => page([{ id: RECEIPT, owner_user_id: OWNER.id, sha256: sha, file_uri: URI, job_id: prior, budget_id: BUDGET }]) });
    const r = await handle(req(ingestBody({ job_id: now })), adapter);
    assert.equal(r.body.error, 'request_key_conflict');
    assert.ok(!calls.includes('uploadPrivate'));
  }
});

test('page contract: truncated / clipped cursor / over-limit / bad ids fail closed before upload', async () => {
  const pages = [
    { items: [], has_more: true, next_cursor: null }, { items: [], has_more: false, next_cursor: null, truncated: true },
    { items: [{ id: RECEIPT }, { id: 'f'.repeat(24) }, { id: 'a'.repeat(24) }], has_more: false, next_cursor: null },
    page([{ id: 'nope' }]), [], null,
  ];
  for (const p of pages) {
    const { adapter, calls } = mock({ receiptFilter: async () => p });
    const r = await handle(req(ingestBody()), adapter);
    assert.equal(r.status, 500);
    assert.ok(!calls.includes('uploadPrivate'));
  }
  const { adapter } = mock({ receiptFilter: async () => page([{ id: RECEIPT }, { id: 'f'.repeat(24) }]) });
  assert.equal((await handle(req(ingestBody()), adapter)).body.error, 'request_key_ambiguous');
});

test('unknown create outcome: one lookup, never a second create → 503', async () => {
  let creates = 0;
  const { adapter } = mock({ budgetCreate: async () => { creates++; throw new Error('timeout'); } });
  const r = await handle(req(ingestBody()), adapter);
  assert.equal(r.status, 503);
  assert.equal(r.body.error, 'create_outcome_unknown');
  assert.equal(creates, 1);
});

test('unknown create outcome recovered by key binds the receipt, no duplicate', async () => {
  const sha = await sha256Hex(PDF);
  let creates = 0;
  const { adapter } = mock({
    budgetCreate: async () => { creates++; throw new Error('timeout'); },
    budgetFilter: async () => page([{ id: BUDGET, source_sha256: sha, job_id: JOB, title: 'T', status: 'filed' }]),
  });
  const r = await handle(req(ingestBody()), adapter);
  assert.equal(r.body.recovered, true);
  assert.equal(creates, 1);
});

test('receipt create failure → unknown, nothing signed', async () => {
  const { adapter, calls } = mock({ receiptCreate: async () => { throw new Error('x'); } });
  const r = await handle(req(ingestBody()), adapter);
  assert.equal(r.body.error, 'receipt_outcome_unknown');
  assert.ok(!calls.includes('signUrl'));
});

test('fetched bytes must match receipt sha, PDF magic and allowed MIME', async () => {
  for (const [fetchBytes, code] of [
    [async () => ({ bytes: new TextEncoder().encode('%PDF-other'), contentType: 'application/pdf' }), 'source_changed'],
    [async () => ({ bytes: PDF, contentType: 'text/html' }), 'unsupported_mime'],
    [async () => ({ error: 'pdf_too_large' }), 'pdf_too_large'],
  ]) {
    const { adapter } = mock({ fetchBytes });
    assert.equal((await handle(req(ingestBody()), adapter)).body.error, code);
  }
});

const boundBudget = async (over = {}) => ({ id: BUDGET, job_id: JOB, updated_date: 'v1', source_sha256: await sha256Hex(PDF), source_pdf_uri: 'private/someone-else/secret.pdf', quote: { customer_total: 1 }, inputs: { actual_total_sell: 9 }, ...over });
const boundReceipt = async (over = {}) => ({ id: RECEIPT, owner_user_id: OWNER.id, sha256: await sha256Hex(PDF), file_uri: URI, job_id: JOB, budget_id: BUDGET, ...over });

test('refresh: requires version + review flag; stale version, no receipt, mismatched binding → no signing', async () => {
  for (const over of [{ expected_version: undefined }, { review_confirmed: undefined }]) {
    const { adapter, calls } = mock();
    const r = await handle(req({ action: 'refresh', budget_id: BUDGET, expected_version: 'v1', review_confirmed: true, ...over }), adapter);
    assert.equal(r.status, 400); assert.deepEqual(calls, ['authMe']);
  }
  const cases = [
    [{ budget: { updated_date: 'v2' } }, 'budget_changed'],
    [{ receipts: [] }, 'no_private_source'],
    [{ receipt: { sha256: 'f'.repeat(64) } }, 'source_binding_mismatch'],
    [{ receipt: { job_id: JOB2 } }, 'source_job_mismatch'],
    [{ receipt: { owner_user_id: OTHER_ADMIN.id } }, 'source_binding_invalid'],
  ];
  for (const [c, code] of cases) {
    const b = await boundBudget(c.budget); const rc = await boundReceipt(c.receipt);
    const { adapter, calls } = mock({ budgetGet: async () => b, receiptFilter: async () => page(c.receipts || [rc]) });
    const r = await handle(req({ action: 'refresh', budget_id: BUDGET, expected_version: 'v1', review_confirmed: true }), adapter);
    assert.equal(r.body.error, code);
    assert.ok(!calls.includes('signUrl'));
  }
});

test('refresh: signs only the receipt ref (never budget.source_pdf_uri) and writes nothing', async () => {
  const b = await boundBudget(); const rc = await boundReceipt();
  const signed = [];
  const { adapter, calls } = mock({ budgetGet: async () => b, receiptFilter: async () => page([rc]), signUrl: async (u) => { signed.push(u); return { signed_url: SIGNED }; } });
  const r = await handle(req({ action: 'refresh', budget_id: BUDGET, expected_version: 'v1', review_confirmed: true }), adapter);
  assert.equal(r.body.status, 'staged');
  assert.equal(r.body.writes, 0);
  assert.deepEqual(signed, [URI]);
  assert.ok(!calls.some((c) => /Create|Update|upload/.test(c)));
  noLeak(r.body);
});

test('sign_source: receipt-bound only, 60s TTL; unbound/admin-repointed budget refused', async () => {
  const b = await boundBudget();
  const { adapter: a1, calls: c1 } = mock({ budgetGet: async () => b, receiptFilter: async () => page([]) });
  assert.equal((await handle(req({ action: 'sign_source', budget_id: BUDGET }), a1)).body.error, 'no_private_source');
  assert.ok(!c1.includes('signUrl'));
  const ttl = [];
  const { adapter: a2 } = mock({ budgetGet: async () => b, receiptFilter: async () => page([await boundReceipt()]), signUrl: async (u, t) => { ttl.push([u, t]); return { signed_url: SIGNED }; } });
  const r = await handle(req({ action: 'sign_source', budget_id: BUDGET }), a2);
  assert.equal(r.body.expires_in, REVIEW_TTL);
  assert.deepEqual(ttl, [[URI, 60]]);
});

test('scrubSigned redacts exact, base and credential URLs at any depth', () => {
  const out = scrubSigned({ a: [{ b: SIGNED }], c: `x ${SIGNED.split('?')[0]}`, d: 'https://h/p?token=1', e: 'ok' }, [SIGNED, SIGNED.split('?')[0]]);
  assert.deepEqual(out, { a: [{ b: '[redacted]' }], c: '[redacted]', d: '[redacted]', e: 'ok' });
});

test('validStoredUri is sanity only: rejects URLs, query, traversal (raw and encoded)', () => {
  for (const v of ['https://x/y', 'private/a?b', 'private/../x', 'private/%2e%2e/x', 'private/a b', '']) assert.equal(validStoredUri(v), false, v);
  assert.equal(validStoredUri(URI), true);
});

test('unknown action → 400', async () => {
  const { adapter } = mock();
  assert.equal((await handle(req({ action: 'nope' }), adapter)).status, 400);
});

const OWN_QUOTE = { vendor: 'BFS-UTAH DESIGN', manufacturer: 'AMSCO', quote_name: 'PHIL CHADWICK', quoted_by: 'gabrielfronk', price_levels: 'single', customer_sub_total: 1126.74, customer_tax: 83.94, customer_total: 1210.68, openings_qty: 1, lines: [{ qty: 1, kind: 'window', extended: 1126.74, description: 'Casement' }] };
const REP_QUOTE = { vendor: 'AMSCO', manufacturer: 'AMSCO', quote_name: 'HIDDEN HALLOW 509', quoted_by: 'israelyedra', price_levels: 'single', customer_sub_total: 67.03, customer_tax: 4.99, customer_total: 72.02, openings_qty: 1, lines: [{ qty: 1, kind: 'glass', extended: 67.03, description: 'Glass only' }] };
const TWO_LEVEL = { vendor: 'AMSCO', manufacturer: 'AMSCO', quote_name: 'BAXTER', quoted_by: 'israelyedra', price_levels: 'dealer_and_customer', dealer_subtotal: 2748.78, material_true_cost: 2748.78, customer_total: 7022.31, openings_qty: 4, lines: [{ qty: 3, kind: 'window', extended: 900, description: 'SH' }] };

test('sale: his own quote total lands on the budget as customer sell; nothing else is written', async () => {
  const { adapter, calls } = mock({ invokeReader: async () => OWN_QUOTE });
  const r = await handle(req(ingestBody()), adapter);
  assert.equal(r.status, 200);
  assert.equal(r.body.inputs.actual_total_sell, 1210.68);
  assert.equal(r.body.sale_autofill, undefined);
  assert.ok(!calls.some((c) => /^money/.test(c)));
});

test('sale: supplier rep single-price quote fills cost, never the sale', async () => {
  const { adapter } = mock({ invokeReader: async () => REP_QUOTE });
  const r = await handle(req(ingestBody()), adapter);
  assert.equal(r.status, 200);
  assert.equal(r.body.inputs.actual_total_sell, 0);
  assert.equal(r.body.inputs.material_true_cost, 67.03);
});

test('sale: two-price supplier quote puts the printed customer total on the budget', async () => {
  const { adapter } = mock({ invokeReader: async () => TWO_LEVEL });
  const r = await handle(req(ingestBody()), adapter);
  assert.equal(r.body.inputs.actual_total_sell, 7022.31);
});

const PUBLIC_URL = 'https://base44.app/api/apps/6a7f0d7a4a5f825c724273e9/files/mp/public/6a7f0d7a4a5f825c724273e9/22dab6efe_SANDY-AMSCO.pdf';
const oldBudget = (over = {}) => ({ id: BUDGET, job_id: JOB, source_pdf_url: PUBLIC_URL, source_pdf_name: 'SANDY-AMSCO.pdf', updated_date: 'v1', ...over });

test('privatize_source: copies the public PDF into private storage, binds a receipt, drops the public link', async () => {
  const { adapter, store } = mock();
  store.budgets.push(oldBudget());
  const r = await handle(req({ action: 'privatize_source', budget_id: BUDGET }), adapter);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body, { status: 'private', budget_id: BUDGET });
  const sha = await sha256Hex(PDF);
  assert.equal(store.receipts[0].budget_id, BUDGET);
  assert.equal(store.receipts[0].sha256, sha);
  assert.equal(store.receipts[0].job_id, JOB);
  assert.equal(store.budgets[0].source_sha256, sha);
  assert.equal(store.budgets[0].source_pdf_url, null);
  noLeak(r.body);
});

test('privatize_source: refuses anything but this app\'s public-file URL, owner only, changed bytes', async () => {
  for (const url of ['https://evil.com/x.pdf', 'https://base44.app/api/apps/x/files/mp/private/a/b.pdf', '']) {
    const { adapter, store, calls } = mock();
    store.budgets.push(oldBudget({ source_pdf_url: url }));
    const r = await handle(req({ action: 'privatize_source', budget_id: BUDGET }), adapter);
    assert.equal(r.body.error, 'no_public_source');
    assert.ok(!calls.includes('fetchBytes'));
  }
  const other = mock({ authMe: async () => OTHER_ADMIN });
  assert.equal((await handle(req({ action: 'privatize_source', budget_id: BUDGET }), other.adapter)).status, 403);
  const changed = mock();
  changed.store.budgets.push(oldBudget({ source_sha256: 'f'.repeat(64) }));
  const r = await handle(req({ action: 'privatize_source', budget_id: BUDGET }), changed.adapter);
  assert.equal(r.body.error, 'source_changed');
  assert.ok(!changed.calls.includes('uploadPrivate'));
});
