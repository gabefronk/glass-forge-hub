import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Pencil, Trash2 } from "lucide-react";
import JobNoteForm from "./JobNoteForm";

// Timeline entry for a manual note. Only the author can edit or delete.
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
    <div className="rounded-lg border border-border bg-white p-4 border-l-4 border-l-[#fef3c7]">
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full bg-[#fef3c7] text-foreground">
          Note
        </span>
        {note.edited && (
          <span className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground italic">edited</span>
        )}
        <span className="text-xs text-muted-foreground ml-auto truncate">{note.author}</span>
        {isAuthor && (
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="text-muted-foreground hover:text-foreground transition-colors"
            >
              <Pencil className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              onClick={handleDelete}
              className="text-muted-foreground hover:text-destructive transition-colors"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        )}
      </div>
      <p className="text-sm whitespace-pre-wrap mb-2">{note.body}</p>
      {note.attachments && note.attachments.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-2">
          {note.attachments.map((url, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onPhotoClick(url)}
              className="h-16 w-16 rounded border border-border overflow-hidden hover:opacity-80 transition-opacity"
            >
              <img src={url} alt={`attachment ${i + 1}`} className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}