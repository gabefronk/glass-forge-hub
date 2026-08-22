import { useState } from "react";
import { Plus } from "lucide-react";
import { C } from "@/lib/feeUI";
import JobNoteForm from "./JobNoteForm";
import JobNoteEntry from "./JobNoteEntry";

export default function NotesSection({ jobId, notes, currentUser, onChanged, onPhotoClick }) {
  const [showForm, setShowForm] = useState(false);

  return (
    <div className="rounded-[16px] p-5" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
      <div className="flex items-center justify-between mb-3">
        <h3 className="font-heading text-[13px] font-semibold" style={{ color: C.text }}>Notes</h3>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="inline-flex items-center gap-1 font-mono text-[10px] font-semibold uppercase tracking-[0.13em] px-2.5 py-1 rounded-full whitespace-nowrap transition-colors"
          style={{ border: `1px solid ${C.border}`, color: C.textSecondary }}
        >
          <Plus className="h-3 w-3" />Add
        </button>
      </div>
      {showForm && (
        <div className="mb-3">
          <JobNoteForm jobId={jobId} author={currentUser} onSaved={() => { setShowForm(false); onChanged(); }} onCancel={() => setShowForm(false)} />
        </div>
      )}
      <div className="space-y-2">
        {notes.length === 0 && !showForm && (
          <p className="text-[12px]" style={{ color: C.textMuted }}>No notes yet.</p>
        )}
        {notes.map((note) => (
          <JobNoteEntry key={note.id} note={note} currentUser={currentUser} onChanged={onChanged} onPhotoClick={onPhotoClick} />
        ))}
      </div>
    </div>
  );
}