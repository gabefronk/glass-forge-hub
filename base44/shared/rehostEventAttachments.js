import { driveFileId, isGmailOnlyAttachment } from './eventAttachments.js';
import { fetchAllPages } from './pagination.ts';

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;

async function readBounded(response, maximum) {
  const stated = Number(response.headers.get('content-length'));
  if (stated > maximum) throw new Error('too_large');
  const reader = response.body.getReader(), chunks = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.length;
      if (size > maximum) { await reader.cancel(); throw new Error('too_large'); }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(size); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

const sha256 = async bytes => Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), b => b.toString(16).padStart(2, '0')).join('');
const cleanName = (name, fallback = 'calendar-attachment') => String(name || fallback).replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').slice(0, 180);

async function driveDownload(attachment, accessToken, fetchImpl) {
  const id = driveFileId(attachment);
  if (!id) throw new Error('no_drive_file_id');
  const auth = { Authorization: `Bearer ${accessToken}` };
  const metadataResponse = await fetchImpl(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?fields=name,mimeType,size`, { headers: auth });
  if (!metadataResponse.ok) throw new Error(`drive_metadata_${metadataResponse.status}`);
  const metadata = await metadataResponse.json();
  const googleDocument = String(metadata.mimeType || '').startsWith('application/vnd.google-apps.');
  const mime = googleDocument ? 'application/pdf' : (metadata.mimeType || attachment.mime_type || 'application/octet-stream');
  const url = googleDocument
    ? `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}/export?mimeType=${encodeURIComponent('application/pdf')}`
    : `https://www.googleapis.com/drive/v3/files/${encodeURIComponent(id)}?alt=media`;
  const response = await fetchImpl(url, { headers: auth });
  if (!response.ok) throw new Error(`drive_download_${response.status}`);
  return { response, mime, name: cleanName(metadata.name, attachment.title) + (googleDocument && !/\.pdf$/i.test(metadata.name || '') ? '.pdf' : '') };
}

export async function rehostEventAttachments({ client, eventIds, limit = 20, fetchImpl = fetch, now = () => new Date() }) {
  const api = client.asServiceRole.entities.CalendarEvents;
  const selected = eventIds?.length
    ? (await Promise.all(eventIds.map(id => api.get(id)))).filter(Boolean)
    : await fetchAllPages(api, '-event_date', 500);
  const pending = [];
  for (const event of selected) for (let index = 0; index < (event.event_attachments || []).length; index++) {
    const attachment = event.event_attachments[index];
    // A copy already saved in the job's Drive folder is the one the crew opens.
    if (!attachment?.hub_file_uri && !attachment?.job_folder_file_id) pending.push({ event, index, attachment });
  }
  let driveToken = null, driveChecked = false;
  const results = [];
  for (const item of pending.slice(0, Math.max(1, Math.min(Number(limit) || 20, 50)))) {
    const attachments = [...item.event.event_attachments], patch = { ...item.attachment };
    try {
      if (isGmailOnlyAttachment(patch)) throw new Error('gmail_only');
      if (!driveFileId(patch)) throw new Error('unsupported_source');
      if (!driveChecked) {
        driveChecked = true;
        try { driveToken = (await client.asServiceRole.connectors.getConnection('googledrive')).accessToken; } catch { driveToken = null; }
      }
      if (!driveToken) throw new Error('no drive access');
      const { response, mime, name } = await driveDownload(patch, driveToken, fetchImpl);
      const bytes = await readBounded(response, MAX_ATTACHMENT_BYTES);
      const digest = await sha256(bytes);
      const uploaded = await client.asServiceRole.integrations.Core.UploadPrivateFile({ file: new File([bytes], name, { type: mime }) });
      if (!uploaded.file_uri) throw new Error('upload_failed');
      Object.assign(patch, { hub_file_uri: uploaded.file_uri, hub_uploaded_at: now().toISOString(), hub_size: bytes.length, hub_sha256: digest, hub_error: '' });
    } catch (error) {
      patch.hub_error = error?.message || 'copy_failed';
    }
    attachments[item.index] = patch;
    await api.update(item.event.id, { event_attachments: attachments });
    item.event.event_attachments = attachments;
    results.push({ event_id: item.event.id, attachment_index: item.index, copied: !!patch.hub_file_uri, error: patch.hub_error || '' });
  }
  return { processed: results.length, remaining: Math.max(0, pending.length - results.length), results };
}
