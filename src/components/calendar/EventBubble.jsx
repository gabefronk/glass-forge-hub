import { useState, useEffect } from "react";
import { Link } from "react-router-dom";
import { Pencil, Trash2, X, MapPin, FileText, Calendar, Briefcase, Lock } from "lucide-react";
import { C } from "@/lib/feeUI";
import { formatMoney } from "@/lib/feeMath";
import EventForm from "./EventForm";
import FieldReportActions from "./FieldReportActions";

const INSTALL_COLOR = "#2A5EA8";
const SERVICE_COLOR = "#8A4038";

function InfoRow({ icon: Icon, children, sub }) {
  return (
    <div className="flex items-start gap-3 py-1.5">
      <Icon className="h-4 w-4 shrink-0 mt-0.5" style={{ color: C.textMuted }} />
      <div className="min-w-0 flex-1">
        <div className="text-[13px] leading-snug" style={{ color: C.text }}>{children}</div>
        {sub && <div className="text-[12px] leading-snug mt-0.5" style={{ color: C.textMuted }}>{sub}</div>}
      </div>
    </div>
  );
}

export default function EventBubble({ event, jobs, onEdit, onDelete, onClose, saving, user, onChanged }) {
  const [editing, setEditing] = useState(false);

  useEffect(() => {
    const handler = (e) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  if (editing && event.source === "app") {
    return (
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(19,26,38,.40)" }} onClick={onClose}>
        <div className="rounded-[14px] max-w-lg w-full max-h-[85vh] overflow-y-auto obsidian-scroll card-shadow" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }} onClick={(e) => e.stopPropagation()}>
          <div className="flex items-center justify-between px-4 py-3" style={{ borderBottom: `1px solid ${C.border}` }}>
            <span className="font-heading text-[14px] font-semibold" style={{ color: C.text }}>Edit event</span>
            <button onClick={onClose} className="p-1 rounded-full transition-colors hover:bg-[#F8FAFD]"><X className="h-4 w-4" style={{ color: C.textMuted }} /></button>
          </div>
          <div className="p-4">
            <EventForm initial={event} jobs={jobs} onSave={onEdit} onCancel={() => setEditing(false)} saving={saving} />
          </div>
        </div>
      </div>
    );
  }

  const readOnly = event.source === "google";
  const isInstall = event.source === "app";
  const swatchColor = isInstall ? INSTALL_COLOR : SERVICE_COLOR;
  const dateLabel = new Date(event.event_date + "T00:00:00").toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
  const timeLabel = event.start_time ? ` · ${event.start_time}${event.end_time ? ` – ${event.end_time}` : ""}` : "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ backgroundColor: "rgba(19,26,38,.40)" }} onClick={onClose}>
      <div
        className="rounded-[14px] w-full max-w-[440px] max-h-[85vh] overflow-y-auto obsidian-scroll card-shadow-elevated"
        style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Toolbar */}
        <div className="flex items-center justify-end gap-1 px-3 pt-3">
          {!readOnly && (
            <>
              <button onClick={() => setEditing(true)} className="p-2 rounded-full transition-colors hover:bg-[#F8FAFD]" title="Edit">
                <Pencil className="h-4 w-4" style={{ color: C.textMuted }} />
              </button>
              <button onClick={onDelete} className="p-2 rounded-full transition-colors hover:bg-[#F8FAFD]" title="Delete">
                <Trash2 className="h-4 w-4" style={{ color: C.textMuted }} />
              </button>
            </>
          )}
          <button onClick={onClose} className="p-2 rounded-full transition-colors hover:bg-[#F8FAFD]" title="Close">
            <X className="h-4 w-4" style={{ color: C.textMuted }} />
          </button>
        </div>

        {/* Title section */}
        <div className="px-5 pb-2">
          <div className="flex items-start gap-3">
            <span className="h-3.5 w-3.5 rounded-[3px] shrink-0 mt-1.5" style={{ backgroundColor: swatchColor }} />
            <div className="min-w-0">
              <h2 className="font-heading text-[17px] font-semibold leading-tight" style={{ color: C.text }}>{event.job_name}</h2>
              <p className="text-[13px] mt-0.5" style={{ color: C.textMuted }}>{dateLabel}{timeLabel}</p>
            </div>
          </div>
        </div>

        {/* Body */}
        <div className="px-5 pb-4 pt-2 space-y-1">
          {readOnly && (
            <div className="flex items-center gap-1.5 text-[12px] rounded-[10px] px-2.5 py-2 mb-2" style={{ backgroundColor: "#FBEDEA", border: "1px solid #EFD2CA", color: "#8A4038" }}>
              <Lock className="h-3.5 w-3.5 shrink-0" /> Read-only — edit in Google Calendar
            </div>
          )}

          {event.address && (
            <InfoRow icon={MapPin}>{event.address}</InfoRow>
          )}

          {event.builder && (
            <InfoRow icon={Briefcase}>{event.builder}</InfoRow>
          )}

          {event.crew && (
            <InfoRow icon={Calendar}>Crew: {event.crew}</InfoRow>
          )}

          {event.labor_amt != null && Number(event.labor_amt) !== 0 && (
            <InfoRow icon={FileText}>Labor: ${formatMoney(event.labor_amt)}</InfoRow>
          )}

          {event.scope_notes && (
            <InfoRow icon={FileText}>
              <div className="whitespace-pre-wrap">{event.scope_notes}</div>
            </InfoRow>
          )}

          {event.prerequisites && (
            <InfoRow icon={FileText}>
              <div className="whitespace-pre-wrap" style={{ color: C.textMuted }}>{event.prerequisites}</div>
            </InfoRow>
          )}

          {event.po_number && (
            <InfoRow icon={Briefcase}>PO: {event.po_number}{event.oe_number ? ` · OE: ${event.oe_number}` : ""}</InfoRow>
          )}

          {event.created_by && (
            <InfoRow icon={Calendar} sub="Created by">
              {event.created_by}
            </InfoRow>
          )}

          {event.job_id && (
            <div className="pt-2">
              <Link to={`/jobs/${event.job_id}`} className="inline-flex items-center gap-1.5 text-[10px] font-semibold tracking-[0.01em] px-3 py-1.5 rounded-full" style={{ border: `1px solid ${C.border}`, color: C.accentText }}>
                <Briefcase className="h-3 w-3" /> View job
              </Link>
            </div>
          )}
        </div>

        {/* Field report actions */}
        <div className="px-5 pb-5">
          <FieldReportActions event={event} user={user} onChanged={onChanged} />
        </div>
      </div>
    </div>
  );
}