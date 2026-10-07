import { base44 } from "@/api/base44Client";
import { Trash2 } from "lucide-react";
import HistoryTextEdit from "./HistoryTextEdit";
import { canEditHistoryText } from "@/lib/ownerAccess";
import { C } from "@/lib/feeUI";
import ClampedText from "./ClampedText";
import PhotoStrip from "./PhotoStrip";

export default function JobNoteEntry({ note, currentUser, onChanged, onPhotoClick, embedded }) {
  // Inline text correction is owner-only (Gabriel). Delete stays available to
  // any signed-in user (unchanged) — only the edit path is gated here.
  const canEditText = canEditHistoryText(currentUser);
  const canDelete = !!currentUser;

  const handleDelete = async () => {
    if (!confirm(note.author && note.author !== currentUser ? `Delete this entry by ${note.author}?` : "Delete this note?")) return;
    await base44.entities.JobNotes.delete(note.id);
    onChanged();
  };

  const controls = (canEditText || canDelete) ? (
    <div className="flex items-center gap-3 shrink-0">
      {canEditText ? <HistoryTextEdit type="note" recordId={note.id} jobId={note.job_id} text={note.body} canEdit={canEditText} onSaved={onChanged} /> : null}
      {canDelete ? (
        <button type="button" onClick={handleDelete} className="inline-flex items-center gap-1 text-[12px] font-medium hover:underline" style={{ color: C.textMuted }}>
          <Trash2 className="h-3 w-3" />Delete
        </button>
      ) : null}
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