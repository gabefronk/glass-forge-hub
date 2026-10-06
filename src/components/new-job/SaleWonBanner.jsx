import { useEffect } from "react";
import confetti from "canvas-confetti";
import { Sparkles } from "lucide-react";
import { useCountUp } from "./useCountUp";

const cur = (v) => Math.round(v).toLocaleString("en-US", { style: "currency", currency: "USD" });

// Hero "Sale won" banner: three aligned tiles with count-up numbers, green
// profit, and a subtle gold/green confetti burst on arrival.
export default function SaleWonBanner({ cost, sale, profit, profitPct }) {
  const c = useCountUp(Number(cost) || 0);
  const s = useCountUp(Number(sale) || 0);
  const p = useCountUp(Number(profit) || 0);
  useEffect(() => {
    const fire = (x) => confetti({
      particleCount: 60, spread: 65, startVelocity: 32, origin: { x, y: 0.75 },
      colors: ["#b8955a", "#e0c994", "#0b3f3b", "#166447"], scalar: 0.7, ticks: 180, disableForReducedMotion: true,
    });
    fire(0.28); const t = setTimeout(() => fire(0.72), 130);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="rounded-[14px] p-5" style={{ background: "linear-gradient(160deg,#0b3f3b 0%,#082f2c 100%)", border: "1px solid #b8955a", boxShadow: "0 20px 44px -26px rgba(10,29,31,.7)" }}>
      <div className="flex items-center gap-2">
        <Sparkles size={18} style={{ color: "#e0c994" }} />
        <span className="text-[11px] font-semibold tracking-[.16em]" style={{ color: "#e0c994" }}>SALE WON</span>
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 sm:gap-3">
        <Tile label="What it costs me" value={cur(c)} color="#f2eee8" />
        <Tile label="What I charge" value={cur(s)} color="#f2eee8" />
        <Tile label="What I keep" value={cur(p)} color="#7fd9b6" sub={`${(Number(profitPct) * 100).toFixed(1)}% margin`} />
      </div>
    </div>
  );
}

function Tile({ label, value, color, sub }) {
  return (
    <div className="rounded-[10px] p-3" style={{ backgroundColor: "rgba(255,255,255,.06)", border: "1px solid rgba(255,255,255,.1)" }}>
      <div className="text-[9.5px] font-semibold tracking-[.12em] sm:text-[10px]" style={{ color: "#9fc3b6" }}>{label.toUpperCase()}</div>
      <div className="mt-1 text-[22px] font-extrabold tabular-nums sm:text-[28px]" style={{ color, letterSpacing: "-0.02em" }}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] font-semibold" style={{ color: "#7fd9b6" }}>{sub}</div>}
    </div>
  );
}