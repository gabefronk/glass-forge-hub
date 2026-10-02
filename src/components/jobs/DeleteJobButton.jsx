import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Trash2, AlertTriangle, X } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { sanitizeText } from "@/lib/jobsSanitize";

// Deletes a job record and its app-owned linked data (JobNotes, FeeLines) for
// that job_id. Calendar events and field reports are ingested from external
// sources and are left in place. Restricted to admins/owners by the caller.
export default function DeleteJobButton({ job, onDeleted, className = "", style }) {
  const [open, setOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState("");
  const navigate = useNavigate();
  const dialogRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => { if (e.key === "Escape" && !deleting) setOpen(false); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, deleting]);

  const del = async () => {
    setDeleting(true); setError("");
    try {
      // Remove app-owned linked records first so they don't orphan; then the job.
      await Promise.all([
        base44.entities.JobNotes.deleteMany({ job_id: job.id }).catch(() => {}),
        base44.entities.FeeLines.deleteMany({ job_id: job.id }).catch(() => {}),
      ]);
      await base44.entities.Jobs.delete(job.id);
      setOpen(false);
      if (onDeleted) onDeleted();
      else navigate("/jobs");
    } catch (e) {
      setError(e?.message || "Could not delete the job.");
      setDeleting(false);
    }
  };

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Delete job"
        title="Delete job"
        className={className || "inline-flex h-[38px] items-center gap-[7px] rounded-[9px] px-3.5 text-[13.5px] font-semibold whitespace-nowrap"}
        style={style || { backgroundColor: "rgba(164,52,50,.16)", color: "#f1b9b3", border: "1px solid rgba(241,185,179,.3)" }}
      >
        <Trash2 className="h-[15px] w-[15px]" />Delete
      </button>

      {open ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: "rgba(8,15,16,.6)" }}
          onClick={() => !deleting && setOpen(false)}
          role="dialog"
          aria-modal="true"
          aria-label="Delete this job"
        >
          <div
            ref={dialogRef}
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[440px] rounded-[14px] bg-white"
            style={{ border: "1px solid #e2dcd1", boxShadow: "0 24px 60px -16px rgba(10,29,31,.5)" }}
          >
            <div className="flex items-start gap-3 px-5 pt-5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: "#fcedec", color: "#a43432" }}>
                <AlertTriangle className="h-4.5 w-4.5" />
              </span>
              <div className="min-w-0 flex-1">
                <h3 className="m-0 text-[17px] font-bold" style={{ color: "#101617", letterSpacing: "-0.02em" }}>Delete this job?</h3>
                <p className="m-0 mt-1 text-[13.5px] leading-[20px]" style={{ color: "#566063" }}>
                  <b style={{ color: "#101617" }}>{sanitizeText(job?.canonical_name || "this job")}</b> and its notes and billing lines will be removed. Calendar visits and field reports stay, since they come from Google and Probuild.
                </p>
              </div>
              <button type="button" onClick={() => !deleting && setOpen(false)} aria-label="Close" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full hover:bg-black/[0.05]" style={{ color: "#616a6d" }}>
                <X className="h-4 w-4" />
              </button>
            </div>
            {error ? <p role="alert" className="mx-5 mt-3 rounded-[8px] px-3 py-2 text-[12.5px]" style={{ backgroundColor: "#fcedec", color: "#a43432", border: "1px solid #f0c9c5" }}>{error}</p> : null}
            <div className="flex justify-end gap-2 px-5 pb-5 pt-4">
              <button type="button" onClick={() => setOpen(false)} disabled={deleting} className="inline-flex h-[38px] items-center rounded-[9px] px-4 text-[13.5px] font-semibold disabled:opacity-50" style={{ backgroundColor: "#f4f1ea", color: "#34403f", border: "1px solid #e2dcd1" }}>
                Cancel
              </button>
              <button type="button" onClick={del} disabled={deleting} className="inline-flex h-[38px] items-center gap-1.5 rounded-[9px] px-4 text-[13.5px] font-semibold text-white disabled:opacity-60" style={{ backgroundColor: "#a43432" }}>
                <Trash2 className="h-3.5 w-3.5" />{deleting ? "Deleting…" : "Delete job"}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}