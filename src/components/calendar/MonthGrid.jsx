import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { C } from "@/lib/feeUI";
import { denverDate } from "../../../base44/shared/billingCore.js";

function buildWeeks(month) {
  const [y, m] = month.split("-").map(Number);
  const startDay = new Date(y, m - 1, 1).getDay();
  const daysInMonth = new Date(y, m, 0).getDate();
  const cells = [];
  for (let i = 0; i < startDay; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);
  while (cells.length % 7 !== 0) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

const INSTALL_BG = "#EAF5EE";
const INSTALL_TEXT = "#166447";
const SERVICE_BG = "#FCEDEC";
const SERVICE_TEXT = "#A43432";

function eventColors(event) {
  if (event.source === "outlook") return {bg:"#F0E9FA", text:"#7042A1"};
  const isInstall = event.source === "app";
  return isInstall
    ? { bg: INSTALL_BG, text: INSTALL_TEXT }
    : { bg: SERVICE_BG, text: SERVICE_TEXT };
}

function isFlagged(ev) {
  return ev.report_required !== false &&
    ["pending", "missing_photos", "missing_notes", "missing_all"].includes(ev.report_status);
}

function isMovable(ev) {
  const gid = ev.google_event_id || "";
  return Boolean(gid) && !gid.startsWith("gfjobs");
}

function DesktopEventBlock({ event, onClick }) {
  const { bg, text } = eventColors(event);
  const flagged = isFlagged(event);
  const rescheduled = event.report_status === "rescheduled";
  const movable = isMovable(event);
  return (
    <button
      type="button"
      onClick={onClick}
      draggable={movable}
      onDragStart={movable ? (e) => {
        e.dataTransfer.setData("text/plain", JSON.stringify({ id: event.id, from: (event.event_date || "").slice(0, 10) }));
        e.dataTransfer.effectAllowed = "move";
      } : undefined}
      title={movable ? "Drag to another day to move this on Google Calendar" : undefined}
      className="block w-full text-left rounded-[4px] px-1.5 py-1 text-[11px] leading-tight truncate transition-opacity hover:opacity-80"
      style={{
        backgroundColor: bg,
        color: text,
        borderLeft: flagged ? "2px solid #A43432" : rescheduled ? "2px solid #C9CCC4" : "none",
        cursor: movable ? "grab" : undefined,
      }}
    >
      {event.start_time && (
        <span className="font-mono-num mr-1" style={{ color: text }}>
          {event.start_time}
        </span>
      )}
      <span className="truncate">{event.job_name}</span>
      {flagged && (
        <span className="inline-block w-1.5 h-1.5 rounded-full ml-1 align-middle shrink-0" style={{ backgroundColor: "#A43432" }} />
      )}
    </button>
  );
}

export default function MonthGrid({ month, events, onSelect, onCreateForDate, selectedDate, onSelectDay, onMoveEvent }) {
  const weeks = useMemo(() => buildWeeks(month), [month]);
  const today = denverDate();
  const [dropTarget, setDropTarget] = useState(null);

  return (
    <div className="rounded-[14px] overflow-hidden card-shadow" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
      {/* Weekday header */}
      <div className="grid grid-cols-7" style={{ borderBottom: `1px solid ${C.border}`, backgroundColor: C.headerBg }}>
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d, i) => (
          <div key={i} className="px-2 py-2.5 text-center mono-label-sm">
            <span className="md:inline hidden">{d}</span>
            <span className="md:hidden">{d[0]}</span>
          </div>
        ))}
      </div>

      {/* Calendar body */}
      <div className="grid grid-cols-7" style={{ gridTemplateColumns: "repeat(7, minmax(0, 1fr))" }}>
        {weeks.flat().map((day, i) => {
          const dateStr = day ? `${month}-${String(day).padStart(2, "0")}` : null;
          const dayEvents = dateStr ? events.filter((e) => (e.event_date || "").slice(0, 10) === dateStr) : [];
          const isToday = dateStr === today;
          const isSelected = dateStr === selectedDate;
          const isDropTarget = dateStr && dropTarget === dateStr;

          return (
            <div
              key={i}
              className={cn(
                "align-top flex flex-col p-1 min-w-0",
                "min-h-[84px] md:min-h-[110px]",
                !day && "opacity-30",
              )}
              onDragOver={dateStr ? (e) => {
                if (e.dataTransfer.types.includes("text/plain")) {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  if (dropTarget !== dateStr) setDropTarget(dateStr);
                }
              } : undefined}
              onDragLeave={dateStr ? () => { if (dropTarget === dateStr) setDropTarget(null); } : undefined}
              onDrop={dateStr ? (e) => {
                e.preventDefault();
                setDropTarget(null);
                try {
                  const payload = JSON.parse(e.dataTransfer.getData("text/plain") || "{}");
                  if (payload.id && payload.from && payload.from !== dateStr) onMoveEvent?.(payload.id, dateStr, payload.from);
                } catch { /* not a calendar drag */ }
              } : undefined}
              style={{
                borderTop: `1px solid ${C.rowBorder}`,
                borderRight: (i % 7) !== 6 ? `1px solid ${C.rowBorder}` : "none",
                backgroundColor: isDropTarget ? "#DFF0E6" : isSelected ? "#EAF5EE" : "transparent",
                boxShadow: isDropTarget ? "inset 0 0 0 2px #166447" : isSelected ? "inset 0 0 0 2px #146556" : "none",
              }}
            >
              {day && (
                <>
                  <div className="flex items-center justify-between mb-1">
                    <button
                      type="button"
                      onClick={() => onSelectDay?.(dateStr)}
                      className="font-mono-num text-[12px] flex min-h-11 w-full items-center justify-center rounded-full transition-colors md:min-h-8 md:w-8"
                      style={isToday ? { backgroundColor: C.accent, color: C.accentDark } : { color: C.textSecondary }}
                      aria-label={`${dateStr}, ${dayEvents.length} ${dayEvents.length === 1 ? "event" : "events"}`}
                      aria-pressed={isSelected}
                    >
                      {day}
                    </button>
                    <button
                      type="button"
                      onClick={() => onCreateForDate?.(dateStr)}
                      className="hidden h-8 w-8 items-center justify-center text-[14px] leading-none transition-colors md:inline-flex"
                      style={{ color: C.textFaint }}
                      aria-label={`Add event on ${dateStr}`}
                    >
                      +
                    </button>
                  </div>

                  {/* Mobile: one day target opens the full event list below. */}
                  <button type="button" onClick={() => onSelectDay?.(dateStr)} className="flex min-h-7 flex-1 flex-wrap content-start items-start justify-center gap-1 md:hidden" aria-label={`Show ${dayEvents.length} events on ${dateStr}`}>
                    {dayEvents.map((e) => {
                      const { text } = eventColors(e);
                      const flagged = isFlagged(e);
                      const rescheduled = e.report_status === "rescheduled";
                      const dotColor = flagged ? "#A43432" : rescheduled ? "#C9CCC4" : text;
                      return (
                        <span key={e.id} className="h-1.5 w-1.5 rounded-full shrink-0" style={{ backgroundColor: dotColor }} aria-hidden="true" />
                      );
                    })}
                  </button>

                  {/* Desktop: full text blocks */}
                  <div className="hidden md:flex flex-col gap-0.5 min-h-0 flex-1">
                    {dayEvents.map((e) => (
                      <DesktopEventBlock key={e.id} event={e} onClick={() => onSelect(e)} />
                    ))}
                  </div>
                </>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}