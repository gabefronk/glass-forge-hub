import { C } from "@/lib/feeUI";

// 30-day posts-per-day histogram: UTC bucket vs America/Denver bucket.
// If the Denver column is empty on a working day but the UTC column is fat
// the next day, the timezone conversion is not being applied.
export default function PostsHistogram({ data }) {
  if (!data || !data.length) return null;
  const max = Math.max(...data.flatMap((d) => [d.utc, d.denver]), 1);

  return (
    <div className="rounded-[16px] p-5 mb-5" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
      <div className="flex items-center justify-between mb-4">
        <h3 className="font-heading text-[14px] font-semibold" style={{ color: C.text }}>Posts per day (30 days)</h3>
        <div className="flex items-center gap-3 text-[11px]">
          <span className="inline-flex items-center gap-1.5" style={{ color: C.textSecondary }}>
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: "rgba(255,255,255,.25)" }} />UTC
          </span>
          <span className="inline-flex items-center gap-1.5" style={{ color: C.textSecondary }}>
            <span className="h-2.5 w-2.5 rounded-sm" style={{ backgroundColor: C.accent }} />Denver
          </span>
        </div>
      </div>
      <div className="flex items-end gap-[2px] h-[100px]">
        {data.map((d) => {
          const utcH = (d.utc / max) * 100;
          const denH = (d.denver / max) * 100;
          const isTarget = d.date === (data.find((x) => x)?.targetDate);
          return (
            <div key={d.date} className="flex-1 flex flex-col items-center gap-[1px] min-w-0 group relative">
              <div className="flex items-end gap-[1px] w-full h-full justify-center">
                <div className="rounded-t-[2px] transition-all" style={{ width: "40%", height: `${utcH}%`, backgroundColor: "rgba(255,255,255,.25)", minHeight: d.utc > 0 ? "2px" : "0" }} />
                <div className="rounded-t-[2px] transition-all" style={{ width: "40%", height: `${denH}%`, backgroundColor: C.accent, minHeight: d.denver > 0 ? "2px" : "0" }} />
              </div>
              <div className="absolute -top-8 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap rounded-md px-2 py-1 font-mono text-[10px] z-10" style={{ backgroundColor: C.cardAlt, color: C.text, border: `1px solid ${C.border}` }}>
                {d.date.slice(5)} · UTC {d.utc} · Den {d.denver}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex gap-[2px] mt-1">
        {data.map((d) => (
          <div key={d.date} className="flex-1 text-center font-mono text-[7px] whitespace-nowrap" style={{ color: C.textFaint }}>
            {d.date.slice(5) === "01" || d.date.slice(5) === "15" ? d.date.slice(5) : ""}
          </div>
        ))}
      </div>
    </div>
  );
}