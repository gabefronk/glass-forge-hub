import { createContext, useContext, useEffect, useMemo, useState } from "react";
import { C, formatShort, formatDateGroup, crewName } from "@/lib/feeUI";
import { sanitizeText } from "@/lib/jobsSanitize";
import ClampedText from "./ClampedText";
import { RefreshCw, Plus, Camera, StickyNote, Phone, MessageSquare, Mail, Users, Truck, TriangleAlert, HardHat, FileText, ExternalLink } from "lucide-react";
import { scopeText, parseScopeNotes, scopeIsEmpty } from "@/lib/jobWorkspace";
import ScopeNotes from "./ScopeNotes";
import { eventKind } from "@/lib/calendarModel";
import { denverDate } from "../../../base44/shared/billingCore.js";
import { buildJobHistory, historyCounts, groupHistoryByDay, HISTORY_FILTERS, interactionLabel, isFieldReportNote, fileLabel } from "@/lib/jobHistory";
import JobNoteEntry from "./JobNoteEntry";
import JobNoteForm from "./JobNoteForm";

// Status pill for a visit, in plain words.
function visitBadge(ev, today = denverDate()) {
  if (ev.event_date && ev.event_date > today) return { label: "Scheduled", color: "#34506a", bg: "#E7EDF2" };
  if (!ev.report_required || ev.report_required === false) return null;
  if (ev.report_status === "ok") return { label: "Report in", color: "#0b3f3b", bg: "#E2EEEB" };
  if (ev.report_status === "waived") return { label: "No report needed", color: C.textMuted, bg: "#F0F1ED" };
  if (ev.report_status === "rescheduled") return { label: "Rescheduled", color: C.textMuted, bg: "#F0F1ED" };
  if (ev.days_late > 0) return { label: `Report ${ev.days_late}d late`, color: "#A43432", bg: "#FCEDEC" };
  return { label: "Report due", color: "#8a5a12", bg: "#FAF0DA" };
}

import PhotoStrip from "./PhotoStrip";

// One entry in the job history: icon, what happened, when/who, status, then details.
// Ledger: flat entries on a timeline (the job sheet), instead of bordered cards.
const LedgerContext = createContext(false);

function Entry({ icon: Icon, tone = "neutral", title, meta, badge, actions, children }) {
  const ledger = useContext(LedgerContext);
  const tones = { teal: ["#e2eeeb", "#0b3f3b"], neutral: ["#f1eee7", "#34403f"], red: ["#fcedec", "#a43432"], blue: ["#e7edf2", "#34506a"] };
  const [bg, ink] = tones[tone] || tones.neutral;
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

function ReportBody({ report, onPhotoClick }) {
  return (
    <>
      {report.message ? (
        <ClampedText text={report.message} maxLines={4} className="mt-1.5 text-[14.5px] leading-[21px] whitespace-pre-wrap break-words" style={{ color: C.text }} />
      ) : <p className="m-0 mt-1.5 text-[13.5px]" style={{ color: C.textMuted }}>No notes, photos only.</p>}
      <PhotoStrip urls={report.photos} onPhotoClick={onPhotoClick} />
    </>
  );
}

function VisitCard({ ev, reports, onPhotoClick }) {
  const [showNotes, setShowNotes] = useState(false);
  const kind = eventKind(ev) === "service" ? "Service visit" : eventKind(ev) === "outlook" ? "Visit" : "Install visit";
  const crew = crewName(ev.created_by);
  const time = ev.start_time ? `${ev.start_time}${ev.end_time ? `–${ev.end_time}` : ""}` : "All day";
  const photos = reports.reduce((n, r) => n + (r.photos?.length || 0), 0);
  const notes = scopeText(ev.scope_notes).replace(/\n{3,}/g, "\n\n").trim();
  const parsed = useMemo(() => parseScopeNotes(ev.scope_notes, { keepMoney: true, keepContacts: true }), [ev.scope_notes]);
  return (
    <Entry icon={HardHat} tone="teal" title={kind} meta={joinMeta(time, crew, photoCount(photos))} badge={visitBadge(ev)}>
      {reports.length > 0 ? (
        <>
          {reports.map((r, i) => (
            <div key={r.post_id || i} className={i ? "mt-3 border-t pt-3" : ""} style={{ borderColor: C.rowBorder }}>
              <ReportBody report={r} onPhotoClick={onPhotoClick} />
            </div>
          ))}
          {notes ? (
            <div className="mt-2">
              <button type="button" onClick={() => setShowNotes((v) => !v)} className="text-[12.5px] font-semibold hover:underline" style={{ color: "#0b3f3b" }}>{showNotes ? "Hide calendar notes" : "Calendar notes"}</button>
              {showNotes ? <div className="mt-2"><ScopeNotes parsed={parsed} size="sm" /></div> : null}
            </div>
          ) : null}
        </>
      ) : notes && !scopeIsEmpty(parsed) ? (
        <div className="mt-2"><ScopeNotes parsed={parsed} size="sm" limit={2} /></div>
      ) : null}
    </Entry>
  );
}

function ReportCard({ report, onPhotoClick }) {
  return (
    <Entry icon={Camera} tone="teal" title="Field report" meta={joinMeta(crewName(report.author), photoCount(report.photos?.length))}>
      <ReportBody report={report} onPhotoClick={onPhotoClick} />
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
function FileGroupCard({ files }) {
  return (
    <div className="rounded-[10px] px-3 py-2" style={{ border: `1px solid ${C.rowBorder}` }}>
      <div className="flex items-center gap-2 text-[12px]" style={{ color: C.textMuted }}>
        <FileText className="h-3.5 w-3.5 shrink-0" />
        {files.length === 1 ? "Saved to job folder" : `${files.length} files saved to job folder`}
      </div>
      <div className="mt-1 flex flex-col gap-0.5 pl-5">
        {files.map((f) => (
          <a key={f.id} href={f.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-[12.5px] break-words hover:underline" style={{ color: C.accentText }}>
            {fileLabel(sanitizeText(f.name), f.name)}<ExternalLink className="h-3 w-3 shrink-0" />
          </a>
        ))}
      </div>
    </div>
  );
}

function FileCard({ file }) {
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

function NoteCard({ note, currentUser, onChanged, onPhotoClick }) {
  const isFieldReport = isFieldReportNote(note);
  const kind = note.interaction_type || "note";
  const badge = note.completion === "complete" ? { label: "Work complete", color: "#0b3f3b", bg: "#E2EEEB" }
    : note.completion === "incomplete" ? { label: "Not finished", color: "#A43432", bg: "#FCEDEC" } : null;
  return (
    <Entry
      icon={isFieldReport ? Camera : NOTE_ICONS[kind] || StickyNote}
      tone={isFieldReport ? "teal" : kind === "issue" ? "red" : kind === "call" || kind === "text" || kind === "email" ? "blue" : "neutral"}
      title={isFieldReport ? "Field report" : interactionLabel(kind)}
      meta={joinMeta(crewName(note.author) || note.author, photoCount(note.attachments?.length))}
      badge={badge}
    >
      <JobNoteEntry note={note} currentUser={currentUser} onChanged={onChanged} onPhotoClick={onPhotoClick} embedded />
    </Entry>
  );
}

// ledger: used inside the job sheet's "Visits" card, which carries the title
// and the Live marker itself; entries hang from a timeline with brass nodes.
export default function JobActivityFeed({ jobId, events, rows, notes, fieldReports, files, live, currentUser, onChanged, onPhotoClick, openFormKey = 0, title = "Job history", ledger = false }) {
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState("all");
  // A "Log interaction" button elsewhere on the page opens the form here.
  useEffect(() => { if (openFormKey) setShowForm(true); }, [openFormKey]);

  const entries = useMemo(() => buildJobHistory({ events, rows, notes, fieldReports, files }), [events, rows, notes, fieldReports, files]);
  const counts = useMemo(() => historyCounts(entries), [entries]);
  const days = useMemo(() => groupHistoryByDay(entries, filter), [entries, filter]);

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
      <div role="tablist" aria-label="Filter job history" className={ledger ? "flex min-w-0 flex-1 gap-1.5 overflow-x-auto pb-1" : "flex gap-1.5 overflow-x-auto pb-1 mb-3"}>
        {HISTORY_FILTERS.map((f) => {
          const on = filter === f.key;
          return (
            <button key={f.key} type="button" role="tab" aria-selected={on} onClick={() => setFilter(f.key)}
              className="min-h-[32px] rounded-full px-3 text-[12px] font-medium whitespace-nowrap"
              style={on ? { backgroundColor: C.text, color: "#FFFFFF", border: `1px solid ${C.text}` } : { backgroundColor: C.card, color: C.textSecondary, border: `1px solid ${C.border}` }}>
              {f.label} <span style={{ opacity: 0.7 }}>{counts[f.key]}</span>
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
          <JobNoteForm jobId={jobId} author={currentUser} onSaved={() => { setShowForm(false); onChanged(); }} onCancel={() => setShowForm(false)} />
        </div>
      ) : null}

      <div className={ledger ? "relative pl-6" : "space-y-5"}>
        {ledger && days.length ? <span aria-hidden="true" className="absolute left-[5px] top-2 bottom-2 w-px" style={{ backgroundColor: "#e2dcd1" }} /> : null}
        {days.length === 0 && !showForm ? (
          <div className="py-10 text-center text-[13px]" style={{ color: C.textMuted }}>{filter === "all" ? "No activity recorded yet." : "Nothing of this type yet."}</div>
        ) : null}
        {days.map(({ date, items }, di) => (
          <div key={date} className={ledger ? `relative ${di ? "mt-5 border-t pt-5" : ""}` : ""} style={ledger ? { borderColor: "#eee9e0" } : undefined}>
            {ledger ? <span aria-hidden="true" className={`absolute -left-6 h-[11px] w-[11px] rounded-full bg-white ${di ? "top-[26px]" : "top-[5px]"}`} style={{ border: "2px solid #b8955a" }} /> : null}
            <div className={ledger ? "mb-2" : "mb-2 flex items-center gap-3"}>
              <span className={ledger ? "text-[13.5px] font-bold whitespace-nowrap" : "text-[13px] font-bold whitespace-nowrap"} style={{ color: ledger ? "#8a6420" : C.text }}>{formatDateGroup(date)}</span>
              {ledger ? null : <span className="h-px flex-1" style={{ backgroundColor: C.rowBorder }} />}
            </div>
            <div className={ledger ? "space-y-4" : "space-y-2"}>
              {groupFiles(items).map((it, i) => {
                if (it.kind === "files") return <FileGroupCard key={`fg-${date}`} files={it.files} />;
                if (it.kind === "visit") return <VisitCard key={`v-${it.ev.id || i}`} ev={it.ev} reports={it.reports} onPhotoClick={onPhotoClick} />;
                if (it.kind === "report") return <ReportCard key={`r-${it.report.post_id || i}`} report={it.report} onPhotoClick={onPhotoClick} />;
                if (it.kind === "change") return <ChangeCard key={`c-${it.ev.id || i}`} ev={it.ev} />;
                if (it.kind === "file") return <FileCard key={`f-${it.file.id}`} file={it.file} />;
                return <NoteCard key={`n-${it.note.id}`} note={it.note} currentUser={currentUser} onChanged={onChanged} onPhotoClick={onPhotoClick} />;
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
    </LedgerContext.Provider>
  );
}
