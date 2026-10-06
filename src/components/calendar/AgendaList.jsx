import { useEffect, useMemo, useRef } from "react";
import { C } from "@/lib/feeUI";
import { groupByDay, dayHeading } from "@/lib/calendarModel";
import EventCard from "./EventCard";

// The month as a day-by-day agenda. Scrolls to today (or the next day with
// visits) when the month is the current one.
export default function AgendaList({ events, today, onSelect, emptyText = "No events this month." }) {
  const days = useMemo(() => groupByDay(events), [events]);
  const anchor = useRef(null);
  const focusDay = days.find((g) => g.day >= today)?.day;

  useEffect(() => {
    if (anchor.current && focusDay && focusDay.slice(0, 7) === today.slice(0, 7)) {
      anchor.current.scrollIntoView({ block: "start", behavior: "auto" });
    }
  }, [focusDay, today]);

  if (!days.length) {
    return <div className="rounded-[14px] px-4 py-10 text-center text-[13px] card-shadow" style={{ border: `1px solid ${C.border}`, backgroundColor: C.card, color: C.textMuted }}>{emptyText}</div>;
  }
  return (
    <div className="flex flex-col gap-4">
      {days.map(({ day, events: list }) => (
        <section key={day} ref={day === focusDay ? anchor : undefined} style={{ scrollMarginTop: 16 }}>
          <div className="flex items-baseline justify-between gap-2 mb-2 px-1">
            <h3 className="text-[13px] font-semibold" style={{ color: day === today ? C.accent : C.text }}>{dayHeading(day, today)}</h3>
            <span className="font-mono-num text-[11px]" style={{ color: C.textMuted }}>{list.length} {list.length === 1 ? "visit" : "visits"}</span>
          </div>
          <div className="grid grid-cols-1 min-[700px]:grid-cols-2 xl:grid-cols-3 gap-2">
            {list.map((e) => <EventCard key={e.id} event={e} today={today} onSelect={onSelect} showJobLink />)}
          </div>
        </section>
      ))}
    </div>
  );
}
