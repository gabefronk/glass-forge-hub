import { useEffect, useMemo, useState } from "react";
import { C, formatShort, formatDateGroup, crewName } from "@/lib/feeUI";
import { sanitizeText } from "@/lib/jobsSanitize";
import ClampedText from "./ClampedText";
import FeedImage from "./FeedImage";
import { RefreshCw, Plus, Camera, StickyNote, CheckCircle2, AlertCircle, Clock, Phone, MessageSquare, Mail, Users, Truck, TriangleAlert, HardHat, FileText, ExternalLink } from "lucide-react";
import { scopeText } from "@/lib/jobWorkspace";
import { buildJobHistory, historyCounts, groupHistoryByDay, HISTORY_FILTERS, interactionLabel, isFieldReportNote, fileLabel } from "@/lib/jobHistory";
import JobNoteEntry from "./JobNoteEntry";
import JobNoteForm from "./JobNoteForm";

function visitBadge(ev) {
  if (!ev.report_required || ev.report_required === false) return { label: "N/A", color: C.textMuted, bg: "#F0F1ED" };
  if (ev.report_status === "ok") return { label: "Report complete", color: C.accentText, bg: "#E2EEEB" };
  if (ev.report_status === "waived") return { label: "Waived", color: C.textMuted, bg: "#F0F1ED" };
  if (ev.report_status === "rescheduled") return { label: "Rescheduled", color: C.textMuted, bg: "#F0F1ED" };
  if (ev.days_late > 0) return { label: `${ev.days_late}d late`, color: "#A43432", bg: "#FCEDEC" };
  return { label: "Awaiting report", color: "#89511A", bg: "#FFF3DF" };
}

function PhotoGrid({ urls, onPhotoClick }) {
  if (!urls || !urls.length) return null;
  return (
    <div className="grid grid-cols-3 gap-2 mt-2.5 sm:grid-cols-4">
      {urls.map((url, i) => (
        <button key={i} type="button" onClick={() => onPhotoClick(url)} className="aspect-[4/3] rounded-[10px] overflow-hidden shrink-0" style={{ border: `1px solid ${C.border}` }}>
          <FeedImage src={url} alt={`Photo ${i + 1}`} className="h-full w-full object-cover" loading="lazy" />
        </button>
      ))}
    </div>
  );
}

function TypeLabel({ icon: Icon, children, color }) {
  return (
    <span className="inline-flex items-center gap-1.5 font-mono text-[10px] font-bold uppercase tracking-[0.1em]" style={{ color }}>
      <Icon className="h-3 w-3" />{children}
    </span>
  );
}

function ReportBlock({ report, onPhotoClick }) {
  return (
    <div className="mt-1">
      {report.author ? (
        <div className="text-[11px]" style={{ color: C.textMuted }}>{crewName(report.author)} · {report.created_at ? formatShort(String(report.created_at).slice(0, 10)) : ""}</div>
      ) : null}
      {report.message ? (
        <ClampedText text={report.message} maxLines={5} className="text-[13.5px] whitespace-pre-wrap break-words mt-1" style={{ color: C.text }} />
      ) : null}
      <PhotoGrid urls={report.photos} onPhotoClick={onPhotoClick} />
    </div>
  );
}

function VisitCard({ ev, reports, onPhotoClick }) {
  const badge = visitBadge(ev);
  const crew = crewName(ev.created_by);
  return (
    <div className="rounded-[14px] p-4" style={{ border: `1px solid ${C.border}`, backgroundColor: C.card }}>
      <div className="flex flex-wrap items-center gap-2">
        <TypeLabel icon={Clock} color={C.textSecondary}>Appointment</TypeLabel>
        <span className="font-mono-num text-[12px] whitespace-nowrap" style={{ color: C.textSecondary }}>
          {ev.start_time ? `${ev.start_time}${ev.end_time ? `–${ev.end_time}` : ""}` : "All day"}
        </span>
        <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.1em] px-2 py-0.5 rounded-full whitespace-nowrap" style={{ backgroundColor: badge.bg, color: badge.color }}>{badge.label}</span>
      </div>
      <div className="text-[14px] font-semibold break-words mt-1.5" style={{ color: C.text }}>{sanitizeText(ev.job_name)}</div>
      {reports.length > 0 ? (
        reports.map((r, i) => (
          <div key={r.post_id || i} className="mt-2 pt-2" style={{ borderTop: i > 0 ? `1px solid ${C.rowBorder}` : "none" }}>
            <TypeLabel icon={Camera} color={C.accentText}>Field report</TypeLabel>
            <ReportBlock report={r} onPhotoClick={onPhotoClick} />
          </div>
        ))
      ) : (
        ev.scope_notes ? (
          <ClampedText text={scopeText(ev.scope_notes).replace(/\n{3,}/g, "\n\n").trim()} maxLines={5} className="text-[13.5px] whitespace-pre-wrap break-words mt-1.5" style={{ color: C.textSecondary }} />
        ) : null
      )}
      {crew ? <div className="text-[11px] mt-1.5" style={{ color: C.textMuted }}>Crew: {crew}</div> : null}
    </div>
  );
}

function ReportCard({ report, onPhotoClick }) {
  return (
    <div className="rounded-[14px] p-4" style={{ border: `1px solid ${C.border}`, backgroundColor: C.card }}>
      <TypeLabel icon={Camera} color={C.accentText}>Field report</TypeLabel>
      <ReportBlock report={report} onPhotoClick={onPhotoClick} />
    </div>
  );
}

function ChangeCard({ ev }) {
  return (
    <div className="flex items-center gap-2 rounded-[10px] px-3 py-2" style={{ border: `1px solid ${C.rowBorder}`, backgroundColor: "transparent" }}>
      <RefreshCw className="h-3 w-3 shrink-0" style={{ color: C.textMuted }} />
      <span className="text-[11.5px] break-words" style={{ color: C.textMuted }}>
        Install moved: <span className="font-medium">{formatShort(ev.original_scheduled_date)}</span> → <span className="font-medium">{formatShort(ev.event_date)}</span>
      </span>
    </div>
  );
}

const NOTE_ICONS = { note: StickyNote, site_visit: HardHat, call: Phone, text: MessageSquare, email: Mail, meeting: Users, delivery: Truck, issue: TriangleAlert };

function FileCard({ file }) {
  return (
    <a href={file.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-[10px] px-3 py-2 hover:underline" style={{ border: `1px solid ${C.rowBorder}`, color: C.accentText }}>
      <FileText className="h-3.5 w-3.5 shrink-0" style={{ color: C.textMuted }} />
      <span className="text-[12px] break-words min-w-0 flex-1"><span style={{ color: C.textMuted }}>Saved to job folder: </span>{fileLabel(sanitizeText(file.name), file.name)}</span>
      <ExternalLink className="h-3 w-3 shrink-0" />
    </a>
  );
}

function NoteCard({ note, currentUser, onChanged, onPhotoClick }) {
  const isFieldReport = isFieldReportNote(note);
  const badges = [];
  if (isFieldReport) {
    badges.push(<TypeLabel key="t" icon={Camera} color={C.accentText}>Field report</TypeLabel>);
  } else {
    const kind = note.interaction_type || "note";
    const color = kind === "issue" ? "#A43432" : C.textSecondary;
    badges.push(<TypeLabel key="t" icon={NOTE_ICONS[kind] || StickyNote} color={color}>{interactionLabel(kind)}</TypeLabel>);
  }
  if (note.completion === "complete") {
    badges.push(<TypeLabel key="c" icon={CheckCircle2} color="#166447">Complete</TypeLabel>);
  } else if (note.completion === "incomplete") {
    badges.push(<TypeLabel key="i" icon={AlertCircle} color="#A43432">Incomplete</TypeLabel>);
  }
  return (
    <div className="rounded-[14px] p-4" style={{ border: `1px solid ${C.border}`, backgroundColor: C.card }}>
      <div className="flex items-center gap-2 flex-wrap">{badges}</div>
      <JobNoteEntry note={note} currentUser={currentUser} onChanged={onChanged} onPhotoClick={onPhotoClick} embedded />
    </div>
  );
}

export default function JobActivityFeed({ jobId, events, rows, notes, fieldReports, files, live, currentUser, onChanged, onPhotoClick, openFormKey = 0, title = "Job history" }) {
  const [showForm, setShowForm] = useState(false);
  const [filter, setFilter] = useState("all");
  // A "Log interaction" button elsewhere on the page opens the form here.
  useEffect(() => { if (openFormKey) setShowForm(true); }, [openFormKey]);

  const entries = useMemo(() => buildJobHistory({ events, rows, notes, fieldReports, files }), [events, rows, notes, fieldReports, files]);
  const counts = useMemo(() => historyCounts(entries), [entries]);
  const days = useMemo(() => groupHistoryByDay(entries, filter), [entries, filter]);

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2">
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

      <div role="tablist" aria-label="Filter job history" className="flex gap-1.5 overflow-x-auto pb-1 mb-3">
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

      {showForm ? (
        <div className="mb-3">
          <JobNoteForm jobId={jobId} author={currentUser} onSaved={() => { setShowForm(false); onChanged(); }} onCancel={() => setShowForm(false)} />
        </div>
      ) : null}

      <div className="space-y-5">
        {days.length === 0 && !showForm ? (
          <div className="py-10 text-center text-[13px]" style={{ color: C.textMuted }}>{filter === "all" ? "No activity recorded yet." : "Nothing of this type yet."}</div>
        ) : null}
        {days.map(({ date, items }) => (
          <div key={date}>
            <div className="sticky top-0 z-10 py-1 mb-2" style={{ backgroundColor: C.pageBg }}>
              <span className="text-[12.5px] font-bold" style={{ color: C.textSecondary }}>{formatDateGroup(date)}</span>
            </div>
            <div className="space-y-2">
              {items.map((it, i) => {
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
  );
}
