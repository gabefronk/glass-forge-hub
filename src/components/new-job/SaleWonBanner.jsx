import { useEffect } from "react";
import confetti from "canvas-confetti";
import { Sparkles } from "lucide-react";
import { useCountUp } from "./useCountUp";

const cur = (v) => Math.round(v).toLocaleString("en-US", { style: "currency", currency: "USD" });

// Hero "Sale won" banner: three aligned tiles, count-up numbers, vivid green
// profit tile, subtle gold/green confetti burst on arrival.
export default function SaleWonBanner({ cost, sale, profit, profitPct }) {
  const c = useCountUp(Number(cost) || 0);
  const s = useCountUp(Number(sale) || 0);
  const p = useCountUp(Number(profit) || 0);
  useEffect(() => {
    const fire = (x) => confetti({
      particleCount: 50, spread: 60, startVelocity: 30, origin: { x, y: 0.8 },
      colors: ["#b8955a", "#e0c994", "#0b3f3b", "#166447"], scalar: 0.65, ticks: 160, disableForReducedMotion: true,
    });
    fire(0.3); const t = setTimeout(() => fire(0.7), 120);
    return () => clearTimeout(t);
  }, []);
  return (
    <div className="rounded-[14px] p-4" style={{ background: "linear-gradient(160deg,#0b3f3b 0%,#082f2c 100%)", border: "1px solid #b8955a", boxShadow: "0 18px 40px -24px rgba(10,29,31,.7)" }}>
      <div className="flex items-center gap-1.5">
        <Sparkles size={15} style={{ color: "#e0c994" }} />
        <span className="text-[10px] font-bold tracking-[.18em]" style={{ color: "#e0c994" }}>SALE WON</span>
      </div>
      <div className="mt-2 grid grid-cols-3 gap-2">
        <Tile label="Cost" value={cur(c)} color="#f2eee8" />
        <Tile label="Sale" value={cur(s)} color="#f2eee8" />
        <Tile label="Profit" value={cur(p)} color="#ffffff" sub={`${(Number(profitPct) * 100).toFixed(1)}%`} profit />
      </div>
    </div>
  );
}

function Tile({ label, value, color, sub, profit }) {
  return (
    <div className="rounded-[10px] p-2.5" style={{ backgroundColor: profit ? "rgba(22,100,71,.42)" : "rgba(255,255,255,.06)", border: profit ? "1px solid #7fd9b6" : "1px solid rgba(255,255,255,.1)" }}>
      <div className="text-[9px] font-bold tracking-[.14em]" style={{ color: profit ? "#c9f5e0" : "#9fc3b6" }}>{label.toUpperCase()}</div>
      <div className="mt-0.5 text-[24px] font-extrabold tabular-nums sm:text-[30px]" style={{ color, letterSpacing: "-0.03em" }}>{value}</div>
      {sub && <div className="mt-0.5 text-[11px] font-bold" style={{ color: profit ? "#7fd9b6" : "#9fc3b6" }}>{sub}</div>}
    </div>
  );
}