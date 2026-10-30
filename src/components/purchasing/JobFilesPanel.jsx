// Job files on Budget & Orders (Gabriel, Oct 30): one drop area for everything about the job.
// A vendor quote PDF is read into a budget (stored privately, exactly as before); drawings,
// photos and emails go to the job's Drive folder. Each dropped file shows where it is going
// (a dropdown, guessed from its name) before Upload. The Drive folder menu opens the job's
// folder or links a different one from a pasted link; every Drive link on the job follows
// Jobs.drive_job_folder_id, so they all move together.
import { useRef, useState } from 'react';
import { ArrowUpRight, ChevronDown, FileText, Loader2, UploadCloud } from 'lucide-react';
import { base44 } from '@/api/base44Client';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { useJobFolderFiles } from '@/hooks/use-job-folder-files';
import { fileProblem, fileSizeLabel, guessFileKind, uploadQuote, uploadToJobFolder } from '@/lib/jobFileUpload';
import { etaDate } from '@/lib/purchasingSummary';

const INK = '#101617', INK2 = '#566063', RULE = '#EEE9E0', EDGE = '#E2DCD1', TEAL = '#0B3F3B', RED = '#A43432';
const BTN = 'inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-[9px] px-3 text-[13px] font-medium no-underline disabled:opacity-60';
const SEC = { border: `1px solid ${EDGE}`, backgroundColor: '#FFFFFF', color: '#34403F' };
const PRI = { border: `1px solid ${TEAL}`, backgroundColor: TEAL, color: '#FFFFFF', fontWeight: 600 };
const EYEBROW = 'text-[13px] font-semibold uppercase tracking-[0.08em]';
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
    <form onSubmit={link} className="flex flex-col gap-1.5 rounded-[10px] p-3" style={{ border: `1px solid ${EDGE}`, backgroundColor: '#FFFFFF' }}>
      <label className="text-[13px] font-semibold" style={{ color: INK }} htmlFor={`folder-link-${jobId}`}>Drive folder link</label>
      <div className="flex flex-wrap gap-2">
        <input id={`folder-link-${jobId}`} autoFocus value={text} onChange={(e) => { setText(e.target.value); setError(''); }} disabled={busy}
          placeholder="https://drive.google.com/drive/folders/…" className="h-9 min-w-[240px] flex-1 rounded-[9px] border px-2.5 text-[13px]" style={{ borderColor: EDGE, color: INK }} />
        <button type="submit" disabled={busy || !text.trim()} className={BTN} style={PRI}>{busy ? 'Linking…' : 'Link folder'}</button>
        <button type="button" disabled={busy} onClick={onCancel} className={BTN} style={SEC}>Cancel</button>
      </div>
      <p className="text-[13px]" style={{ color: INK2 }}>Open the folder in Drive and copy the address bar. It must be inside Glass Forge Jobs.</p>
      {error ? <p role="alert" className="text-[13px] font-semibold" style={{ color: RED }}>{error}</p> : null}
    </form>
  );
}

function FolderFiles({ folder, files }) {
  if (!folder) return null;
  const rows = [...files].sort((a, b) => String(b.modified_at || '').localeCompare(String(a.modified_at || ''))).slice(0, 50);
  return (
    <details className="text-[13px]" style={{ color: INK2 }}>
      <summary className="cursor-pointer font-semibold">{files.length} file{files.length === 1 ? '' : 's'} in {folder.name}</summary>
      {rows.length ? (
        <div className="mt-1.5 overflow-hidden rounded-[10px]" style={{ border: `1px solid ${RULE}` }}>
          {rows.map((f) => (
            <div key={f.id} className="flex items-center gap-3 px-3 py-1.5" style={{ borderTop: `1px solid ${RULE}` }}>
              <a href={f.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate font-medium hover:underline" style={{ color: INK }}>{f.name}</a>
              <span className="whitespace-nowrap tabular-nums">{etaDate(String(f.modified_at || '').slice(0, 10)) || ''}</span>
            </div>
          ))}
        </div>
      ) : <p className="mt-1">The folder is empty.</p>}
    </details>
  );
}

export default function JobFilesPanel({ job, onSaved }) {
  const inputRef = useRef(null);
  const [refresh, setRefresh] = useState(0);
  const folderState = useJobFolderFiles(job, refresh);
  const folder = folderState.folder;
  const [linking, setLinking] = useState(false);
  const [queue, setQueue] = useState([]);
  const [busy, setBusy] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const patch = (id, next) => setQueue((q) => q.map((it) => (it.id === id ? { ...it, ...next } : it)));

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
      const parts = [quotes ? `${quotes} quote${quotes === 1 ? '' : 's'} read into the budget - check the numbers below.` : '', saved ? `${saved} file${saved === 1 ? '' : 's'} saved to Drive · ${savedTo || 'job folder'}.` : ''];
      onSaved?.(parts.filter(Boolean).join(' '));
    }
  }

  const waiting = queue.filter((it) => it.status === 'ready' || it.status === 'error').length;
  const folderLabel = folderState.loading && !folder ? 'Drive folder…' : folder ? `Drive folder · ${folder.name}` : 'Link Drive folder';

  return (
    <section className="flex flex-col gap-2" aria-label="Job files">
      <div className="flex flex-wrap items-center gap-2">
        <span className={EYEBROW} style={{ color: INK2 }}>Job files</span>
        <span className="flex-1" />
        {folder ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button type="button" className={BTN} style={SEC} title={folder.url}>{folderLabel}<ChevronDown className="h-4 w-4" /></button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[240px] p-1">
              <DropdownMenuItem asChild className="flex min-h-9 cursor-pointer items-center justify-between gap-6 text-[14px]">
                <a href={folder.url} target="_blank" rel="noreferrer">Open in Drive<ArrowUpRight className="h-4 w-4" /></a>
              </DropdownMenuItem>
              <DropdownMenuItem className="flex min-h-9 cursor-pointer items-center text-[14px]" onSelect={() => setLinking(true)}>Link a different folder</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : (
          <button type="button" disabled={folderState.loading} onClick={() => setLinking(true)} className={BTN} style={SEC}>{folderLabel}</button>
        )}
      </div>
      {folderState.error ? <p className="text-[13px]" style={{ color: RED }}>{folderState.error}</p> : null}
      {linking ? (
        <FolderLinkForm jobId={job.id} onCancel={() => setLinking(false)}
          onLinked={(f) => { setLinking(false); setRefresh((k) => k + 1); onSaved?.(`Drive folder linked: ${f?.name || 'folder'}. This job's Drive links and uploads now use it.`); }} />
      ) : null}

      <div className="rounded-[12px] p-4" style={{ backgroundColor: '#FFFFFF', border: `1.5px dashed ${dragOver ? TEAL : '#CEC6B8'}` }}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); add(e.dataTransfer.files); }}>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: 'var(--gf-teal-050)' }}>
            {busy ? <Loader2 className="h-4 w-4 animate-spin" style={{ color: TEAL }} /> : <UploadCloud className="h-4 w-4" style={{ color: TEAL }} />}
          </div>
          <div className="min-w-[220px] flex-1">
            <p className="text-[14px] font-semibold" style={{ color: INK }}>Drop files for this job</p>
            <p className="text-[13px]" style={{ color: INK2 }}>Vendor quote PDFs are read into the budget and stored privately (up to 5 MB). Drawings, photos and emails go to {folder ? folder.name : 'the job’s Drive folder'} (up to 50 MB).</p>
          </div>
          <button type="button" disabled={busy} onClick={() => inputRef.current?.click()} className={BTN} style={PRI}><FileText className="h-4 w-4" />Choose files</button>
          <input ref={inputRef} type="file" multiple className="hidden" onChange={(e) => add(e.target.files)} />
        </div>
        {queue.length > 0 && (
          <div className="mt-3 flex flex-col gap-2">
            <div className="overflow-hidden rounded-[10px]" style={{ border: `1px solid ${RULE}` }}>
              {queue.map((it) => (
                <div key={it.id} className="grid items-center gap-3 px-3 py-2 text-[13px] [grid-template-columns:minmax(0,2fr)_72px_minmax(190px,1fr)_minmax(0,1.4fr)] max-[767px]:[grid-template-columns:1fr_auto]" style={{ borderTop: `1px solid ${RULE}` }}>
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
            </div>
            <div className="flex flex-wrap gap-2">
              <button type="button" disabled={busy || !waiting} onClick={upload} className={BTN} style={PRI}>{busy ? 'Uploading…' : `Upload ${waiting} file${waiting === 1 ? '' : 's'}`}</button>
              <button type="button" disabled={busy} onClick={() => setQueue([])} className={BTN} style={SEC}>Clear</button>
            </div>
          </div>
        )}
      </div>
      <FolderFiles folder={folder} files={folderState.files} />
    </section>
  );
}
