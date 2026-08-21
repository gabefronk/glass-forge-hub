import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from "recharts";
import { C } from "@/lib/feeUI";
import { formatMoney } from "@/lib/feeMath";

const YA_COLOR = "#1f5049";
const GF_COLOR = "#c4a55a";

function monthLabel(monthStr) {
  if (!monthStr) return "";
  const [y, m] = monthStr.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "short", year: "2-digit" });
}

function CustomTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg p-3 text-xs" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
      <div className="font-semibold mb-1" style={{ color: C.text }}>{label}</div>
      {payload.map((p) => (
        <div key={p.dataKey} className="flex items-center gap-2 tabular-nums">
          <span className="w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: p.color }} />
          <span style={{ color: C.mutedText }}>{p.name}:</span>
          <span className="font-medium" style={{ color: C.text }}>${formatMoney(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

export default function ProfitChart({ data }) {
  if (!data.length) {
    return (
      <div className="flex items-center justify-center h-64 text-sm" style={{ color: C.mutedText }}>
        No monthly data yet — add your first month below.
      </div>
    );
  }
  const chartData = [...data]
    .sort((a, b) => a.month.localeCompare(b.month))
    .map((p) => ({
      month: monthLabel(p.month),
      "YA Windows": Number(p.ya_windows_profit) || 0,
      "Glass Forge": Number(p.glass_forge_profit) || 0,
    }));

  return (
    <div style={{ width: "100%", height: 320 }}>
      <ResponsiveContainer>
        <BarChart data={chartData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={C.border} vertical={false} />
          <XAxis dataKey="month" tick={{ fontSize: 12, fill: C.mutedText }} axisLine={{ stroke: C.border }} tickLine={false} />
          <YAxis tick={{ fontSize: 12, fill: C.mutedText }} axisLine={false} tickLine={false} tickFormatter={(v) => `$${(v / 1000).toFixed(0)}k`} />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: C.mutedBg }} />
          <Legend wrapperStyle={{ fontSize: 12, paddingTop: 8 }} />
          <Bar dataKey="YA Windows" fill={YA_COLOR} radius={[4, 4, 0, 0]} maxBarSize={48} />
          <Bar dataKey="Glass Forge" fill={GF_COLOR} radius={[4, 4, 0, 0]} maxBarSize={48} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}