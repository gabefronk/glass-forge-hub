import { useRef, useState } from 'react';
import { UploadCloud } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { messageOf } from '@/components/budgets/ProcurementForms';
import { C } from '@/lib/feeUI';

// Compact quote-PDF dropzone reusing the existing jobBudgetIngest flow. New
// quotes start as drafts (no job required) and appear in the unlinked review
// list / the existing Procurement budgets tab. Quote PDFs are uploaded with
// UploadFile (public), matching the existing Procurement dropzone behavior.
export default function QuoteDropzone({ onDone }) {
  const inputRef = useRef(null);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const [items, setItems] = useState([]);
  const busyRef = useRef(false);

  const processFiles = async (files) => {
    if (busyRef.current) return;
    const pdfs = Array.from(files || []).filter((f) => /\.pdf$/i.test(f.name));
    if (!pdfs.length) { setItems([{ key: 'err', name: '', status: 'Choose PDF quote files.' }]); return; }
    if (pdfs.length > 10 || pdfs.some((f) => f.size > 30 * 1024 * 1024)) { setItems([{ key: 'err', name: '', status: 'Up to 10 PDFs, each under 30 MB.' }]); return; }
    busyRef.current = true; setBusy(true); setItems([]);
    try {
      for (const file of pdfs) {
        const key = crypto.randomUUID();
        const upd = (p) => setItems((rows) => rows.map((r) => (r.key === key ? { ...r, ...p } : r)));
        setItems((rows) => [...rows, { key, name: file.name, status: 'Uploading…' }]);
        try {
          const up = await base44.integrations.Core.UploadFile({ file });
          if (!up?.file_url) throw new Error('Upload failed');
          upd({ status: 'Reading quote…' });
          const res = await base44.functions.invoke('jobBudgetIngest', { file_url: up.file_url, file_name: file.name });
          const r = res?.data ?? res;
          if (r?.error) throw new Error(r.error);
          upd({ status: r.budget_id ? 'Draft saved' : 'Needs review', ok: true });
        } catch (e) { upd({ status: messageOf(e), failed: true }); }
      }
    } finally { busyRef.current = false; setBusy(false); onDone?.(); }
  };

  return (
    <div>
      <button type="button" disabled={busy} onDragOver={(e) => { e.preventDefault(); setDragging(true); }} onDragLeave={() => setDragging(false)} onDrop={(e) => { e.preventDefault(); setDragging(false); processFiles(e.dataTransfer.files); }} onClick={() => inputRef.current?.click()} className={`flex w-full flex-col items-center gap-1.5 rounded-[10px] border-2 border-dashed px-4 py-5 text-[12.5px] ${dragging ? 'border-emerald-700 bg-emerald-50' : 'border-[#D3CABB] bg-[#FAF8F3]'}`} style={{ color: C.textSecondary }}>
        <UploadCloud size={22} />
        <strong style={{ color: C.text }}>{busy ? 'Saving quote drafts…' : 'Drop quote PDFs or choose files'}</strong>
        <span>Up to 10 files, 30 MB each</span>
      </button>
      <input ref={inputRef} type="file" accept="application/pdf" multiple className="hidden" onChange={(e) => { processFiles(e.target.files); e.target.value = ''; }} />
      {items.map((p) => (
        <div key={p.key} className="mt-1.5 rounded-[7px] px-2.5 py-1.5 text-[12px]" style={{ backgroundColor: p.failed ? 'var(--gf-error-bg)' : '#FAF8F3', color: p.failed ? 'var(--gf-error)' : C.textSecondary }}>
          {p.name && <strong style={{ color: C.text }}>{p.name}</strong>} {p.status}
        </div>
      ))}
    </div>
  );
}