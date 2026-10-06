// Copies files attached to Israel's calendar events into the linked job's
// Drive folder, so the crew can open them from Plans & photos.
//
// Sources:
//  - Drive attachments are copied with the Drive API (no download).
//  - Gmail attachments ("mail.google.com/?view=att&th=…&attid=…") are read
//    through the Gmail connector (read-only), which must be connected to
//    Israel's account. Without it they are left alone and retried later.
// Nothing is ever deleted, in Gmail or in Drive.
import { ensureJobFolder } from './jobDocuments.mjs';
import { driveFileId } from './eventAttachments.js';

const DRIVE = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink,size';
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';
export const MAX_COPY_BYTES = 25 * 1024 * 1024;
// Errors that will not fix themselves; everything else is retried next run.
const PERMANENT = new Set(['too_large', 'gmail_not_found', 'gmail_no_match', 'drive_source_not_found']);

export function gmailRef(url) {
  try {
    const u = new URL(url || '');
    if (u.hostname !== 'mail.google.com' || u.searchParams.get('view') !== 'att') return null;
    const thread = u.searchParams.get('th'), attid = u.searchParams.get('attid') || '';
    if (!thread || !/^[\w-]+$/.test(thread)) return null;
    const index = Number(attid.split('.').pop());
    return { thread, attid, index: Number.isInteger(index) && index > 0 ? index - 1 : 0 };
  } catch { return null; }
}

export function needsJobFolderCopy(attachment) {
  if (!attachment?.file_url || attachment.job_folder_file_id) return false;
  return !PERMANENT.has(attachment.job_folder_error || '');
}

const cleanName = (name) => String(name || 'Calendar attachment').replace(/[\\/:*?"<>|\u0000-\u001f]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180) || 'Calendar attachment';
const esc = (v) => String(v).replace(/\\/g, '\\\\').replace(/'/g, "\\'");

async function sourceKey(url) {
  const bytes = new TextEncoder().encode(url);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest).slice(0, 12), (b) => b.toString(16).padStart(2, '0')).join('');
}

function base64UrlToBytes(data) {
  const b64 = String(data || '').replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(b64 + '='.repeat((4 - (b64.length % 4)) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

// Attachment parts of a Gmail message, in the order Gmail shows them.
export function attachmentParts(message) {
  const out = [];
  const walk = (part) => {
    if (!part) return;
    if (part.filename && part.body?.attachmentId) out.push({ messageId: message.id, filename: part.filename, mimeType: part.mimeType || '', attachmentId: part.body.attachmentId, size: part.body.size || 0 });
    for (const p of part.parts || []) walk(p);
  };
  walk(message.payload);
  return out;
}

// Pick the part the calendar link points at: same file name first, then position.
export function pickPart(messages, ref, title) {
  const own = messages.find((m) => m.id === ref.thread) || messages[0];
  const all = messages.flatMap(attachmentParts);
  const ownParts = own ? attachmentParts(own) : [];
  const want = String(title || '').trim().toLowerCase();
  if (want) {
    const named = (list) => list.filter((p) => p.filename.trim().toLowerCase() === want);
    const inOwn = named(ownParts);
    if (inOwn.length === 1) return inOwn[0];
    if (inOwn.length > 1) return inOwn[Math.min(ref.index, inOwn.length - 1)];
    const anywhere = named(all);
    if (anywhere.length) return anywhere[0];
  }
  return ownParts[ref.index] || null;
}

function multipartBody(metadata, bytes, mime) {
  const boundary = 'gfhub' + crypto.randomUUID().replace(/-/g, '');
  const enc = new TextEncoder();
  const head = enc.encode(`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n--${boundary}\r\nContent-Type: ${mime || 'application/octet-stream'}\r\n\r\n`);
  const tail = enc.encode(`\r\n--${boundary}--`);
  const body = new Uint8Array(head.length + bytes.length + tail.length);
  body.set(head, 0); body.set(bytes, head.length); body.set(tail, head.length + bytes.length);
  return { body, contentType: `multipart/related; boundary=${boundary}` };
}

export async function copyEventFilesToJobFolders({ client, events, limit = 25, fetchImpl = fetch, now = () => new Date() }) {
  const api = client.asServiceRole.entities;
  const summary = { copied: 0, reused: 0, skipped_no_job: 0, waiting_for_gmail: 0, failed: 0, remaining: 0 };
  const token = async (kind) => { try { return (await client.asServiceRole.connectors.getConnection(kind))?.accessToken || null; } catch { return null; } };
  let driveToken, gmailToken, gmailChecked = false;
  const folders = new Map();
  const jobs = new Map();

  const driveJson = async (path, init = {}) => {
    const r = await fetchImpl(DRIVE + path, { ...init, headers: { Authorization: 'Bearer ' + driveToken, ...(init.headers || {}) } });
    if (!r.ok) { const e = new Error(`drive_${r.status}`); e.status = r.status; throw e; }
    return r.json();
  };
  const gmailJson = async (path) => {
    const r = await fetchImpl(GMAIL + path, { headers: { Authorization: 'Bearer ' + gmailToken } });
    if (!r.ok) { const e = new Error(`gmail_${r.status}`); e.status = r.status; throw e; }
    return r.json();
  };
  const folderFor = async (jobId) => {
    if (folders.has(jobId)) { const f = folders.get(jobId); if (f instanceof Error) throw f; return f; }
    try {
      const job = jobs.get(jobId) || await api.Jobs.get(jobId);
      if (!job) throw new Error('job_not_found');
      jobs.set(jobId, job);
      const r = await ensureJobFolder({ drive: driveJson, api, job });
      if (r.status !== 200) throw new Error(r.status === 409 ? 'folder_conflict' : 'folder_unavailable');
      folders.set(jobId, r.body.folder.id);
      return r.body.folder.id;
    } catch (error) { folders.set(jobId, error); throw error; }
  };
  const existing = async (folderId, key) => {
    const q = `'${esc(folderId)}' in parents and trashed=false and appProperties has { key='gf_source' and value='${esc(key)}' }`;
    return ((await driveJson('/files?q=' + encodeURIComponent(q) + '&fields=files(id,webViewLink)&pageSize=1')).files || [])[0] || null;
  };

  const pending = [];
  for (const event of events || []) {
    (event.event_attachments || []).forEach((a, index) => { if (needsJobFolderCopy(a)) pending.push({ event, index }); });
  }
  const touched = new Map();
  let used = 0;
  for (const item of pending) {
    if (used >= limit) { summary.remaining++; continue; }
    const { event, index } = item;
    if (!event.job_id) { summary.skipped_no_job++; continue; }
    const current = touched.get(event.id) || [...event.event_attachments];
    const a = { ...current[index] };
    const ref = gmailRef(a.file_url);
    const driveId = ref ? '' : driveFileId(a);
    if (!ref && !driveId) continue; // some other link type: nothing to copy
    if (ref && !gmailChecked) { gmailChecked = true; gmailToken = await token('gmail'); }
    if (ref && !gmailToken) { summary.waiting_for_gmail++; continue; }
    used++;
    try {
      if (driveToken === undefined) driveToken = await token('googledrive');
      if (!driveToken) throw new Error('no_drive_access');
      const folderId = await folderFor(event.job_id);
      const key = await sourceKey(a.file_url);
      const appProperties = { gf_source: key, gf_event: String(event.id).slice(0, 60) };
      let file = await existing(folderId, key);
      if (file) summary.reused++;
      else if (driveId) {
        try {
          file = await driveJson(`/files/${encodeURIComponent(driveId)}/copy?fields=id,webViewLink`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: cleanName(a.title), parents: [folderId], appProperties }),
          });
        } catch (error) { throw new Error(error.status === 404 ? 'drive_source_not_found' : error.message); }
        summary.copied++;
      } else {
        let messages;
        try { messages = (await gmailJson(`/threads/${ref.thread}?format=full`)).messages || []; }
        catch (error) {
          if (error.status !== 404) throw error;
          try { messages = [await gmailJson(`/messages/${ref.thread}?format=full`)]; }
          catch (inner) { throw new Error(inner.status === 404 ? 'gmail_not_found' : inner.message); }
        }
        const part = pickPart(messages, ref, a.title);
        if (!part) throw new Error('gmail_no_match');
        if (part.size > MAX_COPY_BYTES) throw new Error('too_large');
        const data = await gmailJson(`/messages/${part.messageId}/attachments/${part.attachmentId}`);
        const bytes = base64UrlToBytes(data.data);
        if (bytes.length > MAX_COPY_BYTES) throw new Error('too_large');
        const mime = a.mime_type || part.mimeType || 'application/octet-stream';
        const { body, contentType } = multipartBody({ name: cleanName(a.title || part.filename), parents: [folderId], appProperties }, bytes, mime);
        const r = await fetchImpl(UPLOAD, { method: 'POST', headers: { Authorization: 'Bearer ' + driveToken, 'Content-Type': contentType }, body });
        if (!r.ok) throw new Error(`drive_upload_${r.status}`);
        file = await r.json();
        summary.copied++;
      }
      Object.assign(a, {
        job_folder_file_id: file.id, job_folder_copied_at: now().toISOString(), job_folder_error: '',
        drive_file_id: file.id, drive_url: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`,
      });
    } catch (error) {
      a.job_folder_error = String(error?.message || 'copy_failed').slice(0, 60);
      summary.failed++;
    }
    current[index] = a;
    touched.set(event.id, current);
  }
  for (const [id, event_attachments] of touched) await api.CalendarEvents.update(id, { event_attachments });
  return summary;
}
