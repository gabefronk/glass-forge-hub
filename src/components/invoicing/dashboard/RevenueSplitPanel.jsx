import { formatMoney } from "@/lib/feeMath";

// Glass Forge fee by billing channel for the selected range. Terms come from
// each line's own fee math (fee_pct / split_pct), never from constants.
export default function RevenueSplitPanel({ split, rangeLabel }) {
  return (
    <div className="mt-3 rounded-[12px] px-5 py-4" style={{ backgroundColor: "var(--gf-card)", border: "1px solid var(--gf-border)", boxShadow: "var(--shadow-card)" }}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="m-0 text-[15px] font-bold" style={{ color: "var(--gf-ink)" }}>Revenue split</h2>
        <span className="text-[11.5px]" style={{ color: "var(--gf-ink-3)" }}>{rangeLabel}</span>
      </div>
      <p className="m-0 mt-0.5 text-[12.5px]" style={{ color: "var(--gf-ink-3)" }}>Glass Forge fee by billing channel</p>
      {split.channels.length === 0 ? (
        <p className="m-0 mt-3 text-[13px]" style={{ color: "var(--gf-ink-3)" }}>No billing lines in this range.</p>
      ) : (
        <div className="mt-3">
          {split.channels.map((c) => (
            <div key={c.key} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-2" style={{ borderTop: "1px solid var(--gf-hairline)" }}>
              <span className="text-[13.5px] font-semibold" style={{ color: "var(--gf-ink)" }}>{c.label}</span>
              <span className="text-[12px]" style={{ color: "var(--gf-ink-3)" }}>{c.terms} · {c.lineCount} {c.lineCount === 1 ? "line" : "lines"}</span>
              <div style={{ flex: "1 1 auto" }} />
              <span className="text-[13.5px] font-semibold tabular-nums" style={{ color: "var(--gf-ink)" }}>${formatMoney(c.feeTotal)}</span>
            </div>
          ))}
          <div className="flex items-center gap-3 py-2" style={{ borderTop: "1px solid var(--gf-border)" }}>
            <span className="text-[13.5px] font-bold" style={{ color: "var(--gf-ink)" }}>Glass Forge total</span>
            <div style={{ flex: "1 1 auto" }} />
            <span className="text-[14px] font-bold tabular-nums" style={{ color: "var(--gf-teal-800)" }}>${formatMoney(split.total)}</span>
          </div>
        </div>
      )}
    </div>
  );
}
