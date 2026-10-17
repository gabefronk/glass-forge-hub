import { formatMoney } from "@/lib/feeMath";

const CARDS = [
  { key: "drafts", label: "Drafts", dot: "#8A958F", text: "var(--gf-ink)" },
  { key: "outstanding", label: "Outstanding", dot: "var(--gf-teal-600)", text: "var(--gf-teal-800)" },
  { key: "overdue", label: "Overdue", dot: "#A43432", text: "#A43432" },
  { key: "paid", label: "Paid", dot: "#146556", text: "#146556" },
];

// Four KPI cards that follow the selected date range. Semantics are computed in
// invoiceDashboard.js from existing FeeLines fields only.
export default function DashboardCards({ buckets, rangeLabel }) {
  return (
    <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
      {CARDS.map((c) => {
        const b = buckets[c.key] || { total: 0, count: 0 };
        return (
          <div key={c.key} className="rounded-[12px] px-4 py-3.5" style={{ backgroundColor: "var(--gf-card)", border: "1px solid var(--gf-border)", boxShadow: "var(--shadow-card)" }}>
            <div className="flex items-center gap-1.5">
              <span aria-hidden="true" style={{ width: "7px", height: "7px", borderRadius: "99px", backgroundColor: c.dot, flexShrink: 0 }} />
              <span className="text-[11px] font-semibold tracking-[.1em]" style={{ color: "var(--gf-ink-3)" }}>{c.label.toUpperCase()}</span>
            </div>
            <div className="mt-1 text-[22px] font-bold tabular-nums" style={{ color: c.text, letterSpacing: "-0.02em" }}>${formatMoney(b.total)}</div>
            <div className="mt-0.5 text-[11.5px]" style={{ color: "var(--gf-ink-3)" }}>{b.count} {b.count === 1 ? "line" : "lines"} · {rangeLabel}</div>
          </div>
        );
      })}
    </div>
  );
}
