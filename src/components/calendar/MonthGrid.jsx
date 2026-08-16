import { useMemo } from "react";
import { cn } from "@/lib/utils";

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

const INSTALL_BG = "#d6f5f0";
const INSTALL_BAR = "#0d9488";
const SERVICE_BG = "#fce4e4";
const SERVICE_BAR = "#c1625a";

function EventBlock({ event, onClick }) {
  const isInstall = event.source === "app";
  const bg = isInstall ? INSTALL_BG : SERVICE_BG;
  const bar = isInstall ? INSTALL_BAR : SERVICE_BAR;
  return (
    <button
      type="button"
      onClick={onClick}
      className="block w-full text-left rounded-[3px] px-1.5 py-0.5 text-[11px] leading-tight truncate transition-opacity hover:opacity-80"
      style={{ backgroundColor: bg, borderLeft: `3px solid ${bar}` }}
    >
      {event.start_time && (
        <span className="tabular-nums font-semibold mr-1" style={{ color: bar }}>
          {event.start_time}
        </span>
      )}
      <span className="text-foreground/90 truncate">{event.job_name}</span>
    </button>
  );
}

export default function MonthGrid({ month, events, onSelect, onCreateForDate }) {
  const weeks = useMemo(() => buildWeeks(month), [month]);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <div className="rounded-lg border border-border overflow-hidden bg-background">
      {/* Weekday header */}
      <div className="grid grid-cols-7 border-b border-border bg-muted/30">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="px-2 py-2 text-center text-[11px] uppercase tracking-wide font-semibold text-muted-foreground">
            {d}
          </div>
        ))}
      </div>

      {/* Calendar body */}
      <div className="grid grid-cols-7">
        {weeks.flat().map((day, i) => {
          const dateStr = day ? `${month}-${String(day).padStart(2, "0")}` : null;
          const dayEvents = dateStr ? events.filter((e) => (e.event_date || "").slice(0, 10) === dateStr) : [];
          const isToday = dateStr === today;
          const maxVisible = 3;
          const visible = dayEvents.slice(0, maxVisible);
          const overflow = dayEvents.length - visible.length;

          return (
            <div
              key={i}
              className={cn(
                "min-h-[110px] border-b border-r border-border p-1 align-top flex flex-col gap-0.5",
                !day && "bg-muted/30",
                (i % 7) === 6 && "border-r-0"
              )}
            >
              {day && (
                <>
                  <div className="flex items-center justify-between mb-0.5">
                    <span
                      className={cn(
                        "text-xs font-medium tabular-nums flex items-center justify-center",
                        isToday ? "bg-primary text-primary-foreground rounded-full h-5 w-5" : "text-muted-foreground h-5 px-1"
                      )}
                    >
                      {day}
                    </span>
                    <button
                      type="button"
                      onClick={() => onCreateForDate?.(dateStr)}
                      className="text-muted-foreground/40 hover:text-foreground text-sm leading-none px-0.5"
                      aria-label={`Add event on ${dateStr}`}
                    >
                      +
                    </button>
                  </div>
                  <div className="flex flex-col gap-0.5 min-h-0 flex-1">
                    {visible.map((e) => (
                      <EventBlock key={e.id} event={e} onClick={() => onSelect(e)} />
                    ))}
                    {overflow > 0 && (
                      <button
                        type="button"
                        onClick={() => {
                          const firstHidden = dayEvents[maxVisible];
                          if (firstHidden) onSelect(firstHidden);
                        }}
                        className="text-[10px] text-muted-foreground hover:text-foreground font-medium pl-1.5 pt-0.5 text-left"
                      >
                        +{overflow} more
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