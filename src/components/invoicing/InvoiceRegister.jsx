import { useState } from "react";
import { formatMoney } from "@/lib/feeMath";
import { openInvoiceTotals } from "@/lib/invoiceRegister";
import { denverDate } from "../../../base44/shared/billingCore.js";

const STATUS = {
  open: { label: "Open", color: "var(--gf-amber-700)" },
  partial: { label: "Partly paid", color: "var(--gf-amber-700)" },
  paid: { label: "Paid", color: "var(--gf-teal-800)" },
};
const day = (iso) => (iso ? new Date(iso + "T12:00:00Z").toLocaleDateString("en-US", { timeZone: "UTC", month: "numeric", day: "numeric", year: "numeric" }) : "—");

// Accounts receivable at a glance: every QuickBooks invoice the Hub has billed lines on,
// across months, with what is still owed. Payment dates come from QuickBooks.
export default function InvoiceRegister({ register, onRecordPayment }) {
  const [paying, setPaying] = useState(null);
  const [payDate, setPayDate] = useState(denverDate());
  const open = openInvoiceTotals(register);
  if (!register.length) {
    return <div className="px-4 py-3 text-[13px]" style={{ color: "var(--gf-ink-3)", borderBottom: "1px solid var(--gf-border)" }}>No invoices recorded yet. Select ready lines and choose Mark billed to record the QuickBooks invoice they went out on.</div>;
  }
  return (
    <div style={{ borderBottom: "1px solid var(--gf-border)" }}>
      <div className="flex flex-wrap items-baseline justify-between gap-2 px-4 pt-3 pb-2">
        <span className="text-[13px] font-semibold" style={{ color: "var(--gf-ink)" }}>Invoices · all months</span>
        <span className="text-[12px]" style={{ color: "var(--gf-ink-3)" }}>{open.count ? `${open.count} open · $${formatMoney(open.labor)} labor still owed` : "All invoices paid"}</span>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-[13px]">
          <thead>
            <tr className="text-left text-[11px] uppercase tracking-wide" style={{ color: "var(--gf-ink-3)" }}>
              <th className="px-4 py-1.5 font-medium">Invoice</th><th className="px-2 py-1.5 font-medium">Date</th><th className="px-2 py-1.5 font-medium">Lines</th>
              <th className="px-2 py-1.5 text-right font-medium">Labor</th><th className="px-2 py-1.5 text-right font-medium">Fee</th><th className="px-2 py-1.5 font-medium">Status</th><th className="px-4 py-1.5" />
            </tr>
          </thead>
          <tbody>
            {register.map((inv) => (
              <tr key={inv.number || "none"} style={{ borderTop: "1px solid var(--gf-border)" }}>
                <td className="px-4 py-2 font-semibold" style={{ color: "var(--gf-ink)" }}>{inv.number ? `#${inv.number}` : <span style={{ color: "var(--gf-amber-700)" }}>No number</span>}</td>
                <td className="px-2 py-2">{day(inv.date)}</td>
                <td className="px-2 py-2">{inv.lineCount}{inv.months.length > 1 ? ` · ${inv.months.join(", ")}` : ""}</td>
                <td className="px-2 py-2 text-right font-mono-num-bold">${formatMoney(inv.labor)}</td>
                <td className="px-2 py-2 text-right font-mono-num-bold">${formatMoney(inv.fee)}</td>
                <td className="px-2 py-2" style={{ color: STATUS[inv.status].color }}>{STATUS[inv.status].label}{inv.status === "paid" && inv.paidDate ? ` ${day(inv.paidDate)}` : ""}</td>
                <td className="px-4 py-2 text-right whitespace-nowrap">
                  {paying === inv.number ? (
                    <span className="inline-flex items-center gap-2">
                      <input type="date" aria-label="Payment date" value={payDate} onChange={(e) => setPayDate(e.target.value)} className="min-h-9 rounded-lg border border-slate-300 px-2 text-[13px]" />
                      <button type="button" disabled={!payDate} onClick={() => { onRecordPayment(inv.number, payDate); setPaying(null); }} className="min-h-9 rounded-lg bg-emerald-900 px-3 text-[12px] font-semibold text-white disabled:opacity-50">Save</button>
                      <button type="button" onClick={() => setPaying(null)} className="min-h-9 rounded-lg border px-3 text-[12px]">Cancel</button>
                    </span>
                  ) : inv.status === "paid" ? (
                    <button type="button" onClick={() => onRecordPayment(inv.number, null)} className="min-h-9 rounded-lg border px-3 text-[12px]">Undo paid</button>
                  ) : (
                    <button type="button" onClick={() => { setPaying(inv.number); setPayDate(denverDate()); }} className="min-h-9 rounded-lg border border-emerald-800 px-3 text-[12px] font-semibold" style={{ color: "var(--gf-teal-800)" }}>Mark paid</button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
