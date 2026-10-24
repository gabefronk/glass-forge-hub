import { useEffect, useMemo, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { resolveFieldReport } from "@/lib/fieldReports";
import { sanitizeText } from "@/lib/jobsSanitize";
import { isVideoUrl } from "@/lib/fileLinks";
import { Loader2, X, Camera, Image as ImageIcon } from "lucide-react";
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

// Hub palette (sand sheet, dark teal, brass edges), approved on the Jobs concepts canvas (Oct 24).
const PAGE = "#F6F2EA", CARD = "#FFFFFF", LINE = "#D6CCBA", EDGE = "#B3A792", FIELD = "#9A9080";
const INK = "#101617", MUT = "#34403F", DARK = "#0F2628", TEAL = "#0B3F3B";

const label = { color: MUT, letterSpacing: ".06em" };
const fieldStyle = { border: `1px solid ${FIELD}`, backgroundColor: CARD, color: INK };

// Two-way switch: both halves are real buttons, the picked one is filled.
function Segmented({ value, options, onChange, ariaLabel }) {
  return (
    <div role="group" aria-label={ariaLabel} className="grid grid-cols-2 gap-1 rounded-[12px] p-1" style={{ backgroundColor: "#E9E2D4" }}>
      {options.map((o) => {
        const on = value === o.value;
        return (
          <button key={o.value} type="button" aria-pressed={on} onClick={() => onChange(o.value)}
            className="min-h-[44px] rounded-[9px] px-2 text-[14px] font-semibold"
            style={on ? { backgroundColor: DARK, color: "#fff" } : { color: MUT }}>
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Label({ children, as: Tag = "div", className = "" }) {
  return <Tag className={`mb-1.5 block text-[12px] font-semibold uppercase ${className}`} style={label}>{children}</Tag>;
}

export default function JobFieldReportModal({ jobId, jobName, events, onClose, onDone }) {
  const pendingEvents = useMemo(
    () => (events || []).filter((e) => e.report_required !== false && PENDING.includes(e.report_status) && e.event_date),
    [events]
  );
  const options = [
    ...pendingEvents.map((e) => ({ id: e.id, title: formatShort(e.event_date), sub: [e.start_time, sanitizeText(e.scope_notes || "").split("\n")[0]].filter(Boolean).join(" · ") })),
    { id: "", title: "No appointment", sub: "General report for this job" },
  ];
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

  const canSubmit = (photos.length + videos.length > 0 || notes.trim()) && status && !saving && !uploading;

  // Live rubric values drive the pickers. The charge itself is priced
  // server-side on submit (from these keys) and lands on the job's budget
  // and invoicing - nothing is shown or totalled here.
  const types = rubric ? rubric.types : FALLBACK_TYPES;
  const materials = rubric ? rubric.materials : FALLBACK_MATERIALS;
  const typeRow = types.find((t) => t.label === ticketType || t.key === ticketType) || null;
  const matRow = materials.find((m) => m.label === material || m.key === material) || null;

  // One picker for photos and videos: each file goes to its list by type.
  const handleFiles = async (files) => {
    if (!files.length) return;
    setUploading(true);
    try {
      for (const file of files) {
        const { file_url } = await base44.integrations.Core.UploadFile({ file });
        const isVideo = String(file.type || "").startsWith("video/") || isVideoUrl(file_url);
        (isVideo ? setVideos : setPhotos)((p) => [...p, file_url]);
      }
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
  const step = (d) => setHours((h) => Math.min(24, Math.max(0, Math.round((h + d) * 2) / 2)));
  const pickerClass = "flex min-h-[48px] cursor-pointer items-center justify-center gap-2 rounded-[12px] border-2 border-dashed text-[14px] font-semibold";

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4" style={{ backgroundColor: "rgba(15,38,40,.55)" }} onClick={onClose}>
      <div
        role="dialog" aria-modal="true" aria-label="Field report"
        className="flex w-full max-h-[94dvh] flex-col overflow-hidden rounded-t-[18px] sm:max-w-[600px] sm:rounded-[16px] card-shadow-elevated"
        style={{ backgroundColor: PAGE }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex justify-center pt-2 sm:hidden" aria-hidden="true"><span className="h-[5px] w-10 rounded-full" style={{ backgroundColor: EDGE }} /></div>
        <div className="flex items-start gap-3 px-4 pb-3 pt-2.5 sm:px-5 sm:pt-4" style={{ borderBottom: `1px solid ${LINE}`, backgroundColor: CARD }}>
          <div className="min-w-0 flex-1">
            <h3 className="font-heading text-[19px] font-bold" style={{ color: INK, letterSpacing: "-0.02em" }}>Field report</h3>
            <p className="text-[13.5px] break-words" style={{ color: MUT }}>{sanitizeText(jobName || "")}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full" style={{ border: `1px solid ${EDGE}`, color: INK, backgroundColor: CARD }}><X className="h-4 w-4" /></button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
          <fieldset>
            <Label as="legend">Which visit is this for?</Label>
            <div className="overflow-hidden rounded-[12px]" style={{ border: `1px solid ${EDGE}`, backgroundColor: CARD }}>
              {options.map((o, i) => {
                const on = selected === o.id;
                return (
                  <label key={o.id || "general"} className="flex min-h-[56px] cursor-pointer items-center gap-3 px-3.5 py-2" style={{ borderTop: i ? `1px solid ${LINE}` : 0, backgroundColor: on ? "#EAF2EF" : CARD }}>
                    <input type="radio" name="field-report-visit" className="sr-only" checked={on} onChange={() => setSelected(o.id)} />
                    <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full" style={{ border: `2px solid ${on ? TEAL : FIELD}` }} aria-hidden="true">
                      {on ? <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: TEAL }} /> : null}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[14.5px] font-semibold" style={{ color: INK }}>{o.title}</span>
                      {o.sub ? <span className="block truncate text-[13px]" style={{ color: "#566063" }}>{o.sub}</span> : null}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>

          <label className="block">
            <Label as="span">Ticket type</Label>
            <select value={ticketType} onChange={(e) => setTicketType(e.target.value)} className="min-h-[48px] w-full rounded-[12px] px-3 text-[15px] focus:outline-none" style={fieldStyle}>
              {types.map((t) => <option key={t.key} value={t.label}>{t.label}</option>)}
            </select>
          </label>

          <div>
            <Label>Is the work done?</Label>
            <Segmented ariaLabel="Status" value={status} onChange={setStatus} options={[{ value: "Open", label: "Still open" }, { value: "Closed", label: "Done · close it" }]} />
          </div>

          <label className="block">
            <Label as="span">Notes</Label>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={4}
              placeholder="What was done, what's left, anything the office should know…"
              className="w-full resize-y rounded-[12px] p-3 text-[15px] focus:outline-none" style={fieldStyle} />
          </label>

          {/* Material, long distance and hours price the visit, so they sit together. */}
          <section aria-label="Charge" className="space-y-3 rounded-[12px] p-3" style={{ backgroundColor: CARD, border: `1px solid ${EDGE}` }}>
            <p className="text-[12.5px]" style={{ color: MUT }}>These set what the visit is charged.</p>
            <div className="grid grid-cols-2 items-end gap-2.5">
              <label className="block">
                <Label as="span">Material</Label>
                <select value={material} onChange={(e) => setMaterial(e.target.value)} className="min-h-[48px] w-full rounded-[12px] px-3 text-[15px] focus:outline-none" style={fieldStyle}>
                  <option value="">Pick…</option>
                  {materials.map((m) => <option key={m.key} value={m.label}>{m.label}</option>)}
                </select>
              </label>
              <div>
                <Label>Long distance</Label>
                <Segmented ariaLabel="Long distance" value={longDistance} onChange={setLongDistance} options={[{ value: "No", label: "No" }, { value: "Yes", label: "Yes" }]} />
              </div>
            </div>
            <div>
              <Label>Hours worked</Label>
              <div className="flex items-center gap-2 rounded-[12px] p-1" style={fieldStyle}>
                <button type="button" aria-label="Half hour less" onClick={() => step(-0.5)} className="h-11 w-11 rounded-[9px] text-[20px] font-bold" style={{ backgroundColor: "#E9E2D4", color: INK }}>−</button>
                <span className="flex-1 text-center font-mono-num text-[20px] font-semibold" style={{ color: INK }} aria-live="polite">{hours.toFixed(1)}</span>
                <button type="button" aria-label="Half hour more" onClick={() => step(0.5)} className="h-11 w-11 rounded-[9px] text-[20px] font-bold" style={{ backgroundColor: "#E9E2D4", color: INK }}>+</button>
              </div>
            </div>
          </section>

          <div>
            <Label>Photos &amp; videos{media.length ? ` · ${media.length}` : ""}</Label>
            {media.length > 0 && (
              <div className="mb-2.5 grid grid-cols-3 gap-2">
                {media.map((m, i) => (
                  <div key={i} className="relative aspect-[4/3] overflow-hidden rounded-[10px]" style={{ border: `1px solid ${LINE}` }}>
                    {m.v || isVideoUrl(m.u) ? <video src={m.u} muted playsInline preload="metadata" className="h-full w-full object-cover" /> : <img src={m.u} alt="" className="h-full w-full object-cover" />}
                    <button type="button" onClick={() => removeAt(i)} aria-label="Remove" className="absolute right-1 top-1 flex h-7 w-7 items-center justify-center rounded-full" style={{ backgroundColor: "rgba(15,38,40,.8)", color: "#fff" }}>
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            )}
            <div className="grid grid-cols-2 gap-2">
              <label className={pickerClass} style={{ borderColor: FIELD, backgroundColor: CARD, color: TEAL }}>
                <input type="file" accept="image/*,video/*" capture="environment" className="sr-only" onChange={(e) => { handleFiles(Array.from(e.target.files)); e.target.value = ""; }} />
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-[18px] w-[18px]" />}Camera
              </label>
              <label className={pickerClass} style={{ borderColor: FIELD, backgroundColor: CARD, color: TEAL }}>
                <input type="file" multiple accept="image/*,video/*" className="sr-only" onChange={(e) => { handleFiles(Array.from(e.target.files)); e.target.value = ""; }} />
                {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-[18px] w-[18px]" />}{uploading ? "Uploading…" : "Library"}
              </label>
            </div>
          </div>

          {error ? <p role="alert" className="text-[13px]" style={{ color: "#A43432" }}>{error}</p> : null}
        </div>

        <div className="grid grid-cols-[1fr_2fr] gap-2.5 px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))] sm:px-5" style={{ borderTop: `1px solid ${EDGE}`, backgroundColor: CARD }}>
          <button type="button" onClick={onClose} className="min-h-[48px] rounded-[12px] text-[15px] font-semibold" style={{ border: `1px solid ${EDGE}`, color: INK, backgroundColor: CARD }}>Cancel</button>
          <button type="button" onClick={handleSubmit} disabled={!canSubmit} className="min-h-[48px] rounded-[12px] text-[15px] font-semibold text-white"
            style={{ backgroundColor: canSubmit ? TEAL : "#9AA6A4", opacity: saving ? 0.8 : 1 }}>
            {saving ? "Submitting…" : "Submit report"}
          </button>
        </div>
      </div>
    </div>
  );
}
