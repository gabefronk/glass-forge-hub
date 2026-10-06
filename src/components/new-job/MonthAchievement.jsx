import { useEffect, useState } from "react";
import { TrendingUp } from "lucide-react";
import { useCountUp } from "./useCountUp";

const GOAL = 120000;
const BOOKED = 78000;
const MONTHS = [
  { m: "May", v: 68000 },
  { m: "Jun", v: 91000 },
  { m: "Jul", v: 74000 },
  { m: "Aug", v: 103000 },
  { m: "Sep", v: 88000 },
];
const cur = (v) => Math.round(v).toLocaleString("en-US", { style: "currency", currency: "USD" });

// "This month" achievement: animated progress bar toward a sample goal with a
// highlighted segment for this job, plus a compact 6-month bar chart.
export default function MonthAchievement({ thisJob = 24900 }) {
  const job = Number(thisJob) || 0;
  const total = BOOKED + job;
  const pct = Math.min(100, Math.round((total / GOAL) * 100));
  const bookedPct = (BOOKED / GOAL) * 100;
  const jobPct = Math.min(100 - bookedPct, (job / GOAL) * 100);
  const [on, setOn] = useState(false);
  useEffect(() => { const t = setTimeout(() => setOn(true), 60); return () => clearTimeout(t); }, []);
  const animatedPct = useCountUp(pct, 1000);
  const max = Math.max(...MONTHS.map((x) => x.v), total);
  return (
    <div className="rounded-[14px] bg-white p-4" style={{ border: "1px solid #e0dacf", boxShadow: "0 1px 2px rgba(10,29,31,.06),0 6px 14px -8px rgba(10,29,31,.14)" }}>
      <div className="flex items-center gap-1.5">
        <TrendingUp size={14} style={{ color: "#0b3f3b" }} />
        <h3 className="m-0 text-[13px] font-bold" style={{ color: "#082f2c" }}>This month</h3>
        <span className="ml-1.5 rounded-full px-1.5 py-0.5 text-[9px] font-bold tracking-[.1em]" style={{ backgroundColor: "#faf0da", color: "#6f4e10", border: "1px solid #efdfb7" }}>SAMPLE</span>
        <span className="ml-auto text-[11px] font-semibold" style={{ color: "#8a8f93" }}>Goal {cur(GOAL)}</span>
      </div>

      <div className="mt-2.5 h-2.5 w-full overflow-hidden rounded-full" style={{ backgroundColor: "#f4f1ea", border: "1px solid #e0dacf" }}>
        <div className="flex h-full">
          <div style={{ width: on ? `${bookedPct}%` : "0%", transition: "width 1s cubic-bezier(.2,.8,.2,1)", backgroundColor: "#3b8c7a" }} />
          <div style={{ width: on ? `${jobPct}%` : "0%", transition: "width 1.1s cubic-bezier(.2,.8,.2,1) .2s", backgroundColor: "#b8955a" }} />
        </div>
      </div>

      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px]">
        <Legend color="#3b8c7a" label={`Booked ${cur(BOOKED)}`} />
        <Legend color="#b8955a" label={`This job ${cur(job)}`} />
        <span className="ml-auto font-bold" style={{ color: "#0b3f3b" }}>{Math.round(animatedPct)}%</span>
      </div>

      <p className="mt-1.5 text-[12px] font-semibold" style={{ color: "#082f2c" }}>This sale moves you to <strong>{pct}%</strong> of goal.</p>
      <p className="mt-0.5 text-[10.5px]" style={{ color: "#8a8f93" }}>Sample — goal, booked and chart numbers are placeholders until real monthly data is wired.</p>

      <div className="mt-2.5 flex items-end gap-1.5" style={{ height: 56 }}>
        {MONTHS.concat([{ m: "Oct", v: total, current: true }]).map((x) => {
          const h = (x.v / max) * 100;
          return (
            <div key={x.m} className="flex flex-1 flex-col items-center gap-0.5">
              <div className="flex w-full items-end justify-center" style={{ height: 44 }}>
                <div className="w-full max-w-[20px] rounded-t-[3px]" style={{ height: on ? `${h}%` : "0%", transition: "height .9s cubic-bezier(.2,.8,.2,1)", backgroundColor: x.current ? "#b8955a" : "#c7e4d2" }} />
              </div>
              <span className="text-[9px] font-semibold" style={{ color: x.current ? "#0b3f3b" : "#8a8f93" }}>{x.m}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Legend({ color, label }) {
  return <span className="inline-flex items-center gap-1.5" style={{ color: "#566063" }}><span className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />{label}</span>;
}