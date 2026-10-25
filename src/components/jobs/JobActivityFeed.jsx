import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { C, formatShort, formatDateGroup, crewName } from "@/lib/feeUI";
import { sanitizeText } from "@/lib/jobsSanitize";
import ClampedText from "./ClampedText";
import { RefreshCw, Plus, Camera, StickyNote, Phone, MessageSquare, Mail, Users, Truck, TriangleAlert, HardHat, FileText, ExternalLink, ChevronDown } from "lucide-react";
import { scopeText, parseScopeNotes, scopeIsEmpty } from "@/lib/jobWorkspace";
import ScopeNotes from "./ScopeNotes";
import { eventKind } from "@/lib/calendarModel";
import { denverDate } from "../../../base44/shared/billingCore.js";
import { buildJobHistory, historyCounts, groupHistoryByDay, HISTORY_FILTERS, interactionLabel, isFieldReportNote, fileLabel, ticketsByEvent, visitTickets } from "@/lib/jobHistory";
import JobNoteEntry from "./JobNoteEntry";
import HistoryTextEdit from "./HistoryTextEdit";
import { canEditHistoryText } from "@/lib/ownerAccess";
import JobNoteForm from "./JobNoteForm";
import { DayCard, MonthRule, UpNextCard, VisitEntry, StageOnlyEntry, dayStamp } from "./VisitDayCard";
import { ServiceItemPanel, ServiceItemPointer, isServiceOpen, FOCUS_EVENT } from "./ServiceItems";

// Status pill for a visit, in plain words. Photos alone are a report: a visit with photos on
// it (Probuild post, or a Hub field report that day) reads "Report in" whatever the notes say.
// Visits before the compliance start date (pre_compliance) are never shown as owing one.
function visitBadge(ev, today = denverDate(), { reports = [], photoNote = false } = {}) {
  if (ev.event_date && ev.event_date > today) return { label: "Scheduled", color: "#34506a", bg: "#E7EDF2" };
  if (!ev.report_required || ev.report_required === false) return null;
  const hasEvidence = photoNote || reports.some((r) => (r.photos?.length || 0) > 0 || String(r.message || "").trim());
  if (ev.report_status === "ok" || ev.report_status_raw === "ok" || hasEvidence) return { label: "Report in", color: "#0b3f3b", bg: "#E2EEEB" };
  if (ev.report_status === "pre_compliance" || ev.report_status === "no_source_data") return null;
  if (ev.report_status === "waived") return { label: "No report needed", color: C.textMuted, bg: "#F0F1ED" };
  if (ev.report_status === "rescheduled") return { label: "Rescheduled", color: C.textMuted, bg: "#F0F1ED" };
  if (ev.days_late > 0) return { label: `Report ${ev.days_late}d late`, color: "#A43432", bg: "#FCEDEC" };
  return { label: "Report due", color: "#8a5a12", bg: "#FAF0DA" };
}

import PhotoStrip from "./PhotoStrip";
import { ThumbImage } from "./FeedImage";
import { preferredLang } from "@/lib/visitLang";

// One entry in the job history: icon, what happened, when/who, status, then details.
// Ledger: flat entries on a timeline (the job sheet), instead of bordered cards.
const LedgerContext = createContext(false);
const TONES = { teal: ["#e2eeeb", "#0b3f3b"], neutral: ["#f1eee7", "#34403f"], red: ["#fcedec", "#a43432"], blue: ["#e7edf2", "#34506a"] };

function Entry({ icon: Icon, tone = "neutral", title, meta, badge, actions, children }) {
  const ledger = useContext(LedgerContext);
  const [bg, ink] = TONES[tone] || TONES.neutral;
  if (ledger) {
    return (
      <article className="min-w-0">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <Icon className="h-4 w-4 shrink-0" style={{ color: ink }} />
          <h4 className="m-0 text-[15px] font-bold" style={{ color: C.text }}>{title}</h4>
          {meta ? <span className="text-[13px]" style={{ color: "#616a6d" }}>{meta}</span> : null}
          {badge ? <span className="rounded-[7px] px-2 py-0.5 text-[12px] font-semibold whitespace-nowrap" style={{ backgroundColor: badge.bg, color: badge.color }}>{badge.label}</span> : null}
          {actions ? <span className="ml-auto flex items-center gap-1">{actions}</span> : null}
        </div>
        <div className="mt-1 border-l-2 pl-3.5" style={{ borderColor: "#eee9e0" }}>{children}</div>
      </article>
    );
  }
  return (
    <article className="flex gap-3 rounded-[14px] p-4" style={{ border: `1px solid ${C.border}`, backgroundColor: C.card }}>
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full" style={{ backgroundColor: bg, color: ink }}><Icon className="h-4 w-4" /></span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <h4 className="m-0 text-[14.5px] font-bold" style={{ color: C.text }}>{title}</h4>
          {meta ? <span className="text-[13px]" style={{ color: C.textMuted }}>{meta}</span> : null}
          {badge ? <span className="rounded-full px-2 py-0.5 text-[11.5px] font-semibold whitespace-nowrap" style={{ backgroundColor: badge.bg, color: badge.color }}>{badge.label}</span> : null}
          {actions ? <span className="ml-auto flex items-center gap-1">{actions}</span> : null}
        </div>
        {children}
      </div>
    </article>
  );
}

const joinMeta = (...parts) => parts.filter(Boolean).join(" · ");
const photoCount = (n) => (n ? `${n} ${n === 1 ? "photo" : "photos"}` : "");

function ReportBody({ report, onPhotoClick, canEditText, onChanged }) {
  return (
    <>
      {report.message ? (
        <ClampedText text={report.message} maxLines={4} className="mt-1.5 text-[14.5px] leading-[21px] whitespace-pre-wrap break-words" style={{ color: C.text }} />
      ) : <p className="m-0 mt-1.5 text-[13.5px]" style={{ color: C.textMuted }}>No notes, photos only.</p>}
      {report.edited_at ? <span className="text-[11.5px] italic" style={{ color: C.textMuted }}>{report.edited_by ? `edited by ${report.edited_by}` : "edited"}</span> : null}
      <PhotoStrip urls={report.photos} onPhotoClick={onPhotoClick} />
      <HistoryTextEdit type="report" recordId={report.id} jobId={report.job_id} text={report.message} canEdit={canEditText} onSaved={onChanged} />
    </>
  );
}

// Visit PO/OE only when it differs from the job's own (a reorder or follow-up ticket);
// the job's PO/OE are shown once in "The job".
function VisitRefs({ ev, dedupe }) {
  const refs = [
    ev.po_number && ev.po_number !== dedupe?.primaryPo ? `PO ${ev.po_number}` : "",
    ev.oe_number && ev.oe_number !== dedupe?.primaryOe ? `OE ${ev.oe_number}` : "",
  ].filter(Boolean);
  if (!refs.length) return null;
  return <div className="mt-2 flex flex-wrap gap-x-4 font-mono text-[12.5px]" style={{ color: C.textMuted }}>{refs.map((r) => <span key={r}>{r}</span>)}</div>;
}

function VisitCard({ ev, reports, onPhotoClick, dedupe, canEditText, onChanged }) {
  const [showNotes, setShowNotes] = useState(false);
  // On the job page the Scope card already shows this visit's notes; don't repeat them.
  const scopeShownAbove = !!dedupe && !!ev.id && ev.id === dedupe.workEventId;
  const kind = eventKind(ev) === "service" ? "Service visit" : eventKind(ev) === "outlook" ? "Visit" : "Install visit";
  const crew = crewName(ev.created_by);
  const time = ev.start_time ? `${ev.start_time}${ev.end_time ? `–${ev.end_time}` : ""}` : "All day";
  const photos = reports.reduce((n, r) => n + (r.photos?.length || 0), 0);
  const notes = scopeText(ev.scope_notes).replace(/\n{3,}/g, "\n\n").trim();
  const parsed = useMemo(() => parseScopeNotes(ev.scope_notes, { keepMoney: true, keepContacts: true, refs: !dedupe }), [ev.scope_notes, dedupe]);
  return (
    <Entry icon={HardHat} tone="teal" title={kind} meta={joinMeta(time, crew, photoCount(photos))} badge={visitBadge(ev, undefined, { reports })}>
      {scopeShownAbove && reports.length === 0 ? (
        <p className="m-0 mt-1 text-[13px]" style={{ color: C.textMuted }}>Scope and notes are in the Scope card above.</p>
      ) : null}
      {reports.length > 0 ? (
        <>
          {reports.map((r, i) => (
            <div key={r.post_id || i} className={i ? "mt-3 border-t pt-3" : ""} style={{ borderColor: C.rowBorder }}>
              <ReportBody report={r} onPhotoClick={onPhotoClick} canEditText={canEditText} onChanged={onChanged} />
            </div>
          ))}
          {notes && !scopeShownAbove ? (
            <div className="mt-2">
              <button type="button" onClick={() => setShowNotes((v) => !v)} className="text-[12.5px] font-semibold hover:underline" style={{ color: "#0b3f3b" }}>{showNotes ? "Hide calendar notes" : "Calendar notes"}</button>
              {showNotes ? <div className="mt-2"><ScopeNotes parsed={parsed} size="sm" /></div> : null}
            </div>
          ) : null}
        </>
      ) : notes && !scopeShownAbove && !scopeIsEmpty(parsed) ? (
        <div className="mt-2"><ScopeNotes parsed={parsed} size="sm" limit={2} /></div>
      ) : null}
      {dedupe ? <VisitRefs ev={ev} dedupe={dedupe} /> : null}
    </Entry>
  );
}

function ReportCard({ report, onPhotoClick, canEditText, onChanged }) {
  return (
    <Entry icon={Camera} tone="teal" title="Field report" meta={joinMeta(crewName(report.author), photoCount(report.photos?.length))}>
      <ReportBody report={report} onPhotoClick={onPhotoClick} canEditText={canEditText} onChanged={onChanged} />
    </Entry>
  );
}

function ChangeCard({ ev }) {
  return (
    <div className="flex items-center gap-2 rounded-[10px] px-3 py-2" style={{ border: `1px solid ${C.rowBorder}`, backgroundColor: "transparent" }}>
      <RefreshCw className="h-3 w-3 shrink-0" style={{ color: C.textMuted }} />
      <span className="text-[11.5px] break-words" style={{ color: C.textMuted }}>
        Visit moved: <span className="font-medium">{formatShort(ev.original_scheduled_date)}</span> → <span className="font-medium">{formatShort(ev.event_date)}</span>
      </span>
    </div>
  );
}

const NOTE_ICONS = { note: StickyNote, site_visit: HardHat, call: Phone, text: MessageSquare, email: Mail, meeting: Users, delivery: Truck, issue: TriangleAlert };

// All files saved to the job folder on one day, as one entry.
const IMAGE_EXT = /\.(jpe?g|png|gif|webp|bmp|avif)$/i;
const isImageFile = (f) => IMAGE_EXT.test(f.name || "") || IMAGE_EXT.test(f.url || "");

function ImageThumb({ f, photos, onPhotoClick }) {
  return (
    <button key={f.id} type="button" onClick={() => onPhotoClick?.(f.url, photos)} title={sanitizeText(f.name)} className="block cursor-pointer overflow-hidden rounded-md p-0" style={{ border: `1px solid ${C.rowBorder}` }}>
      <ThumbImage src={f.url} alt={sanitizeText(f.name)} className="h-24 w-full object-cover hover:opacity-90" />
    </button>
  );
}

function FileGroupCard({ files, onPhotoClick }) {
  const images = files.filter(isImageFile);
  const rest = files.filter((f) => !isImageFile(f));
  const photoUrls = images.map((f) => f.url);
  return (
    <div className="rounded-[10px] px-3 py-2" style={{ border: `1px solid ${C.rowBorder}` }}>
      <div className="flex items-center gap-2 text-[12px]" style={{ color: C.textMuted }}>
        <FileText className="h-3.5 w-3.5 shrink-0" />
        {files.length === 1 ? "Saved to job folder" : `${files.length} files saved to job folder`}
      </div>
      {images.length > 0 && (
        <div className="mt-1.5 grid grid-cols-3 gap-1.5 pl-5">
          {images.map((f) => (
            <ImageThumb key={f.id} f={f} photos={photoUrls} onPhotoClick={onPhotoClick} />
          ))}
        </div>
      )}
      <div className="mt-1 flex flex-col gap-0.5 pl-5">
        {rest.map((f) => (
          <a key={f.id} href={f.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[12.5px] break-words hover:underline" style={{ color: C.accentText }}>
            {fileLabel(sanitizeText(f.name), f.name)}<ExternalLink className="h-3 w-3 shrink-0" />
          </a>
        ))}
      </div>
    </div>
  );
}

function FileCard({ file, onPhotoClick }) {
  if (isImageFile(file)) {
    return (
      <button type="button" onClick={() => onPhotoClick?.(file.url, [file.url])} title={sanitizeText(file.name)} className="block cursor-pointer rounded-[10px] p-2 text-left" style={{ border: `1px solid ${C.rowBorder}` }}>
        <ThumbImage src={file.url} alt={sanitizeText(file.name)} className="h-36 w-auto max-w-full rounded-md object-cover hover:opacity-90" />
        <div className="mt-1 flex items-center gap-1.5 text-[12px] break-words" style={{ color: C.textMuted }}>
          Saved to job folder: {fileLabel(sanitizeText(file.name), file.name)}
        </div>
      </button>
    );
  }
  return (
    <a href={file.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-[10px] px-3 py-2 hover:underline" style={{ border: `1px solid ${C.rowBorder}`, color: C.accentText }}>
      <FileText className="h-3.5 w-3.5 shrink-0" style={{ color: C.textMuted }} />
      <span className="text-[12px] break-words min-w-0 flex-1"><span style={{ color: C.textMuted }}>Saved to job folder: </span>{fileLabel(sanitizeText(file.name), file.name)}</span>
      <ExternalLink className="h-3 w-3 shrink-0" />
    </a>
  );
}

// Collapse a day's "saved to job folder" entries into one.
function groupFiles(items) {
  const files = items.filter((it) => it.kind === "file").map((it) => it.file);
  if (files.length < 2) return items;
  const out = [];
  let placed = false;
  for (const it of items) {
    if (it.kind !== "file") out.push(it);
    else if (!placed) { out.push({ kind: "files", files }); placed = true; }
  }
  return out;
}

// What a note is called in the history. Notes logged from a customer text thread read as
// "Text", not "Note"; one with photos or a completion is a field report.
function noteKind(note) {
  const kind = note.interaction_type || "note";
  if (isFieldReportNote(note)) return { title: "Field report", icon: Camera, tone: "teal" };
  if (/^\s*instinct \((?:customer )?texts/i.test(note.body || "")) return { title: "Text", icon: MessageSquare, tone: "blue" };
  return { title: interactionLabel(kind), icon: NOTE_ICONS[kind] || StickyNote, tone: kind === "issue" ? "red" : kind === "call" || kind === "text" || kind === "email" ? "blue" : "neutral" };
}

// Notes, texts, calls and emails fold to one line so the visits and field reports stand out.
// A field report, or a note tied to a service item, stays open.
const isQuietNote = (note, services = [], pointers = []) => !isFieldReportNote(note) && !services.length && !pointers.length;
const notePreview = (note) => String(note.body || "").replace(/\s+/g, " ").trim();

function FoldedEntry({ icon: Icon, tone, title, meta, preview, children }) {
  const [open, setOpen] = useState(false);
  const ink = (TONES[tone] || TONES.neutral)[1];
  return (
    <article className="min-w-0">
      <button type="button" aria-expanded={open} onClick={() => setOpen((v) => !v)} className="-mx-1.5 flex w-[calc(100%+12px)] min-w-0 items-center gap-2 rounded-[8px] px-1.5 py-1 text-left hover:bg-black/[0.035]">
        <Icon className="h-4 w-4 shrink-0" style={{ color: ink }} />
        <span className="shrink-0 text-[14px] font-bold" style={{ color: C.text }}>{title}</span>
        {meta ? <span className="shrink-0 text-[12.5px]" style={{ color: "#616a6d" }}>{meta}</span> : null}
        <span className="min-w-0 flex-1 truncate text-[13.5px]" style={{ color: C.textMuted }}>{open ? "" : preview}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} style={{ color: C.textMuted }} />
      </button>
      {open ? <div className="mt-1 border-l-2 pl-3.5" style={{ borderColor: "#eee9e0" }}>{children}</div> : null}
    </article>
  );
}

// services: service items raised by this report — shown right under it (one record of the issue).
// pointers: items first reported here that are now tracked on their service visit.
function NoteCard({ note, currentUser, authUser, onChanged, onPhotoClick, services = [], pointers = [], onServiceChanged }) {
  const { title, icon, tone } = noteKind(note);
  const meta = joinMeta(crewName(note.author) || note.author, photoCount(note.attachments?.length));
  const body = <JobNoteEntry note={note} currentUser={currentUser} authUser={authUser} onChanged={onChanged} onPhotoClick={onPhotoClick} embedded />;
  if (isQuietNote(note, services, pointers)) {
    return <FoldedEntry icon={icon} tone={tone} title={title} meta={meta} preview={notePreview(note)}>{body}</FoldedEntry>;
  }
  const badge = [...services, ...pointers.map((p) => p.item)].some(isServiceOpen) ? { label: "Service item", color: "#fff", bg: "#A43432" }
    : note.completion === "complete" ? { label: "Work complete", color: "#0b3f3b", bg: "#E2EEEB" }
    : note.completion === "incomplete" ? { label: "Not finished", color: "#A43432", bg: "#FCEDEC" } : null;
  return (
    <Entry icon={icon} tone={tone} title={title} meta={meta} badge={badge}>
      {body}
      {services.map((s) => <ServiceItemPanel key={s.id} item={s} onChanged={onServiceChanged} />)}
      {pointers.map((p) => <div key={p.item.id}><ServiceItemPointer item={p.item} visitDate={p.date} /></div>)}
    </Entry>
  );
}

// A folded list above the timeline, newest day first: "Notes & texts" (every note, text, call
// and email) and "Job folder files", so the visits and field reports below stay the focus.
// Each entry inside still opens on its own.
const plural = (word, n) => (n === 1 ? word : /y$/.test(word) ? `${word.slice(0, -1)}ies` : `${word}s`);
function noteSummary(items) {
  const tally = new Map();
  for (const it of items) {
    const t = noteKind(it.note).title.toLowerCase();
    tally.set(t, (tally.get(t) || 0) + 1);
  }
  return [...tally].map(([t, n]) => `${n} ${plural(t, n)}`).join(" · ");
}
const monthName = (date, today) => new Date(`${date}T12:00:00Z`).toLocaleDateString("en-US", { month: "long", ...(today.slice(0, 4) === date.slice(0, 4) ? {} : { year: "numeric" }), timeZone: "UTC" });

function HistoryDrawer({ icon: Icon, tone = "blue", title, summary, days, today, open, onToggle, renderDay }) {
  const count = days.reduce((n, d) => n + d.items.length, 0);
  if (!count) return null;
  const [tileBg, tileInk] = TONES[tone] || TONES.neutral;
  const latest = dayStamp(days[0].date, today);
  return (
    <section className="mb-4 rounded-[14px] bg-white" style={{ border: "1px solid #d3cabb", boxShadow: "0 1px 2px rgba(10,29,31,.06),0 8px 18px -12px rgba(10,29,31,.22)" }}>
      <button type="button" aria-expanded={open} onClick={onToggle} className={`flex w-full min-w-0 items-center gap-3 px-[18px] py-3 text-left hover:bg-black/[0.02] ${open ? "rounded-t-[14px]" : "rounded-[14px]"}`}>
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px]" style={{ backgroundColor: tileBg, color: tileInk }}><Icon className="h-4 w-4" /></span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-x-2">
            <span className="text-[15px] font-bold" style={{ color: C.text }}>{title}</span>
            <span className="rounded-full px-2 py-px text-[12px] font-semibold" style={{ backgroundColor: "#f1eee7", color: "#34403f" }}>{count}</span>
          </span>
          <span className="block truncate text-[12.5px]" style={{ color: "#616a6d" }}>{summary} · latest {latest.rel ? latest.rel.toLowerCase() : `${latest.mo} ${latest.day}`}</span>
        </span>
        <span className="shrink-0 text-[12.5px] font-semibold" style={{ color: "#0b3f3b" }}>{open ? "Hide" : "Show all"}</span>
        <ChevronDown className={`h-4 w-4 shrink-0 transition-transform ${open ? "rotate-180" : ""}`} style={{ color: "#0b3f3b" }} />
      </button>
      {open ? (
        <div className="max-h-[560px] overflow-y-auto border-t px-[18px] pb-2" style={{ borderColor: "#eee9e0" }}>
          {days.map(({ date, items: dayItems }, di) => {
            const s = dayStamp(date, today);
            const newMonth = di === 0 || days[di - 1].date.slice(0, 7) !== date.slice(0, 7);
            return (
              <div key={date}>
                {newMonth ? <div className="pb-1 pt-3 text-[11px] font-bold uppercase tracking-[.14em]" style={{ color: "#3e5a55" }}>{monthName(date, today)}</div> : null}
                <div className="flex gap-4 border-t py-2" style={{ borderColor: newMonth ? "transparent" : "#f1ede5" }}>
                  <div className="w-[58px] shrink-0 pt-1 leading-tight">
                    <span className="block text-[10.5px] font-semibold uppercase tracking-[.1em]" style={{ color: s.rel ? "#10524c" : "#566063" }}>{s.rel || s.wd}</span>
                    <span className="block text-[13px] font-bold" style={{ color: C.text }}>{s.mo} {s.day}</span>
                  </div>
                  <div className="flex min-w-0 flex-1 flex-col gap-1">{renderDay(dayItems, date)}</div>
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}

// A service item logged without a field report (from the office): its own entry on the day it was logged.
function ServiceEntry({ item, onServiceChanged }) {
  return (
    <Entry icon={TriangleAlert} tone="red" title="Service item" meta={crewName(item.created_by_email) || item.created_by_email}>
      <ServiceItemPanel item={item} withReport={false} onChanged={onServiceChanged} />
    </Entry>
  );
}

// ledger: used inside the job sheet's "Visits" card, which carries the title
// and the Live marker itself; each date is its own card (VisitDayCard) and visits are
// laid out as Work / Details / Report rows. PO/OE are not repeated there (Job info has them).
// dedupe (job page): kept for callers; the non-ledger feed still uses it.
// progress (job page): jobProgress() from jobStages — tags stage days, adds the
// Milestones filter and the "Up next" card. Optional; without it the feed is unchanged.
// serviceItems (job page): the job's service items. Each shows under the field report that
// raised it; one logged without a report gets its own entry on the day it was logged.
export default function JobActivityFeed({ jobId, events, rows, notes, fieldReports, files, live, currentUser, authUser, onChanged, onPhotoClick, openFormKey = 0, title = "Job history", ledger = false, dedupe = null, progress = null, serviceItems = null, onServiceChanged, onScheduleNext = null}) {
  const [showForm, setShowForm] = useState(false);
  const [notesOpen, setNotesOpen] = useState(false);
  const [filesOpen, setFilesOpen] = useState(false);
  const [filter, setFilter] = useState("all");
  // currentUser is the author STRING (email) for legacy note form/delete behavior.
  // authUser is the auth user OBJECT — the owner-ID gate (canEditHistoryText) needs .id.
  const canEditText = canEditHistoryText(authUser);
  const lang = new URLSearchParams(window.location.search).get("feedlang") || preferredLang(authUser);
  // A "Log interaction" button elsewhere on the page opens the form here.
  useEffect(() => { if (openFormKey) setShowForm(true); }, [openFormKey]);

  const entries = useMemo(() => buildJobHistory({ events, rows, notes, fieldReports, files }), [events, rows, notes, fieldReports, files]);
  const tickets = useMemo(() => ticketsByEvent(rows), [rows]);
  const counts = useMemo(() => historyCounts(entries), [entries]);
  const stageDays = ledger && progress?.byDate ? progress.byDate : null;
  const milestoneCount = stageDays ? Object.keys(stageDays).length : 0;
  const today = denverDate();
  // Each service item is shown in full in exactly one place: on its service visit once one is
  // on the schedule (it moves with the visit), otherwise under the report that raised it, or
  // as its own entry if it was logged by hand. Where it was reported keeps a one-line pointer.
  const { servicesByNote, pointersByNote, servicesByVisit, looseServices } = useMemo(() => {
    const noteIds = new Set((notes || []).map((n) => n.id));
    const visitDate = new Map((events || []).map((e) => [e.id, e.event_date]));
    const byNote = {}, pointers = {}, byVisit = {};
    const loose = [];
    const push = (map, k, v) => { (map[k] = map[k] || []).push(v); };
    for (const s of serviceItems || []) {
      if (s.service_event_id && visitDate.has(s.service_event_id)) {
        push(byVisit, s.service_event_id, s);
        if (s.source_note_id && noteIds.has(s.source_note_id)) push(pointers, s.source_note_id, { item: s, date: visitDate.get(s.service_event_id) });
      } else if (s.source_note_id && noteIds.has(s.source_note_id)) push(byNote, s.source_note_id, s);
      else loose.push(s);
    }
    return { servicesByNote: byNote, pointersByNote: pointers, servicesByVisit: byVisit, looseServices: loose };
  }, [serviceItems, notes, events]);
  const noteServices = (note) => servicesByNote[note.id] || [];
  const notePointers = (note) => pointersByNote[note.id] || [];
  const visitServices = (ev) => (ev?.id && servicesByVisit[ev.id]) || [];
  const drawerItem = (it) => it.kind === "note" && isQuietNote(it.note, noteServices(it.note), notePointers(it.note));
  const days = useMemo(() => {
    let base = groupHistoryByDay(entries, filter === "milestones" ? "all" : filter);
    if (filter === "all" && looseServices.length) {
      const byDate = new Map(base.map((d) => [d.date, { ...d, items: [...d.items] }]));
      for (const s of looseServices) {
        const date = denverDate(s.created_date || Date.now());
        if (!byDate.has(date)) byDate.set(date, { date, items: [] });
        byDate.get(date).items.push({ kind: "service", date, item: s });
      }
      base = [...byDate.values()].sort((a, b) => b.date.localeCompare(a.date));
    }
    if (!stageDays || (filter !== "all" && filter !== "milestones")) return base;
    // A stage can fall on a day with nothing logged (product arrived at BFS): give it a card.
    const have = new Set(base.map((d) => d.date));
    const extra = Object.keys(stageDays).filter((d) => !have.has(d)).map((date) => ({ date, items: [{ kind: "stage", date, stages: stageDays[date] }] }));
    const all = [...base, ...extra].sort((a, b) => b.date.localeCompare(a.date));
    return filter === "milestones" ? all.filter((d) => stageDays[d.date]) : all;
  }, [entries, filter, stageDays, looseServices]);
  const filters = ledger && milestoneCount ? [HISTORY_FILTERS[0], { key: "milestones", label: "Milestones" }, ...HISTORY_FILTERS.slice(1)] : HISTORY_FILTERS;
  const filterCount = (key) => (key === "milestones" ? milestoneCount : counts[key]);
  // The title-bar service marker jumps here: make sure the item is on screen (All filter).
  useEffect(() => {
    const onFocus = (e) => {
      if (filter === "all") return;
      setFilter("all");
      setTimeout(() => window.dispatchEvent(new CustomEvent(FOCUS_EVENT, { detail: e.detail })), 60);
    };
    window.addEventListener(FOCUS_EVENT, onFocus);
    return () => window.removeEventListener(FOCUS_EVENT, onFocus);
  }, [filter]);
  // If a live reload leaves no stage days, drop back to All instead of a hidden filter.
  useEffect(() => { if (filter === "milestones" && !milestoneCount) setFilter("all"); }, [filter, milestoneCount]);

  // Ledger, All filter: notes, texts, calls and emails move to the Notes & texts drawer and
  // job-folder files to the Job folder files drawer (both still by day); the day cards keep
  // visits, field reports and stages. Other filters leave every entry on its day.
  const noteDays = [];
  const fileDays = [];
  const reportDays = [];
  for (const d of days) {
    const pull = filter === "all";
    const notesHere = pull ? d.items.filter(drawerItem) : [];
    const filesHere = pull ? d.items.filter((it) => it.kind === "file") : [];
    const rest = notesHere.length || filesHere.length ? d.items.filter((it) => !drawerItem(it) && it.kind !== "file") : d.items;
    if (notesHere.length) noteDays.push({ date: d.date, items: notesHere });
    if (filesHere.length) fileDays.push({ date: d.date, items: filesHere });
    if (rest.length || stageDays?.[d.date]) reportDays.push(rest === d.items ? d : { ...d, items: rest });
  }
  const renderItem = (it, i, dayItems, date) => {
    if (it.kind === "stage") return <StageOnlyEntry key={`s-${date}`} stages={it.stages} />;
    if (it.kind === "files") return <FileGroupCard key={`fg-${date}`} files={it.files} onPhotoClick={onPhotoClick} />;
    if (it.kind === "visit") return <VisitEntry key={`v-${it.ev.id || i}`} ev={it.ev} reports={it.reports} badge={visitBadge(it.ev, today, { reports: it.reports, photoNote: dayItems.some((x) => x.kind === "note" && x.note?.job_id && (x.note.attachments?.length || 0) > 0) })} onPhotoClick={onPhotoClick} services={visitServices(it.ev)} onServiceChanged={onServiceChanged} tickets={visitTickets(tickets, it.ev)} canEditText={canEditText} onChanged={onChanged} lang={lang} />;
    if (it.kind === "report") return <ReportCard key={`r-${it.report.post_id || i}`} report={it.report} onPhotoClick={onPhotoClick} canEditText={canEditText} onChanged={onChanged} lang={lang} />;
    if (it.kind === "change") return <ChangeCard key={`c-${it.ev.id || i}`} ev={it.ev} />;
    if (it.kind === "file") return <FileCard key={`f-${it.file.id}`} file={it.file} onPhotoClick={onPhotoClick} />;
    if (it.kind === "service") return <ServiceEntry key={`svc-${it.item.id}`} item={it.item} onServiceChanged={onServiceChanged} />;
    return <NoteCard key={`n-${it.note.id}`} note={it.note} currentUser={currentUser} authUser={authUser} onChanged={onChanged} onPhotoClick={onPhotoClick} services={noteServices(it.note)} pointers={notePointers(it.note)} onServiceChanged={onServiceChanged} />;
  };

  return (
    <LedgerContext.Provider value={ledger}>
    <div>
      <div className={ledger ? "hidden" : "flex items-center justify-between gap-2 mb-2"}>
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="font-heading text-[20px] font-bold" style={{ color: C.text }}>{title}</h2>
          {live ? (
            <span className="inline-flex items-center gap-1 text-[11px] whitespace-nowrap" style={{ color: C.textMuted }} title="New notes, reports and visits show up here on their own">
              <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: "#2F8F6B" }} />Live
            </span>
          ) : null}
        </div>
        <button type="button" onClick={() => setShowForm((v) => !v)} className="inline-flex items-center gap-1.5 rounded-[10px] px-3 text-[13px] font-semibold whitespace-nowrap min-h-[34px]" style={{ backgroundColor: "#f4f1ea", color: C.text }}>
          <Plus className="h-3.5 w-3.5" style={{ color: "#0b3f3b" }} />Log interaction
        </button>
      </div>

      <div className={ledger ? "mb-4 flex items-center gap-2" : ""}>
      {/* Nothing to filter until something is logged: no row of zeros on a fresh job. */}
      <div role="tablist" aria-label="Filter job history" className={counts.all === 0 ? (ledger ? "flex min-w-0 flex-1" : "hidden") : ledger ? "flex min-w-0 flex-1 gap-1.5 overflow-x-auto pb-1" : "flex gap-1.5 overflow-x-auto pb-1 mb-3"}>
        {counts.all === 0 ? null : filters.map((f) => {
          const on = filter === f.key;
          return (
            <button key={f.key} type="button" role="tab" aria-selected={on} onClick={() => setFilter(f.key)}
              className="min-h-[32px] rounded-full px-3 text-[12px] font-medium whitespace-nowrap"
              style={on ? { backgroundColor: C.text, color: "#FFFFFF", border: `1px solid ${C.text}` } : { backgroundColor: C.card, color: C.textSecondary, border: `1px solid ${C.border}` }}>
              {f.label} <span style={{ opacity: 0.7 }}>{filterCount(f.key)}</span>
            </button>
          );
        })}
      </div>
      {ledger ? (
        <button type="button" onClick={() => setShowForm((v) => !v)} className="inline-flex shrink-0 items-center gap-1.5 rounded-[9px] px-3 text-[13px] font-semibold whitespace-nowrap min-h-[34px]" style={{ backgroundColor: "#f4f1ea", color: C.text, border: "1px solid #e2dcd1" }}>
          <Plus className="h-3.5 w-3.5" style={{ color: "#0b3f3b" }} />Log interaction
        </button>
      ) : null}
      </div>

      {showForm ? (
        <div className="mb-3">
          <JobNoteForm jobId={jobId} author={currentUser} onSaved={() => { setShowForm(false); setNotesOpen(true); onChanged(); }} onCancel={() => setShowForm(false)} />
        </div>
      ) : null}

      {ledger ? (
        <div>
          {(filter === "all" || filter === "milestones") ? <UpNextCard next={progress?.next} onSchedule={onScheduleNext} /> : null}
          <HistoryDrawer icon={MessageSquare} tone="blue" title="Notes & texts" summary={noteSummary(noteDays.flatMap((d) => d.items))} days={noteDays} today={today} open={notesOpen} onToggle={() => setNotesOpen((v) => !v)}
            renderDay={(items, date) => items.map((it, i) => renderItem(it, i, items, date))} />
          <HistoryDrawer icon={FileText} tone="neutral" title="Job folder files" summary={`${fileDays.reduce((n, d) => n + d.items.length, 0)} saved to the job folder`} days={fileDays} today={today} open={filesOpen} onToggle={() => setFilesOpen((v) => !v)}
            renderDay={(items, date) => groupFiles(items).map((it, i, dayItems) => renderItem(it, i, dayItems, date))} />
          {reportDays.length === 0 && !showForm ? (
            <div className="py-10 text-center text-[13px]" style={{ color: C.textMuted }}>{filter !== "all" ? "Nothing of this type yet." : noteDays.length || fileDays.length ? "No visits or field reports yet." : "No activity recorded yet."}</div>
          ) : null}
          {reportDays.map(({ date, items }, di) => (
            <div key={date}>
              {di === 0 || reportDays[di - 1].date.slice(0, 7) !== date.slice(0, 7) ? <MonthRule date={date} today={today} /> : null}
              <DayCard date={date} today={today} stages={stageDays?.[date]}>
                {groupFiles(items).map((it, i, dayItems) => renderItem(it, i, dayItems, date))}
              </DayCard>
            </div>
          ))}
        </div>
      ) : (
      <div className="space-y-5">
        {days.length === 0 && !showForm ? (
          <div className="py-10 text-center text-[13px]" style={{ color: C.textMuted }}>{filter === "all" ? "No activity recorded yet." : "Nothing of this type yet."}</div>
        ) : null}
        {days.map(({ date, items }, di) => (
          <div key={date} className={ledger ? `relative ${di ? "mt-5 border-t pt-5" : ""}` : ""} style={ledger ? { borderColor: "#eee9e0" } : undefined}>
            {ledger ? <span aria-hidden="true" className={`absolute -left-6 h-[13px] w-[13px] rounded-full ${di ? "top-[29px]" : "top-[8px]"}`} style={{ backgroundColor: "#b8955a", border: "2px solid #fff", boxShadow: "0 0 0 1px #b8955a" }} /> : null}
            <div className={ledger ? "mb-2" : "mb-2 flex items-center gap-3"}>
              {ledger
                ? <span className="inline-flex items-center rounded-[8px] px-2.5 py-1 text-[15px] font-extrabold tracking-[-0.01em] whitespace-nowrap" style={{ backgroundColor: "#f6efe0", color: "#5c3f0e", border: "1px solid #e8d9b5" }}>{formatDateGroup(date)}</span>
                : <span className="text-[13px] font-bold whitespace-nowrap" style={{ color: C.text }}>{formatDateGroup(date)}</span>}
              {ledger ? null : <span className="h-px flex-1" style={{ backgroundColor: C.rowBorder }} />}
            </div>
            <div className={ledger ? "space-y-4" : "space-y-2"}>
              {groupFiles(items).map((it, i) => {
                if (it.kind === "files") return <FileGroupCard key={`fg-${date}`} files={it.files} onPhotoClick={onPhotoClick} />;
                if (it.kind === "visit") return <VisitCard key={`v-${it.ev.id || i}`} ev={it.ev} reports={it.reports} onPhotoClick={onPhotoClick} dedupe={dedupe} canEditText={canEditText} onChanged={onChanged} lang={lang} />;
                if (it.kind === "report") return <ReportCard key={`r-${it.report.post_id || i}`} report={it.report} onPhotoClick={onPhotoClick} canEditText={canEditText} onChanged={onChanged} lang={lang} />;
                if (it.kind === "change") return <ChangeCard key={`c-${it.ev.id || i}`} ev={it.ev} />;
                if (it.kind === "file") return <FileCard key={`f-${it.file.id}`} file={it.file} onPhotoClick={onPhotoClick} />;
                if (it.kind === "service") return <ServiceEntry key={`svc-${it.item.id}`} item={it.item} onServiceChanged={onServiceChanged} />;
                return <NoteCard key={`n-${it.note.id}`} note={it.note} currentUser={currentUser} authUser={authUser} onChanged={onChanged} onPhotoClick={onPhotoClick} services={noteServices(it.note)} pointers={notePointers(it.note)} onServiceChanged={onServiceChanged} />;
              })}
            </div>
          </div>
        ))}
      </div>
      )}
    </div>
    </LedgerContext.Provider>
  );
}