import { useState } from "react";
import { base44 } from "@/api/base44Client";
import { Pencil, Loader2 } from "lucide-react";
import { C } from "@/lib/feeUI";

// Inline text editor for one crew field-report (FieldReports.message) or
// job-note (JobNotes.body) entry on the job History cards. The pencil is only
// rendered when canEdit is true (owner gate — see JobActivityFeed). Save calls
// the editJobHistoryText backend (owner gate + concurrency + strict whitelist +
// stored readback there); Cancel writes nothing.
//
// expected_text is FROZEN at the moment editing starts (start()). Receiving new
// `text` props while the user is typing (a live reload with different text)
// must NOT silently rebase the stale edit — the frozen snapshot is the
// concurrency token sent to the backend. The editor only closes when the
// backend returns ok:true with a verified stored readback; on save_unknown
// (uncertain commit — the update may have written but readback couldn't
// confirm) Save is locked and the user is asked to Reload. There is never an
// auto-retry: a retry could double-write or clobber a concurrent edit.
//
// type: "report" | "note". recordId/jobId must come from the underlying record
// (FieldReports.id/job_id for reports; JobNotes.id/job_id for notes). For
// fee-line-sourced report cards (no FieldReports record) recordId is null and
// the pencil is hidden.
export default function HistoryTextEdit({ type, recordId, jobId, text, canEdit, onSaved }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  // Frozen at edit start; live `text` prop changes must NOT rebase a stale edit.
  const [expectedText, setExpectedText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  // save_unknown: lock Save, ask for a Reload. No auto-retry, no close.
  const [locked, setLocked] = useState(false);

  if (!canEdit || !recordId || !jobId) return null;

  const start = () => {
    setValue(String(text || ""));
    setExpectedText(String(text || ""));
    setError("");
    setLocked(false);
    setEditing(true);
  };
  const cancel = () => { setEditing(false); setError(""); setLocked(false); };
  const save = async () => {
    if (saving || locked) return;
    const trimmed = (value || "").trim();
    if (!trimmed) { setError("Text can't be empty."); return; }
    if (trimmed === expectedText.trim()) { setEditing(false); return; }
    setSaving(true); setError("");
    try {
      const res = await base44.functions.invoke("editJobHistoryText", {
        type, record_id: recordId, job_id: jobId,
        expected_text: expectedText, new_text: trimmed,
      });
      const data = res?.data ?? res;
      if (data?.save_unknown) {
        setLocked(true);
        setError("Save status uncertain. Reload the job to see the latest, then edit again if needed.");
        return;
      }
      if (data?.error === "conflict") { setError("This was edited elsewhere. Reload to see the latest."); return; }
      if (data?.error) { setError(data.error === "forbidden" ? "Only Gabriel can edit this." : String(data.error)); return; }
      // Only close when ok:true with a verified stored readback.
      if (data?.ok === true) { setEditing(false); onSaved?.(); return; }
      // Anything else: uncertain — lock, don't close, no auto-retry.
      setLocked(true);
      setError("Save status uncertain. Reload the job to see the latest.");
    } catch (e) {
      // Network/throw = uncertain (the update may have written). Lock, no autoretry.
      setLocked(true);
      setError("Save status uncertain. Reload the job to see the latest.");
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
          <button type="button" onClick={save} disabled={saving || locked}
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