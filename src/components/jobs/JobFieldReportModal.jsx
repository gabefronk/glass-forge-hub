import { useEffect, useMemo, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { resolveFieldReport } from "@/lib/fieldReports";
import { sanitizeText } from "@/lib/jobsSanitize";
import { isVideoUrl } from "@/lib/fileLinks";
import { Loader2, X, Film } from "lucide-react";
import { formatShort } from "@/lib/feeUI";

const PENDING = ["pending", "missing_photos", "missing_notes", "missing_all", "rescheduled"];
// Fallbacks only - the form reads the live PricingRubric entity (ticket types with visit fees,
// materials with hourly rates, the long distance charge). These apply when the rubric fetch
// fails; the server always prices the report from the rubric itself, never from this file.
const FALLBACK_TYPES = [
  { key: "initial_visit_po", label: "Initial visit", visitFee: null },
  { key: "delivery", label: "Delivery", visitFee: null },
  { key: "install", label: "Install", visitFee: null },
  { key: "sheetrock_window", label: "Sheetrock window", visitFee: null },
  { key: "screen_service", label: "Screen Service", visitFee: null },
  { key: "service", label: "Service", visitFee: null },
  { key: "follow_up", label: "Follow-up", visitFee: 0 },
  { key: "warranty", label: "Warranty", visitFee: null },
  { key: "punch_list", label: "Punch List", visitFee: null },
];
const FALLBACK_MATERIALS = [
  { key: "vinyl", label: "Vinyl", rate: 100 },
  { key: "composite", label: "Composite", rate: 125 },
  { key: "wood", label: "Wood", rate: 150 },
];
const FALLBACK_LD_FEE = 75;

// Palette pulled from the "New ticket" example Gabriel supplied: light blue-gray
// page, white inner card, dark navy pills, pale-teal selected chips, teal links.
const PAGE = "#EDF2F6", CARD = "#FFFFFF", LINE = "#D8E0E6", INK = "#0F1B22", MUT = "#64748B";
const NAVY = "#0E2A38", TEAL = "#0E7C7B", TEAL_BG = "#E2F1EF", TEAL_INK = "#0B5F5E";

const label = { color: MUT, letterSpacing: ".08em" };
function Chip({ on, onClick, children, dark }) {
  return (
    <button type="button" onClick={onClick}
      className="rounded-[10px] px-4 py-2 text-[13px] font-semibold transition-colors"
      style={on
        ? (dark ? { backgroundColor: NAVY, color: "#fff", border: `1px solid ${NAVY}` } : { backgroundColor: TEAL_BG, color: TEAL_INK, border: `1px solid ${TEAL_BG}` })
        : { backgroundColor: CARD, color: INK, border: `1px solid ${LINE}` }}>
      {children}
    </button>
  );
}

export default function JobFieldReportModal({ jobId, jobName, events, onClose, onDone }) {
  const pendingEvents = useMemo(
    () => (events || []).filter((e) => e.report_required !== false && PENDING.includes(e.report_status) && e.event_date),
    [events]
  );
  const general = { id: "", label: "General field report (no specific appointment)" };
  const options = [general, ...pendingEvents.map((e) => ({ id: e.id, label: `${formatShort(e.event_date)}${e.start_time ? ` · ${e.start_time}` : ""}`, ev: e }))];
  const [selected, setSelected] = useState(pendingEvents[0] ? pendingEvents[0].id : "");
  const [ticketType, setTicketType] = useState("Install");
  const [status, setStatus] = useState(""); // Open | Closed -> incomplete | complete (required, like the old question)
  const [hours, setHours] = useState(0);
  const [material, setMaterial] = useState("");
  const [longDistance, setLongDistance] = useState("No");
  const [photos, setPhotos] = useState([]);
  const [videos, setVideos] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [rubric, setRubric] = useState(null);

  useEffect(() => {
    let cancelled = false;
    base44.entities.PricingRubric.list("sort", 200).then((rows) => {
      if (cancelled) return;
      const active = (Array.isArray(rows) ? rows : []).filter((r) => r && !r.retired);
      const types = active.filter((r) => r.kind === "ticket_type").map((r) => ({ key: r.key, label: r.label, visitFee: r.visit_fee ?? null }));
      const materials = active.filter((r) => r.kind === "material").map((r) => ({ key: r.key, label: r.label, rate: Number(r.hourly_rate) || 0 }));
      const ldRow = active.find((r) => r.kind === "setting" && r.key === "long_distance");
      if (types.length && materials.length) setRubric({ types, materials, ldFee: ldRow ? Number(ldRow.amount) || 0 : FALLBACK_LD_FEE });
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);
  const requestKey = useRef(`field-report:${jobId}:${crypto.randomUUID()}`);

  const canSubmit = (photos.length + videos.length > 0 || notes.trim()) && status && !saving;

  // Live rubric values drive the pickers. The charge itself is priced
  // server-side on submit (from these keys) and lands on the job's budget
  // and invoicing - nothing is shown or totalled here.
  const types = rubric ? rubric.types : FALLBACK_TYPES;
  const materials = rubric ? rubric.materials : FALLBACK_MATERIALS;
  const typeRow = types.find((t) => t.label === ticketType || t.key === ticketType) || null;
  const matRow = materials.find((m) => m.label === material || m.key === material) || null;

  const handleFiles = async (files, target) => {
    if (!files.length) return;
    setUploading(true);
    try {
      const urls = [];
      for (const file of files) {
        const { file_url } = await base44.integrations.Core.UploadFile({ file });
        urls.push(file_url);
      }
      (target === "video" ? setVideos : setPhotos)((p) => [...p, ...urls]);
    } catch {
      setError("Upload failed. Try again.");
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSaving(true);
    setError("");
    try {
      // The report record keeps its existing shape (body + attachments + completion);
      // the new structured picks ride as readable lines on the note so the office
      // sees them in the job history exactly as typed.
      const lines = [];
      if (ticketType) lines.push(`Type: ${ticketType}`);
      if (notes.trim()) lines.push(notes.trim());
      if (hours > 0) lines.push(`Hours: ${hours.toFixed(1)}`);
      if (material) lines.push(`Material: ${material}`);
      if (longDistance === "Yes") lines.push("Long distance: Yes");
      await resolveFieldReport({
        action: "upload",
        event_id: selected || undefined,
        job_id: jobId,
        photos: [...photos, ...videos],
        notes: lines.join("\n") || "Field report photos uploaded",
        completion: status === "Closed" ? "complete" : "incomplete",
        // Priced server-side from the live PricingRubric; keys only, never amounts.
        ticket_type: typeRow ? typeRow.key : ticketType,
        hours,
        material: matRow ? matRow.key : material,
        long_distance: longDistance === "Yes",
        // One key per opened form, so a retried submit cannot raise a second to-do.
        request_key: requestKey.current,
      });
      onDone();
    } catch (e) {
      setError(e?.message || "Submit failed. Try again.");
    } finally {
      setSaving(false);
    }
  };

  const media = [...photos.map((u) => ({ u, v: false })), ...videos.map((u) => ({ u, v: true }))];
  const removeAt = (i) => {
    if (i < photos.length) setPhotos((p) => p.filter((_, j) => j !== i));
    else setVideos((p) => p.filter((_, j) => j !== i - photos.length));
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ backgroundColor: "rgba(24,36,34,.45)" }} onClick={onClose}>
      <div
        className="rounded-t-[16px] sm:rounded-[14px] w-full sm:max-w-md max-h-[92dvh] overflow-y-auto overscroll-contain card-shadow-elevated"
        style={{ backgroundColor: PAGE, border: `1px solid ${LINE}` }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 px-4 pt-4 pb-3" style={{ backgroundColor: PAGE }}>
          <div className="flex items-start justify-between">
            <div className="min-w-0">
              <h3 className="font-heading text-[17px] font-bold" style={{ color: INK }}>New field report</h3>
              <p className="text-[12.5px] break-words" style={{ color: MUT }}>{sanitizeText(jobName || "")}</p>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="p-1.5 rounded-full" style={{ border: `1px solid ${LINE}`, color: INK, backgroundColor: CARD }}><X className="h-4 w-4" /></button>
          </div>
        </div>

        <div className="px-4 pb-4 space-y-4">
          <div>
            <div className="text-[11px] font-bold uppercase mb-1.5" style={label}>Ticket type</div>
            <select
              value={ticketType}
              onChange={(e) => setTicketType(e.target.value)}
              className="w-full min-h-[44px] rounded-[10px] px-3 text-[13px] focus:outline-none"
              style={{ border: `1px solid ${LINE}`, backgroundColor: CARD, color: INK }}
            >
              {types.map((t) => <option key={t.key} value={t.label}>{t.label}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-[auto_minmax(0,1fr)] items-end gap-6">
            <div>
              <div className="text-[11px] font-bold uppercase mb-1.5" style={label}>Status</div>
              <div className="flex items-center gap-3">
                <Chip dark on={status === "Open"} onClick={() => setStatus("Open")}>Open</Chip>
                <button type="button" onClick={() => setStatus("Closed")}
                  className="px-1 py-2 text-[13px] font-semibold"
                  style={status === "Closed" ? { backgroundColor: NAVY, color: "#fff", border: `1px solid ${NAVY}`, borderRadius: 10, padding: "8px 16px" } : { color: INK }}>
                  Closed
                </button>
              </div>
            </div>
            <div>
              <div className="text-[11px] font-bold uppercase mb-1.5" style={label}>Service date</div>
              <select
                value={selected}
                onChange={(e) => setSelected(e.target.value)}
                className="w-full min-h-[44px] rounded-[10px] px-3 text-[13px] focus:outline-none"
                style={{ border: `1px solid ${LINE}`, backgroundColor: CARD, color: INK }}
              >
                {options.map((o) => <option key={o.id || "general"} value={o.id}>{o.label}</option>)}
              </select>
            </div>
          </div>

          <div>
            <div className="text-[11px] font-bold uppercase mb-1.5" style={label}>Notes</div>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4}
              placeholder="What was done, what's left, anything the office should know…"
              className="w-full rounded-[12px] p-3 text-[13px] resize-y focus:outline-none"
              style={{ border: `1px solid ${LINE}`, backgroundColor: CARD, color: INK }} />
          </div>

          <div className="rounded-[14px] p-3 space-y-3" style={{ backgroundColor: CARD, border: `1px solid ${LINE}` }}>
            <div className="flex items-center justify-between">
              <span className="text-[11px] font-bold uppercase" style={label}>Hours worked</span>
              <div className="flex items-center gap-3 rounded-[10px] px-2 py-1" style={{ backgroundColor: PAGE }}>
                <button type="button" aria-label="Less time" onClick={() => setHours((h) => Math.max(0, Math.round((h - 0.5) * 2) / 2))}
                  className="h-8 w-8 rounded-[8px] text-[16px] font-bold" style={{ backgroundColor: CARD, border: `1px solid ${LINE}`, color: INK }}>−</button>
                <span className="w-10 text-center text-[16px] font-bold" style={{ color: INK }}>{hours.toFixed(1)}</span>
                <button type="button" aria-label="More time" onClick={() => setHours((h) => Math.min(24, Math.round((h + 0.5) * 2) / 2))}
                  className="h-8 w-8 rounded-[8px] text-[16px] font-bold" style={{ backgroundColor: CARD, border: `1px solid ${LINE}`, color: INK }}>+</button>
              </div>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold uppercase" style={label}>Material</span>
              <div className="flex gap-2">
                {materials.map((m) => <Chip key={m.key} on={material === m.label} onClick={() => setMaterial((cur) => (cur === m.label ? "" : m.label))}>{m.label}</Chip>)}
              </div>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[11px] font-bold uppercase" style={label}>Long distance</span>
              <div className="flex gap-2">
                <Chip dark on={longDistance === "No"} onClick={() => setLongDistance("No")}>No</Chip>
                <Chip on={longDistance === "Yes"} onClick={() => setLongDistance("Yes")}>Yes</Chip>
              </div>
            </div>
          </div>

          <div>
            <div className="text-[11px] font-bold uppercase mb-1.5" style={label}>Photos</div>
            <label className="block cursor-pointer rounded-[14px] border-2 border-dashed px-3 py-5 text-center" style={{ borderColor: LINE, backgroundColor: CARD }}>
              <input type="file" multiple accept="image/*" className="hidden" onChange={(e) => { handleFiles(Array.from(e.target.files), "photo"); e.target.value = ""; }} />
              <span className="inline-flex items-center gap-1.5 text-[13px] font-semibold" style={{ color: TEAL }}>
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : null}{uploading ? "Uploading…" : "+ Add photos"}
              </span>
            </label>
          </div>

          <div>
            <div className="mb-1.5 flex items-center gap-3">
              <span className="text-[11px] font-bold uppercase" style={label}>Videos · {videos.length}</span>
              <label className="cursor-pointer text-[13px] font-semibold" style={{ color: TEAL }}>
                <input type="file" multiple accept="video/*" className="hidden" onChange={(e) => { handleFiles(Array.from(e.target.files), "video"); e.target.value = ""; }} />
                + Add video
              </label>
            </div>
            <label className="block cursor-pointer rounded-[14px] border-2 border-dashed px-3 py-5 text-center" style={{ borderColor: LINE, backgroundColor: CARD }}>
              <input type="file" multiple accept="video/*" className="hidden" onChange={(e) => { handleFiles(Array.from(e.target.files), "video"); e.target.value = ""; }} />
              <Film className="mx-auto h-6 w-6" style={{ color: TEAL }} />
              <span className="mt-1 block text-[13px] font-semibold" style={{ color: TEAL }}>Add video</span>
            </label>
          </div>

          {media.length > 0 && (
            <div className="grid grid-cols-3 gap-1.5">
              {media.map((m, i) => (
                <div key={i} className="relative aspect-square rounded-md overflow-hidden" style={{ border: `1px solid ${LINE}` }}>
                  {m.v || isVideoUrl(m.u) ? <video src={m.u} muted playsInline preload="metadata" className="h-full w-full object-cover" /> : <img src={m.u} alt="" className="h-full w-full object-cover" />}
                  <button type="button" onClick={() => removeAt(i)} aria-label="Remove" className="absolute top-0 right-0 rounded-bl p-1" style={{ backgroundColor: "rgba(19,26,38,.6)", color: "#fff" }}>
                    <X className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          )}

          {error ? <p role="alert" className="text-[12px]" style={{ color: "#A43432" }}>{error}</p> : null}

          <div className="flex justify-end gap-2 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2.5 rounded-[12px] text-[13px] font-semibold" style={{ border: `1px solid ${LINE}`, color: INK, backgroundColor: CARD }}>Cancel</button>
            <button type="button" onClick={handleSubmit} disabled={!canSubmit} className="px-4 py-2.5 rounded-[12px] text-[13px] font-semibold"
              style={{ backgroundColor: canSubmit ? NAVY : "#C7D1D9", color: "#fff", opacity: saving ? 0.8 : 1 }}>
              {saving ? "Submitting…" : "Submit report"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}