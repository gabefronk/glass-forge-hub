import { useMemo } from "react";
import { cn } from "@/lib/utils";
import { C } from "@/lib/feeUI";

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

const INSTALL_BG = "#E7EEFA";
const INSTALL_TEXT = "#1E4A85";
const SERVICE_BG = "#FBEDEA";
const SERVICE_TEXT = "#8A4038";

function eventColors(event) {
  const isInstall = event.source === "app";
  return isInstall
    ? { bg: INSTALL_BG, text: INSTALL_TEXT }
    : { bg: SERVICE_BG, text: SERVICE_TEXT };
}

function isFlagged(ev) {
  return ev.report_required !== false &&
    ["pending", "missing_photos", "missing_notes", "missing_all"].includes(ev.report_status);
}

function DesktopEventBlock({ event, onClick }) {
  const { bg, text } = eventColors(event);
  const flagged = isFlagged(event);
  const rescheduled = event.report_status === "rescheduled";
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full text-left rounded-[4px] px-1.5 py-1 text-[11px] leading-tight truncate transition-opacity hover:opacity-80"
      style={{
        backgroundColor: bg,
        color: text,
        borderLeft: flagged ? "2px solid #8A4038" : rescheduled ? "2px solid #CBD4E1" : "none",
      }}
    >
      {event.start_time && (
        <span className="font-mono-num mr-1" style={{ color: text }}>
          {event.start_time}
        </span>
      )}
      <span className="truncate">{event.job_name}</span>
      {flagged && (
        <span className="inline-block w-1.5 h-1.5 rounded-full ml-1 align-middle shrink-0" style={{ backgroundColor: "#8A4038" }} />
      )}
    </button>
  );
}

export default function MonthGrid({ month, events, onSelect, onCreateForDate, selectedDate, onSelectDay }) {
  const weeks = useMemo(() => buildWeeks(month), [month]);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="rounded-[14px] overflow-hidden card-shadow" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
      {/* Weekday header */}
      <div className="grid grid-cols-7" style={{ borderBottom: `1px solid ${C.border}`, backgroundColor: C.headerBg }}>
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d, i) => (
          <div key={i} className="px-2 py-2.5 text-center mono-label-sm">
            <span className="min-[700px]:inline hidden">{d}</span>
            <span className="min-[700px]:hidden">{d[0]}</span>
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

          return (
            <div
              key={i}
              className={cn(
                "align-top flex flex-col p-1 min-w-0",
                "min-h-[104px] min-[700px]:min-h-[110px]",
                !day && "opacity-30",
              )}
              style={{
                borderTop: `1px solid ${C.rowBorder}`,
                borderRight: (i % 7) !== 6 ? `1px solid ${C.rowBorder}` : "none",
                backgroundColor: isSelected ? "#E7EEFA" : "transparent",
                boxShadow: isSelected ? "inset 0 0 0 2px #2A5EA8" : "none",
              }}
            >
              {day && (
                <>
                  <div className="flex items-center justify-between mb-1">
                    <button
                      type="button"
                      onClick={() => onSelectDay?.(dateStr)}
                      className="font-mono-num text-[12px] flex items-center justify-center transition-colors"
                      style={
                        isToday
                          ? { backgroundColor: C.accent, color: C.accentDark, borderRadius: "99px", height: "22px", width: "22px" }
                          : { color: C.textSecondary, height: "22px", minWidth: "22px" }
                      }
                    >
                      {day}
                    </button>
                    <button
                      type="button"
                      onClick={() => onCreateForDate?.(dateStr)}
                      className="text-[14px] leading-none px-0.5 transition-colors"
                      style={{ color: C.textFaint }}
                      aria-label={`Add event on ${dateStr}`}
                    >
                      +
                    </button>
                  </div>

                  {/* Mobile: density dots */}
                  <div className="flex flex-col gap-1 min-h-0 flex-1 min-[700px]:hidden">
                    {dayEvents.map((e) => {
                      const { text } = eventColors(e);
                      const flagged = isFlagged(e);
                      const rescheduled = e.report_status === "rescheduled";
                      const dotColor = flagged ? "#8A4038" : rescheduled ? "#CBD4E1" : text;
                      return (
                        <button key={e.id} type="button" onClick={() => onSelect(e)} className="h-1.5 w-1.5 rounded-full shrink-0 self-start" style={{ backgroundColor: dotColor }} aria-label={e.job_name} />
                      );
                    })}
                  </div>

                  {/* Desktop: full text blocks */}
                  <div className="hidden min-[700px]:flex flex-col gap-0.5 min-h-0 flex-1">
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