import { formatMoney } from "@/lib/feeMath";

function monthShort(monthStr) {
  if (!monthStr) return "";
  const [y, m] = monthStr.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("en-US", { month: "short" }).toUpperCase();
}

export default function InvoiceSummary({ readyTotal, readyCount, heldTotal, recordedLaborTotal, splitReviewCount, matchBlockedTotal, matchBlockedCount, reportBlockedTotal, reportBlockedCount, noSourceDataCount, billedTotal, billedCount, scheduledTotal, scheduledCount, monthEarnedTotal, monthEarnedCount, onFilterBlocked, onFilterMatchBlocked, month }) {
  const recorded = Number(monthEarnedTotal) || 0;
  const ready = Number(readyTotal) || 0;
  const held = Number(heldTotal) || 0;
  const tealPct = recorded > 0 ? Math.max(0, Math.min(100, (ready / recorded) * 100)) : 0;
  const amberPct = recorded > 0 ? Math.max(0, Math.min(100 - tealPct, (held / recorded) * 100)) : 0;
  const heldSub = `${reportBlockedCount + matchBlockedCount} lines · ${matchBlockedCount} pricing, ${reportBlockedCount} reports`;
  const eyebrow = `RECORDED FEES · ${monthShort(month)}`;

  return (
    <div style={{ padding: "10px 0 22px" }}>
      {/* Desktop: single flex row */}
      <div className="hidden sm:flex items-stretch flex-nowrap" style={{ whiteSpace: "nowrap" }}>
        {/* Hero cell */}
        <div style={{ flex: "0 0 auto", width: "236px" }}>
          <div className="text-[11px] font-medium uppercase" style={{ color: "var(--gf-ink-3)", letterSpacing: "0.08em", marginBottom: "4px" }}>{eyebrow}</div>
          <div className="font-mono-num-bold" style={{ fontSize: "38px", fontWeight: 600, color: "var(--gf-ink)", letterSpacing: "-0.04em", lineHeight: 1 }}>${formatMoney(monthEarnedTotal)}</div>
          {recorded > 0 && (
            <div className="flex" style={{ gap: "2px", marginTop: "8px", height: "4px" }}>
              <div style={{ width: `${tealPct}%`, backgroundColor: "var(--gf-teal-600)", borderRadius: "2px" }} />
              <div style={{ width: `${amberPct}%`, backgroundColor: "var(--gf-amber-500)", borderRadius: "2px" }} />
            </div>
          )}
        </div>

        {/* Ready to bill */}
        <StatCell label="Ready to bill" swatchColor="var(--gf-teal-600)" value={`$${formatMoney(readyTotal)}`} sub={`${readyCount} lines`} />

        {/* Held for review */}
        <StatCell label="Held for review" swatchColor="var(--gf-amber-500)" value={`$${formatMoney(heldTotal)}`} sub={heldSub}>
          <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1" style={{ whiteSpace: "normal" }}>
            {onFilterBlocked && (
              <button onClick={onFilterBlocked} className="text-[11px] font-medium hover:underline" style={{ color: "var(--gf-amber-700)" }}>{reportBlockedCount} reports · ${formatMoney(reportBlockedTotal)}</button>
            )}
            {onFilterMatchBlocked && (
              <button onClick={onFilterMatchBlocked} className="text-[11px] font-medium hover:underline" style={{ color: "var(--gf-amber-700)" }}>{matchBlockedCount} pricing · ${formatMoney(matchBlockedTotal)}</button>
            )}
          </div>
        </StatCell>

        {/* Billed */}
        <StatCell label="Billed" swatchColor="var(--gf-ink-4)" value={`$${formatMoney(billedTotal)}`} sub={`${billedCount} lines`} />

        {/* Spacer */}
        <div style={{ flex: "1 1 auto", minWidth: "16px" }} />

        {/* Scheduled */}
        <StatCell label="Scheduled" swatchColor="var(--gf-slate-300)" swatchDashed value={`$${formatMoney(scheduledTotal)}`} sub={`${scheduledCount} lines · future work`} valueColor="var(--gf-ink-2)" />

        {/* Labor */}
        <StatCell label="Labor" value={`$${formatMoney(recordedLaborTotal)}`} sub="separate measure" valueColor="var(--gf-ink-2)" />
      </div>

      {/* Mobile: stacked */}
      <div className="sm:hidden">
        <div style={{ marginBottom: "12px" }}>
          <div className="text-[11px] font-medium uppercase" style={{ color: "var(--gf-ink-3)", letterSpacing: "0.08em", marginBottom: "4px" }}>{eyebrow}</div>
          <div className="font-mono-num-bold" style={{ fontSize: "34px", fontWeight: 600, color: "var(--gf-ink)", letterSpacing: "-0.04em", lineHeight: 1 }}>${formatMoney(monthEarnedTotal)}</div>
          {recorded > 0 && (
            <div className="flex" style={{ gap: "2px", marginTop: "8px", height: "4px" }}>
              <div style={{ width: `${tealPct}%`, backgroundColor: "var(--gf-teal-600)", borderRadius: "2px" }} />
              <div style={{ width: `${amberPct}%`, backgroundColor: "var(--gf-amber-500)", borderRadius: "2px" }} />
            </div>
          )}
        </div>

        <div className="grid grid-cols-2" style={{ gap: "12px 16px" }}>
          <MobileStat label="Ready to bill" swatchColor="var(--gf-teal-600)" value={`$${formatMoney(readyTotal)}`} sub={`${readyCount} lines`} />
          <MobileStat label="Held for review" swatchColor="var(--gf-amber-500)" value={`$${formatMoney(heldTotal)}`} sub={heldSub} />
          <MobileStat label="Billed" swatchColor="var(--gf-ink-4)" value={`$${formatMoney(billedTotal)}`} sub={`${billedCount} lines`} />
          <MobileStat label="Scheduled" swatchColor="var(--gf-slate-300)" swatchDashed value={`$${formatMoney(scheduledTotal)}`} sub={`${scheduledCount} lines · future`} valueColor="var(--gf-ink-2)" />
        </div>

        <div className="flex flex-wrap gap-x-3 gap-y-1 mt-2 text-[11px]">
          {onFilterBlocked && (
            <button onClick={onFilterBlocked} className="font-medium hover:underline" style={{ color: "var(--gf-amber-700)" }}>{reportBlockedCount} reports · ${formatMoney(reportBlockedTotal)}</button>
          )}
          {onFilterMatchBlocked && (
            <button onClick={onFilterMatchBlocked} className="font-medium hover:underline" style={{ color: "var(--gf-amber-700)" }}>{matchBlockedCount} pricing · ${formatMoney(matchBlockedTotal)}</button>
          )}
        </div>

        <div className="flex items-baseline gap-2 mt-3 pt-3" style={{ borderTop: "1px solid var(--gf-hairline)" }}>
          <span className="text-[12px] font-medium" style={{ color: "var(--gf-ink-2)" }}>Labor</span>
          <span className="font-mono-num-bold text-[18px]" style={{ color: "var(--gf-ink-2)", letterSpacing: "-0.025em" }}>${formatMoney(recordedLaborTotal)}</span>
          <span className="text-[11px]" style={{ color: "var(--gf-ink-3)" }}>separate measure</span>
        </div>
      </div>

      {/* Provisional + allocation warning */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mt-3 text-[12px]">
        <span style={{ color: "var(--gf-ink-3)" }}>Includes provisional amounts held for review.</span>
        {splitReviewCount > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-medium" style={{ backgroundColor: "var(--gf-amber-050)", border: "1px solid var(--gf-amber-100)", color: "var(--gf-amber-700)" }}>
            {splitReviewCount} profit-split {splitReviewCount === 1 ? "note" : "notes"} need allocation · candidate splits excluded from totals
          </span>
        )}
        {noSourceDataCount > 0 && (
          <span style={{ color: "#A43432" }}>⚠ {noSourceDataCount} missing source data</span>
        )}
      </div>
    </div>
  );
}

function StatCell({ label, swatchColor, swatchDashed, value, sub, valueColor, children }) {
  return (
    <div style={{ flex: "0 0 auto", borderLeft: "1px solid var(--gf-border)", padding: "0 24px 1px 22px", display: "flex", flexDirection: "column", justifyContent: "flex-end" }}>
      <div className="flex items-center gap-1.5 mb-1">
        {swatchColor && <span style={{ width: "8px", height: "8px", borderRadius: "2.5px", backgroundColor: swatchDashed ? "transparent" : swatchColor, border: swatchDashed ? `1.5px dashed ${swatchColor}` : "none", flexShrink: 0 }} />}
        <span className="text-[12px] font-medium" style={{ color: "var(--gf-ink-2)" }}>{label}</span>
      </div>
      <div className="font-mono-num-bold" style={{ fontSize: "20px", fontWeight: 600, color: valueColor || "var(--gf-ink)", letterSpacing: "-0.025em", lineHeight: 1 }}>{value}</div>
      <div className="text-[12px]" style={{ color: "var(--gf-ink-3)" }}>{sub}</div>
      {children}
    </div>
  );
}

function MobileStat({ label, swatchColor, swatchDashed, value, sub, valueColor }) {
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-1">
        {swatchColor && <span style={{ width: "8px", height: "8px", borderRadius: "2.5px", backgroundColor: swatchDashed ? "transparent" : swatchColor, border: swatchDashed ? `1.5px dashed ${swatchColor}` : "none", flexShrink: 0 }} />}
        <span className="text-[12px] font-medium" style={{ color: "var(--gf-ink-2)" }}>{label}</span>
      </div>
      <div className="font-mono-num-bold" style={{ fontSize: "20px", fontWeight: 600, color: valueColor || "var(--gf-ink)", letterSpacing: "-0.025em", lineHeight: 1 }}>{value}</div>
      <div className="text-[12px]" style={{ color: "var(--gf-ink-3)" }}>{sub}</div>
    </div>
  );
}