import { useMemo } from "react";
import { Plus } from "lucide-react";
import { C } from "@/lib/feeUI";
import { weekDays, dayOf, byTime } from "@/lib/calendarModel";
import EventCard from "./EventCard";

// Sunday-to-Saturday week: seven columns from md up, stacked days on phones.
export default function WeekView({ day, events, today, onSelect, onSelectDay, onCreateForDate, selectedDay }) {
  const days = useMemo(() => weekDays(day), [day]);
  const byDay = useMemo(() => {
    const map = Object.fromEntries(days.map((d) => [d, []]));
    for (const e of events) { const d = dayOf(e); if (map[d]) map[d].push(e); }
    for (const d of days) map[d].sort(byTime);
    return map;
  }, [days, events]);

  return (
    <div className="rounded-[14px] overflow-hidden card-shadow" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
      <div className="grid grid-cols-1 md:grid-cols-7">
        {days.map((d, i) => {
          const [y, m, dd] = d.split("-").map(Number);
          const date = new Date(y, m - 1, dd);
          const isToday = d === today;
          const isSelected = d === selectedDay;
          const list = byDay[d];
          return (
            <section key={d} aria-label={date.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" })} className="min-w-0 flex flex-col"
              style={{ borderLeft: i ? `1px solid ${C.rowBorder}` : "none", borderTop: `1px solid ${C.rowBorder}`, backgroundColor: isSelected ? "#EEF5F3" : "transparent" }}>
              <div className="flex items-center justify-between gap-2 px-2.5 py-2" style={{ backgroundColor: isSelected ? "transparent" : C.headerBg, borderBottom: `1px solid ${C.rowBorder}` }}>
                <button type="button" onClick={() => onSelectDay?.(d)} className="flex items-baseline gap-1.5 min-h-9 rounded-md px-1 text-left" aria-pressed={isSelected}>
                  <span className="text-[11px] font-medium uppercase tracking-[0.06em]" style={{ color: C.textMuted }}>{date.toLocaleDateString("en-US", { weekday: "short" })}</span>
                  <span className="font-mono-num text-[15px] font-semibold inline-flex items-center justify-center rounded-full" style={isToday ? { backgroundColor: C.accent, color: "#fff", minWidth: 26, height: 26, padding: "0 6px" } : { color: C.text }}>{dd}</span>
                  <span className="md:hidden text-[12px]" style={{ color: C.textMuted }}>{date.toLocaleDateString("en-US", { month: "short" })}</span>
                </button>
                <button type="button" onClick={() => onCreateForDate?.(d)} aria-label={`Add event on ${d}`} className="inline-flex h-9 w-9 items-center justify-center rounded-full transition-colors hover:bg-[#F6F3EC]" style={{ color: C.textFaint }}>
                  <Plus className="h-4 w-4" />
                </button>
              </div>
              <div className="flex flex-col gap-1.5 p-1.5 md:min-h-[220px]">
                {list.length === 0 && <div className="hidden md:block text-center text-[11px] pt-4" style={{ color: C.textFaint }}>—</div>}
                {list.length === 0 && <div className="md:hidden px-1 pb-1 text-[12px]" style={{ color: C.textFaint }}>Nothing scheduled</div>}
                {list.map((e) => (
                  <div key={e.id}>
                    <div className="hidden md:block"><EventCard event={e} today={today} onSelect={onSelect} compact /></div>
                    <div className="md:hidden"><EventCard event={e} today={today} onSelect={onSelect} showJobLink /></div>
                  </div>
                ))}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
