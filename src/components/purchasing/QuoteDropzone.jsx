import React, { useRef, useState } from 'react';
import { UploadCloud, FileText, Loader2, AlertCircle, RotateCw } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { C } from '@/lib/feeUI';

// Private quote-PDF dropzone. The PDF bytes go to purchasingQuoteIngest, which
// (after owner-id auth) uploads them to private storage itself and records a
// server-only receipt. The client never sees or sends a file ref or URL.
// One stable request_key per chosen file: a retry after an unknown outcome
// reuses it, so the server replays instead of creating a duplicate.
const MAX_PDF_BYTES = 5 * 1024 * 1024;

const toBase64 = (file) => new Promise((resolve, reject) => {
  const r = new FileReader();
  r.onload = () => resolve(String(r.result).split(',')[1] || '');
  r.onerror = () => reject(new Error('Could not read the file.'));
  r.readAsDataURL(file);
});

export default function QuoteDropzone({ onDone }) {
  const inputRef = useRef(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState(null);
  const [pending, setPending] = useState(null); // { file, key } kept for a same-key retry
  const [dragOver, setDragOver] = useState(false);

  async function send(job) {
    setBusy(true); setStatus(null);
    try {
      const file_base64 = await toBase64(job.file);
      const res = await base44.functions.invoke('purchasingQuoteIngest', {
        action: 'ingest', file_name: job.file.name, file_type: job.file.type || '', file_base64, request_key: job.key,
      });
      const data = res?.data || res;
      if (data?.error) throw new Error(data.error);
      setPending(null);
      setStatus({ kind: 'ok', text: data.duplicate || data.recovered ? `Already saved: ${data.title || 'quote'}` : `Saved: ${data.title || job.file.name}` });
      if (onDone) onDone(data);
    } catch (e) {
      const code = e?.response?.data?.error || e?.message || 'ingest_failed';
      setStatus({ kind: 'error', text: String(code).slice(0, 200) });
    } finally {
      setBusy(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  function choose(file) {
    if (!file || busy) return;
    if (!/\.pdf$/i.test(file.name)) { setStatus({ kind: 'error', text: 'Quote must be a PDF.' }); return; }
    if (file.size > MAX_PDF_BYTES) { setStatus({ kind: 'error', text: 'Quote PDF must be under 5 MB.' }); return; }
    const job = { file, key: crypto.randomUUID() };
    setPending(job);
    send(job);
  }

  return (
    <div className="rounded-[12px] p-4" style={{ backgroundColor: '#FFFFFF', border: `1.5px dashed ${dragOver ? '#0B3F3B' : C.border}` }}
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); choose(e.dataTransfer.files?.[0]); }}>
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: 'var(--gf-teal-050)' }}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" style={{ color: '#0B3F3B' }} /> : <UploadCloud className="h-4 w-4" style={{ color: '#0B3F3B' }} />}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold" style={{ color: C.text }}>Drop a vendor quote PDF</p>
          <p className="text-[11.5px]" style={{ color: C.textSecondary }}>Stored privately, no public link. Up to 5 MB.</p>
        </div>
        <button type="button" disabled={busy} onClick={() => inputRef.current?.click()} className="inline-flex min-h-9 items-center gap-1.5 rounded-[8px] px-3 text-[12.5px] font-semibold" style={{ backgroundColor: '#0B3F3B', color: '#FFFFFF' }}>
          <FileText size={14} /> Choose PDF
        </button>
        <input ref={inputRef} type="file" accept="application/pdf" className="hidden" onChange={(e) => choose(e.target.files?.[0])} />
      </div>
      {status && (
        <div className="mt-2.5 flex items-center gap-2 text-[12px]" style={{ color: status.kind === 'error' ? 'var(--gf-error)' : '#166447' }}>
          {status.kind === 'error' && <AlertCircle className="h-3.5 w-3.5 shrink-0" />}
          <span className="flex-1">{status.text}</span>
          {status.kind === 'error' && pending && !busy && (
            <button type="button" onClick={() => send(pending)} className="inline-flex items-center gap-1 rounded-[7px] border px-2 py-1 font-semibold" style={{ borderColor: C.border, color: C.text }}>
              <RotateCw className="h-3 w-3" /> Try again
            </button>
          )}
        </div>
      )}
    </div>
  );
}