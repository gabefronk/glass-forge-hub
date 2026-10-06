import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Pencil, Trash2 } from "lucide-react";
import JobNoteForm from "./JobNoteForm";
import { C } from "@/lib/feeUI";
import ClampedText from "./ClampedText";
import PhotoStrip from "./PhotoStrip";

export default function JobNoteEntry({ note, currentUser, onChanged, onPhotoClick, embedded }) {
  const [editing, setEditing] = useState(false);
  // For now every signed-in user can fix or remove any history entry.
  const canEdit = !!currentUser;

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
    if (!confirm(note.author && note.author !== currentUser ? `Delete this entry by ${note.author}?` : "Delete this note?")) return;
    await base44.entities.JobNotes.delete(note.id);
    onChanged();
  };

  const controls = canEdit ? (
    <div className="flex items-center gap-3 shrink-0">
      <button type="button" onClick={() => setEditing(true)} className="inline-flex items-center gap-1 text-[12px] font-medium hover:underline" style={{ color: C.textMuted }}>
        <Pencil className="h-3 w-3" />Edit
      </button>
      <button type="button" onClick={handleDelete} className="inline-flex items-center gap-1 text-[12px] font-medium hover:underline" style={{ color: C.textMuted }}>
        <Trash2 className="h-3 w-3" />Delete
      </button>
    </div>
  ) : null;

  const body = (
    <>
      {!embedded ? <div className="mb-1.5 text-[12px] truncate" style={{ color: C.textSecondary }}>{note.author}</div> : null}
      <ClampedText text={note.body} maxLines={5} className="mt-1 text-[14.5px] leading-[21px] whitespace-pre-wrap break-words" style={{ color: C.text }} />
      <PhotoStrip urls={note.attachments} onPhotoClick={onPhotoClick} />
      <div className="mt-2 flex items-center gap-3">
        {note.edited && <span className="text-[11.5px] italic" style={{ color: C.textMuted }}>{note.edited_by ? `edited by ${note.edited_by}` : "edited"}</span>}
        {controls}
      </div>
    </>
  );

  if (embedded) return <div>{body}</div>;
  return (
    <div className="rounded-[12px] p-3" style={{ border: `1px solid ${C.border}`, backgroundColor: C.card }}>{body}</div>
  );
}