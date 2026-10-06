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

// "This month" achievement card: animated progress bar toward a sample monthly
// goal, with a highlighted segment for this job, plus a 6-month bar chart.
export default function MonthAchievement({ thisJob = 24900 }) {
  const job = Number(thisJob) || 0;
  const total = BOOKED + job;
  const pct = Math.min(100, Math.round((total / GOAL) * 100));
  const bookedPct = (BOOKED / GOAL) * 100;
  const jobPct = Math.min(100 - bookedPct, (job / GOAL) * 100);
  const [on, setOn] = useState(false);
  useEffect(() => { const t = setTimeout(() => setOn(true), 60); return () => clearTimeout(t); }, []);
  const animatedPct = useCountUp(pct, 1100);
  const max = Math.max(...MONTHS.map((x) => x.v), total);
  return (
    <div className="rounded-[14px] bg-white p-5" style={{ border: "1px solid #d3cabb", boxShadow: "0 1px 2px rgba(10,29,31,.08),0 6px 14px -6px rgba(10,29,31,.16)" }}>
      <div className="flex items-center gap-2">
        <TrendingUp size={16} style={{ color: "#0b3f3b" }} />
        <h3 className="m-0 text-[15px] font-bold" style={{ color: "#082f2c" }}>This month</h3>
        <span className="ml-auto text-[12px] font-semibold" style={{ color: "#616a6d" }}>Goal {cur(GOAL)}</span>
      </div>

      <div className="mt-3 h-3 w-full overflow-hidden rounded-full" style={{ backgroundColor: "#f4f1ea", border: "1px solid #e0dacf" }}>
        <div className="flex h-full">
          <div style={{ width: on ? `${bookedPct}%` : "0%", transition: "width 1s cubic-bezier(.2,.8,.2,1)", backgroundColor: "#3b8c7a" }} />
          <div style={{ width: on ? `${jobPct}%` : "0%", transition: "width 1.1s cubic-bezier(.2,.8,.2,1) .2s", backgroundColor: "#b8955a" }} />
        </div>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-[12px]">
        <Legend color="#3b8c7a" label={`Booked ${cur(BOOKED)}`} />
        <Legend color="#b8955a" label={`This job ${cur(job)}`} />
        <span className="ml-auto font-bold" style={{ color: "#0b3f3b" }}>{Math.round(animatedPct)}% of goal</span>
      </div>

      <p className="mt-2 text-[13px] font-semibold" style={{ color: "#082f2c" }}>
        This sale moves you to <strong>{pct}%</strong> of your {cur(GOAL)} goal.
      </p>

      <div className="mt-4 flex items-end gap-2" style={{ height: 84 }}>
        {MONTHS.concat([{ m: "Oct", v: total, current: true }]).map((x) => {
          const h = (x.v / max) * 100;
          return (
            <div key={x.m} className="flex flex-1 flex-col items-center gap-1">
              <div className="flex w-full items-end justify-center" style={{ height: 64 }}>
                <div className="w-full max-w-[26px] rounded-t-[4px]" style={{ height: on ? `${h}%` : "0%", transition: "height .9s cubic-bezier(.2,.8,.2,1)", backgroundColor: x.current ? "#b8955a" : "#c7e4d2" }} />
              </div>
              <span className="text-[10px] font-semibold" style={{ color: x.current ? "#0b3f3b" : "#8a8f93" }}>{x.m}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Legend({ color, label }) {
  return <span className="inline-flex items-center gap-1.5" style={{ color: "#566063" }}><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: color }} />{label}</span>;
}