import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Pencil, Trash2 } from "lucide-react";
import JobNoteForm from "./JobNoteForm";
import { C, CARD_SHADOW } from "@/lib/feeUI";

export default function JobNoteEntry({ note, currentUser, onChanged, onPhotoClick }) {
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

  return (
    <div className="rounded-lg p-3" style={{ border: `1px solid ${C.border}`, boxShadow: CARD_SHADOW, backgroundColor: C.card }}>
      <div className="flex items-center gap-2 mb-2">
        {note.edited && (
          <span className="text-[10px] font-medium uppercase tracking-wide italic" style={{ color: C.text, opacity: 0.5 }}>edited</span>
        )}
        <span className="text-xs truncate ml-auto" style={{ color: C.text, opacity: 0.68 }}>{note.author}</span>
        {isAuthor && (
          <div className="flex items-center gap-2 shrink-0">
            <button type="button" onClick={() => setEditing(true)} style={{ color: C.text, opacity: 0.5 }} className="hover:opacity-100 transition-opacity">
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button type="button" onClick={handleDelete} style={{ color: C.text, opacity: 0.5 }} className="hover:text-red-600 transition-colors">
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
      <p className="text-sm whitespace-pre-wrap" style={{ color: C.accentDark }}>{note.body}</p>
      {note.attachments && note.attachments.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-2">
          {note.attachments.map((url, i) => (
            <button key={i} type="button" onClick={() => onPhotoClick(url)} className="h-14 w-14 rounded border overflow-hidden" style={{ borderColor: C.border }}>
              <img src={url} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}