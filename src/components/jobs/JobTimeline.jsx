import { useMemo } from "react";
import { C, CARD_SHADOW, crewName } from "@/lib/feeUI";
import { formatMoney } from "@/lib/feeMath";
import JobNoteForm from "@/components/jobs/JobNoteForm";
import JobNoteEntry from "@/components/jobs/JobNoteEntry";

export default function JobTimeline({ jobId, rows, notes, currentUser, showNoteForm, onNoteSaved, onNoteCancel, onChanged, onPhotoClick }) {
  const entries = useMemo(() => {
    const items = [
      ...rows.map(r => ({
        kind: "fee",
        type: (r.source === "probuild" || r.source === "both") ? "report" : "scheduled",
        date: r.job_date || "",
        data: r,
      })),
      ...notes.map(n => ({ kind: "note", type: "note", date: n.note_date || "", data: n })),
    ];
    return items.sort((a, b) => b.date.localeCompare(a.date));
  }, [rows, notes]);

  const reportCount = rows.filter(r => r.source === "probuild" || r.source === "both").length;
  const noteCount = notes.length;

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <h2 style={{ fontSize: "15px", fontWeight: 700, color: C.accentDark }}>Timeline</h2>
        <span className="text-sm whitespace-nowrap" style={{ color: C.text, opacity: 0.62 }}>
          {reportCount} field report{reportCount === 1 ? "" : "s"} · {noteCount} note{noteCount === 1 ? "" : "s"}
        </span>
      </div>

      {showNoteForm && (
        <div className="mb-4 pl-8">
          <JobNoteForm jobId={jobId} author={currentUser} onSaved={onNoteSaved} onCancel={onNoteCancel} />
        </div>
      )}

      <div className="relative">
        <div className="absolute left-[5px] top-0 bottom-0 w-px" style={{ backgroundColor: C.border }} />
        <div className="space-y-4">
          {entries.map((entry) => (
            <TimelineItem key={entry.data.id || entry.date} entry={entry} currentUser={currentUser} onChanged={onChanged} onPhotoClick={onPhotoClick} />
          ))}
        </div>
      </div>

      {!entries.length && !showNoteForm && (
        <div className="py-10 text-center text-sm" style={{ color: C.text, opacity: 0.5 }}>No activity recorded.</div>
      )}
    </div>
  );
}

function TimelineItem({ entry, currentUser, onChanged, onPhotoClick }) {
  const isReport = entry.type === "report";
  const isScheduled = entry.type === "scheduled";
  const dotColor = isReport ? C.accent : isScheduled ? C.amber : C.mutedText;
  const kindLabel = isReport ? "Field report" : isScheduled ? "Scheduled" : "Note";
  const tagBg = isReport ? C.tagBillable.bg : isScheduled ? C.tagCal.bg : C.tagReview.bg;
  const tagText = isReport ? C.tagBillable.text : isScheduled ? C.tagCal.text : C.tagReview.text;
  const dateStr = entry.data.job_date || entry.data.note_date || "";

  return (
    <div className="relative pl-8">
      <div
        className="absolute left-[1px] top-3 w-[9px] h-[9px] rounded-full z-10"
        style={{ backgroundColor: dotColor, boxShadow: `0 0 0 3px ${C.pageBg}` }}
      />
      {/* Head */}
      <div className="flex items-center gap-2 mb-1.5 flex-wrap">
        <span className="font-mono tabular-nums whitespace-nowrap" style={{ fontSize: "12px", color: C.text, opacity: 0.68 }}>{dateStr}</span>
        <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full whitespace-nowrap" style={{ backgroundColor: tagBg, color: tagText }}>{kindLabel}</span>
        {entry.kind === "fee" && entry.data.ticket_sequence != null && entry.data.ticket_sequence >= 2 && (
          <span className="text-[10px] font-bold uppercase px-2 py-0.5 rounded-full whitespace-nowrap" style={{ backgroundColor: C.tagReview.bg, color: C.tagReview.text }}>Rework #{entry.data.ticket_sequence}</span>
        )}
      </div>
      {/* Card */}
      {entry.kind === "note" ? (
        <JobNoteEntry note={entry.data} currentUser={currentUser} onChanged={onChanged} onPhotoClick={onPhotoClick} />
      ) : (
        <FeeEntryCard row={entry.data} onPhotoClick={onPhotoClick} />
      )}
    </div>
  );
}

function FeeEntryCard({ row, onPhotoClick }) {
  const isZero = Number(row.labor_amt) === 0;
  const crew = crewName(row.calendar_creator);

  return (
    <div className="rounded-lg p-3" style={{ border: `1px solid ${C.border}`, boxShadow: CARD_SHADOW, backgroundColor: C.card }}>
      {row.line_description && (
        <p className="text-sm mb-2 truncate" style={{ color: C.accentDark }}>{row.line_description}</p>
      )}
      {row.note_text && (
        <div className="text-sm whitespace-pre-wrap mb-2 rounded p-2" style={{ backgroundColor: C.mutedBg, color: C.text }}>{row.note_text}</div>
      )}
      {row.photo_urls && row.photo_urls.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-2">
          {row.photo_urls.map((url, i) => (
            <button key={i} onClick={() => onPhotoClick(url)} className="h-14 w-14 rounded border overflow-hidden" style={{ borderColor: C.border }}>
              <img src={url} alt="" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center flex-wrap gap-x-2 gap-y-1 text-xs" style={{ color: C.text, opacity: 0.68 }}>
        <span className="whitespace-nowrap">Labor <span className="tabular-nums">{isZero ? "—" : `$${formatMoney(row.labor_amt)}`}</span></span>
        <span className="whitespace-nowrap">·</span>
        <span className="whitespace-nowrap">Fee <span className="tabular-nums font-semibold" style={{ color: C.accent }}>{isZero ? "—" : `$${formatMoney(row.fee_amt)}`}</span></span>
        {crew && (<><span className="whitespace-nowrap">·</span><span className="whitespace-nowrap">Crew {crew}</span></>)}
      </div>
    </div>
  );
}