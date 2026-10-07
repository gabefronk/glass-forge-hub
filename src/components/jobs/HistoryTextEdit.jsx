import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Pencil, Loader2 } from "lucide-react";
import { C } from "@/lib/feeUI";

// Inline text editor for one crew field-report (FieldReports.message) or
// job-note (JobNotes.body) entry on the job History cards. The pencil is only
// rendered when canEdit is true (owner gate — see JobActivityFeed). Save calls
// the editJobHistoryText backend (owner gate + concurrency + strict whitelist
// there); Cancel writes nothing. A conflict (someone else edited) or any error
// shows a message and never auto-retries/overwrites.
//
// type: "report" | "note". recordId/jobId must come from the underlying record
// (FieldReports.id/job_id for reports; JobNotes.id/job_id for notes). For
// fee-line-sourced report cards (no FieldReports record) recordId is null and
// the pencil is hidden.
export default function HistoryTextEdit({ type, recordId, jobId, text, canEdit, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(text || "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  if (!canEdit || !recordId || !jobId) return null;

  const start = () => { setValue(text || ""); setError(""); setEditing(true); };
  const cancel = () => { setEditing(false); setError(""); };
  const save = async () => {
    if (saving) return;
    const trimmed = (value || "").trim();
    if (!trimmed) { setError("Text can't be empty."); return; }
    if (trimmed === String(text || "").trim()) { setEditing(false); return; }
    setSaving(true); setError("");
    try {
      const res = await base44.functions.invoke("editJobHistoryText", {
        type, record_id: recordId, job_id: jobId,
        expected_text: text || "", new_text: trimmed,
      });
      const data = res?.data ?? res;
      if (data?.error === "conflict") { setError("This was edited elsewhere. Reload to see the latest."); return; }
      if (data?.error) { setError(data.error === "forbidden" ? "Only Gabriel can edit this." : String(data.error)); return; }
      setEditing(false);
      onSaved?.();
    } catch (e) {
      const code = e?.response?.data?.error;
      if (code === "conflict") { setError("This was edited elsewhere. Reload to see the latest."); return; }
      setError(code ? String(code) : "Could not save. Try again.");
    } finally {
      setSaving(false);
    }
  };

  if (editing) {
    return (
      <div className="mt-1.5">
        <textarea
          value={value}
          onChange={(e) => setValue(e.target.value)}
          rows={3}
          autoFocus
          className="w-full text-[14px] leading-[21px] rounded-[8px] p-2 resize-y focus:outline-none"
          style={{ border: `1px solid ${C.border}`, color: C.text, backgroundColor: C.card }}
        />
        <div className="mt-1.5 flex flex-wrap items-center gap-2">
          <button type="button" onClick={save} disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-[8px] px-3 py-1 text-[12.5px] font-semibold min-h-[34px] disabled:opacity-60"
            style={{ backgroundColor: "#0b3f3b", color: "#fff" }}>
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}{saving ? "Saving…" : "Save"}
          </button>
          <button type="button" onClick={cancel} disabled={saving}
            className="inline-flex items-center rounded-[8px] px-3 py-1 text-[12.5px] font-semibold min-h-[34px] disabled:opacity-60"
            style={{ border: `1px solid ${C.border}`, color: C.text, backgroundColor: C.card }}>Cancel</button>
          {error ? <span className="text-[12px]" style={{ color: "#a43432" }}>{error}</span> : null}
        </div>
      </div>
    );
  }

  return (
    <button type="button" onClick={start}
      className="inline-flex items-center gap-1 text-[12px] font-medium hover:underline min-h-[28px]"
      style={{ color: C.textMuted }} title="Fix spelling">
      <Pencil className="h-3 w-3" />Edit
    </button>
  );
}