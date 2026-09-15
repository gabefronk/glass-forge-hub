import { useMemo, useState } from "react";
import { C, formatShort, formatDateGroup, crewName } from "@/lib/feeUI";
import { sanitizeText } from "@/lib/jobsSanitize";
import { Check, Clock, X, RefreshCw, Plus, Camera } from "lucide-react";
import JobNoteEntry from "./JobNoteEntry";
import JobNoteForm from "./JobNoteForm";

function visitBadge(ev) {
  if (!ev.report_required || ev.report_required === false) return { label: "N/A", color: C.textMuted, bg: "#F6F8FC" };
  if (ev.report_status === "ok") return { label: "Report complete", color: C.accentText, bg: "#E2EEEB" };
  if (ev.report_status === "waived") return { label: "Waived", color: C.textMuted, bg: "#F6F8FC" };
  if (ev.report_status === "rescheduled") return { label: "Rescheduled", color: C.textMuted, bg: "#F6F8FC" };
  if (ev.days_late > 0) return { label: `${ev.days_late}d late`, color: "#8A4038", bg: "#FBEDEA" };
  return { label: "Awaiting report", color: C.amber, bg: "#FAF0DA" };
}

function Photos({ urls, onPhotoClick }) {
  if (!urls || !urls.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5 mt-2">
      {urls.map((url, i) => (
        <button key={i} onClick={() => onPhotoClick(url)} className="h-16 w-16 rounded-lg overflow-hidden shrink-0" style={{ border: `1px solid ${C.border}` }}>
          <img src={url} alt={`Photo ${i + 1}`} className="h-full w-full object-cover" />
        </button>
      ))}
    </div>
  );
}

function VisitEntry({ ev, reports, onPhotoClick }) {
  const badge = visitBadge(ev);
  const crew = crewName(ev.created_by);
  const reportNotes = sanitizeText(reports.flatMap((r) => [r.note_text, r.probuild_note_text].filter(Boolean)).join("\n\n"));
  const reportPhotos = reports.flatMap((r) => r.photo_urls || []);
  return (
    <div className="rounded-[12px] p-3" style={{ border: `1px solid ${C.border}`, backgroundColor: C.card }}>
      <div className="flex flex-wrap items-center gap-2 mb-1">
        <span className="font-mono-num text-[12px] whitespace-nowrap" style={{ color: C.textSecondary }}>
          {ev.start_time ? `${ev.start_time}${ev.end_time ? `–${ev.end_time}` : ""}` : "All day"}
        </span>
        <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.1em] px-2 py-0.5 rounded-full whitespace-nowrap" style={{ backgroundColor: badge.bg, color: badge.color }}>{badge.label}</span>
        {ev.reschedule_count > 0 && (
          <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.1em] px-2 py-0.5 rounded-full whitespace-nowrap" style={{ backgroundColor: "#F6F8FC", color: C.textMuted }}>Rescheduled ×{ev.reschedule_count}</span>
        )}
      </div>
      <div className="text-[13px] font-medium break-words" style={{ color: C.text }}>{sanitizeText(ev.job_name)}</div>
      {ev.address && ev.scope_notes && (
        <div className="text-[11px] break-words mt-0.5" style={{ color: C.textMuted }}>{sanitizeText(ev.address)}</div>
      )}
      {ev.scope_notes && (
        <div className="text-[12px] whitespace-pre-wrap break-words mt-1.5 rounded p-2" style={{ backgroundColor: C.mutedBg, color: C.textSecondary }}>{sanitizeText(ev.scope_notes)}</div>
      )}
      {reportNotes && (
        <div className="text-[12px] whitespace-pre-wrap break-words mt-1.5" style={{ color: C.text }}>
          <span className="mono-label-sm">Field report notes</span>
          <div className="mt-1">{reportNotes}</div>
        </div>
      )}
      <Photos urls={reportPhotos} onPhotoClick={onPhotoClick} />
      {crew && <div className="text-[11px] mt-1.5" style={{ color: C.textMuted }}>Crew: {crew}</div>}
    </div>
  );
}

function ReportEntry({ row, onPhotoClick }) {
  const notes = [row.note_text, row.probuild_note_text].filter(Boolean).join("\n\n");
  return (
    <div className="rounded-[12px] p-3" style={{ border: `1px solid ${C.border}`, backgroundColor: C.card }}>
      <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.1em] px-2 py-0.5 rounded-full whitespace-nowrap" style={{ backgroundColor: "#E2EEEB", color: C.accentText }}>Field report</span>
      {row.line_description && <div className="text-[13px] font-medium break-words mt-1.5" style={{ color: C.text }}>{sanitizeText(row.line_description)}</div>}
      {notes && <div className="text-[12px] whitespace-pre-wrap break-words mt-1.5" style={{ color: C.textSecondary }}>{sanitizeText(notes)}</div>}
      <Photos urls={row.photo_urls} onPhotoClick={onPhotoClick} />
    </div>
  );
}

function RescheduleEntry({ ev }) {
  return (
    <div className="flex items-center gap-2 rounded-[12px] p-3" style={{ border: `1px solid ${C.border}`, backgroundColor: C.cardAlt }}>
      <RefreshCw className="h-3.5 w-3.5 shrink-0" style={{ color: C.textMuted }} />
      <span className="text-[12px] break-words" style={{ color: C.text }}>
        Install moved: <span className="font-medium">{formatShort(ev.original_scheduled_date)}</span> → <span className="font-medium">{formatShort(ev.event_date)}</span>
      </span>
    </div>
  );
}

export default function JobActivityFeed({ jobId, events, rows, notes, currentUser, onChanged, onPhotoClick }) {
  const [showForm, setShowForm] = useState(false);

  const days = useMemo(() => {
    const eventDates = new Set(events.map((e) => e.event_date).filter(Boolean));
    const reportsByDate = {};
    for (const r of rows) {
      if ((r.source === "probuild" || r.source === "both") && r.job_date) {
        (reportsByDate[r.job_date] ||= []).push(r);
      }
    }
    const items = [];
    for (const ev of events) {
      if (!ev.event_date) continue;
      items.push({ kind: "visit", date: ev.event_date, ev, reports: reportsByDate[ev.event_date] || [] });
      if (ev.original_scheduled_date && ev.original_scheduled_date !== ev.event_date && ev.reschedule_count > 0) {
        items.push({ kind: "reschedule", date: ev.event_date, ev });
      }
    }
    for (const r of rows) {
      if ((r.source === "probuild" || r.source === "both") && r.job_date && !eventDates.has(r.job_date)) {
        items.push({ kind: "report", date: r.job_date, row: r });
      }
    }
    for (const n of notes) {
      if (n.note_date) items.push({ kind: "note", date: n.note_date, note: n });
    }
    const byDate = {};
    for (const it of items) {
      if (!it.date) continue;
      (byDate[it.date] ||= []).push(it);
    }
    return Object.entries(byDate).sort((a, b) => b[0].localeCompare(a[0]));
  }, [events, rows, notes]);

  return (
    <div>
      <div className="flex flex-wrap items-center justify-between gap-2 mb-4">
        <h2 className="font-heading text-[15px] font-semibold" style={{ color: C.text }}>Activity</h2>
        <button
          onClick={() => setShowForm((v) => !v)}
          className="inline-flex items-center gap-1 font-mono text-[10px] font-semibold uppercase tracking-[0.13em] px-2.5 py-1.5 rounded-full whitespace-nowrap min-h-[32px] transition-colors"
          style={{ border: `1px solid ${C.border}`, color: C.textSecondary }}
        >
          <Plus className="h-3 w-3" />Add note
        </button>
      </div>

      {showForm && (
        <div className="mb-4">
          <JobNoteForm jobId={jobId} author={currentUser} onSaved={() => { setShowForm(false); onChanged(); }} onCancel={() => setShowForm(false)} />
        </div>
      )}

      <div className="space-y-6">
        {days.length === 0 && !showForm && (
          <div className="py-10 text-center text-[13px]" style={{ color: C.textMuted }}>No activity recorded yet.</div>
        )}
        {days.map(([date, items]) => (
          <div key={date}>
            <div className="sticky top-0 z-10 py-1.5 mb-2" style={{ backgroundColor: C.pageBg }}>
              <span className="font-mono-num text-[11px] font-semibold uppercase tracking-[0.08em]" style={{ color: C.textMuted }}>{formatDateGroup(date)}</span>
            </div>
            <div className="space-y-2.5">
              {items.map((it, i) => {
                if (it.kind === "visit") return <VisitEntry key={`v-${i}`} ev={it.ev} reports={it.reports} onPhotoClick={onPhotoClick} />;
                if (it.kind === "report") return <ReportEntry key={`r-${i}`} row={it.row} onPhotoClick={onPhotoClick} />;
                if (it.kind === "reschedule") return <RescheduleEntry key={`s-${i}`} ev={it.ev} />;
                return <JobNoteEntry key={it.note.id} note={it.note} currentUser={currentUser} onChanged={onChanged} onPhotoClick={onPhotoClick} />;
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}