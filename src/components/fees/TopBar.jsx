import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatMoney, monthLabel } from "@/lib/feeMath";
import { C } from "@/lib/feeUI";

export default function TopBar({ month, onMonthChange, onExport, topRef,
  invoiceTotal, notYetBilledTotal, notYetBilledCount,
  bfsFees, laborTotal, lineCount, scheduledLabor, awaitingPayment, awaitingPaymentCount }) {
  const [y, m] = month.split("-").map(Number);
  const prev = () => {
    const d = new Date(y, m - 2, 1);
    onMonthChange(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };
  const next = () => {
    const d = new Date(y, m, 1);
    onMonthChange(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`);
  };

  const isZero = (val, count) => (Number(val) || 0) === 0 && (count === undefined || count === 0);

  return (
    <div ref={topRef} className="sticky top-0 z-20 border-b" style={{ backgroundColor: C.pageBg, borderColor: C.border }}>
      {/* Row 1: month nav + export */}
      <div className="px-4 sm:px-8 py-4 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={prev} aria-label="Previous month" style={{ borderColor: C.border }}>
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="font-bold tabular-nums" style={{ fontSize: "22px", fontWeight: 700, color: C.accentDark, minWidth: "10rem", textAlign: "center" }}>
            {monthLabel(month)}
          </span>
          <Button variant="outline" size="icon" onClick={next} aria-label="Next month" style={{ borderColor: C.border }}>
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
        <Button onClick={onExport} variant="outline" className="gap-2 uppercase text-xs tracking-wide font-semibold" style={{ borderColor: C.border }}>
          <Download className="h-4 w-4" />
          Export CSV
        </Button>
      </div>

      {/* Row 2: totals card */}
      <div className="px-4 sm:px-8 pb-4">
        <div
          className="flex flex-wrap items-center gap-x-8 gap-y-4 px-6 py-5 rounded-lg"
          style={{ backgroundColor: C.card, border: `1px solid ${C.border}`, boxShadow: "0 1px 3px rgba(18,33,30,0.06)" }}
        >
          {/* Hero figures */}
          <div className="flex items-end gap-8">
            <Hero label="Invoice Total" value={`$${formatMoney(invoiceTotal)}`} color={C.accentDark} />
            <Hero
              label="Not Yet Billed"
              value={`$${formatMoney(notYetBilledTotal)}`}
              color={C.accent}
              sub={`${notYetBilledCount} lines`}
            />
          </div>

          {/* Divider */}
          <div className="hidden lg:block w-px self-stretch" style={{ backgroundColor: C.border }} />

          {/* Small grid */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-x-6 gap-y-3">
            <Mini label="BFS Labor" value={`$${formatMoney(bfsFees)}`} zero={isZero(bfsFees)} />
            <Mini label="Labor Total" value={`$${formatMoney(laborTotal)}`} zero={isZero(laborTotal)} />
            <Mini label="Line Count" value={lineCount} zero={lineCount === 0} />
            <Mini label="Scheduled" value={`$${formatMoney(scheduledLabor)}`} amber zero={isZero(scheduledLabor)} />
            <Mini label="Awaiting Payment" value={`$${formatMoney(awaitingPayment)}`} zero={isZero(awaitingPayment, awaitingPaymentCount)} />
          </div>
        </div>
      </div>
    </div>
  );
}

function Hero({ label, value, color, sub }) {
  return (
    <div className="flex flex-col">
      <span className="font-semibold" style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.1em", color: C.text, opacity: 0.68 }}>
        {label}
      </span>
      <div className="flex items-baseline gap-2">
        <span className="font-bold tabular-nums" style={{ fontSize: "30px", fontWeight: 700, color, lineHeight: 1.1 }}>
          {value}
        </span>
        {sub && (
          <span className="tabular-nums" style={{ fontSize: "13px", color: C.text, opacity: 0.68 }}>
            {sub}
          </span>
        )}
      </div>
    </div>
  );
}

function Mini({ label, value, zero, amber }) {
  return (
    <div className="flex flex-col" style={{ opacity: zero ? 0.4 : 1 }}>
      <span className="font-semibold" style={{ fontSize: "10px", textTransform: "uppercase", letterSpacing: "0.1em", color: C.text, opacity: 0.68 }}>
        {label}
      </span>
      <span className="font-semibold tabular-nums" style={{ fontSize: "15px", color: amber ? C.amber : C.text, whiteSpace: "nowrap" }}>
        {value}
      </span>
    </div>
  );
}