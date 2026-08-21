import { C } from "@/lib/feeUI";
import { formatMoney } from "@/lib/feeMath";

function HeroCard({ label, value, color, sublabel, isPercent }) {
  return (
    <div
      className="rounded-lg p-5 flex flex-col gap-1"
      style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}
    >
      <span className="text-xs font-medium uppercase tracking-wider" style={{ color: C.mutedText }}>
        {label}
      </span>
      <span className="text-3xl font-bold tabular-nums" style={{ color }}>
        {isPercent ? `${formatMoney(value)}%` : `$${formatMoney(value)}`}
      </span>
      {sublabel && (
        <span className="text-xs" style={{ color: C.mutedText }}>{sublabel}</span>
      )}
    </div>
  );
}

export default function ProfitSummaryCards({ profits }) {
  const year = new Date().getFullYear();
  const ytd = profits.filter((p) => (p.month || "").startsWith(String(year)));
  const yaYtd = ytd.reduce((s, p) => s + (Number(p.ya_windows_profit) || 0), 0);
  const gfYtd = ytd.reduce((s, p) => s + (Number(p.glass_forge_profit) || 0), 0);
  const monthCount = ytd.length;
  const yaAvg = monthCount ? yaYtd / monthCount : 0;
  const gfAvg = monthCount ? gfYtd / monthCount : 0;

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      <HeroCard label={`YA Windows ${year}`} value={yaYtd} color={C.accent} sublabel={`Avg $${formatMoney(yaAvg)}/mo`} />
      <HeroCard label={`Glass Forge ${year}`} value={gfYtd} color="#8a5a12" sublabel={`Avg $${formatMoney(gfAvg)}/mo`} />
      <HeroCard label="Months Tracked" value={monthCount} color={C.text} sublabel={monthCount ? `${year} year-to-date` : "No data yet"} />
      <HeroCard
        label="YA / GF Ratio"
        value={gfYtd && yaYtd ? (gfYtd / yaYtd) * 100 : 0}
        color={C.text}
        sublabel="GF profit as % of YA profit"
        isPercent
      />
    </div>
  );
}