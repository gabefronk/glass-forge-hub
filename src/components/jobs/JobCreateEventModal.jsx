import { useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ExternalLink, Calendar } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { CREW_CALENDAR_OPTIONS, crewCalendarLabel, newRequestId, isJobCalendarOwner, safeError } from "@/lib/jobCalendarShared";
import { buildReviewedPayload, validateReviewed, reviewErrorMessage, addDays } from "@/lib/jobCalendarValidate";
import { createVisitController } from "@/lib/jobCalendarCreateController";
import { upcomingWorkDays, bookedCounts, applyVisitPick, visitSummary, TIME_PRESETS } from "@/lib/visitPlanner";
import { useJobContacts } from "@/hooks/use-job-contacts";
import { sanitizeText } from "@/lib/jobsSanitize";
import { titleCase } from "@/lib/displayName";
import { denverDate } from "../../../base44/shared/billingCore.js";
import JobCreateEventReview from "@/components/jobs/JobCreateEventReview";

const EMPTY = { all_day: true, start_date: "", end_date: "", start_time: "", end_time: "", notes: "", confirm_no_jobsite: false, calendars: ["israel"], contact: "" };
const CONTACT_ORDER = ["site", "superintendent", "project_manager", "homeowner", "customer"];
const pickContact = (linked) => { for (const r of CONTACT_ORDER) { const c = (linked || []).find((x) => x.role === r && x.phone); if (c) return `${c.name ? c.name + " " : ""}${c.phone}`.trim(); } return ""; };
const getStore = () => { try { return window.sessionStorage; } catch { return null; } };
const MUTED = { color: "#566063" };

// Hub palette, as on the approved Jobs concepts canvas (Oct 24).
const INK = "#101617", MUT = "#34403F", DARK = "#0F2628", TEAL = "#0B3F3B", EDGE = "#B3A792", FIELD = "#9A9080", LINE = "#D6CCBA";
const LABEL = "mb-1.5 block text-[12px] font-semibold uppercase tracking-[.06em]";
const FIELD_CLASS = "min-h-[48px] w-full rounded-[12px] px-3 text-[15px] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#0B3F3B]";
const fieldStyle = { border: `1px solid ${FIELD}`, backgroundColor: "#fff", color: INK };
const dayParts = (d) => { const [y, m, dd] = d.split("-").map(Number); const dt = new Date(y, m - 1, dd); return { dow: dt.toLocaleDateString("en-US", { weekday: "short" }), n: dd }; };

// Owner-gated create-visit modal. Title + jobsite come from the job and are frozen
// into the reviewed payload; the review, locked and done views render that frozen
// payload. Lifecycle (freeze before call, byte-equal retries, double-submit guard,
// release rules) lives in createVisitController.
export default function JobCreateEventModal({ job, user, open, onOpenChange, onCreated, prefill = null }) {
  const ctrl = useRef(null);
  if (!ctrl.current) ctrl.current = createVisitController({ store: getStore(), invoke: (name, body) => base44.functions.invoke(name, body) });
  const keyRef = useRef("");
  keyRef.current = `${user?.id || ""}:${job?.id || ""}`;

  const [form, setForm] = useState(EMPTY);
  const [timeKey, setTimeKey] = useState("all_day");
  const [dayCount, setDayCount] = useState(1);
  const [otherDate, setOtherDate] = useState(false);
  const [requestId, setRequestId] = useState("");
  const [reviewed, setReviewed] = useState(null);
  const [step, setStep] = useState("form"); // form | review | locked | damaged | done
  const [result, setResult] = useState({ kind: "", link: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const owner = isJobCalendarOwner(user);
  const jc = useJobContacts(open && owner ? job?.id : null);
  const defaultContact = pickContact(jc.view?.job?.id === job?.id ? jc.view?.linked : []);
  const touchedContact = useRef(false);
  useEffect(() => { touchedContact.current = false; }, [open, job?.id]);
  useEffect(() => { if (step === "form" && defaultContact && !touchedContact.current) setForm((s) => (s.contact ? s : { ...s, contact: defaultContact })); }, [defaultContact, step, open, form.contact]);
  const noJobsite = !job?.address;

  // The day strip: the next working days, with how many visits each crew calendar
  // already has. Counts are a guide only; a failed load just hides them.
  const today = denverDate();
  const days = useMemo(() => upcomingWorkDays(today, 6), [today]);
  const [booked, setBooked] = useState(null);
  useEffect(() => {
    if (!open || !owner) return undefined;
    let live = true;
    setBooked(null);
    base44.entities.CalendarEvents.filter({ event_date: { $gte: addDays(days[0], -31), $lte: days[days.length - 1] } }, "event_date", 2000)
      .then((rows) => { if (live) setBooked(bookedCounts(rows, days, CREW_CALENDAR_OPTIONS)); })
      .catch(() => { if (live) setBooked(null); });
    return () => { live = false; };
  }, [open, owner, days]);

  useEffect(() => {
    if (!open || !job || !user || !owner) return;
    setBusy(false); setError(""); setResult({ kind: "", link: "" });
    const cur = ctrl.current.load(user.id, job.id);
    if (cur.state === "locked") { setReviewed(cur.record.payload); setStep("locked"); setError(safeError("prior_unknown")); return; }
    if (cur.state === "damaged") { setReviewed(null); setStep("damaged"); setError(safeError("damaged")); return; }
    setReviewed(null); setForm({ ...EMPTY, ...(prefill?.notes ? { notes: prefill.notes } : {}) }); setTimeKey("all_day"); setDayCount(1); setOtherDate(false); setRequestId(newRequestId()); setStep("form");
  }, [open, job?.id, user?.id, owner, prefill?.notes]);

  const set = (k) => (e) => setForm((s) => ({ ...s, [k]: e.target.value }));
  const pickDay = (day) => { setOtherDate(false); setForm((s) => applyVisitPick(s, { day, days: dayCount, time: timeKey })); };
  const pickDayCount = (n) => { setDayCount(n); setForm((s) => applyVisitPick(s, { days: n, time: timeKey })); };
  const pickTime = (key) => { setTimeKey(key); setForm((s) => applyVisitPick(s, { days: dayCount, time: key })); };

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

  const crewNames = CREW_CALENDAR_OPTIONS.filter((o) => form.calendars.includes(o.key)).map((o) => o.short);
  const summary = visitSummary(form, crewNames);
  const showOther = otherDate || (form.start_date && !days.includes(form.start_date));
  const pickedCounts = form.start_date && booked ? booked[form.start_date] : null;
  const anyCounts = booked && days.some((d) => Object.values(booked[d] || {}).some((n) => n !== null));

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="flex max-h-[94dvh] w-[calc(100vw-16px)] max-w-[600px] flex-col gap-0 overflow-hidden overflow-y-hidden rounded-[16px] p-0 sm:p-0" style={{ backgroundColor: "#F6F2EA" }}>
        <DialogHeader className="space-y-0.5 pl-5 pr-14 pb-3 pt-4" style={{ backgroundColor: "#fff", borderBottom: `1px solid ${LINE}` }}>
          <DialogTitle className="text-[19px] font-bold" style={{ color: INK, letterSpacing: "-0.02em" }}>Add visit{prefill?.stageLabel ? ` · ${prefill.stageLabel}` : ""}</DialogTitle>
          <p className="m-0 text-[13.5px] break-words" style={{ color: MUT }}>{titleCase(sanitizeText(reviewed?.title || job?.canonical_name || ""))}{job?.address ? ` · ${sanitizeText(job.address)}` : ""}</p>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4">
          {step === "form" && (
            <div className="space-y-5">
              <div>
                <div className="flex items-baseline justify-between gap-2">
                  <span className={LABEL} style={{ color: MUT }}>Day</span>
                  {anyCounts ? <span className="text-[12.5px]" style={{ color: MUT }}>visits already on Israel&apos;s calendar</span> : null}
                </div>
                <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1" role="group" aria-label="Day">
                  {days.map((d) => {
                    const on = form.start_date === d && !otherDate;
                    const n = booked?.[d]?.israel;
                    const { dow, n: dn } = dayParts(d);
                    return (
                      <button key={d} type="button" aria-pressed={on} onClick={() => pickDay(d)}
                        className="flex min-h-[80px] w-[74px] shrink-0 flex-col items-center justify-center gap-0.5 rounded-[12px] text-center"
                        style={on ? { backgroundColor: DARK, border: `1px solid ${DARK}`, color: "#fff" } : { backgroundColor: "#fff", border: `1px solid ${EDGE}`, color: INK }}>
                        <span className="text-[12px] font-semibold uppercase tracking-[.05em]" style={{ color: on ? "#E0C994" : MUT }}>{dow}</span>
                        <span className="font-mono-num text-[20px] font-bold leading-none">{dn}</span>
                        {n !== null && n !== undefined ? <span className="text-[11.5px]" style={{ color: on ? "#D5DADB" : "#566063" }}>{n} booked</span> : null}
                      </button>
                    );
                  })}
                  <button type="button" aria-pressed={showOther} onClick={() => setOtherDate(true)}
                    className="flex min-h-[80px] w-[74px] shrink-0 flex-col items-center justify-center gap-1 rounded-[12px]"
                    style={showOther ? { backgroundColor: DARK, border: `1px solid ${DARK}`, color: "#fff" } : { backgroundColor: "#fff", border: `1px solid ${EDGE}`, color: TEAL }}>
                    <Calendar className="h-5 w-5" /><span className="text-[12px] font-semibold">Other</span>
                  </button>
                </div>
                {showOther ? (
                  <label className="mt-2.5 block">
                    <span className="sr-only">Visit date</span>
                    <input type="date" value={form.start_date} onChange={(e) => setForm((s) => applyVisitPick(s, { day: e.target.value, days: dayCount, time: timeKey }))} className={FIELD_CLASS} style={fieldStyle} />
                  </label>
                ) : null}
              </div>

              <div className="grid grid-cols-2 gap-2.5">
                <label className="block">
                  <span className={LABEL} style={{ color: MUT }}>Time</span>
                  <select value={timeKey} onChange={(e) => pickTime(e.target.value)} className={FIELD_CLASS} style={fieldStyle}>
                    {TIME_PRESETS.map((t) => <option key={t.key} value={t.key}>{t.label}</option>)}
                  </select>
                </label>
                <label className="block">
                  <span className={LABEL} style={{ color: MUT }}>Days</span>
                  <select value={dayCount} onChange={(e) => pickDayCount(Number(e.target.value))} className={FIELD_CLASS} style={fieldStyle}>
                    {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n === 1 ? "1 day" : `${n} days`}</option>)}
                  </select>
                </label>
                {timeKey === "custom" ? (
                  <>
                    <label className="block"><span className={LABEL} style={{ color: MUT }}>Start time</span><input type="time" value={form.start_time} onChange={set("start_time")} className={FIELD_CLASS} style={fieldStyle} /></label>
                    <label className="block"><span className={LABEL} style={{ color: MUT }}>End time</span><input type="time" value={form.end_time} onChange={set("end_time")} className={FIELD_CLASS} style={fieldStyle} /></label>
                  </>
                ) : null}
              </div>

              <fieldset>
                <legend className={LABEL} style={{ color: MUT }}>Crew calendar</legend>
                <div className="grid grid-cols-2 gap-2">
                  {CREW_CALENDAR_OPTIONS.map((o) => {
                    const on = form.calendars.includes(o.key);
                    const n = pickedCounts?.[o.key];
                    return (
                      <button key={o.key} type="button" role="checkbox" aria-checked={on}
                        onClick={() => setForm((s) => {
                          const has = s.calendars.includes(o.key);
                          if (has && s.calendars.length === 1) return s; // keep at least one calendar selected
                          return { ...s, calendars: has ? s.calendars.filter((k) => k !== o.key) : [...s.calendars, o.key] };
                        })}
                        className="flex min-h-[56px] items-center gap-2.5 rounded-[12px] px-3 text-left"
                        style={on ? { backgroundColor: "#EAF2EF", border: `2px solid ${TEAL}` } : { backgroundColor: "#fff", border: `1px solid ${EDGE}` }}>
                        <span className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[6px] text-[13px] font-bold text-white" style={on ? { backgroundColor: TEAL } : { border: `2px solid ${FIELD}` }} aria-hidden="true">{on ? "✓" : ""}</span>
                        <span className="min-w-0">
                          <span className="block text-[14.5px] font-semibold" style={{ color: INK }}>{o.short}</span>
                          <span className="block truncate text-[12px]" style={{ color: MUT }}>{n !== null && n !== undefined ? `${n} booked` : o.email}</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              {noJobsite ? (
                <label className="flex items-start gap-2 rounded-[12px] px-3 py-2.5 text-[13px]" style={{ backgroundColor: "#FAF0DA", border: "1px solid #8A5A12", color: "#5C3D0C" }}>
                  <input type="checkbox" className="mt-0.5" checked={form.confirm_no_jobsite} onChange={(e) => setForm((s) => ({ ...s, confirm_no_jobsite: e.target.checked }))} />
                  <span>This job has no jobsite address. I&apos;ve confirmed that&apos;s correct for this visit.</span>
                </label>
              ) : null}

              <label className="block">
                <span className={LABEL} style={{ color: MUT }}>Site contact</span>
                <input value={form.contact} onChange={(e) => { touchedContact.current = true; set("contact")(e); }} placeholder="Name and number" className={FIELD_CLASS} style={fieldStyle} />
                <span className="mt-1.5 block text-[12.5px]" style={{ color: MUT }}>Shown on the calendar event. Filled in from the job&apos;s contacts.</span>
              </label>

              <label className="block">
                <span className={LABEL} style={{ color: MUT }}>Notes for the crew</span>
                <textarea rows={3} value={form.notes} onChange={set("notes")} placeholder="Finish up install trim items…" className="w-full resize-y rounded-[12px] p-3 text-[15px] focus:outline-none" style={fieldStyle} />
                <span className="mt-1.5 block text-[12.5px]" style={{ color: MUT }}>The crew sees these notes. No pricing is sent.</span>
              </label>
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
                  : result.kind === "created" ? `Visit created on ${crewCalendarLabel(reviewed?.calendar).split(" (")[0]}.`
                  : result.kind === "existing" ? `This visit was already on ${crewCalendarLabel(reviewed?.calendar).split(" (")[0]}.`
                  : "This request's visit was deleted from the crew calendar. Nothing was recreated."}
              </p>
              {result.link ? <a href={result.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[12px] font-semibold hover:underline" style={{ color: "#0b3f3b" }}>Open in Google Calendar<ExternalLink className="h-3 w-3" /></a> : null}
              <JobCreateEventReview payload={reviewed} />
            </div>
          )}
          {error ? <p role="alert" className="mt-3 text-[13px]" style={{ color: "#a43432" }}>{error}</p> : null}
        </div>

        <div className="space-y-2 px-5 pt-3 pb-[calc(12px+env(safe-area-inset-bottom))]" style={{ backgroundColor: "#fff", borderTop: `1px solid ${EDGE}` }}>
          {step === "form" && summary ? <p className="m-0 text-center text-[13.5px] font-semibold" style={{ color: MUT }}>{summary}</p> : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" className="min-h-[44px]" onClick={close}>Close</Button>
            {step === "form" && <Button className="min-h-[44px] flex-1 sm:flex-none" style={{ backgroundColor: TEAL }} onClick={goReview}>Review visit</Button>}
            {step === "review" && <Button variant="ghost" className="min-h-[44px]" disabled={busy} onClick={() => setStep("form")}>Back to edit</Button>}
            {step === "review" && <Button className="min-h-[44px]" style={{ backgroundColor: TEAL }} onClick={send} disabled={busy}>{busy ? "Creating…" : "Add to calendar"}</Button>}
            {step === "locked" && <Button className="min-h-[44px]" onClick={send} disabled={busy}>{busy ? "Retrying…" : "Retry same request"}</Button>}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
