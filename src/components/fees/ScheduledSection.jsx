import { useMemo } from "react";
import { CalendarClock, AlertTriangle } from "lucide-react";
import { formatMoney, isFutureRow, isBillableFuture } from "@/lib/feeMath";

// "Scheduled — not yet billable" section: future-dated rows (job_date > today).
// Split into billable-future (the not-yet-billable subtotal) and held-out-future
// (needs_review / non-billable), each with its own subtotal so nothing is hidden.
export default function ScheduledSection({ rows }) {
  const future = useMemo(
    () => rows.filter(isFutureRow).sort((a, b) => a.job_date.localeCompare(b.job_date)),
    [rows]
  );

  const billable = useMemo(() => future.filter(isBillableFuture), [future]);
  const heldOut = useMemo(() => future.filter((r) => !isBillableFuture(r)), [future]);

  const billableSub = useMemo(() => ({
    labor: billable.reduce((s, r) => s + (Number(r.labor_amt) || 0), 0),
    fee: billable.reduce((s, r) => s + (Number(r.fee_amt) || 0), 0),
  }), [billable]);

  const heldSub = useMemo(() => ({
    labor: heldOut.reduce((s, r) => s + (Number(r.labor_amt) || 0), 0),
    fee: heldOut.reduce((s, r) => s + (Number(r.fee_amt) || 0), 0),
  }), [heldOut]);

  if (!future.length) return null;

  return (
    <section className="px-4 sm:px-8 pt-4 pb-2">
      <div className="rounded-lg border border-amber-300 bg-amber-50 overflow-hidden">
        <div className="flex items-center gap-2 px-4 py-3 bg-amber-100 border-b border-amber-300">
          <CalendarClock className="h-4 w-4 text-amber-700" />
          <h2 className="font-heading text-sm font-semibold text-amber-900">
            Scheduled — not yet billable
          </h2>
          <span className="text-xs text-amber-800 ml-1">({billable.length})</span>
          <span className="ml-auto text-sm text-amber-900">
            <span className="text-xs uppercase tracking-wide text-amber-700 mr-2">Upcoming</span>
            <span className="font-semibold tabular-nums">${formatMoney(billableSub.labor)}</span>
            <span className="text-xs text-amber-700 mx-1">labor ·</span>
            <span className="font-semibold tabular-nums">${formatMoney(billableSub.fee)}</span>
            <span className="text-xs text-amber-700 ml-1">fee</span>
          </span>
        </div>
        <div className="divide-y divide-amber-200">
          {billable.map((r) => (
            <div key={r.id} className="flex items-center gap-3 px-4 py-2 text-sm">
              <span className="tabular-nums text-muted-foreground w-24">{r.job_date}</span>
              <span className="font-medium truncate flex-1">{r.job_name_norm}</span>
              <span className="tabular-nums text-muted-foreground w-24 text-right">${formatMoney(r.labor_amt)}</span>
              <span className="tabular-nums font-medium w-24 text-right">${formatMoney(r.fee_amt)}</span>
            </div>
          ))}
        </div>
        {heldOut.length > 0 && (
          <>
            <div className="flex items-center gap-2 px-4 py-2.5 bg-amber-50 border-t border-amber-200">
              <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
              <span className="text-xs font-semibold uppercase tracking-wide text-amber-800">
                Held out (needs review)
              </span>
              <span className="text-xs text-amber-700 ml-1">({heldOut.length})</span>
              <span className="ml-auto text-xs text-amber-800">
                <span className="font-semibold tabular-nums">${formatMoney(heldSub.labor)}</span>
                <span className="text-xs mx-1">labor ·</span>
                <span className="font-semibold tabular-nums">${formatMoney(heldSub.fee)}</span>
                <span className="text-xs ml-1">fee</span>
              </span>
            </div>
            <div className="divide-y divide-amber-200/60">
              {heldOut.map((r) => (
                <div key={r.id} className="flex items-center gap-3 px-4 py-2 text-sm bg-amber-50/30">
                  <span className="tabular-nums text-muted-foreground w-24">{r.job_date}</span>
                  <span className="font-medium truncate flex-1">{r.job_name_norm}</span>
                  <span className="tabular-nums text-muted-foreground w-24 text-right">${formatMoney(r.labor_amt)}</span>
                  <span className="tabular-nums font-medium w-24 text-right">${formatMoney(r.fee_amt)}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}