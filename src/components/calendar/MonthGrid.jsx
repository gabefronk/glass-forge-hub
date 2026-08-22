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

const INSTALL_BG = "rgba(110,231,192,.13)";
const INSTALL_TEXT = "#6EE7C0";
const SERVICE_BG = "rgba(255,138,122,.13)";
const SERVICE_TEXT = "#FF8A7A";

function eventColors(event) {
  const isInstall = event.source === "app";
  return isInstall
    ? { bg: INSTALL_BG, text: INSTALL_TEXT }
    : { bg: SERVICE_BG, text: SERVICE_TEXT };
}

// Desktop: full text block with time + job name
function DesktopEventBlock({ event, onClick }) {
  const { bg, text } = eventColors(event);
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full text-left rounded-[4px] px-1.5 py-1 text-[11px] leading-tight truncate transition-opacity hover:opacity-80"
      style={{ backgroundColor: bg, color: text }}
    >
      {event.start_time && (
        <span className="font-mono-num mr-1" style={{ color: text }}>
          {event.start_time}
        </span>
      )}
      <span className="truncate">{event.job_name}</span>
    </button>
  );
}

export default function MonthGrid({ month, events, onSelect, onCreateForDate, selectedDate, onSelectDay }) {
  const weeks = useMemo(() => buildWeeks(month), [month]);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="rounded-[16px] overflow-hidden" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
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
          const maxDesktop = 3;
          const desktopVisible = dayEvents.slice(0, maxDesktop);
          const desktopOverflow = dayEvents.length - desktopVisible.length;
          const mobileVisible = dayEvents.slice(0, 3);
          const mobileOverflow = dayEvents.length - mobileVisible.length;

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
                backgroundColor: isSelected ? "rgba(110,231,192,.10)" : "transparent",
                boxShadow: isSelected ? "inset 0 0 0 2px #6EE7C0" : "none",
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
                    {mobileVisible.map((e) => {
                      const { text } = eventColors(e);
                      return (
                        <button key={e.id} type="button" onClick={() => onSelect(e)} className="h-1.5 w-1.5 rounded-full shrink-0 self-start" style={{ backgroundColor: text }} aria-label={e.job_name} />
                      );
                    })}
                    {mobileOverflow > 0 && (
                      <span className="font-mono text-[9px] leading-none pt-0.5" style={{ color: C.textFaint }}>
                        +{mobileOverflow}
                      </span>
                    )}
                  </div>

                  {/* Desktop: full text blocks */}
                  <div className="hidden min-[700px]:flex flex-col gap-0.5 min-h-0 flex-1">
                    {desktopVisible.map((e) => (
                      <DesktopEventBlock key={e.id} event={e} onClick={() => onSelect(e)} />
                    ))}
                    {desktopOverflow > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          const firstHidden = dayEvents[maxDesktop];
                          if (firstHidden) onSelect(firstHidden);
                        }}
                        className="font-mono text-[10px] text-left pl-1 pt-0.5 transition-colors hover:opacity-80"
                        style={{ color: C.textMuted }}
                      >
                        +{desktopOverflow} more
                      </button>
                    )}
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