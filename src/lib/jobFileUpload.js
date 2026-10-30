// Files dropped on a job's Budget & Orders page (Gabriel, Oct 30). A vendor quote PDF is read
// into a budget (purchasingQuoteIngest, stored privately, unchanged); anything else - drawings,
// photos, emails - goes to the job's Drive folder through job-documents upload_start /
// upload_chunk. Pure apart from the injected invoke, so it runs under node --test.

export const MAX_QUOTE_BYTES = 5 * 1024 * 1024;
export const MAX_DRIVE_BYTES = 50 * 1024 * 1024; // job-documents MAX_UPLOAD_BYTES
export const DRIVE_CHUNK_BYTES = 2 * 1024 * 1024; // job-documents UPLOAD_CHUNK_BYTES (8 x 256 KiB)

// Words that mark a PDF as a supplier quote rather than drawings or notes.
const QUOTE_WORDS = /\b(quote|quotation|estimate|proposal|amsco|pella|andersen|milgard|windor|marvin|jeld|ply ?gem|simonton|anlin|western window|fhc|frameless|bmc|abc supply|nu ?vista|studio)\b/i;

export const isPdf = (file) => /\.pdf$/i.test(file?.name || '') || file?.type === 'application/pdf';

// 'quote' (read into the budget) or 'drive' (saved to the job folder). Only a PDF can be a
// quote; the owner can change the pick before uploading.
export function guessFileKind(file) {
  return isPdf(file) && QUOTE_WORDS.test(String(file?.name || '').replace(/[_.-]+/g, ' ')) ? 'quote' : 'drive';
}

// '' when the file can go where it is headed, else why not.
export function fileProblem(file, kind) {
  if (!file?.size) return 'The file is empty.';
  if (kind === 'quote') {
    if (!isPdf(file)) return 'A vendor quote must be a PDF.';
    if (file.size > MAX_QUOTE_BYTES) return 'A vendor quote PDF must be under 5 MB.';
    return '';
  }
  return file.size > MAX_DRIVE_BYTES ? 'Files must be under 50 MB.' : '';
}

export function fileSizeLabel(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

// Byte ranges for the Drive upload: full chunks, then whatever is left.
export function chunkRanges(size, chunk = DRIVE_CHUNK_BYTES) {
  const out = [];
  for (let start = 0; start < size; start += chunk) out.push({ start, end: Math.min(start + chunk, size) });
  return out;
}

export async function blobToBase64(blob) {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

const dataOf = (res) => {
  const data = res?.data ?? res;
  if (data?.error) throw new Error(data.error);
  return data;
};

// invoke(functionName, body) -> the SDK response. Resolves to the Drive file { id, name, url }.
export async function uploadToJobFolder({ invoke, jobId, file, onProgress }) {
  const start = dataOf(await invoke('job-documents', { action: 'upload_start', job_id: jobId, file_name: file.name, mime_type: file.type || '', size: file.size }));
  const chunk = Number(start.chunk_bytes) || DRIVE_CHUNK_BYTES;
  for (const { start: from, end } of chunkRanges(file.size, chunk)) {
    const data = await blobToBase64(file.slice(from, end));
    const sent = dataOf(await invoke('job-documents', { action: 'upload_chunk', job_id: jobId, upload_url: start.upload_url, offset: from, total: file.size, data }));
    onProgress?.(end / file.size);
    if (sent.done) return { ...sent.file, folder: start.folder };
  }
  throw new Error('Drive did not confirm the upload. Check the folder before trying again.');
}

// The private vendor-quote read (same call the quote dropzone always made). One request_key
// per chosen file, so a retry after an unknown outcome replays instead of duplicating.
export async function uploadQuote({ invoke, jobId, file, requestKey }) {
  const file_base64 = await blobToBase64(file);
  return dataOf(await invoke('purchasingQuoteIngest', {
    action: 'ingest', file_name: file.name, file_type: file.type || '', file_base64, request_key: requestKey, ...(jobId ? { job_id: jobId } : {}),
  }));
}
