import React, { useRef, useState } from 'react';
import { UploadCloud, FileText, Loader2, AlertCircle } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { C } from '@/lib/feeUI';

// Private quote-PDF dropzone for the Purchasing page. Uploads via the SDK's
// private storage (UploadPrivateFile → file_uri), then sends the private ref to
// the purchasingQuoteIngest backend, which signs a short-lived fetch URL
// server-side only. No public URL is ever created, persisted, or returned.
// Owner-ID auth runs on the server before any file/entity/provider read.
const MAX_PDF_BYTES = 30 * 1024 * 1024;
const PDF = 'application/pdf';

export default function QuoteDropzone({ onDone }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null); // {kind:'ok'|'error', text}
  const [dragOver, setDragOver] = useState(false);

  const reset = () => { if (inputRef.current) inputRef.current.value = ''; };

  async function ingest(file) {
    if (!file) return;
    if (file.type !== PDF && !/\.pdf$/i.test(file.name)) { setStatus({ kind: 'error', text: 'Quote must be a PDF.' }); return; }
    if (file.size > MAX_PDF_BYTES) { setStatus({ kind: 'error', text: 'Quote PDF must be under 30 MB.' }); return; }
    setBusy(true); setStatus(null);
    try {
      // 1. Private upload — no public URL, access follows app permissions.
      const { file_uri } = await base44.integrations.Core.UploadPrivateFile({ file });
      if (!file_uri) throw new Error('Private upload failed.');
      // 2. Server ingest — owner-auth first, server-side signing, private ref persisted.
      const res = await base44.functions.invoke('purchasingQuoteIngest', {
        action: 'ingest', file_uri, file_name: file.name, request_key: crypto.randomUUID(),
      });
      const data = res?.data || res;
      if (data?.error) throw new Error(data.error);
      setStatus({ kind: 'ok', text: data.duplicate ? `Already saved: ${data.title || 'quote'}` : `Saved: ${data.title || file.name}` });
      if (onDone) onDone(data);
    } catch (e) {
      setStatus({ kind: 'error', text: String(e?.message || e).slice(0, 200) });
    } finally {
      setBusy(false); reset();
    }
  }

  return (
    <div
      className="rounded-[12px] p-4"
      style={{ backgroundColor: '#FFFFFF', border: `1.5px dashed ${dragOver ? '#0B3F3B' : C.border}` }}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); if (!busy) ingest(e.dataTransfer.files?.[0]); }}
    >
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: 'var(--gf-teal-050)' }}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" style={{ color: '#0B3F3B' }} /> : <UploadCloud className="h-4 w-4" style={{ color: '#0B3F3B' }} />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold" style={{ color: C.text }}>Drop a vendor quote PDF</p>
          <p className="text-[11.5px]" style={{ color: C.textSecondary }}>Stored privately — no public URL. The server signs a short-lived link only to read it.</p>
        </div>
        <button type="button" disabled={busy} onClick={() => inputRef.current?.click()} className="inline-flex min-h-9 items-center gap-1.5 rounded-[8px] px-3 text-[12.5px] font-semibold" style={{ backgroundColor: '#0B3F3B', color: '#FFFFFF' }}>
          <FileText size={14} /> Choose PDF
        </button>
        <input ref={inputRef} type="file" accept={PDF} className="hidden" onChange={(e) => { if (!busy) ingest(e.target.files?.[0]); }} />
      </div>
      {status && (
        <p className="mt-2.5 flex items-start gap-1.5 text-[12px]" style={{ color: status.kind === 'error' ? 'var(--gf-error)' : '#166447' }}>
          {status.kind === 'error' ? <AlertCircle className="mt-px h-3.5 w-3.5 shrink-0" /> : null}
          <span>{status.text}</span>
        </p>
      )}
    </div>
  );
}