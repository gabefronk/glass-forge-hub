import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Paperclip, X, Loader2 } from "lucide-react";
import { C, CARD_SHADOW } from "@/lib/feeUI";

export default function JobNoteForm({ jobId, author, editing, onSaved, onCancel }) {
  const today = new Date().toISOString().slice(0, 10);
  const [noteDate, setNoteDate] = useState(editing?.note_date || today);
  const [body, setBody] = useState(editing?.body || "");
  const [attachments, setAttachments] = useState(editing?.attachments || []);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleFiles = async (files) => {
    if (!files.length) return;
    setUploading(true);
    try {
      const urls = [];
      for (const file of files) {
        const { file_url } = await base44.integrations.Core.UploadFile({ file });
        urls.push(file_url);
      }
      setAttachments((a) => [...a, ...urls]);
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async () => {
    if (!body.trim()) return;
    setSaving(true);
    try {
      const payload = {
        job_id: jobId,
        note_date: noteDate,
        body: body.trim(),
        author,
        attachments,
        edited: !!editing,
      };
      if (editing?.id) {
        await base44.entities.JobNotes.update(editing.id, payload);
      } else {
        await base44.entities.JobNotes.create(payload);
      }
      onSaved();
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="rounded-lg p-3" style={{ border: `1px solid ${C.border}`, boxShadow: CARD_SHADOW, backgroundColor: C.card }}>
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <label className="text-xs font-medium uppercase tracking-wide whitespace-nowrap" style={{ color: C.text, opacity: 0.62 }}>Date</label>
          <input
            type="date"
            value={noteDate}
            onChange={(e) => setNoteDate(e.target.value)}
            className="text-sm rounded px-2 py-1 focus:outline-none"
            style={{ border: `1px solid ${C.border}`, color: C.text, backgroundColor: C.cardAlt }}
          />
          <span className="text-xs ml-auto whitespace-nowrap" style={{ color: C.text, opacity: 0.62 }}>{editing ? "Edit note" : "New note"}</span>
        </div>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="What happened on the call / interaction..."
          rows={3}
          className="w-full text-sm rounded p-2 resize-y focus:outline-none"
          style={{ border: `1px solid ${C.border}`, color: C.text, backgroundColor: C.cardAlt }}
        />
        <div className="flex items-center gap-3 flex-wrap">
          <label className="cursor-pointer">
            <input
              type="file"
              multiple
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                handleFiles(Array.from(e.target.files));
                e.target.value = "";
              }}
            />
            <span className="inline-flex items-center gap-1 text-xs whitespace-nowrap" style={{ color: C.text, opacity: 0.68 }}>
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
              {uploading ? "Uploading…" : "Attach"}
            </span>
          </label>
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {attachments.map((url, i) => (
                <div key={i} className="relative h-12 w-12 rounded border overflow-hidden group" style={{ borderColor: C.border }}>
                  <img src={url} alt="" className="h-full w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => setAttachments((a) => a.filter((_, j) => j !== i))}
                    className="absolute top-0 right-0 bg-black/60 text-white rounded-bl p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button size="sm" onClick={handleSubmit} disabled={saving || !body.trim()}>
            {saving ? "Saving…" : editing ? "Save" : "Add note"}
          </Button>
          <Button size="sm" variant="ghost" onClick={onCancel}>Cancel</Button>
        </div>
      </div>
    </div>
  );
}