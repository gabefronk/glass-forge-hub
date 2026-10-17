import { formatMoney } from "@/lib/feeMath";

const CARDS = [
  { key: "drafts", label: "Drafts", dot: "#8A958F" },
  { key: "outstanding", label: "Outstanding", dot: "#FFFFFF" },
  { key: "overdue", label: "Overdue", dot: "#A43432" },
  { key: "paid", label: "Paid", dot: "#146556" },
];

// Four KPI cards that follow the selected date range. The Outstanding card is
// the highlighted one, matching the target layout.
export default function DashboardCards({ buckets, rangeLabel }) {
  return (
    <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-4">
      {CARDS.map((c) => {
        const b = buckets[c.key] || { total: 0, count: 0 };
        const hot = c.key === "outstanding";
        return (
          <div
            key={c.key}
            className="rounded-[12px] px-4 py-3.5"
            style={{
              backgroundColor: hot ? "var(--gf-teal-800)" : "var(--gf-card)",
              border: hot ? "1px solid var(--gf-teal-800)" : "1px solid var(--gf-border)",
              boxShadow: "var(--shadow-card)",
            }}
          >
            <div className="flex items-center gap-1.5">
              <span aria-hidden="true" style={{ width: "7px", height: "7px", borderRadius: "99px", backgroundColor: hot ? "#9CC5BF" : c.dot, flexShrink: 0 }} />
              <span className="text-[11px] font-semibold tracking-[.1em]" style={{ color: hot ? "#CFE3DF" : "var(--gf-ink-3)" }}>{c.label.toUpperCase()}</span>
            </div>
            <div
              className="mt-1 text-[22px] font-bold tabular-nums"
              style={{ color: hot ? "#FFFFFF" : c.key === "overdue" && b.total > 0 ? "#A43432" : "var(--gf-ink)", letterSpacing: "-0.02em" }}
            >
              ${formatMoney(b.total)}
            </div>
            <div className="mt-0.5 text-[11.5px]" style={{ color: hot ? "#CFE3DF" : "var(--gf-ink-3)" }}>{rangeLabel}</div>
          </div>
        );
      })}
    </div>
  );
}
