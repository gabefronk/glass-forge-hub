import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatMoney } from "@/lib/feeMath";
import { invoiceInputError, findInvoice, lineTotals, kindLabel } from "@/lib/invoiceRegister";
import { denverDate } from "@/lib/feeMath";

const inputClass = "mt-1.5 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-base focus:border-emerald-700 focus:outline-none sm:text-sm";

// Billing records the QuickBooks invoice the lines went out on, so the Hub and the
// books agree on what was invoiced and what is still owed. A number already on file
// adds these lines to that invoice.
export default function RecordInvoiceDialog({ request, invoices = [], onCancel, onConfirm }) {
  const [number, setNumber] = useState("");
  const [date, setDate] = useState(denverDate());
  const [customer, setCustomer] = useState("BFS");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (request) { setNumber(""); setDate(denverDate()); setCustomer("BFS"); setError(""); setSaving(false); } }, [request]);

  const rows = request?.rows || [];
  const totals = lineTotals(rows);
  const existing = number.trim() ? findInvoice(invoices, number) : null;

  const submit = async (e) => {
    e.preventDefault();
    const problem = invoiceInputError({ number, date });
    if (problem) { setError(problem); return; }
    setSaving(true);
    const result = await onConfirm({ number: number.trim(), date: existing?.invoice_date || date, customer: customer.trim() || "BFS" });
    if (typeof result === "string") { setError(result); setSaving(false); }
  };

  return (
    <Dialog open={!!request} onOpenChange={(open) => { if (!open && !saving) onCancel(); }}>
      <DialogContent className="bottom-0 top-auto w-full max-w-none translate-y-0 rounded-b-none rounded-t-2xl sm:bottom-auto sm:top-1/2 sm:max-w-md sm:-translate-y-1/2 sm:rounded-lg">
        <DialogHeader>
          <DialogTitle>Record invoice</DialogTitle>
          <DialogDescription>
            {request?.label ? `${request.label} · ` : ""}{totals.count} {totals.count === 1 ? "line" : "lines"} · ${formatMoney(totals.labor)} labor · ${formatMoney(totals.fee)} fee. Enter the invoice as it appears in QuickBooks.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <label className="block text-sm font-medium">QuickBooks invoice number <span className="text-red-700">*</span>
            <input autoFocus required className={inputClass} value={number} onChange={(e) => { setNumber(e.target.value); setError(""); }} placeholder="e.g. 1042" />
          </label>
          {existing && (
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              {existing.kind === "labor_billing"
                ? `Adds these lines to invoice #${existing.invoice_number} (${existing.line_count || 0} lines, $${formatMoney(existing.amount || 0)} so far, dated ${existing.invoice_date}).`
                : `#${existing.invoice_number} is already a ${kindLabel(existing.kind).toLowerCase()} invoice on a job.`}
            </p>
          )}
          {!existing && (
            <div className="grid gap-4 sm:grid-cols-2">
              <label className="block text-sm font-medium">Invoice date <span className="text-red-700">*</span>
                <input type="date" required className={inputClass} value={date} onChange={(e) => { setDate(e.target.value); setError(""); }} />
              </label>
              <label className="block text-sm font-medium">Customer
                <input className={inputClass} value={customer} onChange={(e) => setCustomer(e.target.value)} />
              </label>
            </div>
          )}
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <DialogFooter>
            <button type="button" disabled={saving} onClick={onCancel} className="min-h-11 rounded-xl border px-4 text-sm font-medium">Cancel</button>
            <button type="submit" disabled={!rows.length || saving} className="min-h-11 rounded-xl bg-emerald-900 px-4 text-sm font-semibold text-white disabled:opacity-50">{saving ? "Saving…" : `Mark ${rows.length} billed`}</button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
