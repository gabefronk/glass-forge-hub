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

export default function MonthGrid({ month, events, onSelect, onCreateForDate }) {
  const weeks = useMemo(() => buildWeeks(month), [month]);
  const today = new Date().toISOString().slice(0, 10);
  return (
    <div className="rounded-lg border border-border overflow-hidden">
      <div className="grid grid-cols-7 bg-background text-[11px] uppercase tracking-wide font-semibold text-muted-foreground border-b border-border">
        {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
          <div key={d} className="px-2 py-2 text-center">{d}</div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {weeks.flat().map((day, i) => {
          const dateStr = day ? `${month}-${String(day).padStart(2, "0")}` : null;
          const dayEvents = dateStr ? events.filter((e) => (e.event_date || "").slice(0, 10) === dateStr) : [];
          return (
            <div key={i} className={cn("min-h-[120px] border-b border-r border-border p-1.5 align-top", !day && "bg-muted/40")}>
              {day && (
                <>
                  <div className="flex items-center justify-between mb-1">
                    <span className={cn("text-xs font-medium", dateStr === today ? "bg-primary text-primary-foreground rounded-full h-5 w-5 flex items-center justify-center" : "text-muted-foreground")}>{day}</span>
                    <button type="button" onClick={() => onCreateForDate?.(dateStr)} className="text-muted-foreground/50 hover:text-foreground text-xs leading-none">+</button>
                  </div>
                  <div className="space-y-1">
                    {dayEvents.map((e) => (
                      <button
                        key={e.id}
                        type="button"
                        onClick={() => onSelect(e)}
                        className={cn(
                          "block w-full text-left text-xs px-1.5 py-1 rounded truncate border-l-2",
                          e.source === "app"
                            ? "bg-[#A1E9E6]/25 border-[#A1E9E6] hover:bg-[#A1E9E6]/40"
                            : "bg-[#F4C7D0]/30 border-[#F4C7D0] hover:bg-[#F4C7D0]/50"
                        )}
                      >
                        {e.start_time && <span className="tabular-nums mr-1 text-muted-foreground">{e.start_time}</span>}
                        <span className="text-foreground">{e.job_name}</span>
                      </button>
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