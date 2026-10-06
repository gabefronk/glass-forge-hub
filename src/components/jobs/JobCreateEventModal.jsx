import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { base44 } from "@/api/base44Client";
import { CREW_CALENDAR_LABEL, newRequestId, buildCreatePayload, freezeRequest, loadFrozenRequest, clearFrozenRequest } from "@/lib/jobCalendarShared";

const store = typeof window !== "undefined" ? window.sessionStorage : null;

// Owner-gated create-visit modal. Title + jobsite are locked to the job; no pricing
// fields. Final Review -> explicit Create. The request_id + payload are frozen in
// tab-session scoped to user+job so an unknown outcome locks before navigation and
// a retry only re-sends the same request_id + payload (never a new id).
export default function JobCreateEventModal({ job, user, open, onOpenChange }) {
  const [form, setForm] = useState({ all_day: true, start_date: "", end_date: "", start_time: "", end_time: "", notes: "" });
  const [requestId, setRequestId] = useState("");
  const [step, setStep] = useState("form"); // form | review | locked | done
  const [review, setReview] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open || !job || !user) return;
    const frozen = store ? loadFrozenRequest(store, user, job) : null;
    if (frozen && frozen.status === "creating") {
      setRequestId(frozen.request_id); setForm(frozen.form); setStep("locked");
      setError("A previous create is locked (unknown outcome). Retry sends the same request only.");
      return;
    }
    setRequestId(newRequestId());
    setForm({ all_day: true, start_date: "", end_date: "", start_time: "", end_time: "", notes: "" });
    setStep("form"); setError(""); setReview(null);
  }, [open, job?.id, user?.id]);

  const set = (k) => (e) => setForm((s) => ({ ...s, [k]: e.target.value }));

  const canReview = useMemo(() => {
    if (!form.start_date) return false;
    if (!form.all_day && !form.start_time) return false;
    return true;
  }, [form]);

  const goReview = () => {
    setError("");
    if (!canReview) { setError("Add a date" + (form.all_day ? "" : " and a start time") + "."); return; }
    setStep("review");
  };

  const submit = async () => {
    setSubmitting(true); setError("");
    const payload = buildCreatePayload({ user, job, form, requestId });
    if (store) freezeRequest(store, user, job, { status: "creating", request_id: requestId, form });
    try {
      const res = await base44.functions.invoke("jobCalendar", { action: "create", payload });
      const d = res?.data || {};
      if (d.disabled) { setReview(d.reviewed || payload); setStep("done"); }
      else if (d.error) setError(d.error);
      else { setReview(d.reviewed || payload); setStep("done"); }
    } catch (e) {
      setError(String(e?.message || e || "Create failed.").slice(0, 200));
    } finally {
      setSubmitting(false);
      if (store && job && user) clearFrozenRequest(store, user, job);
    }
  };

  const close = () => { if (store && job && user) clearFrozenRequest(store, user, job); onOpenChange(false); };

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
                  <Label className="text-xs">End date (optional, multi-day)</Label>
                  <Input type="date" value={form.end_date} onChange={set("end_date")} />
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
                  </div>
                </>
              )}
            </div>
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
            <Button onClick={submit} disabled={submitting}>{submitting ? "Retrying…" : "Retry same request"}</Button>
          </div>
        )}
        {step === "done" && (
          <div className="space-y-2">
            <p className="text-[13px] font-semibold" style={{ color: "#082f2c" }}>Review confirmed. Create is staged off — no Google event was created.</p>
            {review ? <ReviewView job={job} form={form} requestId={requestId} readonly /> : null}
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
    ["Jobsite", job?.address || "—"],
    ["All day", form.all_day ? "Yes" : "No"],
    ["Date", form.start_date],
    ...(form.all_day ? [["End date", form.end_date || "—"]] : [["Start time", form.start_time || "—"], ["End time", form.end_time || "—"]]),
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