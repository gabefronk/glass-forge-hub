import test from 'node:test';
import assert from 'node:assert/strict';
import { extractJobDocuments, validateJobDocumentResult, JOB_DOCUMENT_SCHEMA } from '../integration/jobDocumentExtraction.mjs';
const now = '2026-09-13T10:00:00Z';
const digest = 'a'.repeat(64);
const file = (id = 'pdf1', changes = {}) => ({ id, status: 'verified', source_deleted: false, mime_type: 'application/pdf', file_uri: 'private/library/' + id + '.pdf', sha256: digest, size: 1024, verified_at: '2026-09-12T10:00:00Z', source_project_id: 'project1', source_post_id: 'post1', ...changes });
const dateFact = (meaning = 'document_date') => ({ date_text: 'September 15, 2026', normalized_date: '2026-09-15', meaning, source_quote: 'Document date: September 15, 2026', page: 1, uncertainty: '' });
const output = (changes = {}) => ({ document_type: 'invoice', job_identifiers: [{ type: 'lot', value: '24', source_quote: 'Lot 24', page: 1 }], dated_statements: [dateFact()], summary: 'Invoice for work at lot 24.', ...changes });
function fixture(files = [file()], records = []) {
  const calls = { signed: [], extraction: [], created: [], updated: [], sourceWrites: 0, publicUploads: 0 };
  const api = { entities: {
    FieldLibraryFile: { filter: async (query, _, size, skip) => files.filter(f => !query.status || f.status === query.status).slice(skip, skip + size), get: async id => files.find(f => f.id === id), update: async () => { calls.sourceWrites++; throw Error('Source write forbidden'); } },
    JobDocumentExtraction: { filter: async ({ extraction_key }, _, size = 5, skip = 0) => records.filter(r => !extraction_key || r.extraction_key === extraction_key).slice(skip, skip + size),
      create: async record => { const saved = { id: 'extracted-' + (records.length + 1), ...structuredClone(record) }; calls.created.push(saved); records.push(saved); return saved; },
      update: async (id, record) => { const saved = { id, ...structuredClone(record) }; calls.updated.push(saved); Object.assign(records.find(r => r.id === id), saved); return saved; } }
  }, integrations: { Core: {
    CreateFileSignedUrl: async args => { calls.signed.push(args); return { signed_url: 'https://private.example/pdf?signature=TOP-SECRET' }; },
    ExtractDataFromUploadedFile: async args => { calls.extraction.push(args); return output(); },
    UploadFile: async () => { calls.publicUploads++; throw Error('Public upload forbidden'); }
  } } };
  return { api, calls, records };
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
  const changed = fixture([file('pdf1', { sha256: 'b'.repeat(64) })], [previous]);
  assert.equal((await extractJobDocuments(changed.api, { now })).extracted, 1);
  assert.equal(changed.calls.created[0].sha256, 'b'.repeat(64));
});

test('failed extraction retries only after 24 hours and updates existing keyed record', async () => {
  const recent = { id: 'failure', extraction_key: 'pdf1:' + digest, status: 'failed', checked_at: '2026-09-12T10:00:01Z', attempts: 1 };
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
