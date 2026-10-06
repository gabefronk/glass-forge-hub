import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { ExternalLink } from "lucide-react";
import { base44 } from "@/api/base44Client";
import {
  CREW_CALENDAR_LABEL, newRequestId, buildCreatePayload,
  freezeRequest, loadFrozenRequest, clearFrozenRequest,
  isJobCalendarOwner, decideCreateOutcome, reviewFormError,
} from "@/lib/jobCalendarShared";

const store = typeof window !== "undefined" ? window.sessionStorage : null;

// Owner-gated create-visit modal. Title + jobsite are locked to the job; no pricing
// fields. Final Review -> explicit Create. The request_id + payload are frozen in
// tab-session scoped to user+job so an unknown outcome locks before navigation and
// a retry only re-sends the same request_id + payload (never a new id). The frozen
// state persists across close, job switch, reopen and reload; it is released only
// on proven noncreation (staged off, validation rejection) or a reconciled outcome
// (created / existing_match). Raw provider/exception strings never reach the UI.
export default function JobCreateEventModal({ job, user, open, onOpenChange, onCreated }) {
  const [form, setForm] = useState({ all_day: true, start_date: "", end_date: "", start_time: "", end_time: "", notes: "", confirm_no_jobsite: false });
  const [requestId, setRequestId] = useState("");
  const [step, setStep] = useState("form"); // form | review | locked | done
  const [resultKind, setResultKind] = useState(""); // staged | created | existing
  const [resultLink, setResultLink] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  // Owner guard inside the modal too — never trust the parent alone.
  const owner = isJobCalendarOwner(user);
  const noJobsite = !job?.address;

  useEffect(() => {
    if (!open || !job || !user) return;
    // Persist an unknown/creating request across close, job switch, reopen, reload.
    const frozen = store ? loadFrozenRequest(store, user, job) : null;
    if (frozen && frozen.status === "creating") {
      setRequestId(frozen.request_id);
      setForm(frozen.form);
      setStep("locked");
      setError("A previous create is locked (unknown outcome). Retry sends the same request only.");
      return;
    }
    setRequestId(newRequestId());
    setForm({ all_day: true, start_date: "", end_date: "", start_time: "", end_time: "", notes: "", confirm_no_jobsite: false });
    setStep("form"); setError(""); setResultKind(""); setResultLink("");
  }, [open, job?.id, user?.id]);

  const set = (k) => (e) => setForm((s) => ({ ...s, [k]: e.target.value }));

  const canReview = useMemo(() => {
    if (!form.start_date) return false;
    if (!form.all_day && !form.start_time) return false;
    if (noJobsite && !form.confirm_no_jobsite) return false;
    return true;
  }, [form, noJobsite]);

  const goReview = () => {
    const err = reviewFormError(form);
    if (err) { setError(err); return; }
    if (noJobsite && !form.confirm_no_jobsite) { setError("Confirm there is no jobsite address, or add one to this job."); return; }
    setError(""); setStep("review");
  };

  const submit = async () => {
    setSubmitting(true); setError("");
    const payload = buildCreatePayload({ user, job, form, requestId });
    // Freeze BEFORE the call so an unknown outcome locks before navigation.
    if (store) freezeRequest(store, user, job, { status: "creating", request_id: requestId, form });
    let d = null;
    try {
      const res = await base44.functions.invoke("jobCalendar", { action: "create", payload });
      d = res?.data || null;
    } catch {
      d = null; // network failure → unknown
    }
    const out = decideCreateOutcome(d);
    if (out.release && store) clearFrozenRequest(store, user, job);
    if (out.step === "done") {
      setResultKind(out.kind); setResultLink(out.link || ""); setStep("done");
      if (out.kind === "created" || out.kind === "existing") onCreated?.();
    } else if (out.step === "locked") {
      setStep("locked"); setError(out.error);
    } else {
      setStep("form"); setError(out.error);
    }
    setSubmitting(false);
  };

  // Close never clears a creating lock — it persists so a reopen resumes the retry.
  const close = () => onOpenChange(false);

  if (!owner) {
    return (
      <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
        <DialogContent className="max-w-[420px]">
          <DialogHeader><DialogTitle>Owner access required</DialogTitle></DialogHeader>
          <p className="text-[13px]" style={{ color: "#566063" }}>Adding visits to the crew calendar is restricted to the owner.</p>
          <DialogFooter><Button variant="ghost" onClick={close}>Close</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="max-w-[560px]">
        <DialogHeader>
          <DialogTitle>Add a visit — {job?.canonical_name}</DialogTitle>
        </DialogHeader>
        {step === "form" && (
          <div className="space-y-3">
            <div className="rounded-[9px] px-3 py-2 text-[12px]" style={{ backgroundColor: "#eef5f3", border: "1px solid #c7e4d2", color: "#082f2c" }}>
              Crew calendar: <b>{CREW_CALENDAR_LABEL}</b>. Title and jobsite are locked to this job. No pricing.
            </div>
            <label className="flex items-center gap-2 text-[13px] font-medium">
              <input type="checkbox" checked={form.all_day} onChange={(e) => setForm((s) => ({ ...s, all_day: e.target.checked }))} /> All day
            </label>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Date</Label>
                <Input type="date" value={form.start_date} onChange={set("start_date")} />
              </div>
              {form.all_day ? (
                <div>
                  <Label className="text-xs">End date — last day (inclusive)</Label>
                  <Input type="date" value={form.end_date} onChange={set("end_date")} />
                  <p className="mt-1 text-[11px]" style={{ color: "#566063" }}>Leave blank for a single day. The calendar end is exclusive.</p>
                </div>
              ) : (
                <>
                  <div>
                    <Label className="text-xs">Start time</Label>
                    <Input type="time" value={form.start_time} onChange={set("start_time")} />
                  </div>
                  <div>
                    <Label className="text-xs">End time (optional)</Label>
                    <Input type="time" value={form.end_time} onChange={set("end_time")} />
                    <p className="mt-1 text-[11px]" style={{ color: "#566063" }}>Blank = +1 hour. End at or before start = overnight.</p>
                  </div>
                </>
              )}
            </div>
            {noJobsite ? (
              <label className="flex items-start gap-2 rounded-[9px] px-3 py-2 text-[12.5px]" style={{ backgroundColor: "#fff3df", border: "1px solid #f0dba8", color: "#6f4e10" }}>
                <input type="checkbox" className="mt-0.5" checked={form.confirm_no_jobsite} onChange={(e) => setForm((s) => ({ ...s, confirm_no_jobsite: e.target.checked }))} />
                <span>This job has no jobsite address. I've confirmed that's correct before creating the visit.</span>
              </label>
            ) : null}
            <div>
              <Label className="text-xs">Notes (crew-safe, no pricing)</Label>
              <Textarea rows={3} value={form.notes} onChange={set("notes")} placeholder="Finish up install trim items…" />
            </div>
            <div className="text-[12px]" style={{ color: "#566063" }}>Timezone: America/Denver. Jobsite: {job?.address || "—"}</div>
            {error ? <p role="alert" className="text-[12.5px]" style={{ color: "#a43432" }}>{error}</p> : null}
          </div>
        )}
        {step === "review" && <ReviewView job={job} form={form} requestId={requestId} onBack={() => setStep("form")} />}
        {step === "locked" && (
          <div className="space-y-2">
            <p className="text-[13px]" style={{ color: "#a43432" }}>{error}</p>
            <p className="text-[12px]" style={{ color: "#566063" }}>Request id: <span className="font-ref">{requestId}</span></p>
            <Button onClick={submit} disabled={submitting}>{submitting ? "Retrying…" : "Retry same request"}</Button>
          </div>
        )}
        {step === "done" && (
          <div className="space-y-2">
            {resultKind === "staged" ? (
              <p className="text-[13px] font-semibold" style={{ color: "#082f2c" }}>Review confirmed. Create is staged off — no Google event was created.</p>
            ) : resultKind === "created" ? (
              <>
                <p className="text-[13px] font-semibold" style={{ color: "#082f2c" }}>Visit created on the crew calendar.</p>
                {resultLink ? <a href={resultLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] font-semibold hover:underline" style={{ color: "#0b3f3b" }}>Open in Google Calendar<ExternalLink className="h-3 w-3" /></a> : null}
              </>
            ) : resultKind === "existing" ? (
              <>
                <p className="text-[13px] font-semibold" style={{ color: "#082f2c" }}>This visit already exists on the crew calendar.</p>
                {resultLink ? <a href={resultLink} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] font-semibold hover:underline" style={{ color: "#0b3f3b" }}>Open in Google Calendar<ExternalLink className="h-3 w-3" /></a> : null}
              </>
            ) : null}
            <ReviewView job={job} form={form} requestId={requestId} readonly />
          </div>
        )}
        <DialogFooter>
          {step === "form" && <Button onClick={goReview} disabled={!canReview}>Review</Button>}
          {step === "review" && <Button onClick={submit} disabled={submitting}>{submitting ? "Creating…" : "Create"}</Button>}
          <Button variant="ghost" onClick={close}>Close</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ReviewView({ job, form, requestId, onBack, readonly }) {
  const rows = [
    ["Title", job?.canonical_name],
    ["Jobsite", job?.address || (form.confirm_no_jobsite ? "— (confirmed none)" : "—")],
    ["All day", form.all_day ? "Yes" : "No"],
    ["Date", form.start_date],
    ...(form.all_day
      ? [["End date (last day, inclusive)", form.end_date || "—"]]
      : [["Start time", form.start_time || "—"], ["End time", form.end_time || "— (+1 hour)"]]),
    ["Timezone", "America/Denver"],
    ["Notes", form.notes || "—"],
    ["Request id", requestId],
  ];
  return (
    <div className="space-y-2">
      <p className="text-[12.5px] font-semibold" style={{ color: "#082f2c" }}>Final review — confirm before creating on the crew calendar.</p>
      <dl className="grid grid-cols-1 gap-2">
        {rows.map(([k, v]) => (
          <div key={k} className="rounded-[8px] px-3 py-1.5" style={{ border: "1px solid #e2dcd1", backgroundColor: "#faf8f3" }}>
            <dt className="text-[10.5px] font-semibold uppercase tracking-[.1em]" style={{ color: "#566063" }}>{k}</dt>
            <dd className="m-0 text-[13px] break-words" style={{ color: "#182422" }}>{v}</dd>
          </div>
        ))}
      </dl>
      {!readonly && onBack ? <Button variant="ghost" onClick={onBack}>Back to edit</Button> : null}
    </div>
  );
}