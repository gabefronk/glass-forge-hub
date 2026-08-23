import { useState } from "react";
import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Lock, Briefcase } from "lucide-react";
import EventForm from "./EventForm";
import FieldReportActions from "./FieldReportActions";
import { formatMoney } from "@/lib/feeMath";
import { cn } from "@/lib/utils";

function Detail({ label, value }) {
  return (
    <div>
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-sm">{value || "—"}</div>
    </div>
  );
}

export default function EventDetail({ event, jobs, onEdit, onDelete, onClose, saving, user, onChanged }) {
  const [editing, setEditing] = useState(false);
  if (editing && event.source === "app") {
    return <EventForm initial={event} jobs={jobs} onSave={onEdit} onCancel={() => setEditing(false)} saving={saving} />;
  }
  const readOnly = event.source === "google";
  return (
    <div className="rounded-lg border border-border bg-card p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold">{event.job_name}</div>
          <div className="text-sm text-muted-foreground">{event.event_date}{event.start_time ? ` · ${event.start_time}` : ""}</div>
        </div>
        <div className="flex items-center gap-2">
          <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.13em] px-2 py-0.5 rounded-full whitespace-nowrap" style={{ backgroundColor: event.source === "app" ? "rgba(110,231,192,.14)" : "rgba(255,255,255,.06)", color: event.source === "app" ? "#6EE7C0" : "rgba(255,255,255,.62)" }}>
            {event.source === "app" ? "App" : "Google"}
          </span>
          {event.job_id && (
            <Link to={`/jobs/${event.job_id}`} className="inline-flex items-center gap-1 text-xs font-medium text-accent hover:underline">
              <Briefcase className="h-3 w-3" />
              View Job
            </Link>
          )}
          <Button variant="ghost" size="sm" onClick={onClose}>Close</Button>
        </div>
      </div>
      {readOnly && (
        <div className="flex items-center gap-1.5 text-xs rounded-[10px] px-2.5 py-1.5" style={{ backgroundColor: "rgba(255,138,122,.10)", color: "#FF8A7A" }}>
          <Lock className="h-3.5 w-3.5" /> Read-only — created in Google Calendar. Edit it there, not here.
        </div>
      )}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        <Detail label="Builder" value={event.builder} />
        <Detail label="Crew" value={event.crew} />
        <Detail label="Address" value={event.address} />
        <Detail label="Labor $" value={event.labor_amt != null ? `$${formatMoney(event.labor_amt)}` : ""} />
      </div>
      <FieldReportActions event={event} user={user} onChanged={onChanged} />
      {event.scope_notes && (
        <div>
          <div className="text-xs text-muted-foreground mb-1">Scope notes</div>
          <div className="whitespace-pre-wrap text-sm">{event.scope_notes}</div>
        </div>
      )}
      {event.prerequisites && (
        <div>
          <div className="text-xs text-muted-foreground mb-1">Prerequisites</div>
          <div className="whitespace-pre-wrap text-sm">{event.prerequisites}</div>
        </div>
      )}
      {!readOnly && (
        <div className="flex justify-end gap-2 pt-1">
          <Button variant="destructive" size="sm" onClick={onDelete}>Delete</Button>
          <Button size="sm" onClick={() => setEditing(true)}>Edit</Button>
        </div>
      )}
    </div>
  );
}