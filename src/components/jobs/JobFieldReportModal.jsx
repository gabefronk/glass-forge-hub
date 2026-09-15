import { useMemo, useState } from "react";
import { base44 } from "@/api/base44Client";
import { C } from "@/lib/feeUI";
import { sanitizeText } from "@/lib/jobsSanitize";
import { Camera, Loader2, X, CheckCircle2, AlertCircle } from "lucide-react";
import { formatShort } from "@/lib/feeUI";

const PENDING = ["pending", "missing_photos", "missing_notes", "missing_all", "rescheduled"];

export default function JobFieldReportModal({ jobId, jobName, events, onClose, onDone }) {
  const pendingEvents = useMemo(
    () => (events || []).filter((e) => e.report_required !== false && PENDING.includes(e.report_status) && e.event_date),
    [events]
  );
  const general = { id: "", label: "General field report (no specific appointment)" };
  const options = [general, ...pendingEvents.map((e) => ({ id: e.id, label: `${formatShort(e.event_date)}${e.start_time ? ` · ${e.start_time}` : ""}`, ev: e }))];
  const [selected, setSelected] = useState(pendingEvents[0] ? pendingEvents[0].id : "");
  const [photos, setPhotos] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [notes, setNotes] = useState("");
  const [completion, setCompletion] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const canSubmit = (photos.length > 0 || notes.trim()) && completion && !saving;

  const handleFiles = async (files) => {
    if (!files.length) return;
    setUploading(true);
    try {
      const urls = [];
      for (const file of files) {
        const { file_url } = await base44.integrations.Core.UploadFile({ file });
        urls.push(file_url);
      }
      setPhotos((p) => [...p, ...urls]);
    } catch {
      setError("Photo upload failed. Try again.");
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    setError("");
    try {
      const request_key = `field-report:${jobId}:${crypto.randomUUID()}`;
      await base44.functions.invoke("resolveFieldReport", {
        action: "upload",
        event_id: selected || undefined,
        job_id: jobId,
        photos,
        notes: notes.trim(),
        completion,
        request_key,
      });
      onDone();
    } catch (e) {
      setError(e?.response?.data?.error || e?.message || "Submit failed. Try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ backgroundColor: "rgba(24,36,34,.45)" }} onClick={onClose}>
      <div
        className="rounded-t-[16px] sm:rounded-[14px] w-full sm:max-w-md max-h-[92dvh] overflow-y-auto overscroll-contain card-shadow-elevated"
        style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-center justify-between px-4 py-3" style={{ backgroundColor: C.card, borderBottom: `1px solid ${C.border}` }}>
          <h3 className="font-heading text-[15px] font-semibold" style={{ color: C.text }}>Add field report</h3>
          <button type="button" onClick={onClose} aria-label="Close" className="p-2" style={{ color: C.textMuted }}><X className="h-4 w-4" /></button>
        </div>

        <div className="p-4 space-y-4">
          <p className="text-[12px] break-words" style={{ color: C.textMuted }}>{sanitizeText(jobName || "")}</p>

          {options.length > 1 && (
            <div>
              <label className="mono-label-sm block mb-1.5">For appointment</label>
              <select
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                className="w-full min-h-[44px] rounded-[10px] px-3 text-[13px] focus:outline-none"
                style={{ border: `1px solid ${C.border}`, backgroundColor: C.cardAlt, color: C.text }}
              >
                {options.map((o) => <option key={o.id || "general"} value={o.id}>{o.label}</option>)}
              </select>
            </div>
          )}

          <div>
            <label className="mono-label-sm block mb-1.5">Photos</label>
            <label className="cursor-pointer">
              <input type="file" multiple accept="image/*" className="hidden" onChange={(e) => { handleFiles(Array.from(e.target.files)); e.target.value = ""; }} />
              <span className="inline-flex items-center gap-1.5 text-[12px] px-3 py-2 rounded-[10px]" style={{ border: `1px solid ${C.border}`, color: C.textSecondary, backgroundColor: C.cardAlt }}>
                {uploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Camera className="h-3.5 w-3.5" />}
                {uploading ? "Uploading…" : "Add photos"}
              </span>
            </label>
            {photos.length > 0 && (
              <div className="grid grid-cols-3 gap-1.5 mt-2">
                {photos.map((url, i) => (
                  <div key={i} className="relative aspect-square rounded-md overflow-hidden" style={{ border: `1px solid ${C.border}` }}>
                    <img src={url} alt="" className="h-full w-full object-cover" />
                    <button type="button" onClick={() => setPhotos((p) => p.filter((_, j) => j !== i))} aria-label="Remove photo" className="absolute top-0 right-0 rounded-bl p-1" style={{ backgroundColor: "rgba(19,26,38,.6)", color: "#fff" }}>
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <label className="mono-label-sm block mb-1.5">Notes</label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} placeholder="What did you do, find, or need fixed?" className="w-full rounded-[10px] p-2.5 text-[13px] resize-y focus:outline-none" style={{ border: `1px solid ${C.border}`, backgroundColor: C.cardAlt, color: C.text }} />
          </div>

          <div>
            <label className="mono-label-sm block mb-1.5">Is this job complete or incomplete?</label>
            <div className="grid grid-cols-2 gap-2">
              <button
                type="button"
                onClick={() => setCompletion("complete")}
                className="flex items-center justify-center gap-2 min-h-[48px] rounded-[10px] text-[13px] font-medium transition-colors"
                style={{
                  border: `1px solid ${completion === "complete" ? "#166447" : C.border}`,
                  backgroundColor: completion === "complete" ? "#EAF5EE" : C.cardAlt,
                  color: completion === "complete" ? "#166447" : C.text,
                }}
              >
                <CheckCircle2 className="h-4 w-4" />Complete
              </button>
              <button
                type="button"
                onClick={() => setCompletion("incomplete")}
                className="flex items-center justify-center gap-2 min-h-[48px] rounded-[10px] text-[13px] font-medium transition-colors"
                style={{
                  border: `1px solid ${completion === "incomplete" ? "#A43432" : C.border}`,
                  backgroundColor: completion === "incomplete" ? "#FCEDEC" : C.cardAlt,
                  color: completion === "incomplete" ? "#A43432" : C.text,
                }}
              >
                <AlertCircle className="h-4 w-4" />Incomplete
              </button>
            </div>
            {completion === "incomplete" ? (
              <p className="text-[11px] mt-1.5" style={{ color: C.textMuted }}>Milan will be notified to check and get this fixed.</p>
            ) : null}
          </div>

          {error ? <p role="alert" className="text-[12px]" style={{ color: "#A43432" }}>{error}</p> : null}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="px-3.5 py-2 rounded-full text-[12px]" style={{ border: `1px solid ${C.border}`, color: C.textSecondary }}>Cancel</button>
            <button type="button" onClick={handleSubmit} disabled={!canSubmit} className="px-3.5 py-2 rounded-full text-[12px] font-semibold" style={{ backgroundColor: canSubmit ? C.accent : C.mutedBg, color: canSubmit ? C.accentDark : C.textMuted }}>
              {saving ? "Submitting…" : "Submit report"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}