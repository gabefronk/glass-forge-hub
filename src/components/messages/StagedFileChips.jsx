import { Paperclip, X } from 'lucide-react';

// Locally staged files (not uploaded): name, size, image thumbnail, remove.
const kb = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

export default function StagedFileChips({ files, disabled, onRemove }) {
  if (!files.length) return null;
  return (
    <div className="mb-2 flex flex-wrap gap-2">
      {files.map((f) => (
        <div key={f.id} className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 p-1.5 pr-2">
          {f.isImage && f.previewUrl ? (
            <img src={f.previewUrl} alt={f.name} className="h-10 w-10 rounded object-cover" />
          ) : (
            <div className="flex h-10 w-10 items-center justify-center rounded bg-slate-200"><Paperclip className="h-4 w-4 text-slate-500" /></div>
          )}
          <span className="min-w-0">
            <span className="block max-w-[140px] truncate text-xs text-slate-700">{f.name}</span>
            <span className="block text-[10px] text-slate-500">{kb(f.size)}</span>
          </span>
          <button type="button" onClick={() => onRemove(f.id)} disabled={disabled} aria-label={`Remove ${f.name}`} className="rounded-full p-0.5 text-slate-400 hover:text-slate-700 disabled:opacity-40"><X className="h-3.5 w-3.5" /></button>
        </div>
      ))}
    </div>
  );
}