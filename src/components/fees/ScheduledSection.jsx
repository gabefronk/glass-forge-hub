import { useMemo } from "react";
import { CalendarClock } from "lucide-react";
import { formatMoney } from "@/lib/feeMath";

// "Scheduled — not yet billable" section: future-dated rows (job_date > today).
// Shown in its own section with its own subtotal so the user can see what's
// coming without it inflating the Invoice Total or Labor Total.
export default function ScheduledSection({ rows }) {
  const scheduled = useMemo(
    () => rows.filter((r) => r.job_date && r.job_date > todayStr()).sort((a, b) => a.job_date.localeCompare(b.job_date)),
    [rows]
  );

  const subtotal = useMemo(() => ({
    labor: scheduled.reduce((s, r) => s + (Number(r.labor_amt) || 0), 0),
    fee: scheduled.reduce((s, r) => s + (Number(r.fee_amt) || 0), 0),
    count: scheduled.length,
  }), [scheduled]);

  if (!scheduled.length) return null;

  return (
    <section className="px-4 sm:px-8 pt-4 pb-2">
      <div className="rounded-lg border border-amber-300 bg-amber-50 overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 bg-amber-100 border-b border-amber-300">
          <CalendarClock className="h-4 w-4 text-amber-700" />
          <h2 className="font-heading text-sm font-semibold text-amber-900">
            Scheduled — not yet billable
          </h2>
          <span className="text-xs text-amber-800 ml-1">({subtotal.count})</span>
          <span className="ml-auto text-sm text-amber-900">
            <span className="text-xs uppercase tracking-wide text-amber-700 mr-2">Upcoming labor</span>
            <span className="font-semibold tabular-nums">${formatMoney(subtotal.labor)}</span>
            <span className="text-xs text-amber-700 mx-1">·</span>
            <span className="text-xs uppercase tracking-wide text-amber-700 mr-1">fees</span>
            <span className="font-semibold tabular-nums">${formatMoney(subtotal.fee)}</span>
          </span>
        </div>
        <div className="divide-y divide-amber-200">
          {scheduled.map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-4 py-2 text-sm">
              <span className="tabular-nums text-muted-foreground w-24">{r.job_date}</span>
              <span className="font-medium truncate flex-1">{r.job_name_norm}</span>
              <span className="tabular-nums text-muted-foreground">${formatMoney(r.labor_amt)}</span>
              <span className="tabular-nums font-medium">${formatMoney(r.fee_amt)}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}