import test from 'node:test';
import assert from 'node:assert/strict';
import { DRIVE_CHUNK_BYTES, blobToBase64, chunkRanges, fileProblem, fileSizeLabel, guessFileKind, uploadQuote, uploadToJobFolder } from '../src/lib/jobFileUpload.js';

const file = (name, size, type = '') => ({ name, size, type });

test('a dropped PDF is a vendor quote only when its name says so; everything else goes to Drive', () => {
  // The Campbell Add-on folder's files (Oct 30).
  assert.equal(guessFileKind(file('CAMPBELL ADDITION - WHITE - AMSCO STUDIO.pdf', 1, 'application/pdf')), 'quote');
  assert.equal(guessFileKind(file('25069 - fishied upstairs unfinished basementCasita Drawings 2026-06-26.pdf', 1, 'application/pdf')), 'drive');
  assert.equal(guessFileKind(file('Finished up and Down ADDITION Final.pdf', 1)), 'drive');
  assert.equal(guessFileKind(file('Cambell front .png', 1, 'image/png')), 'drive');
  assert.equal(guessFileKind(file('Email notes - through 2026-09-12.txt', 1, 'text/plain')), 'drive');
  assert.equal(guessFileKind(file('Pella_quote_21464768.pdf', 1)), 'quote');
  assert.equal(guessFileKind(file('amsco-quote.png', 1, 'image/png')), 'drive');
});

test('size limits: quotes 5 MB (PDF only), Drive files 50 MB', () => {
  assert.equal(fileProblem(file('a.pdf', 4 * 1024 * 1024), 'quote'), '');
  assert.match(fileProblem(file('a.pdf', 6 * 1024 * 1024), 'quote'), /5 MB/);
  assert.match(fileProblem(file('a.png', 10), 'quote'), /PDF/);
  assert.equal(fileProblem(file('a.png', 40 * 1024 * 1024), 'drive'), '');
  assert.match(fileProblem(file('a.png', 51 * 1024 * 1024), 'drive'), /50 MB/);
  assert.match(fileProblem(file('a.png', 0), 'drive'), /empty/);
  assert.equal(fileSizeLabel(375 * 1024), '375 KB');
  assert.equal(fileSizeLabel(5.25 * 1024 * 1024), '5.3 MB');
});

test('chunks are whole 2 MiB pieces and then the rest', () => {
  assert.deepEqual(chunkRanges(5 * 1024 * 1024 + 1, DRIVE_CHUNK_BYTES).map((r) => r.end - r.start), [DRIVE_CHUNK_BYTES, DRIVE_CHUNK_BYTES, 1024 * 1024 + 1]);
  assert.equal(DRIVE_CHUNK_BYTES % (256 * 1024), 0);
  assert.deepEqual(chunkRanges(10, 4), [{ start: 0, end: 4 }, { start: 4, end: 8 }, { start: 8, end: 10 }]);
});

test('uploadToJobFolder starts a Drive upload, sends every chunk in order and returns the file', async () => {
  const bytes = new Uint8Array(10).map((_, i) => 65 + i);
  const blob = new Blob([bytes], { type: 'image/png' });
  const photo = Object.assign(blob, { name: 'Cambell front .png' });
  const calls = [];
  const invoke = async (name, body) => {
    calls.push({ name, ...body });
    if (body.action === 'upload_start') return { data: { ok: true, upload_url: 'https://www.googleapis.com/upload/drive/v3/files?upload_id=x', chunk_bytes: 4, folder: { id: 'f1', name: 'Campbell Add-on' } } };
    const done = body.offset + atob(body.data).length === body.total;
    return { data: done ? { ok: true, done: true, file: { id: 'd1', name: 'Cambell front .png', url: 'https://drive.google.com/file/d/d1/view' } } : { ok: true, done: false } };
  };
  const progress = [];
  const out = await uploadToJobFolder({ invoke, jobId: 'campbell', file: photo, onProgress: (p) => progress.push(p) });
  assert.equal(out.id, 'd1');
  assert.equal(out.folder.name, 'Campbell Add-on');
  assert.deepEqual(calls.map((c) => c.action), ['upload_start', 'upload_chunk', 'upload_chunk', 'upload_chunk']);
  assert.deepEqual(calls.slice(1).map((c) => c.offset), [0, 4, 8]);
  assert.equal(calls.slice(1).map((c) => atob(c.data)).join(''), 'ABCDEFGHIJ');
  assert.deepEqual(calls[0], { name: 'job-documents', action: 'upload_start', job_id: 'campbell', file_name: 'Cambell front .png', mime_type: 'image/png', size: 10 });
  assert.equal(progress.at(-1), 1);
  await assert.rejects(uploadToJobFolder({ invoke: async () => ({ data: { error: 'Stored folder is no longer in Glass Forge Jobs.' } }), jobId: 'campbell', file: photo }), /no longer/);
});

test('uploadQuote sends the same private ingest request the quote dropzone always sent', async () => {
  const pdf = Object.assign(new Blob(['%PDF-1'], { type: 'application/pdf' }), { name: 'quote.pdf' });
  let sent;
  const data = await uploadQuote({ invoke: async (name, body) => { sent = { name, body }; return { data: { title: 'Q' } }; }, jobId: 'campbell', file: pdf, requestKey: 'k1' });
  assert.equal(data.title, 'Q');
  assert.equal(sent.name, 'purchasingQuoteIngest');
  assert.deepEqual({ ...sent.body, file_base64: undefined }, { action: 'ingest', file_name: 'quote.pdf', file_type: 'application/pdf', file_base64: undefined, request_key: 'k1', job_id: 'campbell' });
  assert.equal(atob(sent.body.file_base64), '%PDF-1');
  assert.equal(await blobToBase64(new Blob([''])), '');
});
