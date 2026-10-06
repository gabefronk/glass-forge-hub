import test from 'node:test';
import assert from 'node:assert/strict';
import { saveTaxRecord, LEASE_MS } from '../base44/shared/emailTaxDrive.js';
import { taxKey, attachmentKey } from '../base44/shared/emailTaxRecord.js';
import { makeDriveMock } from './fixtures/driveMock.mjs';

const NOW = '2026-10-06T12:00:00.000Z';
const MAILBOX = { key: 'gf-gmail', provider: 'gmail', display_name: 'Glass Forge (Gmail)' };
const PDF = { name: 'INV001184.pdf', mime: 'application/pdf', size: 40_000, attachment_id: 'attP' };
const LOGO = { name: 'helcim-logo.png', mime: 'image/png', size: 60_000, attachment_id: 'attL' };
const INLINE = { name: 'receipt-photo.jpg', mime: 'image/jpeg', size: 90_000, attachment_id: 'attI', inline: true };
const DOCX = { name: 'terms.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', size: 9000, attachment_id: 'attD' };
const MSG = { message_id: 'mh', direction: 'incoming', text: 'Your card was charged $1,842.50.', attachments: [PDF, LOGO, INLINE, DOCX] };
const ROW = { id: 'r1', mailbox_key: 'gf-gmail', thread_id: 'th', subject: 'Invoice INV001184 (PAID)', from_name: 'Helcim', from_email: 'noreply@helcim.com', last_message_at: '2026-10-03T15:00:00.000Z', tax_record: true, receipt_date: '2026-10-03', vendor: 'Wasatch Windows LLC', amount_total: 1842.5, reference: 'INV001184' };

function setup({ row = ROW, files = [], connected = true, onGet } = {}) {
  const rows = { [row.id]: structuredClone(row) };
  const writes = [];
  const api = { EmailRelay: {
    get: async (id) => { const r = structuredClone(rows[id]); return onGet ? onGet(r) : r; },
    update: async (id, patch) => { writes.push(patch); Object.assign(rows[id], structuredClone(patch)); return structuredClone(rows[id]); },
  } };
  const drive = makeDriveMock(files);
  const downloads = [];
  const provider = { getAttachmentBytes: async (mid, aid) => { downloads.push(aid); return { bytes: new Uint8Array([37, 80, 68, 70]), mime: 'application/pdf' }; } };
  const connectors = { getConnection: async (t) => { if (t !== 'googledrive' || !connected) throw new Error('drive not connected'); return { accessToken: 'd' }; } };
  const run = async (opts) => {
    const r = await saveTaxRecord({ api, connectors, fetchImpl: drive.fetchImpl, now: () => NOW }, MAILBOX, provider, rows[row.id], [MSG], opts);
    if (r) Object.assign(rows[row.id], structuredClone(r));
    return r;
  };
  return { run, rows, writes, drive, downloads, row: () => rows[row.id] };
}

test('saves doc + only the receipt PDF into Taxes/2026; exact money in the name; second run does nothing', async () => {
  const s = setup();
  const r = await s.run();
  assert.equal(r.tax_save_state, 'saved');
  assert.equal(r.tax_save_error, '');
  assert.deepEqual(s.drive.folders().map((f) => f.name), ['Taxes', '2026']);
  const [doc] = s.drive.byKind('doc');
  assert.equal(doc.name, '2026-10-03 Wasatch Windows LLC - $1842.50 - INV001184');
  assert.equal(r.drive_file_id, doc.id);
  assert.deepEqual(s.drive.byKind('attachment').map((f) => f.name), ['INV001184.pdf'], 'logo, inline image and docx stay in the mailbox');
  assert.deepEqual(s.downloads, ['attP']);
  assert.equal(r.tax_attachments.length, 1);
  assert.equal(r.tax_attachments[0].att_key, await attachmentKey('mh', PDF));
  assert.equal(r.tax_key, await taxKey('gmail', 'gf-gmail', 'th'));
  assert.equal(r.tax_lock_id, '', 'lease released');
  const creates = s.drive.state.creates.length;
  assert.equal(await s.run(), null, 'saved row: no Drive call at all');
  assert.equal(s.drive.state.creates.length, creates);
});

test('identity lookup: a doc already in Drive with this thread key is adopted, never re-created (lost ledger write)', async () => {
  const key = await taxKey('gmail', 'gf-gmail', 'th');
  const s = setup({ files: [{ id: 'old', name: 'renamed by owner', mimeType: 'application/vnd.google-apps.document', parents: ['yr'], createdTime: '2026-10-03T00:00:00Z', appProperties: { gf_tax_key: key, gf_kind: 'doc' } }] });
  const r = await s.run();
  assert.equal(r.drive_file_id, 'old');
  assert.equal(s.drive.state.creates.filter((c) => c.kind !== 'file').length, 0, 'no folder or doc created');
  assert.equal(s.drive.byKind('attachment')[0].parents[0], 'yr', 'attachment goes next to the adopted doc');
  assert.equal(r.tax_save_state, 'saved');
});

test('lease: a live lease from another run blocks; an expired one does not; losing the re-read gives up', async () => {
  const held = setup({ row: { ...ROW, tax_lock_id: 'other', tax_lock_until: new Date(Date.parse(NOW) + 60_000).toISOString() } });
  assert.equal(await held.run(), null);
  assert.equal(held.writes.length, 0);
  const expired = setup({ row: { ...ROW, tax_lock_id: 'other', tax_lock_until: new Date(Date.parse(NOW) - 1).toISOString() } });
  assert.equal((await expired.run()).tax_save_state, 'saved');
  // last write wins: a racer overwrote our lease between our write and our re-read
  let n = 0;
  const lost = setup({ onGet: (r) => (++n === 2 ? { ...r, tax_lock_id: 'racer' } : r) });
  assert.equal(await lost.run(), null);
  assert.equal(lost.drive.state.creates.length, 0);
  assert.ok(LEASE_MS > 0);
});

test('lease is not atomic: two runs that both pass it converge on the earliest doc and record the extra as a duplicate', async () => {
  // Both runs see an empty lease and each re-read returns its own id (the race the lease cannot stop).
  const s = setup();
  // Barrier: hold the first doc lookup of each run until both runs have looked, so both miss.
  let waiting = 0; let open; const gate = new Promise((r) => { open = r; });
  const fetchImpl = async (url, init) => {
    if (decodeURIComponent(url).includes("value='doc'") && waiting < 2) { if (++waiting === 2) open(); await gate; }
    return s.drive.fetchImpl(url, init);
  };
  const ctx = (lock) => ({ api: { EmailRelay: { get: async () => ({ ...ROW, tax_lock_id: lock.id }), update: async (id, p) => { if (p.tax_lock_id) lock.id = p.tax_lock_id; return {}; } } }, connectors: { getConnection: async () => ({ accessToken: 'd' }) }, fetchImpl, now: () => NOW });
  const provider = { getAttachmentBytes: async () => ({ bytes: new Uint8Array([1]), mime: 'application/pdf' }) };
  const [a, b] = await Promise.all([saveTaxRecord(ctx({}), MAILBOX, provider, ROW, [MSG]), saveTaxRecord(ctx({}), MAILBOX, provider, ROW, [MSG])]);
  const docs = s.drive.byKind('doc').sort((x, y) => x.createdTime.localeCompare(y.createdTime));
  assert.equal(a.drive_file_id, docs[0].id);
  assert.equal(b.drive_file_id, docs[0].id, 'both runs agree on the canonical doc');
  assert.equal(docs.length, 2, 'the race really produced two docs');
  assert.ok([...a.tax_duplicate_ids, ...b.tax_duplicate_ids].includes(docs[1].id), 'duplicate surfaced, not deleted');
  assert.ok(s.drive.state.files.every((f) => !f.trashed));
});

test('unknown create outcome (5xx / dropped reply) is never retried automatically; found later it is adopted; admin confirm re-creates', async () => {
  const s = setup();
  s.drive.state.faults.push({ kind: 'doc', mode: '503' });
  const r1 = await s.run();
  assert.equal(r1.tax_save_state, 'unknown');
  assert.match(r1.tax_save_error, /outcome unknown/);
  const docCreates = () => s.drive.state.creates.filter((c) => c.kind === 'doc').length;
  assert.equal(docCreates(), 1);
  const r2 = await s.run();
  assert.equal(r2.tax_save_state, 'unknown', 'read-only lookup, still not found');
  assert.equal(docCreates(), 1, 'no automatic second create');
  const r3 = await s.run({ force: true, confirmRecreate: true });
  assert.equal(r3.tax_save_state, 'saved');
  assert.equal(docCreates(), 2);
  // created server-side but the reply was lost: the next run finds it by key
  const lost = setup();
  lost.drive.state.faults.push({ kind: 'doc', mode: 'lost' });
  assert.equal((await lost.run()).tax_save_state, 'unknown');
  const r = await lost.run();
  assert.equal(r.tax_save_state, 'saved');
  assert.equal(lost.drive.byKind('doc').length, 1, 'adopted, not duplicated');
  // a known 4xx rejection is a plain failure and retried next run
  const rej = setup();
  rej.drive.state.faults.push({ kind: 'doc', mode: '400' });
  assert.equal((await rej.run()).tax_save_state, 'failed');
  assert.equal((await rej.run()).tax_save_state, 'saved');
});

test('saved doc with a failed attachment is partial; the retry uploads only the attachment', async () => {
  const s = setup();
  s.drive.state.faults.push({ kind: 'file', mode: '400' });
  const r1 = await s.run();
  assert.equal(r1.tax_save_state, 'partial');
  assert.ok(r1.drive_file_id);
  assert.equal(r1.tax_attachments[0].status, 'failed');
  assert.match(r1.tax_save_error, /INV001184\.pdf \(failed\)/);
  const r2 = await s.run();
  assert.equal(r2.tax_save_state, 'saved');
  assert.equal(r2.drive_file_id, r1.drive_file_id);
  assert.equal(s.drive.byKind('doc').length, 1, 'doc not re-created');
  assert.equal(s.drive.byKind('attachment').length, 1);
  // an attachment upload with an unknown outcome is not re-uploaded without confirm
  const u = setup();
  u.drive.state.faults.push({ kind: 'file', mode: '503' });
  assert.equal((await u.run()).tax_attachments[0].status, 'unknown');
  const uploads = () => u.drive.state.creates.filter((c) => c.kind === 'file').length;
  await u.run();
  assert.equal(uploads(), 1, 'unknown attachment left alone');
  assert.equal(u.row().tax_save_state, 'partial');
});

test('Drive not connected: failed, no Drive call; an earlier unknown stays unknown', async () => {
  const s = setup({ connected: false });
  const r = await s.run();
  assert.equal(r.tax_save_state, 'failed');
  assert.match(r.tax_save_error, /tax save failed: drive not connected/);
  assert.equal(s.drive.state.finds + s.drive.state.creates.length, 0);
  const u = setup({ connected: false, row: { ...ROW, tax_save_state: 'unknown' } });
  assert.equal((await u.run()).tax_save_state, 'unknown');
});

test('decimal money: 1.005 and 0.285 keep exact cents in the doc name', async () => {
  const { parseTaxRecord } = await import('../base44/shared/emailTaxRecord.js');
  const s = setup({ row: { ...ROW, ...parseTaxRecord({ tax_record: true, receipt_date: '2026-10-03', vendor: 'Helcim', amount_total: '1.005', reference: 'X1' }) } });
  assert.equal(s.row().amount_total, 1.01);
  await s.run();
  assert.equal(s.drive.byKind('doc')[0].name, '2026-10-03 Helcim - $1.01 - X1');
});