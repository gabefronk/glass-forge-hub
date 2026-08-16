import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatMoney, monthLabel } from "@/lib/feeMath";

export default function TopBar({ month, onMonthChange, invoiceTotalVal, bfsFeesVal = 0, splitFeesVal = 0, laborTotalVal, lineCount, onExport, topRef, futureLaborVal = 0 }) {
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
    <div ref={topRef} className="sticky top-0 z-20 bg-background border-b border-border">
      <div className="px-4 sm:px-8 py-4 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2">
          <Button variant="outline" size="icon" onClick={prev} aria-label="Previous month" className="border-border">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-[10rem] text-center">
            <span className="font-heading text-sm font-semibold uppercase tracking-wide">{monthLabel(month)}</span>
          </div>
          <Button variant="outline" size="icon" onClick={next} aria-label="Next month" className="border-border">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex items-center gap-8">
          <Stat label="Invoice Total" value={`$${formatMoney(invoiceTotalVal)}`} />
          <Stat label="BFS Labor" value={`$${formatMoney(bfsFeesVal)}`} />
          <Stat label="Sales Split" value={`$${formatMoney(splitFeesVal)}`} />
          <Stat label="Labor Total" value={`$${formatMoney(laborTotalVal)}`} />
          <Stat label="Line Count" value={lineCount} />
          {futureLaborVal > 0 && (
            <Stat label="Scheduled (not billable)" value={`$${formatMoney(futureLaborVal)}`} muted />
          )}
        </div>

        <Button onClick={onExport} variant="outline" className="gap-2 uppercase text-xs tracking-wide font-semibold">
          <Download className="h-4 w-4" />
          Export CSV
        </Button>
      </div>
    </div>
  );
}

function Stat({ label, value, muted }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-semibold">{label}</span>
      <span className={muted ? "font-heading text-lg font-semibold tabular-nums text-accent" : "font-heading text-lg font-semibold tabular-nums"}>{value}</span>
    </div>
  );
}