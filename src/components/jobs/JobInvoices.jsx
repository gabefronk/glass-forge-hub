import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { CUSTOMER_KINDS, invoiceInputError, kindLabel } from "@/lib/invoiceRegister";
import { denverDate } from "@/lib/feeMath";

const INK = "#101617", SECOND = "#566063", RULE = "#D6CCBA", RED = "#A43432";
const money = (value) => value === null || value === undefined ? "—" : Number(value).toLocaleString("en-US", { style: "currency", currency: "USD" });
const shortDay = (iso) => (iso ? `${Number(iso.slice(5, 7))}/${Number(iso.slice(8, 10))}/${iso.slice(2, 4)}` : "—");
const ageDays = (iso) => Math.max(0, Math.round((Date.parse(`${denverDate()}T12:00:00Z`) - Date.parse(`${iso}T12:00:00Z`)) / 86400000));
const inputClass = "h-9 w-full rounded-lg border bg-white px-2.5 text-[14px] focus:outline-none";
const blank = (customer) => ({ kind: "deposit", number: "", date: denverDate(), amount: "", customer: customer || "" });
const GRID = { display: "grid", gridTemplateColumns: "88px 96px 104px minmax(0,1fr) 124px 132px 96px", alignItems: "center" };
const cell = "px-2.5";

// Customer invoices on a job (deposit, progress, balance), recorded as they are issued in
// QuickBooks. The list is owned by JobMoneyPanel so the money strip updates with it; the
// panel's Add menu opens the form.
export default function JobInvoices({ jobId, invoices, onChange, formOpen, onFormOpen, customerName }) {
  const [form, setForm] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [payFor, setPayFor] = useState(null);
  const [payDate, setPayDate] = useState(denverDate());
  const current = formOpen ? form || blank(customerName) : null;
  const close = () => { setForm(null); setError(""); onFormOpen(false); };

  const save = async (e) => {
    e.preventDefault();
    const problem = invoiceInputError({ number: current.number, date: current.date, amount: current.amount, requireAmount: true });
    if (problem) { setError(problem); return; }
    setBusy(true); setError("");
    try {
      const number = current.number.trim();
      const taken = await base44.entities.Invoices.filter({ invoice_number: number }, "-created_date", 5);
      if ((taken || []).some((i) => !i.voided_at)) { setError(`Invoice #${number} is already recorded.`); setBusy(false); return; }
      const me = await base44.auth.me().catch(() => null);
      const created = await base44.entities.Invoices.create({
        invoice_number: number, invoice_date: current.date, kind: current.kind, job_id: jobId,
        customer_name: current.customer.trim() || customerName || "", amount: Math.round(Number(current.amount) * 100) / 100,
        created_by_email: me?.email || "",
      });
      onChange([...invoices, created]);
      close();
    } catch (err) { setError(`Invoice was not recorded. ${err?.message || ""}`.trim()); }
    setBusy(false);
  };

  const patch = async (inv, changes, failure) => {
    setBusy(true); setError("");
    try {
      await base44.entities.Invoices.update(inv.id, changes);
      onChange(invoices.map((i) => (i.id === inv.id ? { ...i, ...changes } : i)));
      setPayFor(null);
    } catch (err) { setError(`${failure} ${err?.message || ""}`.trim()); }
    setBusy(false);
  };
  const voidInvoice = (inv) => {
    if (window.confirm(`Void invoice #${inv.invoice_number}? It stays on record as voided.`)) patch(inv, { voided_at: new Date().toISOString() }, "Invoice was not voided.");
  };

  const live = invoices.filter((i) => !i.voided_at).sort((a, b) => String(a.invoice_date).localeCompare(String(b.invoice_date)));
  const total = live.reduce((n, i) => n + (Number(i.amount) || 0), 0);

  return (
    <div>
      <h3 className="m-0 mb-2 text-[15px] font-bold" style={{ color: INK }}>Customer invoices</h3>
      {current && (
        <form onSubmit={save} className="mb-3 grid gap-2 rounded-lg p-3 sm:grid-cols-5" style={{ border: `1px solid ${RULE}`, background: "#FAF8F3" }}>
          <label className="text-[13px] font-medium" style={{ color: INK }}>Kind
            <select className={inputClass} style={{ borderColor: "#9A9080" }} value={current.kind} onChange={(e) => setForm({ ...current, kind: e.target.value })}>
              {CUSTOMER_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
            </select>
          </label>
          <label className="text-[13px] font-medium" style={{ color: INK }}>QuickBooks invoice #
            <input autoFocus className={inputClass} style={{ borderColor: "#9A9080" }} value={current.number} onChange={(e) => setForm({ ...current, number: e.target.value })} />
          </label>
          <label className="text-[13px] font-medium" style={{ color: INK }}>Invoice date
            <input type="date" className={inputClass} style={{ borderColor: "#9A9080" }} value={current.date} onChange={(e) => setForm({ ...current, date: e.target.value })} />
          </label>
          <label className="text-[13px] font-medium" style={{ color: INK }}>Amount
            <input inputMode="decimal" className={inputClass} style={{ borderColor: "#9A9080" }} value={current.amount} onChange={(e) => setForm({ ...current, amount: e.target.value.replace(/[^0-9.]/g, "") })} placeholder="0.00" />
          </label>
          <label className="text-[13px] font-medium" style={{ color: INK }}>Customer
            <input className={inputClass} style={{ borderColor: "#9A9080" }} value={current.customer} onChange={(e) => setForm({ ...current, customer: e.target.value })} />
          </label>
          <div className="flex gap-2 sm:col-span-5">
            <button type="submit" disabled={busy} className="h-9 rounded-lg px-4 text-[14px] font-semibold text-white disabled:opacity-50" style={{ background: "#0B3F3B" }}>{busy ? "Saving…" : "Save invoice"}</button>
            <button type="button" disabled={busy} onClick={close} className="h-9 rounded-lg border px-4 text-[14px]" style={{ borderColor: "#9A9080", color: INK }}>Cancel</button>
          </div>
        </form>
      )}
      {error && <p role="alert" className="mb-2 text-[14px]" style={{ color: RED }}>{error}</p>}
      <div role="table" aria-label="Customer invoices" className="text-[14px]" style={{ color: INK }}>
        <div role="row" className="text-[11.5px] font-semibold uppercase" style={{ ...GRID, height: 36, background: "#E9E2D4", borderBottom: "2px solid #34403F", color: "#34403F", letterSpacing: "0.06em" }}>
          <span role="columnheader" className={cell}>Date</span>
          <span role="columnheader" className={cell}>No.</span>
          <span role="columnheader" className={cell}>Kind</span>
          <span role="columnheader" className={cell}>Customer</span>
          <span role="columnheader" className={`${cell} text-right`}>Amount</span>
          <span role="columnheader" className={cell}>Status</span>
          <span role="columnheader" className={cell}><span className="sr-only">Actions</span></span>
        </div>
        {live.length ? live.map((inv) => (
          <div key={inv.id} role="row" style={{ ...GRID, minHeight: 40, borderBottom: `1px solid ${RULE}` }}>
            <span role="cell" className={`${cell} tabular-nums`}>{shortDay(inv.invoice_date)}</span>
            <span role="cell" className={cell} style={{ fontFamily: "'Geist Mono', ui-monospace, monospace", fontSize: 13, color: "#34403F" }}>{inv.invoice_number}</span>
            <span role="cell" className={cell}>{kindLabel(inv.kind)}</span>
            <span role="cell" className={`${cell} truncate`}>{inv.customer_name || ""}</span>
            <span role="cell" className={`${cell} text-right tabular-nums`}>{money(inv.amount)}</span>
            <span role="cell" className={`${cell} inline-flex items-center gap-2`}>
              <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: inv.paid_date ? "#0B3F3B" : "#C08B2E" }} />
              {inv.paid_date ? `Paid ${shortDay(inv.paid_date)}` : `Open · ${ageDays(inv.invoice_date)}d`}
            </span>
            <span role="cell" className={`${cell} flex justify-end`}>
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button type="button" disabled={busy} className="inline-flex h-8 items-center gap-1 rounded-lg border px-2.5 text-[13px] font-medium" style={{ borderColor: "#9A9080", color: INK }} aria-label={`Actions for invoice ${inv.invoice_number}`}>More<ChevronDown className="h-3.5 w-3.5" /></button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="min-w-[180px] p-1">
                  {inv.paid_date
                    ? <DropdownMenuItem className="min-h-9 cursor-pointer text-[14px]" onSelect={() => patch(inv, { paid_date: null }, "Payment was not undone.")}>Undo paid</DropdownMenuItem>
                    : <DropdownMenuItem className="min-h-9 cursor-pointer text-[14px]" onSelect={() => { setPayFor(inv.id); setPayDate(denverDate()); }}>Mark paid…</DropdownMenuItem>}
                  <DropdownMenuItem className="min-h-9 cursor-pointer text-[14px]" style={{ color: RED }} onSelect={() => voidInvoice(inv)}>Void invoice</DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            </span>
            {payFor === inv.id && (
              <div className="flex items-center justify-end gap-2 px-2.5 pb-2" style={{ gridColumn: "1 / -1" }}>
                <label className="text-[14px]" style={{ color: SECOND }} htmlFor={`paid-${inv.id}`}>Paid on</label>
                <input id={`paid-${inv.id}`} type="date" value={payDate} onChange={(e) => setPayDate(e.target.value)} className="h-9 rounded-lg border px-2 text-[14px]" style={{ borderColor: "#9A9080" }} />
                <button type="button" disabled={busy || !payDate} onClick={() => patch(inv, { paid_date: payDate }, "Payment was not saved.")} className="h-9 rounded-lg px-3 text-[14px] font-semibold text-white disabled:opacity-50" style={{ background: "#0B3F3B" }}>Save</button>
                <button type="button" onClick={() => setPayFor(null)} className="h-9 rounded-lg border px-3 text-[14px]" style={{ borderColor: "#9A9080", color: INK }}>Cancel</button>
              </div>
            )}
          </div>
        )) : (
          <div role="row" className="px-2.5 text-[14px]" style={{ minHeight: 40, display: "flex", alignItems: "center", borderBottom: `1px solid ${RULE}`, color: SECOND }}>
            <span role="cell">No customer invoices recorded. Use Add → Customer invoice when one is issued in QuickBooks.</span>
          </div>
        )}
        {live.length > 1 && (
          <div role="row" className="font-bold" style={{ ...GRID, minHeight: 40, background: "#FAF8F3", borderBottom: `1px solid ${RULE}` }}>
            <span role="cell" className={cell} style={{ gridColumn: "1 / 5" }}>Total</span>
            <span role="cell" className={`${cell} text-right tabular-nums`}>{money(Math.round(total * 100) / 100)}</span>
          </div>
        )}
      </div>
    </div>
  );
}
