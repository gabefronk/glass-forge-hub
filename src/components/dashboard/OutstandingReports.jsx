import { useState } from "react";
import { Link } from "react-router-dom";
import { base44 } from "@/api/base44Client";
import { C, formatDateGroup } from "@/lib/feeUI";
import { AlertTriangle } from "lucide-react";

function statusLabel(event) {
  if (event.report_status === "rescheduled") {
    return { text: "RESCHEDULED", color: C.textMuted, bg: "rgba(255,255,255,.06)", dot: C.textMuted };
  }
  const days = event.days_late || 0;
  if (days === 0) return { text: "AWAITING REPORT", color: C.amber, bg: "rgba(255,138,122,.10)", dot: C.amber };
  if (days >= 3) return { text: `${days} DAYS LATE`, color: "#FF8A7A", bg: "rgba(255,138,122,.18)", dot: "#FF8A7A", escalate: true };
  return { text: `${days} DAY${days > 1 ? "S" : ""} LATE`, color: "#FF8A7A", bg: "rgba(255,138,122,.14)", dot: "#FF8A7A" };
}

function missingText(event) {
  if (event.report_status === "rescheduled") {
    const orig = event.original_scheduled_date ? formatDateGroup(event.original_scheduled_date) : "";
    const now = event.event_date ? formatDateGroup(event.event_date) : "";
    return `Originally ${orig} · now ${now} · still no report`;
  }
  if (event.report_status === "pending") return "Within grace period — report not yet due";
  if (event.report_status === "missing_all") return "Missing: photos, notes";
  if (event.report_status === "missing_photos") return "Missing: photos";
  if (event.report_status === "missing_notes") return "Missing: notes";
  return "Missing: photos, notes";
}

export default function OutstandingReports({ events, user, onChanged, complianceStartDate }) {
  const [uploading, setUploading] = useState(null);
  const [waiving, setWaiving] = useState(null);
  const [uploadPhotos, setUploadPhotos] = useState([]);
  const [uploadNotes, setUploadNotes] = useState("");
  const [waiveReason, setWaiveReason] = useState("");
  const [busy, setBusy] = useState(false);

  const outstanding = (events || [])
    .filter((e) => e.report_required !== false &&
      ["pending", "missing_photos", "missing_notes", "missing_all", "rescheduled"].includes(e.report_status))
    .filter((e) => !complianceStartDate || (e.event_date || "") >= complianceStartDate)
    .sort((a, b) => {
      const aRes = a.report_status === "rescheduled" ? 1 : 0;
      const bRes = b.report_status === "rescheduled" ? 1 : 0;
      if (aRes !== bRes) return bRes - aRes;
      return (b.days_late || 0) - (a.days_late || 0);
    });

  const noSourceDates = [...new Set((events || [])
    .filter((e) => e.report_status === "no_source_data")
    .filter((e) => !complianceStartDate || (e.event_date || "") >= complianceStartDate)
    .map((e) => e.event_date))]
    .sort()
    .reverse();

  if (!outstanding.length && !noSourceDates.length) {
    return (
      <div className="rounded-[18px] px-5 py-4 mb-5 flex items-center gap-3" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
        <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: C.accent }} />
        <div className="text-[13px] font-medium" style={{ color: C.textSecondary }}>All field reports current</div>
      </div>
    );
  }

  const isAdmin = user?.role === "admin";
  const isManager = user?.role === "manager" || isAdmin;

  const handleUpload = async () => {
    setBusy(true);
    try {
      const photoUrls = [];
      for (const file of uploadPhotos) {
        const { file_url } = await base44.integrations.Core.UploadFile({ file });
        photoUrls.push(file_url);
      }
      await base44.functions.invoke("resolveFieldReport", {
        event_id: uploading.id, action: "upload", photos: photoUrls, notes: uploadNotes,
      });
      setUploading(null); setUploadPhotos([]); setUploadNotes("");
      if (onChanged) await onChanged();
    } finally { setBusy(false); }
  };

  const handleMarkReported = async (event) => {
    setBusy(true);
    try {
      await base44.functions.invoke("resolveFieldReport", { event_id: event.id, action: "mark_reported" });
      if (onChanged) await onChanged();
    } finally { setBusy(false); }
  };

  const handleWaive = async () => {
    setBusy(true);
    try {
      await base44.functions.invoke("resolveFieldReport", {
        event_id: waiving.id, action: "waive", reason: waiveReason,
      });
      setWaiving(null); setWaiveReason("");
      if (onChanged) await onChanged();
    } finally { setBusy(false); }
  };

  return (
    <>
      {noSourceDates.length > 0 && (
        <div className="rounded-[18px] px-5 py-4 mb-5 flex items-start gap-3" style={{ backgroundColor: "rgba(255,138,122,.10)", border: `1px solid rgba(255,138,122,.25)` }}>
          <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" style={{ color: "#FF8A7A" }} />
          <div>
            <div className="text-[14px] font-semibold mb-1" style={{ color: "#FF8A7A" }}>Probuild sync incomplete</div>
            <div className="text-[12px]" style={{ color: C.textMuted }}>
              No field reports ingested for {noSourceDates.join(", ")} — flags suppressed. The Probuild pull may have failed; check the ingest logs.
            </div>
          </div>
        </div>
      )}
      {outstanding.length > 0 && (
      <div className="rounded-[18px] overflow-hidden mb-5" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
        <div className="flex items-center justify-between px-5 py-3.5" style={{ borderBottom: `1px solid ${C.border}` }}>
          <h2 className="font-heading text-[15px] font-semibold" style={{ color: C.text }}>Field reports outstanding</h2>
          <span className="font-mono-num-bold text-[20px]" style={{ color: C.amber }}>{outstanding.length}</span>
        </div>
        <div>
          {outstanding.map((event) => {
            const label = statusLabel(event);
            return (
              <div key={event.id} className="px-5 py-3.5" style={{ borderTop: `1px solid ${C.rowBorder}` }}>
                <div className="flex items-start gap-3">
                  <div className="w-1.5 h-1.5 rounded-full mt-2 shrink-0" style={{ backgroundColor: label.dot }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-[14px] font-medium truncate" style={{ color: C.text }}>{event.job_name}</span>
                      <span className="font-mono text-[10px] whitespace-nowrap shrink-0" style={{ color: C.textMuted }}>
                        {event.event_date ? formatDateGroup(event.event_date) : ""}
                      </span>
                      <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.1em] px-2 py-0.5 rounded-full whitespace-nowrap shrink-0 flex items-center gap-1" style={{ backgroundColor: label.bg, color: label.color }}>
                        {label.escalate && <AlertTriangle className="h-2.5 w-2.5" />}{label.text}
                      </span>
                    </div>
                    <div className="text-[12px] mt-0.5" style={{ color: C.textMuted }}>{missingText(event)}</div>
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      {event.job_id && (
                        <Link to={`/jobs/${event.job_id}`} className="font-mono text-[10px] font-semibold uppercase tracking-[0.13em] px-2.5 py-1.5 rounded-full whitespace-nowrap" style={{ border: `1px solid ${C.border}`, color: C.textSecondary }}>Open job</Link>
                      )}
                      <button onClick={() => setUploading(event)} className="font-mono text-[10px] font-semibold uppercase tracking-[0.13em] px-2.5 py-1.5 rounded-full whitespace-nowrap" style={{ border: `1px solid ${C.border}`, color: C.textSecondary }}>Upload here</button>
                      {isManager && (
                        <button onClick={() => handleMarkReported(event)} disabled={busy} className="font-mono text-[10px] font-semibold uppercase tracking-[0.13em] px-2.5 py-1.5 rounded-full whitespace-nowrap" style={{ border: `1px solid ${C.border}`, color: C.textSecondary }}>Mark reported</button>
                      )}
                      {isAdmin && (
                        <button onClick={() => setWaiving(event)} className="font-mono text-[10px] font-semibold uppercase tracking-[0.13em] px-2.5 py-1.5 rounded-full whitespace-nowrap" style={{ border: `1px solid ${C.border}`, color: C.textSecondary }}>Waive</button>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
      )}

      {uploading && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(0,0,0,.80)" }} onClick={() => setUploading(null)}>
          <div className="rounded-[16px] p-5 max-w-md w-full" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }} onClick={(e) => e.stopPropagation()}>
            <h3 className="font-heading text-[15px] font-semibold mb-1" style={{ color: C.text }}>Upload field report</h3>
            <p className="text-[12px] mb-3" style={{ color: C.textMuted }}>{uploading.job_name}</p>
            <input type="file" multiple accept="image/*" onChange={(e) => setUploadPhotos([...e.target.files])} className="mb-3 w-full text-[12px]" style={{ color: C.textSecondary }} />
            <textarea value={uploadNotes} onChange={(e) => setUploadNotes(e.target.value)} placeholder="Notes..." className="w-full rounded-[10px] p-2.5 text-[13px] mb-3" style={{ border: `1px solid ${C.border}`, backgroundColor: C.cardAlt, color: C.text }} rows={3} />
            <div className="flex justify-end gap-2">
              <button onClick={() => setUploading(null)} className="px-3 py-1.5 rounded-full text-[12px]" style={{ border: `1px solid ${C.border}`, color: C.textSecondary }}>Cancel</button>
              <button onClick={handleUpload} disabled={busy} className="px-3 py-1.5 rounded-full text-[12px] font-semibold" style={{ backgroundColor: C.accent, color: C.accentDark }}>{busy ? "Uploading..." : "Upload"}</button>
            </div>
          </div>
        </div>
      )}

      {waiving && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(0,0,0,.80)" }} onClick={() => setWaiving(null)}>
          <div className="rounded-[16px] p-5 max-w-md w-full" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }} onClick={(e) => e.stopPropagation()}>
            <h3 className="font-heading text-[15px] font-semibold mb-1" style={{ color: C.text }}>Waive report requirement</h3>
            <p className="text-[12px] mb-3" style={{ color: C.textMuted }}>{waiving.job_name}</p>
            <textarea value={waiveReason} onChange={(e) => setWaiveReason(e.target.value)} placeholder="Reason for waiving..." className="w-full rounded-[10px] p-2.5 text-[13px] mb-3" style={{ border: `1px solid ${C.border}`, backgroundColor: C.cardAlt, color: C.text }} rows={3} />
            <div className="flex justify-end gap-2">
              <button onClick={() => setWaiving(null)} className="px-3 py-1.5 rounded-full text-[12px]" style={{ border: `1px solid ${C.border}`, color: C.textSecondary }}>Cancel</button>
              <button onClick={handleWaive} disabled={busy || !waiveReason.trim()} className="px-3 py-1.5 rounded-full text-[12px] font-semibold" style={{ backgroundColor: C.amber, color: C.accentDark, opacity: busy || !waiveReason.trim() ? 0.5 : 1 }}>{busy ? "Waiving..." : "Waive"}</button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}