import { useMemo, useState } from "react";
import { C, formatShort, formatDateGroup, crewName } from "@/lib/feeUI";
import { sanitizeText } from "@/lib/jobsSanitize";
import ClampedText from "./ClampedText";
import FeedImage from "./FeedImage";
import { RefreshCw, Plus, Camera, StickyNote, CheckCircle2, AlertCircle, Clock } from "lucide-react";
import JobNoteEntry from "./JobNoteEntry";
import JobNoteForm from "./JobNoteForm";

// Reports are normalized by source record id (probuild_post_id) so each Probuild
// post renders exactly once. A post whose date matches an appointment is folded
// into that visit; otherwise it stands alone. This suppresses the duplicate copy
// that used to appear when the same field-report text was both embedded in an
// appointment and rendered as a separate report row.
function buildReports(rows, fieldReports) {
  const byPost = new Map();
  for (const fr of fieldReports || []) {
    if (!fr.post_id) continue;
    byPost.set(fr.post_id, {
      post_id: fr.post_id,
      date: fr.job_date,
      message: fr.message || "",
      photos: fr.photo_urls || [],
      created_at: fr.created_at || "",
      author: "",
    });
  }
  for (const r of rows || []) {
    if ((r.source === "probuild" || r.source === "both") && r.probuild_post_id && !byPost.has(r.probuild_post_id)) {
      byPost.set(r.probuild_post_id, {
        post_id: r.probuild_post_id,
        date: r.job_date,
        message: [r.note_text, r.probuild_note_text].filter(Boolean).join("\n\n"),
        photos: r.photo_urls || [],
        created_at: r.probuild_job_date || r.job_date || "",
        author: r.calendar_creator || "",
      });
    }
  }
  return [...byPost.values()];
}

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
    <div className="grid grid-cols-2 gap-2 mt-2.5 sm:grid-cols-3">
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
          <ClampedText text={ev.scope_notes} maxLines={5} className="text-[13.5px] whitespace-pre-wrap break-words mt-1.5" style={{ color: C.textSecondary }} />
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

function NoteCard({ note, currentUser, onChanged, onPhotoClick }) {
  const isFieldReport = (note.attachments && note.attachments.length > 0) || !!note.completion;
  const badges = [];
  if (isFieldReport) {
    badges.push(<TypeLabel key="t" icon={Camera} color={C.accentText}>Field report</TypeLabel>);
  } else {
    badges.push(<TypeLabel key="t" icon={StickyNote} color={C.textSecondary}>Note</TypeLabel>);
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

export default function JobActivityFeed({ jobId, events, rows, notes, fieldReports, currentUser, onChanged, onPhotoClick }) {
  const [showForm, setShowForm] = useState(false);

  const days = useMemo(() => {
    const reports = buildReports(rows, fieldReports);
    const reportsByDate = new Map();
    for (const r of reports) {
      const list = reportsByDate.get(r.date) || [];
      list.push(r);
      reportsByDate.set(r.date, list);
    }

    const items = [];
    const attached = new Set();

    for (const ev of events || []) {
      if (!ev.event_date) continue;
      const dayReports = (reportsByDate.get(ev.event_date) || []).filter((r) => !attached.has(r.post_id));
      dayReports.forEach((r) => attached.add(r.post_id));
      items.push({ kind: "visit", date: ev.event_date, when: `${ev.event_date}T${ev.start_time || "00:00"}`, ev, reports: dayReports });
      if (ev.reschedule_count > 0 && ev.original_scheduled_date && ev.original_scheduled_date !== ev.event_date) {
        items.push({ kind: "change", date: ev.event_date, when: `${ev.event_date}T23:59`, ev });
      }
    }
    for (const r of reports) {
      if (!attached.has(r.post_id)) {
        items.push({ kind: "report", date: r.date, when: r.created_at || `${r.date}T12:00`, report: r });
      }
    }
    for (const n of notes || []) {
      items.push({ kind: "note", date: n.note_date, when: `${n.note_date}T23:58`, note: n });
    }

    const byDate = new Map();
    for (const it of items) {
      if (!it.date) continue;
      const list = byDate.get(it.date) || [];
      list.push(it);
      byDate.set(it.date, list);
    }
    return [...byDate.entries()]
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([date, list]) => ({ date, items: list.sort((a, b) => a.when.localeCompare(b.when)) }));
  }, [events, rows, notes, fieldReports]);

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-3">
        <h2 className="font-heading text-[20px] font-bold" style={{ color: C.text }}>Activity</h2>
        <button onClick={() => setShowForm((v) => !v)} className="inline-flex items-center gap-1 font-mono text-[10px] font-semibold uppercase tracking-[0.13em] px-2.5 py-1.5 rounded-full whitespace-nowrap min-h-[32px]" style={{ border: `1px solid ${C.border}`, color: C.textSecondary }}>
          <Plus className="h-3 w-3" />Add note
        </button>
      </div>

      {showForm ? (
        <div className="mb-3">
          <JobNoteForm jobId={jobId} author={currentUser} onSaved={() => { setShowForm(false); onChanged(); }} onCancel={() => setShowForm(false)} />
        </div>
      ) : null}

      <div className="space-y-5">
        {days.length === 0 && !showForm ? (
          <div className="py-10 text-center text-[13px]" style={{ color: C.textMuted }}>No activity recorded yet.</div>
        ) : null}
        {days.map(({ date, items }) => (
          <div key={date}>
            <div className="sticky top-0 z-10 py-1 mb-2" style={{ backgroundColor: C.pageBg }}>
              <span className="font-mono-num text-[12px] font-bold uppercase tracking-[0.08em]" style={{ color: C.textMuted }}>{formatDateGroup(date)}</span>
            </div>
            <div className="space-y-2">
              {items.map((it, i) => {
                if (it.kind === "visit") return <VisitCard key={`v-${i}`} ev={it.ev} reports={it.reports} onPhotoClick={onPhotoClick} />;
                if (it.kind === "report") return <ReportCard key={`r-${it.report.post_id || i}`} report={it.report} onPhotoClick={onPhotoClick} />;
                if (it.kind === "change") return <ChangeCard key={`c-${i}`} ev={it.ev} />;
                return <NoteCard key={`n-${it.note.id}`} note={it.note} currentUser={currentUser} onChanged={onChanged} onPhotoClick={onPhotoClick} />;
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}