import { useState } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { C } from "@/lib/feeUI";
import { AlertTriangle } from "lucide-react";

export default function FieldReportActions({ event, user, onChanged }) {
  const [uploading, setUploading] = useState(false);
  const [waiving, setWaiving] = useState(false);
  const [uploadPhotos, setUploadPhotos] = useState([]);
  const [uploadNotes, setUploadNotes] = useState("");
  const [waiveReason, setWaiveReason] = useState("");
  const [busy, setBusy] = useState(false);

  if (!event.report_required || event.report_required === false) return null;
  if (!["pending", "missing_photos", "missing_notes", "missing_all", "rescheduled"].includes(event.report_status)) return null;

  const isAdmin = user?.role === "admin";
  const isManager = user?.role === "manager" || isAdmin;
  const days = event.days_late || 0;

  let statusText, statusColor, statusBg, statusBorder;
  if (event.report_status === "rescheduled") {
    statusText = "Rescheduled"; statusColor = C.textMuted; statusBg = "#F6F8FC"; statusBorder = "#DDE3EC";
  } else if (days === 0) {
    statusText = "Awaiting report"; statusColor = "#8A5A10"; statusBg = "#FCF5E9"; statusBorder = "#EEDAB4";
  } else if (days >= 3) {
    statusText = `${days} days late`; statusColor = "#8A4038"; statusBg = "#FBEDEA"; statusBorder = "#EFD2CA";
  } else {
    statusText = `${days} day${days > 1 ? "s" : ""} late`; statusColor = "#8A4038"; statusBg = "#FBEDEA"; statusBorder = "#EFD2CA";
  }

  const missing = [];
  if (["missing_all", "pending", "rescheduled"].includes(event.report_status)) missing.push("photos", "notes");
  else if (event.report_status === "missing_photos") missing.push("photos");
  else if (event.report_status === "missing_notes") missing.push("notes");

  const handleUpload = async () => {
    setBusy(true);
    try {
      const photoUrls = [];
      for (const file of uploadPhotos) {
        const { file_url } = await base44.integrations.Core.UploadFile({ file });
        photoUrls.push(file_url);
      }
      await base44.functions.invoke("resolveFieldReport", { event_id: event.id, action: "upload", photos: photoUrls, notes: uploadNotes });
      setUploading(false); setUploadPhotos([]); setUploadNotes("");
      if (onChanged) await onChanged();
    } finally { setBusy(false); }
  };

  const handleMarkReported = async () => {
    setBusy(true);
    try {
      await base44.functions.invoke("resolveFieldReport", { event_id: event.id, action: "mark_reported" });
      if (onChanged) await onChanged();
    } finally { setBusy(false); }
  };

  const handleWaive = async () => {
    setBusy(true);
    try {
      await base44.functions.invoke("resolveFieldReport", { event_id: event.id, action: "waive", reason: waiveReason });
      setWaiving(false); setWaiveReason("");
      if (onChanged) await onChanged();
    } finally { setBusy(false); }
  };

  return (
    <>
      <div className="rounded-[10px] p-3" style={{ backgroundColor: statusBg, border: `1px solid ${statusBorder}` }}>
        <div className="flex items-center gap-2 mb-2 flex-wrap">
          <span className="text-[10px] font-semibold tracking-[0.01em] px-2 py-0.5 rounded-full whitespace-nowrap flex items-center gap-1" style={{ color: statusColor, backgroundColor: "#FFFFFF", border: `1px solid ${statusBorder}` }}>
            {days >= 3 && <AlertTriangle className="h-3 w-3" />}{statusText}
          </span>
          {missing.length > 0 && <span className="text-[12px]" style={{ color: C.textMuted }}>Missing: {missing.join(", ")}</span>}
        </div>
        {event.report_status === "rescheduled" && event.original_scheduled_date && (
          <div className="text-[12px] mb-2" style={{ color: C.textMuted }}>Originally {event.original_scheduled_date} · now {event.event_date}</div>
        )}
        <div className="flex items-center gap-2 flex-wrap">
          {event.job_id && <Link to={`/jobs/${event.job_id}`} className="text-[10px] font-semibold tracking-[0.01em] px-2.5 py-1.5 rounded-full whitespace-nowrap" style={{ border: `1px solid ${C.border}`, color: C.textSecondary }}>Open job</Link>}
          <button onClick={() => setUploading(true)} className="text-[10px] font-semibold tracking-[0.01em] px-2.5 py-1.5 rounded-full whitespace-nowrap" style={{ border: `1px solid ${C.border}`, color: C.textSecondary }}>Upload here</button>
          {isManager && <button onClick={handleMarkReported} disabled={busy} className="text-[10px] font-semibold tracking-[0.01em] px-2.5 py-1.5 rounded-full whitespace-nowrap" style={{ border: `1px solid ${C.border}`, color: C.textSecondary }}>Mark reported</button>}
          {isAdmin && <button onClick={() => setWaiving(true)} className="text-[10px] font-semibold tracking-[0.01em] px-2.5 py-1.5 rounded-full whitespace-nowrap" style={{ border: `1px solid ${C.border}`, color: C.textSecondary }}>Waive</button>}
        </div>
      </div>

      {uploading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(19,26,38,.40)" }} onClick={() => setUploading(false)}>
          <div className="rounded-[14px] p-4 sm:p-5 max-w-md w-full max-h-[90dvh] overflow-y-auto overscroll-contain card-shadow-elevated" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }} onClick={(e) => e.stopPropagation()}>
            <h3 className="font-heading text-[15px] font-semibold mb-1" style={{ color: C.text }}>Upload field report</h3>
            <p className="break-words text-[12px] mb-3" style={{ color: C.textMuted }}>{event.job_name}</p>
            <input type="file" multiple accept="image/*" onChange={(e) => setUploadPhotos([...e.target.files])} className="mb-3 w-full text-[12px]" style={{ color: C.textSecondary }} />
            <textarea value={uploadNotes} onChange={(e) => setUploadNotes(e.target.value)} placeholder="Notes..." className="w-full rounded-[10px] p-2.5 text-[13px] mb-3" style={{ border: `1px solid ${C.border}`, backgroundColor: C.cardAlt, color: C.text }} rows={3} />
            <div className="flex flex-wrap justify-end gap-2">
              <button onClick={() => setUploading(false)} className="px-3 py-1.5 rounded-full text-[12px]" style={{ border: `1px solid ${C.border}`, color: C.textSecondary }}>Cancel</button>
              <button onClick={handleUpload} disabled={busy} className="px-3 py-1.5 rounded-full text-[12px] font-semibold" style={{ backgroundColor: C.accent, color: C.accentDark }}>{busy ? "Uploading..." : "Upload"}</button>
            </div>
          </div>
        </div>
      )}

      {waiving && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(19,26,38,.40)" }} onClick={() => setWaiving(false)}>
          <div className="rounded-[14px] p-4 sm:p-5 max-w-md w-full max-h-[90dvh] overflow-y-auto overscroll-contain card-shadow-elevated" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }} onClick={(e) => e.stopPropagation()}>
            <h3 className="font-heading text-[15px] font-semibold mb-1" style={{ color: C.text }}>Waive report requirement</h3>
            <p className="break-words text-[12px] mb-3" style={{ color: C.textMuted }}>{event.job_name}</p>
            <textarea value={waiveReason} onChange={(e) => setWaiveReason(e.target.value)} placeholder="Reason for waiving..." className="w-full rounded-[10px] p-2.5 text-[13px] mb-3" style={{ border: `1px solid ${C.border}`, backgroundColor: C.cardAlt, color: C.text }} rows={3} />
            <div className="flex flex-wrap justify-end gap-2">
              <button onClick={() => setWaiving(false)} className="px-3 py-1.5 rounded-full text-[12px]" style={{ border: `1px solid ${C.border}`, color: C.textSecondary }}>Cancel</button>
              <button onClick={handleWaive} disabled={busy || !waiveReason.trim()} className="px-3 py-1.5 rounded-full text-[12px] font-semibold" style={{ backgroundColor: C.amber, color: "#FFFFFF", opacity: busy || !waiveReason.trim() ? 0.5 : 1 }}>{busy ? "Waiving..." : "Waive"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
