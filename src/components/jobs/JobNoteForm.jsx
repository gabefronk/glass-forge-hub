import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Button } from "@/components/ui/button";
import { Paperclip, X, Loader2 } from "lucide-react";
import { C } from "@/lib/feeUI";
import { denverDate } from "../../../base44/shared/billingCore.js";

export default function JobNoteForm({ jobId, author, editing, onSaved, onCancel }) {
  const today = denverDate();
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
    <div className="rounded-[12px] p-3" style={{ border: `1px solid ${C.border}`, backgroundColor: C.card }}>
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <label className="mono-label-sm">Date</label>
          <input
            type="date"
            aria-label="Note date"
            value={noteDate}
            onChange={(e) => setNoteDate(e.target.value)}
            className="min-w-0 max-w-full text-sm rounded px-2 py-1 focus:outline-none"
            style={{ border: `1px solid ${C.border}`, color: C.text, backgroundColor: C.cardAlt }}
          />
          <span className="text-[11px] ml-auto whitespace-nowrap" style={{ color: C.textMuted }}>{editing ? "Edit note" : "New note"}</span>
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
            <span className="inline-flex items-center gap-1 text-xs whitespace-nowrap" style={{ color: C.textSecondary }}>
              {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
              {uploading ? "Uploading…" : "Attach"}
            </span>
          </label>
          {attachments.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {attachments.map((url, i) => (
                <div key={i} className="relative h-24 w-24 rounded border overflow-hidden group" style={{ borderColor: C.border }}>
                  <img src={url} alt="" className="h-full w-full object-cover" />
                  <button
                    type="button"
                    onClick={() => setAttachments((a) => a.filter((_, j) => j !== i))}
                    aria-label={`Remove attachment ${i + 1}`}
                    className="absolute top-0 right-0 bg-[#131A26]/60 text-white rounded-bl p-1 opacity-100 transition-opacity"
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
