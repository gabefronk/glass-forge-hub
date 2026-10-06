import { useState } from "react";
import { Link } from "react-router-dom";
import { FolderOpen, Undo2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { sanitizeText } from "@/lib/jobsSanitize";
import { mergeLogState, movedSummary, logErrors } from "@/lib/mergeLogs";

const TONES = {
  green: { bg: "#eaf5ee", ink: "#166447", bd: "#c7e4d2" },
  amber: { bg: "#fff3df", ink: "#89511a", bd: "#f0dba8" },
  muted: { bg: "#f4f1ea", ink: "#566063", bd: "#e2dcd1" },
};
const folderUrl = (j) => j?.drive_job_folder_url || (j?.drive_job_folder_id ? `https://drive.google.com/drive/folders/${j.drive_job_folder_id}` : "");

// One combine (JobMergeLog) as seen from this job, with an exact-ID undo.
export default function MergeLogRow({ log, job, other, onUndone }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(null);
  const state = mergeLogState(log);
  const tone = TONES[state.tone] || TONES.muted;
  const intoThis = log.target_job_id === job.id;
  const otherId = intoThis ? log.source_job_id : log.target_job_id;
  const otherName = sanitizeText(other?.canonical_name || (intoThis ? log.source_job_name : log.target_job_name) || otherId);
  const otherFolder = intoThis ? folderUrl(other) : "";
  const showFolder = otherFolder && otherFolder !== folderUrl(job);
  const errors = logErrors(log);
  const when = log.merged_at ? new Date(log.merged_at).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";

  const undo = async () => {
    if (!window.confirm(`${state.undoLabel}? Only the records this combine recorded are moved back to ${sanitizeText(log.source_job_name || "the combined record")}. The surviving job's own records are not touched.`)) return;
    setBusy(true); setMessage(null);
    try {
      const res = await base44.functions.invoke("reverseMerge", { merge_log_id: log.id });
      const r = res?.data || {};
      setMessage(r.ok ? { ok: true, text: "Undone." } : { ok: false, text: r.error || "Undo did not finish." });
      onUndone?.();
    } catch (e) {
      setMessage({ ok: false, text: e?.response?.data?.error || e?.message || "Undo failed." });
    } finally {
      setBusy(false);
    }
  };

  return (
    <li className="rounded-[10px] px-3 py-2.5 text-[12.5px]" style={{ backgroundColor: "#faf8f3", border: "1px solid #e2dcd1" }}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ backgroundColor: tone.bg, color: tone.ink, border: `1px solid ${tone.bd}` }}>{state.label}</span>
        <span className="min-w-0 font-semibold" style={{ color: "#101617" }}>
          {intoThis ? "Combined in from " : "This record → "}
          <Link to={`/jobs/${otherId}`} className="underline">{otherName}</Link>
        </span>
        <span style={{ color: "#616a6d" }}>{when}{log.merged_by ? ` · ${log.merged_by}` : ""}</span>
      </div>
      <div className="mt-1 font-mono text-[11px]" style={{ color: "#8a8f93" }}>ID {otherId} · log {log.id}</div>
      <div className="mt-1" style={{ color: "#566063" }}>Moved: {movedSummary(log)}.</div>
      {state.note ? <div className="mt-1" style={{ color: tone.ink }}>{state.note}</div> : null}
      {showFolder ? (
        <a href={otherFolder} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1.5 font-semibold underline" style={{ color: "#0b3f3b" }}>
          <FolderOpen className="h-3.5 w-3.5" />Drive folder of {otherName} (its files were not moved)
        </a>
      ) : null}
      {errors.length ? <ul className="m-0 mt-1 list-disc pl-5" style={{ color: "#a43432" }}>{errors.map((e, i) => <li key={i}>{e}</li>)}</ul> : null}
      {state.canUndo ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <button type="button" onClick={undo} disabled={busy} className="inline-flex h-[30px] items-center gap-1.5 rounded-[8px] px-2.5 text-[12px] font-semibold disabled:opacity-60" style={{ backgroundColor: "rgba(192,139,46,.16)", color: "#6f4e10", border: "1px solid rgba(192,139,46,.3)" }}>
            <Undo2 className="h-3.5 w-3.5" />{busy ? "Working…" : state.undoLabel}
          </button>
          {message ? <span role={message.ok ? "status" : "alert"} style={{ color: message.ok ? "#166447" : "#a43432" }}>{message.text}</span> : null}
        </div>
      ) : null}
    </li>
  );
}