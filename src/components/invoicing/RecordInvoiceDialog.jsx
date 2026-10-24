import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { computeFeeAmt, computeLaborAmt, formatMoney } from "@/lib/feeMath";
import { invoiceInputError } from "@/lib/invoiceRegister";
import { denverDate } from "../../../base44/shared/billingCore.js";

const inputClass = "mt-1.5 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 text-base focus:border-emerald-700 focus:outline-none sm:text-sm";

// Billing records the QuickBooks invoice the lines went out on, so the Hub and the
// books agree on what was invoiced and what is still owed.
export default function RecordInvoiceDialog({ request, onCancel, onConfirm }) {
  const [number, setNumber] = useState("");
  const [date, setDate] = useState(denverDate());
  const [error, setError] = useState("");
  useEffect(() => { if (request) { setNumber(""); setDate(denverDate()); setError(""); } }, [request]);

  const rows = request?.rows || [];
  const labor = rows.reduce((n, r) => n + (computeLaborAmt(r) || 0), 0);
  const fee = rows.reduce((n, r) => n + (computeFeeAmt(r) || 0), 0);

  const submit = (e) => {
    e.preventDefault();
    const problem = invoiceInputError({ number, date });
    if (problem) { setError(problem); return; }
    onConfirm({ number: number.trim(), date });
  };

  return (
    <Dialog open={!!request} onOpenChange={(open) => { if (!open) onCancel(); }}>
      <DialogContent className="bottom-0 top-auto w-full max-w-none translate-y-0 rounded-b-none rounded-t-2xl sm:bottom-auto sm:top-1/2 sm:max-w-md sm:-translate-y-1/2 sm:rounded-lg">
        <DialogHeader>
          <DialogTitle>Record invoice</DialogTitle>
          <DialogDescription>
            {request?.label ? `${request.label} · ` : ""}{rows.length} {rows.length === 1 ? "line" : "lines"} · ${formatMoney(labor)} labor · ${formatMoney(fee)} fee. Enter the invoice as it appears in QuickBooks.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={submit} className="space-y-4">
          <label className="block text-sm font-medium">QuickBooks invoice number <span className="text-red-700">*</span>
            <input autoFocus required className={inputClass} value={number} onChange={(e) => { setNumber(e.target.value); setError(""); }} placeholder="e.g. 1042" />
          </label>
          <label className="block text-sm font-medium">Invoice date <span className="text-red-700">*</span>
            <input type="date" required className={inputClass} value={date} onChange={(e) => { setDate(e.target.value); setError(""); }} />
          </label>
          {error && <p role="alert" className="text-sm text-red-700">{error}</p>}
          <DialogFooter>
            <button type="button" onClick={onCancel} className="min-h-11 rounded-xl border px-4 text-sm font-medium">Cancel</button>
            <button type="submit" disabled={!rows.length} className="min-h-11 rounded-xl bg-emerald-900 px-4 text-sm font-semibold text-white disabled:opacity-50">Mark {rows.length} billed</button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
