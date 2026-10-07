import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ExternalLink } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { CREW_CALENDAR_LABEL, newRequestId, isJobCalendarOwner, safeError } from "@/lib/jobCalendarShared";
import { buildReviewedPayload, validateReviewed, reviewErrorMessage } from "@/lib/jobCalendarValidate";
import { createVisitController } from "@/lib/jobCalendarCreateController";
import JobCreateEventReview from "@/components/jobs/JobCreateEventReview";

const EMPTY = { all_day: true, start_date: "", end_date: "", start_time: "", end_time: "", notes: "", confirm_no_jobsite: false };
const getStore = () => { try { return window.sessionStorage; } catch { return null; } };
const MUTED = { color: "#566063" };

// Owner-gated create-visit modal. Title + jobsite come from the job and are frozen
// into the reviewed payload; the review, locked and done views render that frozen
// payload. Lifecycle (freeze before call, byte-equal retries, double-submit guard,
// release rules) lives in createVisitController.
export default function JobCreateEventModal({ job, user, open, onOpenChange, onCreated }) {
  const ctrl = useRef(null);
  if (!ctrl.current) ctrl.current = createVisitController({ store: getStore(), invoke: (name, body) => base44.functions.invoke(name, body) });
  const keyRef = useRef("");
  keyRef.current = `${user?.id || ""}:${job?.id || ""}`;

  const [form, setForm] = useState(EMPTY);
  const [requestId, setRequestId] = useState("");
  const [reviewed, setReviewed] = useState(null);
  const [step, setStep] = useState("form"); // form | review | locked | damaged | done
  const [result, setResult] = useState({ kind: "", link: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const owner = isJobCalendarOwner(user);
  const noJobsite = !job?.address;

  useEffect(() => {
    if (!open || !job || !user || !owner) return;
    setBusy(false); setError(""); setResult({ kind: "", link: "" });
    const cur = ctrl.current.load(user.id, job.id);
    if (cur.state === "locked") { setReviewed(cur.record.payload); setStep("locked"); setError(safeError("prior_unknown")); return; }
    if (cur.state === "damaged") { setReviewed(null); setStep("damaged"); setError(safeError("damaged")); return; }
    setReviewed(null); setForm(EMPTY); setRequestId(newRequestId()); setStep("form");
  }, [open, job?.id, user?.id, owner]);

  const set = (k) => (e) => setForm((s) => ({ ...s, [k]: e.target.value }));

  const goReview = () => {
    if (noJobsite && !form.confirm_no_jobsite) { setError("Confirm there is no jobsite address, or add one to this job."); return; }
    const p = Object.freeze(buildReviewedPayload({ user, job, form, requestId }));
    const v = validateReviewed(p, { ownerId: user.id });
    if (!v.ok) { setError(reviewErrorMessage(v.errors)); return; }
    setError(""); setReviewed(p); setStep("review");
  };

  const send = async () => {
    const k = keyRef.current;
    const pending = step === "locked" ? ctrl.current.retry(user.id, job.id) : ctrl.current.submit(user.id, job.id, reviewed);
    setBusy(true); setError("");
    const r = await pending;
    if (r.ignored || keyRef.current !== k) return; // another job/user is on screen now
    setBusy(false);
    if (!r.sent) { if (r.step === "damaged") setStep("damaged"); setError(r.error); return; }
    if (r.step === "done") {
      setReviewed(r.payload); setResult({ kind: r.kind, link: r.link || "" }); setStep("done");
      if (r.kind === "created" || r.kind === "existing") onCreated?.();
    } else if (r.step === "locked") { setReviewed(r.payload); setStep("locked"); setError(r.error); }
    else { setStep("form"); setError(r.error); }
  };

  const close = () => onOpenChange(false); // never clears a frozen request

  if (!owner) {
    return (
      <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
        <DialogContent className="max-w-[420px]">
          <DialogHeader><DialogTitle>Owner access required</DialogTitle></DialogHeader>
          <p className="text-[13px]" style={MUTED}>Adding visits to the crew calendar is restricted to the owner.</p>
          <DialogFooter><Button variant="ghost" onClick={close}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="max-h-[92vh] max-w-[600px] overflow-y-auto">
        <DialogHeader><DialogTitle>Add a visit — {reviewed?.title || job?.canonical_name}</DialogTitle></DialogHeader>
        {step === "form" && (
          <div className="space-y-3">
            <div className="rounded-[9px] px-3 py-2 text-[12px]" style={{ backgroundColor: "#eef5f3", border: "1px solid #c7e4d2", color: "#082f2c" }}>
              Crew calendar: <b>{CREW_CALENDAR_LABEL}</b>. Title and jobsite come from this job. No pricing.
            </div>
            <label className="flex items-center gap-2 text-[13px] font-medium">
              <input type="checkbox" checked={form.all_day} onChange={(e) => setForm((s) => ({ ...s, all_day: e.target.checked }))} /> All day
            </label>
            <div className="grid grid-cols-2 gap-3 max-[479px]:grid-cols-1">
              <div><Label className="text-xs">Start date</Label><Input type="date" value={form.start_date} onChange={set("start_date")} /></div>
              {!form.all_day && <div><Label className="text-xs">Start time</Label><Input type="time" value={form.start_time} onChange={set("start_time")} /></div>}
              <div>
                <Label className="text-xs">{form.all_day ? "Last day (inclusive)" : "End date"}</Label>
                <Input type="date" value={form.end_date} onChange={set("end_date")} />
              </div>
              {!form.all_day && <div><Label className="text-xs">End time</Label><Input type="time" value={form.end_time} onChange={set("end_time")} /></div>}
            </div>
            <p className="text-[11.5px]" style={MUTED}>{form.all_day ? "Blank last day = a single day. The exact calendar dates are shown at review." : "Blank end = one hour after start. The exact end date and time are shown at review."}</p>
            {noJobsite ? (
              <label className="flex items-start gap-2 rounded-[9px] px-3 py-2 text-[12.5px]" style={{ backgroundColor: "#fff3df", border: "1px solid #f0dba8", color: "#6f4e10" }}>
                <input type="checkbox" className="mt-0.5" checked={form.confirm_no_jobsite} onChange={(e) => setForm((s) => ({ ...s, confirm_no_jobsite: e.target.checked }))} />
                <span>This job has no jobsite address. I&apos;ve confirmed that&apos;s correct for this visit.</span>
              </label>
            ) : null}
            <div>
              <Label className="text-xs">Notes (crew-safe, no pricing)</Label>
              <Textarea rows={3} value={form.notes} onChange={set("notes")} placeholder="Finish up install trim items…" />
            </div>
            <div className="text-[12px]" style={MUTED}>Timezone: America/Denver. Jobsite: {job?.address || "—"}</div>
          </div>
        )}
        {step === "review" && <JobCreateEventReview payload={reviewed} heading="Final review — this exact visit is what gets sent." />}
        {step === "locked" && (
          <div className="space-y-3">
            <JobCreateEventReview payload={reviewed} heading="Locked request — only this exact visit can be retried." />
          </div>
        )}
        {step === "damaged" && (
          <div className="space-y-2 rounded-[9px] px-3 py-2.5" style={{ backgroundColor: "#fcedec", border: "1px solid #f0c9c5" }}>
            <p className="m-0 text-[12.5px] font-semibold" style={{ color: "#a43432" }}>Manual reconciliation required.</p>
            <p className="m-0 text-[12px]" style={MUTED}>A saved request for this job is unreadable, so an earlier attempt cannot be ruled out. Do not start a new request with a fresh id. Open the crew calendar, find any event whose description links to this job, and confirm whether it matches the visit you intended. Only an owner who has checked the calendar should clear this device&apos;s saved request.</p>
          </div>
        )}
        {step === "done" && (
          <div className="space-y-2">
            <p className="text-[13px] font-semibold" style={{ color: "#082f2c" }}>
              {result.kind === "staged" ? "Review confirmed. Creating is turned off in this version — no calendar event was created."
                : result.kind === "created" ? "Visit created on the crew calendar."
                : result.kind === "existing" ? "This visit was already on the crew calendar."
                : "This request's visit was deleted from the crew calendar. Nothing was recreated."}
            </p>
            {result.link ? <a href={result.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] font-semibold hover:underline" style={{ color: "#0b3f3b" }}>Open in Google Calendar<ExternalLink className="h-3 w-3" /></a> : null}
            <JobCreateEventReview payload={reviewed} />
          </div>
        )}
        {error ? <p role="alert" className="text-[12.5px]" style={{ color: "#a43432" }}>{error}</p> : null}
        <DialogFooter className="gap-2">
          {step === "form" && <Button onClick={goReview}>Review</Button>}
          {step === "review" && <Button variant="ghost" disabled={busy} onClick={() => setStep("form")}>Back to edit</Button>}
          {step === "review" && <Button onClick={send} disabled={busy}>{busy ? "Creating…" : "Create"}</Button>}
          {step === "locked" && <Button onClick={send} disabled={busy}>{busy ? "Retrying…" : "Retry same request"}</Button>}
          <Button variant="ghost" onClick={close}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}