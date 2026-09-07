import { useMemo } from "react";
import { CalendarClock, AlertTriangle } from "lucide-react";
import { formatMoney, isFutureRow, isBillableFuture } from "@/lib/feeMath";

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
      <div className="rounded-lg border border-border bg-white overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 px-4 py-3 bg-[#f9f9f9] border-b border-border">
          <CalendarClock className="h-4 w-4 text-accent" />
          <h2 className="font-heading text-xs font-bold uppercase tracking-wide text-foreground">
            Scheduled — not yet billable
          </h2>
          <span className="text-xs text-muted-foreground ml-1">({billable.length})</span>
          <span className="ml-auto text-sm">
            <span className="text-[10px] uppercase tracking-wide text-muted-foreground mr-2">Upcoming</span>
            <span className="font-semibold tabular-nums text-foreground">${formatMoney(billableSub.labor)}</span>
            <span className="text-xs text-muted-foreground mx-1">labor ·</span>
            <span className="font-semibold tabular-nums text-accent">${formatMoney(billableSub.fee)}</span>
            <span className="text-xs text-muted-foreground ml-1">fee</span>
          </span>
        </div>
        <div className="divide-y divide-border">
          {billable.map((r) => (
            <div key={r.id} className="grid grid-cols-2 sm:grid-cols-[100px_minmax(0,1fr)_100px_100px] gap-3 px-4 py-2.5 text-sm border-l-4 border-l-accent">
              <span className="tabular-nums text-muted-foreground w-24 text-xs">{r.job_date}</span>
              <span className="min-w-0 font-medium break-words">{r.job_name_norm}</span>
              <span className="tabular-nums text-muted-foreground sm:text-right">${formatMoney(r.labor_amt)}</span>
              <span className="tabular-nums font-medium text-right text-accent">${formatMoney(r.fee_amt)}</span>
            </div>
          ))}
        </div>
        {heldOut.length > 0 && (
          <>
            <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 bg-[#f9f9f9] border-t border-border">
              <AlertTriangle className="h-3.5 w-3.5 text-accent" />
              <span className="text-xs font-bold uppercase tracking-wide text-foreground">
                Held out (needs review)
              </span>
              <span className="text-xs text-muted-foreground ml-1">({heldOut.length})</span>
              <span className="ml-auto text-xs">
                <span className="font-semibold tabular-nums text-foreground">${formatMoney(heldSub.labor)}</span>
                <span className="text-muted-foreground mx-1">labor ·</span>
                <span className="font-semibold tabular-nums text-accent">${formatMoney(heldSub.fee)}</span>
                <span className="text-muted-foreground ml-1">fee</span>
              </span>
            </div>
            <div className="divide-y divide-border">
              {heldOut.map((r) => (
                <div key={r.id} className="grid grid-cols-2 sm:grid-cols-[100px_minmax(0,1fr)_100px_100px] gap-3 px-4 py-2 text-sm border-l-4 border-l-accent/50">
                  <span className="tabular-nums text-muted-foreground w-24 text-xs">{r.job_date}</span>
                  <span className="min-w-0 font-medium break-words">{r.job_name_norm}</span>
                  <span className="tabular-nums text-muted-foreground sm:text-right">${formatMoney(r.labor_amt)}</span>
                  <span className="tabular-nums font-medium text-right text-accent">${formatMoney(r.fee_amt)}</span>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
