// The field-visit report a worker files from a job, on a phone, in one pass:
// pick the visit, pick the event, say whether it was completed, fill only the fields that
// event collects, add as many issue items as the visit needs, pick who has to know, and
// upload every photo and video ONCE at the end.
//
// The rules live in base44/shared/fieldVisitReport.js and are shared with the published
// resolveFieldReport handler, so the form and the server agree on which fields an event
// shows, what must be explained, when a recipient is required and what may be charged.
// Nothing is priced here: the server prices the visit from the live PricingRubric.
import { useEffect, useMemo, useRef, useState } from "react";
import { base44 } from "@/api/base44Client";
import { resolveFieldReport } from "@/lib/fieldReports";
import { sanitizeText } from "@/lib/jobsSanitize";
import { titleCase } from "@/lib/displayName";
import { isVideoUrl } from "@/lib/fileLinks";
import { Loader2, X, Camera, Image as ImageIcon } from "lucide-react";
import { formatShort } from "@/lib/feeUI";
import {
  VISIT_EVENT_TYPES,
  eventFieldScope,
  validateFieldReport,
  followUpTriggers,
  TRIGGER_LABELS,
  rubricFromRows,
} from "../../../base44/shared/fieldVisitReport.js";
import {
  Label,
  Card,
  Segmented,
  TextArea,
  NotReadySection,
  WindowIssuesSection,
  SheetrockSection,
  PartsNeededSection,
  ScreenIssuesSection,
  CannotFixSection,
  ChecklistSection,
  WarrantySection,
  HoursMaterialSection,
  DocumentationSection,
  RecipientsSection,
} from "@/components/jobs/FieldReportSections";

const PENDING = ["pending", "missing_photos", "missing_notes", "missing_all", "rescheduled"];

// Hub palette (sand sheet, dark teal, brass edges), approved on the Jobs concepts canvas (Oct 24).
const PAGE = "#F6F2EA", CARD = "#FFFFFF", LINE = "#D6CCBA", EDGE = "#B3A792", FIELD = "#9A9080";
const INK = "#101617", MUT = "#34403F", TEAL = "#0B3F3B";

const fieldStyle = { border: `1px solid ${FIELD}`, backgroundColor: CARD, color: INK };

// One plain-English line per blocking rule. Missing photos and unticked documentation
// confirmations are deliberately absent: they never block a submit.
const ERRORS = {
  event_type: "Pick what kind of visit this was.",
  completion: "Say whether the visit was completed or left incomplete.",
  incomplete_reason: "Incomplete work needs an explanation.",
  other_reason_note: "An “Other” reason needs a note.",
  other_issue_note: "An “Other” issue needs a note.",
  issue_level_media_not_allowed: "Photos and videos belong in the one section at the end of the visit.",
  window_issue_kind: "One window item does not apply to this visit type.",
  window_target: "Pick the affected window on every window item.",
  window_other_location: "“Other” needs a location or note so the office can find it.",
  current_ro_dimensions: "Enter the current framed opening on every framing / RO item.",
  required_ro_dimensions: "Enter the dimensions required by the ordered unit.",
  window_issue_note: "“Needs clarification” needs a note.",
  screen_issue_kind: "Pick the screen problem on every screen item.",
  screen_quantity: "Enter how many screens on every screen item.",
  screen_location: "Enter where the screens go on every screen item.",
  cannot_fix_window: "Pick the window that could not be fixed.",
  cannot_fix_note: "Say what is wrong with the window that could not be fixed.",
  sheetrock_outcome: "Pick what happened with the sheetrock window.",
  recipients_required: "Pick at least one manager or salesperson to follow this up.",
  invalid_report: "Some answers are missing. Check the highlighted sections.",
  missing_request_key: "Reload the page and file the report again.",
};

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
  const [eventType, setEventType] = useState("");
  const [status, setStatus] = useState("");
  const [incompleteReason, setIncompleteReason] = useState("");
  const [notReady, setNotReady] = useState(false);
  const [notReadyReasons, setNotReadyReasons] = useState([]);
  const [windowIssues, setWindowIssues] = useState([]);
  const [sheetrockOutcomes, setSheetrockOutcomes] = useState([]);
  const [screenIssues, setScreenIssues] = useState([]);
  const [cannotFix, setCannotFix] = useState([]);
  const [items, setItems] = useState([]);
  const [warrantyIssue, setWarrantyIssue] = useState({ reported_by: "", text: "" });
  const [partsNeeded, setPartsNeeded] = useState("");
  const [documentation, setDocumentation] = useState({});
  const [hasPatioDoor, setHasPatioDoor] = useState(false);
  const [recipients, setRecipients] = useState([]);
  const [hours, setHours] = useState(0);
  const [material, setMaterial] = useState("");
  const [longDistance, setLongDistance] = useState(false);
  const [photos, setPhotos] = useState([]);
  const [videos, setVideos] = useState([]);
  const [uploading, setUploading] = useState(false);
  const [notes, setNotes] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [showErrors, setShowErrors] = useState(false);
  const [materials, setMaterials] = useState([]);
  const [ctx, setCtx] = useState({ recipients: [], windows: [], patio_door_detected: false });
  const [ctxState, setCtxState] = useState("loading");

  // Live PricingRubric material rows drive the product-material picker. Amounts are never
  // read here: the server prices the visit from the same rubric on submit.
  useEffect(() => {
    let cancelled = false;
    base44.entities.PricingRubric.list("sort", 200).then((rows) => {
      if (!cancelled) setMaterials(rubricFromRows(rows).materials);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // The follow-up recipients and the job's ordered window package come from the server:
  // TeamMember is RLS-closed to the client, and the ordered package lives in an admin-only
  // field on the job. Real identities and stable ids only — no names in this file.
  useEffect(() => {
    let cancelled = false;
    setCtxState("loading");
    resolveFieldReport({ action: "form_context", job_id: jobId })
      .then((data) => {
        if (cancelled) return;
        setCtx({ recipients: data?.recipients || [], windows: data?.windows || [], patio_door_detected: !!data?.patio_door_detected });
        setHasPatioDoor(!!data?.patio_door_detected);
        setCtxState("ready");
      })
      .catch(() => { if (!cancelled) setCtxState("error"); });
    return () => { cancelled = true; };
  }, [jobId]);

  // One key per opened form. The server treats it as the idempotency key, so a retried
  // submit — or an edited re-submit of this same form — never doubles the job note, the
  // invoicing staging line or anybody's Today item.
  const requestKey = useRef(`field-report:${jobId}:${crypto.randomUUID()}`);

  const scope = eventFieldScope(eventType);
  const report = useMemo(() => ({
    event_type: eventType,
    completion: status === "Closed" ? "complete" : status === "Open" ? "incomplete" : "",
    incomplete_reason: incompleteReason,
    not_ready: notReady,
    not_ready_reasons: notReadyReasons,
    window_issues: windowIssues,
    items,
    sheetrock_outcomes: sheetrockOutcomes,
    screen_issues: screenIssues,
    cannot_fix: cannotFix,
    warranty_issue: warrantyIssue,
    parts_needed: partsNeeded,
    documentation,
    has_patio_door: hasPatioDoor,
    hours,
    material,
    long_distance: longDistance,
    notes,
    recipients,
  }), [eventType, status, incompleteReason, notReady, notReadyReasons, windowIssues, items, sheetrockOutcomes,
    screenIssues, cannotFix, warrantyIssue, partsNeeded, documentation, hasPatioDoor, hours, material, longDistance, notes, recipients]);

  const check = useMemo(() => validateFieldReport(report), [report]);
  const triggers = check.triggers.map((t) => TRIGGER_LABELS[t] || t);
  const canSubmit = check.ok && !saving && !uploading;

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
    if (!check.ok) { setShowErrors(true); return; }
    if (saving || uploading) return;
    setSaving(true);
    setError("");
    try {
      const res = await resolveFieldReport({
        action: "upload",
        event_id: selected || undefined,
        job_id: jobId,
        photos: [...photos, ...videos],
        notes,
        completion: report.completion,
        event_type: eventType,
        incomplete_reason: incompleteReason,
        not_ready: notReady,
        not_ready_reasons: notReadyReasons,
        window_issues: windowIssues,
        items,
        sheetrock_outcomes: sheetrockOutcomes,
        screen_issues: screenIssues,
        cannot_fix: cannotFix,
        warranty_issue: warrantyIssue,
        parts_needed: partsNeeded,
        documentation,
        has_patio_door: hasPatioDoor,
        recipients,
        // Priced server-side from the live PricingRubric; keys only, never amounts.
        hours,
        material,
        long_distance: longDistance,
        request_key: requestKey.current,
      });
      onDone(res);
    } catch (e) {
      const code = String(e?.message || "");
      setError(ERRORS[code] || code || "Submit failed. Try again.");
      setShowErrors(true);
    } finally {
      setSaving(false);
    }
  };

  const media = [...photos.map((u) => ({ u, v: false })), ...videos.map((u) => ({ u, v: true }))];
  const removeAt = (i) => {
    if (i < photos.length) setPhotos((p) => p.filter((_, j) => j !== i));
    else setVideos((p) => p.filter((_, j) => j !== i - photos.length));
  };
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
            <p className="text-[13.5px] break-words" style={{ color: MUT }}>{titleCase(sanitizeText(jobName || ""))}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Close" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full" style={{ border: `1px solid ${EDGE}`, color: INK, backgroundColor: CARD }}><X className="h-4 w-4" /></button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5">
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
            <Label as="span">What kind of visit?</Label>
            <select value={eventType} onChange={(e) => setEventType(e.target.value)} aria-label="Visit type"
              className="min-h-[48px] w-full rounded-[12px] px-3 text-[15px] focus:outline-none" style={fieldStyle}>
              <option value="">Pick the visit type…</option>
              {VISIT_EVENT_TYPES.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
            </select>
          </label>

          {eventType ? (
            <>
              <div>
                <Label>{eventType === "job_readiness" ? "Was the readiness visit completed?" : "Was the work completed?"}</Label>
                <Segmented ariaLabel="Completion" value={status} onChange={setStatus}
                  options={[{ value: "Open", label: "Incomplete" }, { value: "Closed", label: "Completed" }]} />
                {eventType === "job_readiness" ? (
                  <p className="mt-1.5 text-[12.5px]" style={{ color: MUT }}>This is the readiness visit itself — not whether the windows are installed.</p>
                ) : null}
              </div>

              {status === "Open" ? (
                <Card title="Why was it incomplete? (required)">
                  <TextArea value={incompleteReason} onChange={setIncompleteReason} rows={3} ariaLabel="Why incomplete"
                    placeholder="What stopped you, and what is still left" />
                </Card>
              ) : null}

              <NotReadySection eventType={eventType} value={notReadyReasons} onChange={setNotReadyReasons} notReady={notReady} onNotReady={setNotReady} />

              {scope.sheetrock ? <SheetrockSection value={sheetrockOutcomes} onChange={setSheetrockOutcomes} /> : null}

              <WindowIssuesSection eventType={eventType} windows={ctx.windows} value={windowIssues} onChange={setWindowIssues} />

              {scope.warrantyIssue ? <WarrantySection value={warrantyIssue} onChange={setWarrantyIssue} /> : null}

              <ChecklistSection eventType={eventType} value={items} onChange={setItems} />

              {scope.partsNeeded ? <PartsNeededSection value={partsNeeded} onChange={setPartsNeeded} /> : null}
              {scope.screenIssues ? <ScreenIssuesSection value={screenIssues} onChange={setScreenIssues} /> : null}
              {scope.cannotFix ? <CannotFixSection windows={ctx.windows} value={cannotFix} onChange={setCannotFix} /> : null}

              {scope.hours || scope.material ? (
                <HoursMaterialSection eventType={eventType} materials={materials} hours={hours} onHours={setHours}
                  material={material} onMaterial={setMaterial} longDistance={longDistance} onLongDistance={setLongDistance}
                  showLongDistance={scope.longDistance} billable={scope.billable} />
              ) : null}

              {!scope.hours && !scope.material && scope.longDistance ? (
                <div>
                  <Label>Long distance</Label>
                  <Segmented ariaLabel="Long distance" value={longDistance ? "yes" : "no"} onChange={(v) => setLongDistance(v === "yes")}
                    options={[{ value: "no", label: "No" }, { value: "yes", label: "Yes" }]} />
                </div>
              ) : null}

              <DocumentationSection eventType={eventType} hasPatioDoor={hasPatioDoor} onPatioDoor={setHasPatioDoor} value={documentation} onChange={setDocumentation} />

              <label className="block">
                <Label as="span">Notes</Label>
                <TextArea value={notes} onChange={setNotes} rows={4} ariaLabel="Notes"
                  placeholder="What was done, what's left, anything the office should know…" />
              </label>

              <RecipientsSection people={ctx.recipients} value={recipients} onChange={setRecipients}
                required={followUpTriggers(report).length > 0} triggers={triggers}
                loading={ctxState === "loading"} error={ctxState === "error" ? "The team list could not load. Reload and try again." : ""} />

              {/* The one and only media section: everything for the whole visit, at the end. */}
              <Card title={`Photos & videos for this visit${media.length ? ` · ${media.length}` : ""}`}
                hint="Upload everything for the whole visit here, once. Optional — a missing photo never stops you submitting.">
                {media.length > 0 && (
                  <div className="grid grid-cols-3 gap-2">
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
                    <input type="file" accept="image/*,video/*" capture="environment" className="sr-only" onChange={(e) => { handleFiles(Array.from(e.target.files || [])); e.target.value = ""; }} />
                    {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-[18px] w-[18px]" />}Camera
                  </label>
                  <label className={pickerClass} style={{ borderColor: FIELD, backgroundColor: CARD, color: TEAL }}>
                    <input type="file" multiple accept="image/*,video/*" className="sr-only" onChange={(e) => { handleFiles(Array.from(e.target.files || [])); e.target.value = ""; }} />
                    {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <ImageIcon className="h-[18px] w-[18px]" />}{uploading ? "Uploading…" : "Library"}
                  </label>
                </div>
              </Card>
            </>
          ) : null}

          {showErrors && check.errors.length ? (
            <ul role="alert" className="space-y-1 rounded-[12px] p-3 text-[13px]" style={{ backgroundColor: "#FCEDEC", border: "1px solid #F0C9C5", color: "#A43432" }}>
              {check.errors.map((code) => <li key={code}>{ERRORS[code] || code}</li>)}
            </ul>
          ) : null}
          {error ? <p role="alert" className="text-[13px]" style={{ color: "#A43432" }}>{error}</p> : null}
        </div>

        <div className="grid grid-cols-[1fr_2fr] gap-2.5 px-4 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))] sm:px-5" style={{ borderTop: `1px solid ${EDGE}`, backgroundColor: CARD }}>
          <button type="button" onClick={onClose} className="min-h-[48px] rounded-[12px] text-[15px] font-semibold" style={{ border: `1px solid ${EDGE}`, color: INK, backgroundColor: CARD }}>Cancel</button>
          <button type="button" onClick={handleSubmit} disabled={saving || uploading} className="min-h-[48px] rounded-[12px] text-[15px] font-semibold text-white"
            style={{ backgroundColor: canSubmit ? TEAL : "#9AA6A4", opacity: saving ? 0.8 : 1 }}>
            {saving ? "Submitting…" : "Submit report"}
          </button>
        </div>
      </div>
    </div>
  );
}
