import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { extractJobDocuments as actualExtract, validateJobDocumentResult, JOB_DOCUMENT_SCHEMA, JOB_DOCUMENT_EXTRACTOR_REVISION } from '../shared/jobDocumentExtraction.mjs';
const now = '2026-09-13T10:00:00Z';
const pdfBytes = new TextEncoder().encode('%PDF-1.7\n1 0 obj\n<< /Type /Catalog >>\nendobj\n%%EOF\n');
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const digest = hash(pdfBytes), fixtures = new WeakMap();
const extractJobDocuments = (api, options) => actualExtract(api, { fetchImpl: fixtures.get(api).fetchImpl, ...options });
const file = (id = 'pdf1', changes = {}) => ({ id, name: id + '.pdf', status: 'verified', source_deleted: false, mime_type: 'application/pdf', file_uri: 'private/library/' + id + '.pdf', sha256: hash(changes._bytes || pdfBytes), size: (changes._bytes || pdfBytes).length, verified_at: '2026-09-12T10:00:00Z', source_project_id: 'project1', source_post_id: 'post1', ...changes });
const dateFact = (meaning = 'document_date') => ({ date_text: 'September 15, 2026', normalized_date: '2026-09-15', meaning, source_quote: 'Document date: September 15, 2026', page: 1, uncertainty: '' });
const output = (changes = {}) => ({ document_type: 'invoice', job_identifiers: [{ type: 'lot', value: '24', source_quote: 'Lot 24', page: 1 }], dated_statements: [dateFact()], summary: 'Invoice for work at lot 24.', ...changes });
function fixture(files = [file()], records = []) {
  const calls = { signed: [], fetched: [], extraction: [], created: [], updated: [], sourceWrites: 0, publicUploads: 0, privateUploads: [] };
  const blobs = new Map(files.map(f => [f.file_uri, f._bytes || pdfBytes]));
  const api = { entities: {
    FieldLibraryFile: { filter: async (query, _, size, skip) => files.filter(f => !query.status || f.status === query.status).slice(skip, skip + size), get: async id => files.find(f => f.id === id), update: async () => { calls.sourceWrites++; throw Error('Source write forbidden'); } },
    JobDocumentExtraction: { filter: async ({ extraction_key }, _, size = 5, skip = 0) => records.filter(r => !extraction_key || r.extraction_key === extraction_key).slice(skip, skip + size),
      create: async record => { const saved = { id: 'extracted-' + (records.length + 1), ...structuredClone(record) }; calls.created.push(saved); records.push(saved); return saved; },
      update: async (id, record) => { const saved = { id, ...structuredClone(record) }; calls.updated.push(saved); Object.assign(records.find(r => r.id === id), saved); return saved; } }
  }, integrations: { Core: {
    CreateFileSignedUrl: async args => { calls.signed.push(args); return { signed_url: 'https://private.example/' + encodeURIComponent(args.file_uri) + '?signature=TOP-SECRET' }; },
    ExtractDataFromUploadedFile: async args => { calls.extraction.push(args); return output(); },
    UploadFile: async () => { calls.publicUploads++; throw Error('Public upload forbidden'); },
    UploadPrivateFile: async ({ file }) => { calls.privateUploads.push(file); const uri = 'mp/private/reassembled-' + calls.privateUploads.length + '.pdf'; blobs.set(uri, new Uint8Array(await file.arrayBuffer())); return { file_uri: uri }; }
  } } };
  const fixture = { api, calls, records, blobs, fetchImpl: async (url, options) => { calls.fetched.push({ url, options }); const bytes = blobs.get(decodeURIComponent(new URL(url).pathname.slice(1))); return bytes ? new Response(bytes, { headers: { 'Content-Type': 'application/octet-stream', 'Content-Length': String(bytes.length) } }) : new Response('', { status: 404 }); } };
  fixtures.set(api, fixture);
  return fixture;
}

test('uses private signed URL and stores review-only extraction without signed credentials', async () => {
  const { api, calls } = fixture(); const result = await extractJobDocuments(api, { now });
  assert.equal(result.extracted, 1); assert.equal(result.automatic_arrival_confirmation, false);
  assert.deepEqual(calls.signed, [{ file_uri: 'private/library/pdf1.pdf', expires_in: 600 }]);
  assert.equal(calls.extraction[0].json_schema, JOB_DOCUMENT_SCHEMA);
  assert.equal(calls.created[0].status, 'extracted_needs_review'); assert.equal(calls.created[0].extraction_key, 'pdf1:' + digest);
  assert.equal(calls.created[0].result.dated_statements[0].meaning, 'document_date');
  assert.ok(!JSON.stringify([result, calls.created]).includes('TOP-SECRET'));
  assert.equal(calls.sourceWrites, 0); assert.equal(calls.publicUploads, 0);
  assert.equal(calls.fetched.length, 1); assert.equal(calls.privateUploads.length, 0);
});

test('processes at most two eligible PDFs and leaves remaining work visible', async () => {
  const { api, calls } = fixture([file('a'), file('b'), file('c')]);
  const result = await extractJobDocuments(api, { now });
  assert.equal(result.attempted, 2); assert.equal(calls.extraction.length, 2); assert.equal(result.has_more, true);
  await assert.rejects(extractJobDocuments(api, { now, maxFiles: 3 }), /At most two/);
});

test('unverified, deleted, oversized, non-PDF and non-private files never reach extraction', async () => {
  const samples = [file('unverified', { status: 'pending' }), file('deleted', { source_deleted: true }), file('large', { size: 8 * 1024 * 1024 + 1 }), file('image', { mime_type: 'image/jpeg' }), file('public', { file_uri: 'https://public.example/a.pdf' }), file('missing-digest', { sha256: '' })];
  const { api, calls } = fixture(samples); const result = await extractJobDocuments(api, { now });
  assert.equal(result.eligible, 0); assert.equal(calls.signed.length, 0); assert.equal(calls.extraction.length, 0);
});

test('successful hash-key extraction is reused and changed hash is new work', async () => {
  const previous = { id: 'prior', extraction_key: 'pdf1:' + digest, status: 'extracted_needs_review', checked_at: now };
  const first = fixture([file()], [previous]); assert.equal((await extractJobDocuments(first.api, { now })).skipped, 1);
  assert.equal(first.calls.extraction.length, 0);
  const changedBytes = new TextEncoder().encode('%PDF-1.7\nUpdated PDF source\n%%EOF\n');
  const changed = fixture([file('pdf1', { _bytes: changedBytes })], [previous]);
  assert.equal((await extractJobDocuments(changed.api, { now })).extracted, 1);
  assert.equal(changed.calls.created[0].sha256, hash(changedBytes));
});

test('failed extraction retries only after 24 hours and updates existing keyed record', async () => {
  const recent = { id: 'failure', extraction_key: 'pdf1:' + digest, status: 'failed', checked_at: '2026-09-12T10:00:01Z', attempts: 1, extractor_revision: JOB_DOCUMENT_EXTRACTOR_REVISION };
  const first = fixture([file()], [recent]); assert.equal((await extractJobDocuments(first.api, { now })).retry_deferred, 1);
  assert.equal(first.calls.extraction.length, 0);
  recent.checked_at = '2026-09-12T10:00:00Z'; const next = fixture([file()], [recent]);
  assert.equal((await extractJobDocuments(next.api, { now })).extracted, 1);
  assert.equal(next.calls.updated[0].id, 'failure'); assert.equal(next.calls.updated[0].attempts, 2);
});

test('provider failures are private and persist a failed attempt for backoff', async () => {
  const { api, calls } = fixture(); api.integrations.Core.ExtractDataFromUploadedFile = async () => { throw Error('signed_url https://host?signature=TOP-SECRET'); };
  const result = await extractJobDocuments(api, { now });
  assert.equal(result.failed, 1); assert.equal(calls.created[0].status, 'failed'); assert.equal(calls.created[0].result, null);
  assert.ok(!JSON.stringify([result, calls.created]).includes('TOP-SECRET'));
});

test('receipt changes before signing cannot be extracted under an old digest', async () => {
  const { api, calls } = fixture(); api.entities.FieldLibraryFile.get = async () => file('pdf1', { sha256: 'b'.repeat(64) });
  const result = await extractJobDocuments(api, { now });
  assert.equal(result.failed, 1); assert.equal(calls.signed.length, 0); assert.equal(calls.extraction.length, 0);
});

test('malformed output and missing evidence citations are rejected', () => {
  assert.throws(() => validateJobDocumentResult(output({ dated_statements: [{ ...dateFact(), page: 0 }] })), /invalid_extraction_page/);
  assert.throws(() => validateJobDocumentResult(output({ dated_statements: [{ ...dateFact(), source_quote: '' }] })), /invalid_extraction_text/);
  assert.throws(() => validateJobDocumentResult(output({ dated_statements: [{ ...dateFact(), normalized_date: '2026-02-30' }] })), /invalid_document_date/);
  assert.throws(() => validateJobDocumentResult({ ...output(), confirmed_arrival: true }), /invalid_extraction_shape/);
});

test('invoice, quote and parts diagram date meanings remain distinct and review-only', () => {
  assert.equal(validateJobDocumentResult(output()).dated_statements[0].meaning, 'document_date');
  const quote = validateJobDocumentResult(output({ document_type: 'quote', dated_statements: [{ ...dateFact('estimated_arrival'), uncertainty: 'Estimate only' }] }));
  assert.equal(quote.dated_statements[0].meaning, 'estimated_arrival');
  const diagram = validateJobDocumentResult(output({ document_type: 'parts_diagram', dated_statements: [dateFact('revision_date')] }));
  assert.equal(diagram.document_type, 'parts_diagram');
  assert.throws(() => validateJobDocumentResult(output({ document_type: 'parts_diagram', dated_statements: [dateFact('estimated_arrival')] })), /diagram_is_not_operational_schedule/);
});

test('unknown dates can remain null, but excessive output or secrets are rejected', () => {
  assert.equal(validateJobDocumentResult(output({ dated_statements: [{ ...dateFact(), normalized_date: null, uncertainty: 'Year not established.' }] })).dated_statements[0].normalized_date, null);
  assert.throws(() => validateJobDocumentResult(output({ summary: 'x'.repeat(3001) })), /invalid_extraction_text/);
  assert.throws(() => validateJobDocumentResult(output({ summary: 'https://host/?signature=SECRET' })), /invalid_extraction_text/);
  assert.throws(() => validateJobDocumentResult(output({ dated_statements: Array.from({ length: 41 }, dateFact) })), /invalid_extraction_items/);
});

test('known success envelope is supported; provider error envelopes fail', () => {
  assert.equal(validateJobDocumentResult({ status: 'success', output: output() }).document_type, 'invoice');
  assert.throws(() => validateJobDocumentResult({ status: 'error', output: output() }), /extraction_provider_failed/);
});

test('existing-state failure never spends extraction credits or changes source', async () => {
  const { api, calls } = fixture(); api.entities.JobDocumentExtraction.filter = async query => { if (query.extraction_key) throw Error('database unavailable'); return []; };
  const result = await extractJobDocuments(api, { now });
  assert.equal(result.skipped, 1); assert.equal(calls.extraction.length, 0); assert.equal(calls.sourceWrites, 0);
});

test('older PDF beyond 6800 library receipts is reached using selected fields', async () => {
  const files = Array.from({ length: 6800 }, (_, i) => file('image' + i, { mime_type: 'image/jpeg' }));
  files.push(file('old-pdf', { mime_type: 'Application/PDF; charset=binary' }));
  const { api, calls } = fixture(files); const list = api.entities.FieldLibraryFile.filter; const selections = [];
  api.entities.FieldLibraryFile.filter = async (...args) => { selections.push(args[4]); return list(...args); };
  const result = await extractJobDocuments(api, { now });
  assert.equal(result.candidates_complete, true); assert.equal(result.extracted, 1); assert.equal(calls.created[0].file_id, 'old-pdf');
  assert.ok(selections.length > 20); assert.ok(selections.every(fields => fields.includes('sha256') && !fields.includes('source_snapshot')));
});

test('completed-document backlog does not starve a new PDF beyond lookup budget', async () => {
  const files = Array.from({ length: 102 }, (_, i) => file('pdf' + i));
  const records = files.slice(0, 101).map((f, i) => ({ id: 'e' + i, extraction_key: f.id + ':' + digest, status: 'extracted_needs_review', checked_at: now }));
  const { api, calls } = fixture(files, records);
  const result = await extractJobDocuments(api, { now });
  assert.equal(result.skipped, 101); assert.equal(result.extracted, 1); assert.equal(result.lookups, 1);
  assert.equal(calls.created[0].file_id, 'pdf101');
});

test('actual mp/private namespace is reused after full SHA and PDF verification', async () => {
  const f = file('actual', { file_uri: 'mp/private/verified-source.pdf', chunks: [{ offset: 0, size: pdfBytes.length, sha256: digest, file_uri: 'mp/private/verified-source.pdf' }] });
  const { api, calls } = fixture([f]);
  const result = await extractJobDocuments(api, { now });
  assert.equal(result.extracted, 1); assert.equal(calls.privateUploads.length, 0);
  assert.equal(calls.signed[0].file_uri, f.file_uri); assert.equal(calls.fetched[0].options.redirect, 'manual');
  assert.equal(calls.extraction[0].file_url, calls.fetched[0].url);
});

test('octet-stream PDF filename is admitted only when its verified bytes are PDF', async () => {
  const good = file('named', { mime_type: 'application/octet-stream', name: 'Parts Drawing.PDF' });
  const disguised = file('wrong', { mime_type: 'application/octet-stream', name: 'fake.pdf', _bytes: new TextEncoder().encode('<html>Not a PDF</html>') });
  const f = fixture([good, disguised]);
  const result = await extractJobDocuments(f.api, { now });
  assert.equal(result.eligible, 2); assert.equal(result.extracted, 1); assert.equal(result.failed, 1);
  assert.equal(f.calls.extraction.length, 1); assert.equal(f.calls.sourceWrites, 0);
});

test('PDF MIME with non-PDF bytes or a changed full hash never reaches extraction', async () => {
  const fake = file('fake', { _bytes: new TextEncoder().encode('not a pdf') });
  const mismatch = file('mismatch', { sha256: 'b'.repeat(64) });
  const f = fixture([fake, mismatch]);
  const result = await extractJobDocuments(f.api, { now });
  assert.equal(result.failed, 2); assert.equal(f.calls.extraction.length, 0); assert.equal(f.calls.privateUploads.length, 0);
});

test('private PDF streaming rejects oversized and truncated responses before extraction', async () => {
  const large = fixture();
  large.fetchImpl = async () => new Response(new Uint8Array(pdfBytes.length + 1));
  assert.equal((await extractJobDocuments(large.api, { now })).failed, 1);
  assert.equal(large.calls.extraction.length, 0);
  const short = fixture();
  short.fetchImpl = async () => new Response(pdfBytes.subarray(0, -1));
  assert.equal((await extractJobDocuments(short.api, { now })).failed, 1);
  assert.equal(short.calls.extraction.length, 0);
});

function chunkFixture(overrides = {}) {
  const parts = [pdfBytes.subarray(0, 20), pdfBytes.subarray(20)];
  const chunks = [{ offset: 0, size: parts[0].length, sha256: hash(parts[0]), file_uri: 'mp/private/first.bin' }, { offset: parts[0].length, size: parts[1].length, sha256: hash(parts[1]), file_uri: 'mp/private/second.bin' }];
  const manifest = JSON.stringify(chunks.map(({ offset, size, sha256 }) => ({ offset, size, sha256 })));
  const f = fixture([file('chunked', { file_uri: '', chunks, bytes_stored: pdfBytes.length, manifest_sha256: hash(manifest), ...overrides })]);
  f.blobs.set(chunks[0].file_uri, parts[0]); f.blobs.set(chunks[1].file_uri, parts[1]);
  return f;
}

test('verified chunks reassemble into a verified private PDF without modifying source receipts', async () => {
  const f = chunkFixture(), result = await extractJobDocuments(f.api, { now });
  assert.equal(result.extracted, 1); assert.equal(f.calls.privateUploads.length, 1);
  assert.equal(f.calls.privateUploads[0].type, 'application/pdf');
  assert.deepEqual(new Uint8Array(await f.calls.privateUploads[0].arrayBuffer()), pdfBytes);
  assert.equal(f.calls.fetched.length, 3); // two chunks and verification of new private object
  assert.equal(f.calls.extraction[0].file_url, f.calls.fetched[2].url);
  assert.equal(f.calls.sourceWrites, 0); assert.equal(f.calls.publicUploads, 0);
  assert(!JSON.stringify([result, f.records]).includes('TOP-SECRET'));
});

test('chunk corruption, malformed ranges, and altered manifest fail before extraction', async () => {
  const corrupt = chunkFixture(); corrupt.blobs.set('mp/private/first.bin', new Uint8Array(20));
  assert.equal((await extractJobDocuments(corrupt.api, { now })).failed, 1);
  assert.equal(corrupt.calls.privateUploads.length, 0);
  const malformed = chunkFixture(); const get = malformed.api.entities.FieldLibraryFile.get;
  malformed.api.entities.FieldLibraryFile.get = async id => { const value = structuredClone(await get(id)); value.chunks[1].offset++; return value; };
  assert.equal((await extractJobDocuments(malformed.api, { now })).failed, 1);
  assert.equal(malformed.calls.signed.length, 0);
  const manifest = chunkFixture({ manifest_sha256: 'b'.repeat(64) });
  assert.equal((await extractJobDocuments(manifest.api, { now })).failed, 1);
  assert.equal(manifest.calls.signed.length, 0);
});

test('multipart receipts without a whole-file SHA remain explicitly deferred', async () => {
  const f = chunkFixture({ sha256: '' });
  const result = await extractJobDocuments(f.api, { now });
  assert.equal(result.eligible, 0); assert.equal(result.pdf_candidates_without_whole_sha, 1);
  assert.equal(f.calls.fetched.length, 0); assert.equal(f.calls.sourceWrites, 0);
});

test('private URL signing cannot redirect the reader to non-HTTPS URLs', async () => {
  const f = fixture(); f.api.integrations.Core.CreateFileSignedUrl = async () => ({ signed_url: 'http://private.example/raw' });
  const result = await extractJobDocuments(f.api, { now });
  assert.equal(result.failed, 1); assert.equal(f.calls.fetched.length, 0); assert.equal(f.calls.extraction.length, 0);
});

test('failed superseded revision retries once and current revision backs off', async () => {
  const prior = { id:'prior', extraction_key:'pdf1:'+digest, status:'failed', checked_at:now, attempts:1 };
  const f=fixture([file()],[prior]);
  f.api.integrations.Core.ExtractDataFromUploadedFile=async()=>{throw Error('Unknown private payload');};
  const first=await extractJobDocuments(f.api,{now});
  assert.equal(first.attempted,1);assert.equal(first.revision_retries,1);
  assert.equal(f.records[0].extractor_revision,JOB_DOCUMENT_EXTRACTOR_REVISION);
  const second=await extractJobDocuments(f.api,{now});
  assert.equal(second.attempted,0);assert.equal(second.retry_deferred,1);
});

test('diagnostics identify provider status without exposing error body or signed URL', async () => {
  const f=fixture();
  f.api.integrations.Core.ExtractDataFromUploadedFile=async()=>{throw Object.assign(Error('https://private.example?token=TOP-SECRET'),{response:{status:403,data:'TOP-SECRET'}});};
  const r=await extractJobDocuments(f.api,{now});
  assert.equal(r.outcomes[0].error_stage,'extract_provider');assert.equal(r.outcomes[0].error_code,'provider_http_error');assert.equal(r.outcomes[0].error_http_status,403);
  assert(!JSON.stringify([r,f.records]).includes('TOP-SECRET'));
});

test('storage status and content validation failures have separate fixed diagnostic stages', async () => {
  const f=fixture();f.fetchImpl=async()=>new Response('private error',{status:403});
  const r=await extractJobDocuments(f.api,{now});assert.equal(r.outcomes[0].error_stage,'private_read');assert.equal(r.outcomes[0].error_http_status,403);assert.equal(f.calls.extraction.length,0);
  const bad=fixture([file('bad',{sha256:'a'.repeat(64)})]);const b=await extractJobDocuments(bad.api,{now});
  assert.equal(b.outcomes[0].error_stage,'source_hash');assert.equal(b.outcomes[0].error_code,'private_file_hash_changed');
});

test('future or invalid receipt timestamps cannot be retried through revision migration', async () => {
  for(const checked_at of ['bad-date','2026-10-01T00:00:00Z']) {
    const f=fixture([file()],[{id:'old',extraction_key:'pdf1:'+digest,status:'failed',checked_at}]);
    const r=await extractJobDocuments(f.api,{now});assert.equal(r.attempted,0);assert.equal(r.retry_deferred,1);
  }
});

test('storage redirects are not followed and only their origin is reported', async () => {
  const f=fixture();f.fetchImpl=async()=>new Response(null,{status:302,headers:{location:'https://storage.example/private.pdf?signature=TOP-SECRET'}});
  const r=await extractJobDocuments(f.api,{now});
  assert.equal(r.outcomes[0].error_code,'private_file_redirect');assert.equal(r.outcomes[0].error_http_status,302);assert.equal(r.outcomes[0].error_redirect_origin,'https://storage.example');
  assert.equal(f.calls.extraction.length,0);assert(!JSON.stringify([r,f.records]).includes('TOP-SECRET'));assert(!JSON.stringify([r,f.records]).includes('private.pdf'));
});
