import { Link } from "react-router-dom";
import { ExternalLink, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { C, CARD_SHADOW, formatShort } from "@/lib/feeUI";
import { formatMoney } from "@/lib/feeMath";

function StatCell({ label, children, mono, fee }) {
  return (
    <div className="min-w-0">
      <div className="uppercase tracking-wide whitespace-nowrap" style={{ fontSize: "10px", fontWeight: 600, color: C.text, opacity: 0.62 }}>{label}</div>
      <div
        className={mono ? "font-mono truncate" : "truncate"}
        style={fee ? { fontSize: "17px", fontWeight: 700, color: C.accent } : { fontSize: "15px", fontWeight: 600, color: C.accentDark }}
      >
        {children}
      </div>
    </div>
  );
}

export default function JobDetailHeader({ job, status, totals, dates, onAddNote }) {
  const oes = job.oe_numbers || [];

  return (
    <div className="rounded-lg overflow-hidden" style={{ border: `1px solid ${C.border}`, borderLeft: `3px solid ${C.accent}`, boxShadow: CARD_SHADOW, backgroundColor: C.card }}>
      {/* Title row */}
      <div className="px-6 pt-5 pb-4">
        <div className="flex items-center gap-3 flex-wrap">
          <h1 className="truncate" style={{ fontSize: "24px", fontWeight: 700, color: C.accentDark, letterSpacing: "-0.015em" }}>{job.canonical_name}</h1>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full whitespace-nowrap" style={{ backgroundColor: status.bg, color: status.text }}>
            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: status.text }} />
            <span className="text-[10px] font-bold uppercase tracking-wide">{status.label}</span>
          </span>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="outline" size="sm" asChild>
              <Link to="/calendar"><ExternalLink className="h-3.5 w-3.5" />Open in calendar</Link>
            </Button>
            <Button size="sm" onClick={onAddNote}>
              <Plus className="h-3.5 w-3.5" />Add note
            </Button>
          </div>
        </div>
      </div>
      {/* Gradient stat band */}
      <div className="px-6 py-4" style={{ background: "linear-gradient(to bottom, #f6f8f6, #f1f4f1)", borderTop: `1px solid ${C.border}` }}>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-4">
          <StatCell label="Activity">{dates.first ? `${formatShort(dates.first)} → ${formatShort(dates.last)}` : "—"}</StatCell>
          <StatCell label="Visits">{dates.visits}</StatCell>
          <StatCell label="OE" mono>{oes.length ? oes.join(", ") : "—"}</StatCell>
          <StatCell label="Labor">{totals.labor ? `$${formatMoney(totals.labor)}` : "—"}</StatCell>
          <StatCell label="Fee" fee>{totals.fee ? `$${formatMoney(totals.fee)}` : "—"}</StatCell>
        </div>
      </div>
    </div>
  );
}