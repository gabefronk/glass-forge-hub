import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Pencil, Trash2 } from "lucide-react";
import JobNoteForm from "./JobNoteForm";
import { C } from "@/lib/feeUI";
import { sanitizeText } from "@/lib/jobsSanitize";

export default function JobNoteEntry({ note, currentUser, onChanged, onPhotoClick, embedded }) {
  const [editing, setEditing] = useState(false);
  const isAuthor = !!currentUser && note.author === currentUser;

  if (editing) {
    return (
      <JobNoteForm
        jobId={note.job_id}
        author={currentUser}
        editing={note}
        onSaved={() => { setEditing(false); onChanged(); }}
        onCancel={() => setEditing(false)}
      />
    );
  }

  const handleDelete = async () => {
    if (!confirm("Delete this note?")) return;
    await base44.entities.JobNotes.delete(note.id);
    onChanged();
  };

  const body = (
    <>
      <div className="flex items-center gap-2 mb-1.5">
        {note.edited && (
          <span className="font-mono text-[10px] uppercase tracking-[0.13em] italic" style={{ color: C.textMuted }}>edited</span>
        )}
        <span className="font-mono text-[11px] truncate ml-auto" style={{ color: C.textSecondary }}>{note.author}</span>
        {isAuthor && (
          <div className="flex items-center gap-1 shrink-0">
            <button type="button" aria-label="Edit note" onClick={() => setEditing(true)} style={{ color: C.textMuted }} className="p-1.5 hover:opacity-100 transition-opacity">
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button type="button" aria-label="Delete note" onClick={handleDelete} style={{ color: C.textMuted }} className="p-1.5 hover:opacity-100 transition-opacity">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
      <p className="text-[13px] whitespace-pre-wrap break-words" style={{ color: C.text }}>{sanitizeText(note.body)}</p>
      {note.attachments && note.attachments.length > 0 && (
        <div className="grid grid-cols-2 gap-1.5 mt-2 sm:grid-cols-3">
          {note.attachments.map((url, i) => (
            <button key={i} type="button" onClick={() => onPhotoClick(url)} className="aspect-square rounded-md overflow-hidden" style={{ border: `1px solid ${C.border}` }}>
              <img src={url} alt="" className="h-full w-full object-cover" loading="lazy" />
            </button>
          ))}
        </div>
      )}
    </>
  );

  if (embedded) return <div className="mt-1.5">{body}</div>;
  return (
    <div className="rounded-[12px] p-3" style={{ border: `1px solid ${C.border}`, backgroundColor: C.card }}>{body}</div>
  );
}