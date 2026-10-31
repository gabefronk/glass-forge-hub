// Job files on Budget & Orders (Gabriel, Oct 30; one compact line since Oct 31): the job's
// Drive folder, its file count (click for the list) and a drop target, all on one row of the
// sheet. A vendor quote PDF is read into a budget (stored privately, exactly as before);
// drawings, photos and emails go to the job's Drive folder. Each dropped file shows where it
// is going (a dropdown, guessed from its name) before Upload. Choosing files and linking a
// folder live in the sheet's Add menu (pick() / link() on the ref). Every Drive link on the
// job follows Jobs.drive_job_folder_id, so they all move together.
import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { ArrowUpRight, ChevronDown, ChevronRight, Loader2, UploadCloud } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { useJobFolderFiles } from '@/hooks/use-job-folder-files';
import { fileProblem, fileSizeLabel, guessFileKind, uploadQuote, uploadToJobFolder } from '@/lib/jobFileUpload';
import { etaDate } from '@/lib/purchasingSummary';

const INK = '#101617', INK2 = '#566063', INK3 = '#34403F', RULE = '#EEE9E0', EDGE = '#E2DCD1', TEAL = '#0B3F3B', RED = '#A43432';
const BTN = 'inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-[9px] px-3 text-[13px] font-medium no-underline disabled:opacity-60';
const SEC = { border: `1px solid ${EDGE}`, backgroundColor: '#FFFFFF', color: INK3 };
const PRI = { border: `1px solid ${TEAL}`, backgroundColor: TEAL, color: '#FFFFFF', fontWeight: 600 };
const invoke = (name, body) => base44.functions.invoke(name, body);
const errorText = (e) => e?.response?.data?.error || e?.message || 'Upload failed. Try again.';

function FolderLinkForm({ jobId, onLinked, onCancel }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false), [error, setError] = useState('');
  async function link(e) {
    e.preventDefault(); if (busy || !text.trim()) return;
    setBusy(true); setError('');
    try {
      const r = (await invoke('job-documents', { action: 'attach_folder', job_id: jobId, folder_id: text.trim() })).data;
      if (r?.error) throw new Error(r.error);
      onLinked(r.folder);
    } catch (err) { setError(errorText(err)); } finally { setBusy(false); }
  }
  return (
    <form onSubmit={link} className="flex flex-col gap-1.5 px-4 py-3" style={{ borderTop: `1px solid ${RULE}` }}>
      <label className="text-[13px] font-semibold" style={{ color: INK }} htmlFor={`folder-link-${jobId}`}>Drive folder link (must be inside Glass Forge Jobs)</label>
      <div className="flex flex-wrap gap-2">
        <input id={`folder-link-${jobId}`} autoFocus value={text} onChange={(e) => { setText(e.target.value); setError(''); }} disabled={busy}
          placeholder="https://drive.google.com/drive/folders/…" className="h-9 min-w-[240px] flex-1 rounded-[9px] border px-2.5 text-[13px]" style={{ borderColor: EDGE, color: INK }} />
        <button type="submit" disabled={busy || !text.trim()} className={BTN} style={PRI}>{busy ? 'Linking…' : 'Link folder'}</button>
        <button type="button" disabled={busy} onClick={onCancel} className={BTN} style={SEC}>Cancel</button>
      </div>
      {error ? <p role="alert" className="text-[13px] font-semibold" style={{ color: RED }}>{error}</p> : null}
    </form>
  );
}

function FolderFiles({ folder, files }) {
  const rows = [...files].sort((a, b) => String(b.modified_at || '').localeCompare(String(a.modified_at || ''))).slice(0, 50);
  if (!rows.length) return <p className="px-4 py-2 text-[13px]" style={{ color: INK2, borderTop: `1px solid ${RULE}` }}>{folder.name} is empty.</p>;
  return rows.map((f) => (
    <div key={f.id} className="flex items-center gap-3 px-4 py-1.5 text-[13px]" style={{ borderTop: `1px solid ${RULE}` }}>
      <a href={f.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate font-medium hover:underline" style={{ color: INK }}>{f.name}</a>
      <span className="whitespace-nowrap tabular-nums" style={{ color: INK2 }}>{etaDate(String(f.modified_at || '').slice(0, 10)) || ''}</span>
    </div>
  ));
}

const JobFilesPanel = forwardRef(function JobFilesPanel({ job, onSaved, onFolderChange, headClass, headStyle }, ref) {
  const inputRef = useRef(null);
  const [refresh, setRefresh] = useState(0);
  const folderState = useJobFolderFiles(job, refresh);
  const folder = folderState.folder;
  const [linking, setLinking] = useState(false);
  const [showFiles, setShowFiles] = useState(false);
  const [queue, setQueue] = useState([]);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const patch = (id, next) => setQueue((q) => q.map((it) => (it.id === id ? { ...it, ...next } : it)));

  useImperativeHandle(ref, () => ({
    pick: () => inputRef.current?.click(),
    link: () => setLinking(true),
  }), []);
  useEffect(() => { onFolderChange?.(Boolean(folder)); }, [folder, onFolderChange]);

  function add(list) {
    const files = Array.from(list || []);
    if (!files.length || busy) return;
    setQueue((q) => [...q.filter((it) => it.status !== 'done'), ...files.map((file) => ({ id: crypto.randomUUID(), key: crypto.randomUUID(), file, kind: guessFileKind(file), status: 'ready', note: '' }))]);
    if (inputRef.current) inputRef.current.value = '';
  }

  async function upload() {
    if (busy) return;
    setBusy(true);
    let quotes = 0, saved = 0, savedTo = '';
    for (const it of queue.filter((x) => x.status !== 'done')) {
      const problem = fileProblem(it.file, it.kind);
      if (problem) { patch(it.id, { status: 'error', note: problem }); continue; }
      patch(it.id, { status: 'uploading', note: 'Uploading…' });
      try {
        if (it.kind === 'quote') {
          const data = await uploadQuote({ invoke, jobId: job.id, file: it.file, requestKey: it.key });
          patch(it.id, { status: 'done', note: data.duplicate || data.recovered ? `Already on this job: ${data.title || 'quote'}` : `Read into the budget: ${data.title || it.file.name}` });
          quotes += 1;
        } else {
          const file = await uploadToJobFolder({ invoke, jobId: job.id, file: it.file, onProgress: (p) => patch(it.id, { note: `Uploading… ${Math.round(p * 100)}%` }) });
          patch(it.id, { status: 'done', note: `Saved in ${file.folder?.name || 'the job folder'}`, url: file.url });
          saved += 1; savedTo = file.folder?.name || savedTo;
        }
      } catch (e) { patch(it.id, { status: 'error', note: errorText(e) }); }
    }
    setBusy(false);
    if (saved) setRefresh((k) => k + 1);
    if (quotes || saved) {
      const parts = [quotes ? `${quotes} quote${quotes === 1 ? '' : 's'} read into the budget - check the numbers above.` : '', saved ? `${saved} file${saved === 1 ? '' : 's'} saved to Drive · ${savedTo || 'job folder'}.` : ''];
      onSaved?.(parts.filter(Boolean).join(' '));
    }
  }

  const waiting = queue.filter((it) => it.status === 'ready' || it.status === 'error').length;
  const count = folderState.files.length;

  return (
    <section aria-label="Job files"
      onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)}
      onDrop={(e) => { e.preventDefault(); setDragOver(false); add(e.dataTransfer.files); }}
      style={dragOver ? { outline: `2px dashed ${TEAL}`, outlineOffset: -2 } : undefined}>
      <div className={headClass} style={headStyle}>
        <h3 className="text-[15px] font-semibold" style={{ color: INK }}>Files</h3>
        {folderState.loading && !folder ? <span className="text-[13.5px]" style={{ color: INK2 }}>Drive folder…</span>
          : folder ? (
            <>
              <button type="button" onClick={() => setShowFiles((v) => !v)} aria-expanded={showFiles}
                className="inline-flex items-center gap-1 rounded-[7px] px-1.5 py-1 text-[13.5px] font-medium hover:bg-black/5" style={{ color: INK }}>
                {showFiles ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                {folder.name} · {count} file{count === 1 ? '' : 's'}
              </button>
              <a href={folder.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[13.5px] font-semibold underline-offset-2 hover:underline" style={{ color: TEAL }}>Open in Drive<ArrowUpRight className="h-3.5 w-3.5" /></a>
            </>
          ) : <span className="text-[13.5px]" style={{ color: INK3 }}>No Drive folder linked</span>}
        <span className="flex-1" />
        <button type="button" disabled={busy} onClick={() => inputRef.current?.click()}
          className="inline-flex h-8 items-center gap-1.5 rounded-[8px] px-2.5 text-[13px] font-medium disabled:opacity-60"
          style={{ border: `1px dashed ${dragOver ? TEAL : '#9A9080'}`, color: INK3, backgroundColor: '#FFFFFF' }}
          title="Vendor quote PDFs (up to 5 MB) are read into the budget and kept private. Everything else goes to the job's Drive folder (up to 50 MB).">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}Drop files here
        </button>
        <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => add(e.target.files)} />
      </div>
      {folderState.error ? <p className="px-4 py-2 text-[13px]" style={{ color: RED, borderTop: `1px solid ${RULE}` }}>{folderState.error}</p> : null}
      {linking ? (
        <FolderLinkForm jobId={job.id} onCancel={() => setLinking(false)}
          onLinked={(f) => { setLinking(false); setRefresh((k) => k + 1); onSaved?.(`Drive folder linked: ${f?.name || 'folder'}. This job's Drive links and uploads now use it.`); }} />
      ) : null}
      {showFiles && folder ? <FolderFiles folder={folder} files={folderState.files} /> : null}
      {queue.length > 0 && (
        <div style={{ borderTop: `1px solid ${RULE}` }}>
          {queue.map((it, idx) => (
            <div key={it.id} className="grid items-center gap-3 px-4 py-2 text-[13px] [grid-template-columns:minmax(0,2fr)_72px_minmax(190px,1fr)_minmax(0,1.4fr)] max-[767px]:[grid-template-columns:1fr_auto]" style={idx ? { borderTop: `1px solid ${RULE}` } : undefined}>
              <span className="truncate font-medium" style={{ color: INK }} title={it.file.name}>{it.file.name}</span>
              <span className="text-right tabular-nums max-[767px]:hidden" style={{ color: INK2 }}>{fileSizeLabel(it.file.size)}</span>
              <select aria-label={`Where ${it.file.name} goes`} value={it.kind} disabled={busy || it.status === 'done'}
                onChange={(e) => patch(it.id, { kind: e.target.value, status: 'ready', note: '' })}
                className="h-9 rounded-[8px] border bg-white px-2 text-[13px]" style={{ borderColor: EDGE, color: INK }}>
                <option value="quote">Vendor quote · read into budget</option>
                <option value="drive">Job document · save to Drive</option>
              </select>
              <span className="min-w-0 max-[767px]:col-span-2" style={{ color: it.status === 'error' ? RED : it.status === 'done' ? '#166447' : INK2 }}>
                {it.url ? <a href={it.url} target="_blank" rel="noreferrer" className="font-semibold hover:underline">{it.note}</a> : it.note}
              </span>
            </div>
          ))}
          <div className="flex flex-wrap gap-2 px-4 py-2.5" style={{ borderTop: `1px solid ${RULE}` }}>
            <button type="button" disabled={busy || !waiting} onClick={upload} className={BTN} style={PRI}>{busy ? 'Uploading…' : `Upload ${waiting} file${waiting === 1 ? '' : 's'}`}</button>
            <button type="button" disabled={busy} onClick={() => setQueue([])} className={BTN} style={SEC}>Clear</button>
          </div>
        </div>
      )}
    </section>
  );
});

export default JobFilesPanel;
