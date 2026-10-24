import { formatMoney } from "@/lib/feeMath";

// QuickBooks-style money bar: one strip from "waiting on a report" to "paid". Each part
// shows the labor (what goes on the BFS invoice) and the fee (your share). Totals only;
// the toolbar's Show dropdown is the one filter (same buckets). Replaces the tall card.
const TONES = {
  muted: { rule: "#9A9080", text: "#34403F" },
  amber: { rule: "#C08B2E", text: "#6F4E10" },
  teal: { rule: "#0B3F3B", text: "#0B3F3B" },
  ink: { rule: "#34403F", text: "#101617" },
  green: { rule: "#166447", text: "#166447" },
};

export default function InvoiceMoneyBar({ segments, monthEarnedTotal, monthEarnedCount, month, notes }) {
  const [y, m] = String(month || "").split("-").map(Number);
  const monthName = y ? new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "long" }) : "";
  return (
    <section aria-label="Billing money bar" className="mt-4 overflow-hidden rounded-[12px] bg-white" style={{ border: "1px solid #B3A792" }}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-2" style={{ backgroundColor: "#0B3F3B" }}>
        <span className="text-[12px] font-bold uppercase tracking-[0.08em]" style={{ color: "#E0C994" }}>{monthName} · done and reported</span>
        <span className="font-mono-num-bold text-[15px]" style={{ color: "#FFFFFF" }}>${formatMoney(monthEarnedTotal)} fee <span className="text-[12px] font-normal" style={{ color: "#CFE3DA" }}>· {monthEarnedCount} lines</span></span>
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6">
        {segments.map((s) => {
          const t = TONES[s.tone] || TONES.ink;
          return (
            <div key={s.key}
              className="min-h-[64px] px-3 py-2 text-left"
              style={{ borderTop: `3px solid ${t.rule}`, borderRight: "1px solid #D6CCBA", borderBottom: "1px solid #D6CCBA", backgroundColor: s.primary ? "#F4FAF7" : "#FFFFFF" }}>
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-[11.5px] font-bold" style={{ color: t.text }}>{s.label}</span>
                <span className="text-[11px] font-semibold tabular-nums" style={{ color: "#4A5652" }}>{s.count}</span>
              </div>
              <div className="mt-0.5 font-mono-num-bold text-[16px] leading-tight" style={{ color: s.count ? "#101617" : "#6B7276" }}>${formatMoney(s.labor)}</div>
              <div className="text-[11px] font-medium tabular-nums" style={{ color: "#4A5652" }}>labor · ${formatMoney(s.fee)} fee</div>
            </div>
          );
        })}
      </div>
      {notes}
    </section>
  );
}
