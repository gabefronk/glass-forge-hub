// Inbox agent: save receipt / paid-invoice emails to Drive/Taxes/<year>.
//
// Save receipt / paid-invoice emails to Drive/Taxes/<year>. Called ONLY by the admin
// save_tax_record action — the inbox sync does NOT auto-save, because Drive has no atomic or
// idempotent create (generateIds returns random IDs, not deterministic; there is no unique
// constraint on appProperties), so two concurrent automatic runs could create duplicate docs.
//
// Idempotency for the manual path (best-effort, NOT atomic):
//   - Every created folder / doc / attachment carries Drive appProperties with a deterministic
//     key (provider + mailbox + thread, and per attachment its message + name/mime/size). Before
//     any create the saver looks the key up and adopts what exists; after a create it looks again
//     and converges on the earliest-created file, recording any extra as a duplicate (never
//     deleted, never overwritten). Two concurrent admin saves can still produce a duplicate; it
//     is surfaced in tax_duplicate_ids for the owner to review.
//   - A best-effort lease on the EmailRelay row (write, then re-read) narrows the race window
//     but is not atomic.
//   - A create whose outcome is unknown (network error, 5xx, no id in the reply) is never retried
//     automatically: the row goes to tax_save_state 'unknown' and a later save only looks the key
//     up (read-only). Re-creating requires an admin save with confirm_recreate, and only when the
//     state is 'unknown' — confirm is never a blanket reset of a saved or partial row.
// Nothing here stores an email body in the Hub; only Drive ids, names and statuses.

import * as Tax from './emailTaxRecord.js';

const DRIVE_API = 'https://www.googleapis.com/drive/v3';
const DRIVE_UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const DOC_MIME = 'application/vnd.google-apps.document';
export const LEASE_MS = 10 * 60_000;

export class DriveUnknownOutcome extends Error {}
const errText = (e) => String(e?.message || e || 'error').slice(0, 300);
const q = (s) => String(s).replace(/\\/g, '\\\\').replace(/'/g, "\\'");
const prop = (k, v) => `appProperties has { key='${q(k)}' and value='${q(v)}' }`;

function bytesToB64(bytes) {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function makeDriveClient(token, fetchImpl) {
  const auth = (extra = {}) => ({ Authorization: `Bearer ${token}`, ...extra });
  // Reads: any failure throws a plain error (nothing was created, safe to retry later).
  const find = async (query) => {
    const r = await fetchImpl(`${DRIVE_API}/files?q=${encodeURIComponent(`${query} and trashed=false`)}&fields=files(id,name,createdTime,webViewLink,parents)&pageSize=20`, { headers: auth() });
    const text = await r.text().catch(() => '');
    if (!r.ok) throw new Error(`Drive lookup -> ${r.status}: ${text.slice(0, 160)}`);
    return JSON.parse(text || '{}').files || [];
  };
  // Creates: a rejected request (4xx) is a known failure; anything else uncertain is unknown.
  const create = async (url, init, what) => {
    let r;
    try { r = await fetchImpl(url, { method: 'POST', ...init }); } catch (e) { throw new DriveUnknownOutcome(`${what}: ${errText(e)}`); }
    const text = await r.text().catch(() => null);
    if (r.status >= 500 || r.status === 408) throw new DriveUnknownOutcome(`${what} -> ${r.status}`);
    if (!r.ok) throw new Error(`${what} -> ${r.status}: ${String(text || '').slice(0, 160)}`);
    let j;
    try { j = JSON.parse(text || ''); } catch { throw new DriveUnknownOutcome(`${what}: unreadable reply`); }
    if (!j?.id) throw new DriveUnknownOutcome(`${what}: reply had no id`);
    return j;
  };
  const multipart = (meta, contentType, body) => {
    const b = `tax-${Math.random().toString(36).slice(2)}`;
    return { headers: auth({ 'Content-Type': `multipart/related; boundary=${b}` }), body: `--${b}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(meta)}\r\n--${b}\r\nContent-Type: ${contentType}\r\n${contentType.startsWith('text/') ? '' : 'Content-Transfer-Encoding: base64\r\n'}\r\n${body}\r\n--${b}--\r\n` };
  };
  return {
    find,
    createFolder: (name, parentId, appProperties) => create(`${DRIVE_API}/files?fields=id,name,createdTime,webViewLink`, { headers: auth({ 'Content-Type': 'application/json' }), body: JSON.stringify({ name, mimeType: FOLDER_MIME, parents: [parentId || 'root'], appProperties }) }, `create folder ${name}`),
    createDoc: (name, parentId, html, appProperties) => create(`${DRIVE_UPLOAD}/files?uploadType=multipart&fields=id,name,createdTime,webViewLink`, multipart({ name, mimeType: DOC_MIME, parents: [parentId], appProperties }, 'text/html', html), 'create doc'),
    uploadFile: (name, parentId, bytes, mime, appProperties) => create(`${DRIVE_UPLOAD}/files?uploadType=multipart&fields=id,name,createdTime,webViewLink`, multipart({ name, parents: [parentId], appProperties }, mime || 'application/octet-stream', bytesToB64(bytes)), `upload ${name}`),
  };
}

// Folder by tag: our own tagged folder first, else an exact-name folder the owner already had.
// readOnly never creates.
async function ensureFolder(drive, parentId, name, tag, readOnly) {
  const parent = parentId || 'root';
  let hit = Tax.canonicalFile(await drive.find(`'${q(parent)}' in parents and ${prop('gf_tax_folder', tag)}`));
  if (!hit) { const d = Tax.findFolder(await drive.find(`'${q(parent)}' in parents and mimeType='${FOLDER_MIME}' and name='${q(name)}'`), name); if (d.found) hit = { id: d.found }; }
  if (hit) return hit.id;
  if (readOnly) return null;
  await drive.createFolder(name, parent, { gf_tax_folder: tag });
  return Tax.canonicalFile(await drive.find(`'${q(parent)}' in parents and ${prop('gf_tax_folder', tag)}`))?.id || null;
}

const stateOf = (docId, atts) => (!docId ? 'pending' : atts.every((a) => a.status === 'saved') ? 'saved' : 'partial');

// Returns the EmailRelay patch, or null when there is nothing to do / another run holds the lease.
export async function saveTaxRecord({ api, connectors, fetchImpl, now }, mailbox, provider, row, messages, { force = false, confirmRecreate = false } = {}) {
  if (!force && !row.tax_record) return null;
  row = { ...row, ...(await api.EmailRelay.get(row.id)) }; // the caller's copy may be stale
  const prevAtts = Array.isArray(row.tax_attachments) ? row.tax_attachments : [];
  if (row.tax_save_state === 'saved' && row.drive_file_id && prevAtts.every((a) => a.status === 'saved')) return null;
  const at = now();
  if (row.tax_lock_id && String(row.tax_lock_until || '') > at) return null; // another run holds it

  const key = row.tax_key || await Tax.taxKey(mailbox.provider, mailbox.key, row.thread_id);
  const lockId = crypto.randomUUID();
  await api.EmailRelay.update(row.id, { tax_key: key, tax_lock_id: lockId, tax_lock_until: new Date(Date.parse(at) + LEASE_MS).toISOString() });
  const fresh = await api.EmailRelay.get(row.id);
  if (fresh?.tax_lock_id !== lockId) return null; // another run took the lease
  const release = { tax_key: key, tax_lock_id: '', tax_lock_until: '' };

  let docId = row.drive_file_id || '';
  let docUrl = row.drive_url || '';
  let state = row.tax_save_state || 'pending';
  const atts = prevAtts.map((a) => ({ ...a }));
  const dupes = new Set(row.tax_duplicate_ids || []);
  const done = (extra) => ({ ...release, drive_file_id: docId || undefined, drive_url: docUrl || undefined, tax_attachments: atts, tax_duplicate_ids: [...dupes], ...extra });

  let drive;
  try {
    const conn = await connectors.getConnection('googledrive');
    if (!conn?.accessToken) throw new Error('drive not connected');
    drive = makeDriveClient(conn.accessToken, fetchImpl);
  } catch (e) {
    return done({ tax_save_state: state === 'unknown' ? 'unknown' : (docId ? 'partial' : 'failed'), tax_save_error: `tax save failed: ${errText(e)}` });
  }

  const docReadOnly = state === 'unknown' && !confirmRecreate;
  const incoming = [...(messages || [])].reverse().find((m) => m.direction === 'incoming') || null;
  try {
    // 1. The doc, by key. Adopt what exists; create only when nothing does and creating is allowed.
    const docQuery = `${prop('gf_tax_key', key)} and ${prop('gf_kind', 'doc')}`;
    let docs = await drive.find(docQuery);
    if (!docs.length && !docId) {
      if (docReadOnly) return done({ tax_save_state: 'unknown', tax_save_error: 'tax save outcome unknown: no saved doc found yet; an admin re-save with confirm is needed to create it again' });
      if (!incoming?.text) return done({ tax_save_state: 'failed', tax_save_error: 'tax save failed: receipt email text unavailable; will retry' });
      const fallbackDate = String(row.last_message_at || '').slice(0, 10);
      const taxesId = await ensureFolder(drive, null, 'Taxes', 'taxes', false);
      const year = Tax.taxYear(row.receipt_date, fallbackDate);
      const yearId = taxesId && await ensureFolder(drive, taxesId, year, `year:${year}`, false);
      if (!yearId) throw new DriveUnknownOutcome('folder not found after create');
      const html = Tax.taxDocHtml({ from: [row.from_name, row.from_email ? `<${row.from_email}>` : ''].filter(Boolean).join(' '), date: row.last_message_at || '', subject: row.subject || '', mailbox: mailbox.display_name || mailbox.key || '', bodyText: incoming.text });
      await drive.createDoc(Tax.taxDocName(row, fallbackDate), yearId, html, { gf_tax_key: key, gf_kind: 'doc' });
      docs = await drive.find(docQuery);
      if (!docs.length) throw new DriveUnknownOutcome('doc not found after create');
    }
    const canon = Tax.canonicalFile(docs);
    if (canon) { docId = canon.id; docUrl = canon.webViewLink || docUrl; for (const d of docs) if (d.id !== canon.id) dupes.add(d.id); }

    // 2. Receipt attachments, tracked one by one; retried even when the doc is already saved.
    if (incoming) {
      for (const a of Tax.receiptAttachments(incoming.attachments)) {
        const attKey = await Tax.attachmentKey(incoming.message_id, a);
        let rec = atts.find((x) => x.att_key === attKey);
        if (!rec) { rec = { att_key: attKey, name: a.name || 'attachment', mime: a.mime || '', size: Number(a.size || 0), status: 'pending' }; atts.push(rec); }
        if (rec.status === 'saved') continue;
        const attQuery = `${prop('gf_tax_key', key)} and ${prop('gf_att', attKey)}`;
        try {
          let found = await drive.find(attQuery);
          if (!found.length) {
            if (rec.status === 'unknown' && !confirmRecreate) { rec.error = 'upload outcome unknown; not found yet'; continue; }
            // Next to the doc (wherever the owner keeps it); never creates a folder for this.
            const parentId = (canon?.parents || [])[0];
            if (!parentId) throw new Error('saved doc folder not found');
            const { bytes, mime } = await provider.getAttachmentBytes(incoming.message_id, a.attachment_id);
            await drive.uploadFile(rec.name, parentId, bytes, mime || a.mime, { gf_tax_key: key, gf_kind: 'attachment', gf_att: attKey });
            found = await drive.find(attQuery);
            if (!found.length) throw new DriveUnknownOutcome('attachment not found after upload');
          }
          const c = Tax.canonicalFile(found);
          Object.assign(rec, { status: 'saved', drive_file_id: c.id, error: '' });
          for (const f of found) if (f.id !== c.id) dupes.add(f.id);
        } catch (e) {
          Object.assign(rec, { status: e instanceof DriveUnknownOutcome ? 'unknown' : 'failed', error: errText(e) });
        }
      }
    }
    state = stateOf(docId, atts);
    const bad = atts.filter((x) => x.status !== 'saved');
    return done({ tax_save_state: state, tax_save_error: bad.length ? `attachments not saved: ${bad.map((x) => `${x.name} (${x.status})`).join(', ')}` : '' });
  } catch (e) {
    if (e instanceof DriveUnknownOutcome) return done({ tax_save_state: docId ? 'partial' : 'unknown', tax_save_error: `tax save outcome unknown: ${errText(e)}` });
    return done({ tax_save_state: docId ? 'partial' : 'failed', tax_save_error: `tax save failed: ${errText(e)}` });
  }
}