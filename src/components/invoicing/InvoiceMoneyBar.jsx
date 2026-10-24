import { formatMoney } from "@/lib/feeMath";

// The money strip (declutter, Oct 24): one row of three figures and a thin display-only
// bar sized by labor dollars, QuickBooks style. Ready to invoice, Needs attention (one
// count: waiting on a report + needs a decision + $0 to confirm) and Invoiced, unpaid.
// Figures come from moneyStrip(moneyBarSegments(...)), the same buckets as Show. Not
// clickable: the Show dropdown is the filter.
const TEAL = "#0B3F3B", AMBER = "#C08B2E", SLATE = "#34506A", RULE = "#D6CCBA";

function Cell({ dot, label, figure, figureColor, rest, first }) {
  return (
    <div className="flex min-w-0 items-baseline gap-2 px-4 max-[699px]:py-2" style={{ borderLeft: first ? undefined : `1px solid ${RULE}`, minHeight: "54px", alignItems: "center" }}>
      <span aria-hidden="true" style={{ width: "8px", height: "8px", borderRadius: "99px", backgroundColor: dot, flexShrink: 0, alignSelf: "center" }} />
      <span className="whitespace-nowrap text-[14px] font-semibold" style={{ color: "#34403F" }}>{label}</span>
      <span className="font-mono-num-bold whitespace-nowrap text-[20px] font-bold" style={{ color: figureColor }}>{figure}</span>
      {rest && <span className="min-w-0 truncate text-[14px]" style={{ color: "#566063" }}>{rest}</span>}
    </div>
  );
}

export default function InvoiceMoneyBar({ strip }) {
  const { ready, attention, unpaid } = strip;
  const parts = [[ready.labor, TEAL], [attention.labor, AMBER], [unpaid.labor, SLATE]].filter(([v]) => v > 0);
  return (
    <section aria-label="Billing money strip" className="mt-4 overflow-hidden rounded-[12px] bg-white" style={{ border: "1px solid #B3A792" }}>
      <div className="grid grid-cols-1 md:grid-cols-[1.7fr_1fr_1fr]">
        <Cell first dot={TEAL} label="Ready to invoice" figure={`$${formatMoney(ready.fee)}`} figureColor={TEAL}
          rest={`fee on $${formatMoney(ready.labor)} labor · ${ready.count} ${ready.count === 1 ? "line" : "lines"}`} />
        <Cell dot={AMBER} label="Needs attention" figure={attention.count} figureColor="#6F4E10" rest={attention.count === 1 ? "line" : "lines"} />
        <Cell dot={SLATE} label="Invoiced, unpaid" figure={`$${formatMoney(unpaid.fee)}`} figureColor="#101617"
          rest={unpaid.count ? `fee · ${unpaid.count} ${unpaid.count === 1 ? "invoice" : "invoices"}` : ""} />
      </div>
      <div aria-hidden="true" className="flex" style={{ height: "6px", backgroundColor: "#E9E2D4" }}>
        {parts.map(([v, color], i) => <span key={i} style={{ flex: `${v} 1 0`, backgroundColor: color }} />)}
      </div>
    </section>
  );
}
