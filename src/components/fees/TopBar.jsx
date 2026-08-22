import { ChevronLeft, ChevronRight, Download, Plus } from "lucide-react";
import { formatMoney, monthLabel } from "@/lib/feeMath";
import { C } from "@/lib/feeUI";

export default function TopBar({ month, onMonthChange, onExport, onAddSplit, topRef,
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

  return (
    <div ref={topRef} className="sticky top-0 z-20" style={{ backgroundColor: C.pageBg, borderBottom: `1px solid ${C.border}` }}>
      {/* Row 1: month nav + actions */}
      <div className="px-[26px] max-[699px]:px-[18px] py-5 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <button onClick={prev} aria-label="Previous month" className="h-8 w-8 rounded-full flex items-center justify-center transition-colors hover:bg-white/5" style={{ backgroundColor: "rgba(255,255,255,.07)" }}>
            <ChevronLeft className="h-4 w-4" style={{ color: C.textSecondary }} />
          </button>
          <span className="font-heading text-[20px] font-semibold min-w-[150px] text-center" style={{ color: C.text, letterSpacing: "-0.02em" }}>
            {monthLabel(month)}
          </span>
          <button onClick={next} aria-label="Next month" className="h-8 w-8 rounded-full flex items-center justify-center transition-colors hover:bg-white/5" style={{ backgroundColor: "rgba(255,255,255,.07)" }}>
            <ChevronRight className="h-4 w-4" style={{ color: C.textSecondary }} />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={onExport} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[12px] font-medium whitespace-nowrap transition-colors hover:bg-white/5" style={{ border: `1px solid ${C.border}`, color: C.textSecondary }}>
            <Download className="h-3.5 w-3.5" />
            <span className="hidden min-[700px]:inline">Export CSV</span>
          </button>
          <button onClick={onAddSplit} className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[12px] font-semibold whitespace-nowrap" style={{ backgroundColor: C.accent, color: C.accentDark }}>
            <Plus className="h-3.5 w-3.5" />
            <span className="hidden min-[700px]:inline">Add profit-split job</span>
          </button>
        </div>
      </div>

      {/* Row 2: metrics */}
      <div className="px-[26px] max-[699px]:px-[18px] pb-4">
        {/* Mobile hero */}
        <div className="min-[700px]:hidden mb-3">
          <div className="rounded-[16px] p-5" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
            <div className="mono-label-sm mb-2">Not yet billed</div>
            <div className="font-mono-num-bold text-[32px]" style={{ color: C.accent, letterSpacing: "-0.03em" }}>${formatMoney(notYetBilledTotal)}</div>
            <div className="text-[11px] mt-1" style={{ color: C.textMuted }}>{notYetBilledCount} lines</div>
          </div>
          <div className="grid grid-cols-4 gap-2 mt-2">
            <MiniMetric label="Invoice" value={`$${formatMoney(invoiceTotal)}`} />
            <MiniMetric label="Labor" value={`$${formatMoney(laborTotal)}`} />
            <MiniMetric label="Sched." value={`$${formatMoney(scheduledLabor)}`} valueColor={C.amber} />
            <MiniMetric label="Await." value={`$${formatMoney(awaitingPayment)}`} valueColor={C.textMuted} />
          </div>
        </div>
        {/* Desktop 5-card row */}
        <div className="hidden min-[700px]:grid min-[700px]:grid-cols-5 gap-3">
          <MetricCard label="Not yet billed" value={`$${formatMoney(notYetBilledTotal)}`} sub={`${notYetBilledCount} lines`} valueColor={C.accent} />
          <MetricCard label="Invoice total" value={`$${formatMoney(invoiceTotal)}`} />
          <MetricCard label="Labor total" value={`$${formatMoney(laborTotal)}`} />
          <MetricCard label="Scheduled" value={`$${formatMoney(scheduledLabor)}`} valueColor={C.amber} />
          <MetricCard label="Awaiting payment" value={`$${formatMoney(awaitingPayment)}`} valueColor={C.textMuted} />
        </div>
      </div>
    </div>
  );
}

function MetricCard({ label, value, sub, valueColor }) {
  return (
    <div className="rounded-[14px] p-4" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
      <div className="mono-label-sm mb-2">{label}</div>
      <div className="font-mono-num-bold text-[20px]" style={{ color: valueColor || C.text, letterSpacing: "-0.025em" }}>
        {value}
      </div>
      {sub && <div className="text-[11px] mt-0.5" style={{ color: C.textMuted }}>{sub}</div>}
    </div>
  );
}

function MiniMetric({ label, value, valueColor }) {
  return (
    <div className="rounded-[10px] px-2 py-1.5" style={{ backgroundColor: C.card, border: `1px solid ${C.border}` }}>
      <div className="mono-label-sm" style={{ fontSize: "8px" }}>{label}</div>
      <div className="font-mono-num text-[11px] truncate" style={{ color: valueColor || C.text }}>{value}</div>
    </div>
  );
}