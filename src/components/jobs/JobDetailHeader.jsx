import { Link } from "react-router-dom";
import { ExternalLink, Plus } from "lucide-react";
import { C, formatShort } from "@/lib/feeUI";
import { formatMoney } from "@/lib/feeMath";

function StatCell({ label, children, mono, fee }) {
  return (
    <div className="min-w-0">
      <div className="mono-label-sm mb-1.5">{label}</div>
      <div
        className={mono ? "font-mono-num truncate" : "truncate"}
        style={fee ? { fontSize: "18px", fontWeight: 600, color: C.accent, letterSpacing: "-0.02em" } : { fontSize: "15px", fontWeight: 500, color: C.text }}
      >
        {children}
      </div>
    </div>
  );
}

export default function JobDetailHeader({ job, status, totals, dates, onAddNote }) {
  const oes = job.oe_numbers || [];

  return (
    <div className="rounded-[18px] overflow-hidden" style={{ border: `1px solid ${C.border}`, backgroundColor: C.card }}>
      {/* Title row */}
      <div className="px-5 pt-5 pb-4">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="mono-label-sm mb-1">GF-2026 · {job.builder || "—"}</div>
          <h1 className="truncate w-full font-heading text-[24px] font-semibold" style={{ color: C.text, letterSpacing: "-0.03em" }}>{job.canonical_name}</h1>
          <div className="flex items-center gap-2 mt-1">
            {job.address && <span className="text-[13px]" style={{ color: C.textMuted }}>{job.address}</span>}
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full whitespace-nowrap" style={{ backgroundColor: status.bg, color: status.text }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: status.text }} />
              <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.13em]">{status.label}</span>
            </span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <button className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[12px] font-medium whitespace-nowrap" style={{ border: `1px solid ${C.border}`, color: C.textSecondary }}>
              <Plus className="h-3.5 w-3.5" />Add photo
            </button>
            <button className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[12px] font-semibold whitespace-nowrap" style={{ backgroundColor: C.accent, color: C.accentDark }}>
              Mark install complete
            </button>
          </div>
        </div>
      </div>
      {/* Stat band */}
      <div className="px-5 py-4" style={{ borderTop: `1px solid ${C.border}`, backgroundColor: C.cardAlt }}>
        <div className="grid grid-cols-2 min-[700px]:grid-cols-4 gap-4">
          <StatCell label="Contract">{totals.labor ? `$${formatMoney(totals.labor)}` : "—"}</StatCell>
          <StatCell label="Fee @ 10%" fee>{totals.fee ? `$${formatMoney(totals.fee)}` : "—"}</StatCell>
          <StatCell label="Visits">{dates.visits}</StatCell>
          <StatCell label="Activity">{dates.first ? `${formatShort(dates.first)} → ${formatShort(dates.last)}` : "—"}</StatCell>
        </div>
      </div>
    </div>
  );
}