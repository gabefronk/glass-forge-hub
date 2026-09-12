import { formatMoney } from "@/lib/feeMath";

function StatCard({ label, value, sub, tone, onClick, clickable }) {
  const Comp = onClick ? "button" : "div";
  const tones = {
    ready: { color: "#166447", bg: "#EAF5EE", border: "#C7E4D2" },
    held: { color: "#89511A", bg: "#FFF3DF", border: "#F0DBA8" },
    billed: { color: "#53615B", bg: "#F0F1ED", border: "#DDE0DA" },
    scheduled: { color: "#335E91", bg: "#EBF2FC", border: "#C7D8EF" },
    muted: { color: "#53615B", bg: "transparent", border: "#DDE0DA" },
  };
  const t = tones[tone] || tones.muted;
  return (
    <Comp
      onClick={onClick}
      style={{
        textAlign: "left",
        cursor: clickable ? "pointer" : "default",
        border: `1px solid ${t.border}`,
        backgroundColor: t.bg,
        borderRadius: "12px",
        padding: "14px 16px",
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        gap: "4px",
        transition: "box-shadow .15s, transform .15s",
      }}
    >
      <span className="text-[12px] font-medium" style={{ color: t.color, letterSpacing: "0.01em" }}>{label}</span>
      <span className="font-mono-num-bold text-[28px]" style={{ color: t.color, letterSpacing: "-0.03em", lineHeight: 1.1 }}>{value}</span>
      {sub && <span className="text-[12px]" style={{ color: t.color, opacity: 0.8 }}>{sub}</span>}
    </Comp>
  );
}

export default function InvoiceSummary({ readyTotal, readyCount, heldTotal, recordedLaborTotal, splitReviewCount, matchBlockedTotal, reportBlockedTotal, matchBlockedCount, reportBlockedCount, noSourceDataCount, customFeeCount, billedTotal, billedCount, scheduledTotal, scheduledCount, monthEarnedTotal, monthEarnedCount, onFilterBlocked, onFilterMatchBlocked }) {
  return (
    <div className="flex min-w-0 flex-col" style={{ gap: "20px", paddingTop: "28px", paddingBottom: "24px" }}>
      {/* Recorded fees headline */}
      <div className="min-w-0 max-w-full">
        <div className="text-[12px] font-medium" style={{ color: "#53615B", letterSpacing: "0.02em", marginBottom: "8px" }}>
          Recorded fees this month to date
        </div>
        <div className="font-mono-num-bold" style={{ fontSize: "clamp(40px, 7vw, 48px)", fontWeight: 800, color: "#182422", letterSpacing: "-0.04em", lineHeight: 1 }}>
          ${formatMoney(monthEarnedTotal)}
        </div>
        <div className="text-[15px]" style={{ color: "#53615B", marginTop: "10px" }}>
          ${formatMoney(readyTotal)} ready to bill · ${formatMoney(heldTotal)} held for review or reports · ${formatMoney(billedTotal)} billed
          <span className="block mt-1.5 text-[13px]">Recorded labor ${formatMoney(recordedLaborTotal)}. Includes provisional amounts held for review; future jobs appear under Scheduled.</span>
          {splitReviewCount > 0 && <span className="block mt-1.5 text-[13px]" style={{ color: "#89511A" }}>{splitReviewCount} profit-split notes need allocation review. Candidate splits are excluded from totals.</span>}
          {noSourceDataCount > 0 && (
            <span className="block mt-1.5 text-[13px]" style={{ color: "#A43432" }}>
              ⚠ Source data missing for {noSourceDataCount} {noSourceDataCount === 1 ? "line" : "lines"} — ProBuild pull may have failed
            </span>
          )}
        </div>
      </div>

      {/* Grouped Ready / Held / Billed */}
      <div>
        <div className="text-[11px] font-semibold uppercase mb-2.5" style={{ color: "#8A958F", letterSpacing: "0.06em" }}>This month</div>
        <div className="grid w-full min-w-0 grid-cols-1 gap-3 min-[420px]:grid-cols-3">
          <StatCard tone="ready" label="Ready to bill" value={`$${formatMoney(readyTotal)}`} sub={`${readyCount} eligible lines`} />
          <StatCard tone="held" label="Held for review" value={`$${formatMoney(heldTotal)}`} sub={`${reportBlockedCount + matchBlockedCount} lines held`} clickable={!!onFilterBlocked} onClick={onFilterBlocked} />
          <StatCard tone="billed" label="Billed" value={`$${formatMoney(billedTotal)}`} sub={`${billedCount} lines`} />
        </div>
      </div>

      {/* Scheduled — separate */}
      <div>
        <div className="text-[11px] font-semibold uppercase mb-2.5" style={{ color: "#8A958F", letterSpacing: "0.06em" }}>Future work</div>
        <div className="grid w-full min-w-0 grid-cols-1 gap-3 min-[420px]:grid-cols-2">
          <StatCard tone="scheduled" label="Scheduled" value={`$${formatMoney(scheduledTotal)}`} sub={`${scheduledCount} lines · not yet billable`} />
          <div className="grid grid-cols-1 gap-3 min-[420px]:grid-cols-2">
            <StatCard tone="held" label="Waiting on reports" value={`$${formatMoney(reportBlockedTotal)}`} sub={`${reportBlockedCount} lines · review →`} clickable={!!onFilterBlocked} onClick={onFilterBlocked} />
            <StatCard tone="held" label="Pricing / job review" value={`$${formatMoney(matchBlockedTotal)}`} sub={`${matchBlockedCount} lines · review →`} clickable={!!onFilterMatchBlocked} onClick={onFilterMatchBlocked} />
          </div>
        </div>
      </div>
    </div>
  );
}