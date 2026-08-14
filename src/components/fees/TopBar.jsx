import { ChevronLeft, ChevronRight, Download } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatMoney, monthLabel } from "@/lib/feeMath";

export default function TopBar({ month, onMonthChange, invoiceTotalVal, laborTotalVal, lineCount, onExport }) {
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
    <div className="sticky top-0 z-20 bg-background/90 backdrop-blur border-b border-border">
      <div className="px-4 sm:px-8 py-4 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-3">
          <Button variant="outline" size="icon" onClick={prev} aria-label="Previous month">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <div className="min-w-[10rem] text-center">
            <span className="font-heading text-base font-semibold">{monthLabel(month)}</span>
          </div>
          <Button variant="outline" size="icon" onClick={next} aria-label="Next month">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>

        <div className="flex items-center gap-6">
          <Stat label="Invoice Total" value={`$${formatMoney(invoiceTotalVal)}`} />
          <Stat label="Labor Total" value={`$${formatMoney(laborTotalVal)}`} />
          <Stat label="Line Count" value={lineCount} />
        </div>

        <Button onClick={onExport} variant="default" className="gap-2">
          <Download className="h-4 w-4" />
          Export to CSV
        </Button>
      </div>
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="flex flex-col">
      <span className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</span>
      <span className="font-heading text-lg font-semibold tabular-nums">{value}</span>
    </div>
  );
}