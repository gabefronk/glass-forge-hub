import { useEffect, useState } from "react";
import { base44 } from "@/api/base44Client";
import { C } from "@/lib/feeUI";
import { CUSTOMER_KINDS, invoiceInputError, jobInvoiceSummary, kindLabel } from "@/lib/invoiceRegister";
import { denverDate } from "../../../base44/shared/billingCore.js";

const money = (value) => value === null || value === undefined ? "—" : Number(value).toLocaleString("en-US", { style: "currency", currency: "USD" });
const day = (iso) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { timeZone: "UTC" }) : "—");
const inputClass = "min-h-10 w-full rounded-lg border border-slate-300 bg-white px-2.5 text-[13px] focus:border-emerald-700 focus:outline-none";
const blank = () => ({ kind: "deposit", number: "", date: denverDate(), amount: "", customer: "" });

// Customer invoices on a job (deposit, progress, balance), recorded as they are issued in
// QuickBooks, so the job shows what was invoiced, what was paid and what is still owed.
export default function JobInvoices({ jobIds, jobId, budgetSell, customerName }) {
  const key = jobIds.join(",");
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [form, setForm] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [payFor, setPayFor] = useState(null);
  const [payDate, setPayDate] = useState(denverDate());

  useEffect(() => {
    let active = true;
    setLoading(true);
    const ids = key.split(",").filter(Boolean);
    base44.entities.Invoices.filter(ids.length > 1 ? { job_id: { $in: ids } } : { job_id: ids[0] }, "invoice_date", 200)
      .then((rows) => { if (active) { setInvoices(Array.isArray(rows) ? rows : []); setLoading(false); } })
      .catch(() => { if (active) { setError("Invoices could not be loaded."); setLoading(false); } });
    return () => { active = false; };
  }, [key]);

  const summary = jobInvoiceSummary(invoices.map((i) => ({ ...i, job_id: jobId })), jobId);
  const toInvoice = budgetSell != null ? Math.round((Number(budgetSell) - summary.invoiced) * 100) / 100 : null;

  const save = async (e) => {
    e.preventDefault();
    const problem = invoiceInputError({ number: form.number, date: form.date, amount: form.amount, requireAmount: true });
    if (problem) { setError(problem); return; }
    setBusy(true); setError("");
    try {
      const number = form.number.trim();
      const taken = await base44.entities.Invoices.filter({ invoice_number: number }, "-created_date", 5);
      if ((taken || []).some((i) => !i.voided_at)) { setError(`Invoice #${number} is already recorded.`); setBusy(false); return; }
      const me = await base44.auth.me().catch(() => null);
      const created = await base44.entities.Invoices.create({
        invoice_number: number, invoice_date: form.date, kind: form.kind, job_id: jobId,
        customer_name: form.customer.trim() || customerName || "", amount: Math.round(Number(form.amount) * 100) / 100,
        created_by_email: me?.email || "",
      });
      setInvoices((prev) => [...prev, created]);
      setForm(null);
    } catch (err) { setError(`Invoice was not recorded. ${err?.message || ""}`.trim()); }
    setBusy(false);
  };

  const setPaid = async (inv, date) => {
    setBusy(true); setError("");
    try {
      await base44.entities.Invoices.update(inv.id, { paid_date: date });
      setInvoices((prev) => prev.map((i) => (i.id === inv.id ? { ...i, paid_date: date } : i)));
      setPayFor(null);
    } catch (err) { setError(`Payment was not saved. ${err?.message || ""}`.trim()); }
    setBusy(false);
  };

  const voidInvoice = async (inv) => {
    if (!window.confirm(`Void invoice #${inv.invoice_number}? It stays on record as voided.`)) return;
    setBusy(true);
    try {
      const voided_at = new Date().toISOString();
      await base44.entities.Invoices.update(inv.id, { voided_at });
      setInvoices((prev) => prev.map((i) => (i.id === inv.id ? { ...i, voided_at } : i)));
    } catch (err) { setError(`Invoice was not voided. ${err?.message || ""}`.trim()); }
    setBusy(false);
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="text-[12px] font-bold" style={{ color: C.text }}>Customer invoices</h3>
        {!form && <button type="button" onClick={() => { setForm({ ...blank(), customer: customerName || "" }); setError(""); }} className="min-h-9 rounded-lg border px-3 text-[12px] font-semibold" style={{ borderColor: C.border, color: C.accentText }}>Record invoice</button>}
      </div>
      <div className="mb-2 grid grid-cols-3 gap-2 text-[11px]">
        {[["Invoiced", summary.invoiced], ["Paid", summary.paid], ["Still owed", summary.owed]].map(([label, value]) => (
          <div key={label} className="rounded-lg p-2" style={{ background: C.cardAlt, border: `1px solid ${C.rowBorder}` }}>
            <div className="font-semibold uppercase tracking-[0.08em]" style={{ color: C.textMuted, fontSize: 10 }}>{label}</div>
            <div className="mt-0.5 text-[15px] font-semibold" style={{ color: C.text }}>{money(value)}</div>
          </div>
        ))}
      </div>
      {toInvoice != null && <p className="mb-2 text-[11px]" style={{ color: C.textMuted }}>Budget sell {money(budgetSell)} · left to invoice {money(toInvoice)}</p>}
      {form && (
        <form onSubmit={save} className="mb-3 grid gap-2 rounded-lg p-3 sm:grid-cols-2" style={{ border: `1px solid ${C.rowBorder}` }}>
          <label className="text-[11px] font-medium">Kind
            <select className={inputClass} value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value })}>
              {CUSTOMER_KINDS.map((k) => <option key={k.key} value={k.key}>{k.label}</option>)}
            </select>
          </label>
          <label className="text-[11px] font-medium">QuickBooks invoice #
            <input autoFocus className={inputClass} value={form.number} onChange={(e) => setForm({ ...form, number: e.target.value })} />
          </label>
          <label className="text-[11px] font-medium">Invoice date
            <input type="date" className={inputClass} value={form.date} onChange={(e) => setForm({ ...form, date: e.target.value })} />
          </label>
          <label className="text-[11px] font-medium">Amount
            <input inputMode="decimal" className={inputClass} value={form.amount} onChange={(e) => setForm({ ...form, amount: e.target.value.replace(/[^0-9.]/g, "") })} placeholder="0.00" />
          </label>
          <label className="text-[11px] font-medium sm:col-span-2">Customer
            <input className={inputClass} value={form.customer} onChange={(e) => setForm({ ...form, customer: e.target.value })} />
          </label>
          <div className="flex gap-2 sm:col-span-2">
            <button type="submit" disabled={busy} className="min-h-10 rounded-lg bg-emerald-900 px-4 text-[12px] font-semibold text-white disabled:opacity-50">{busy ? "Saving…" : "Save invoice"}</button>
            <button type="button" disabled={busy} onClick={() => { setForm(null); setError(""); }} className="min-h-10 rounded-lg border px-4 text-[12px]">Cancel</button>
          </div>
        </form>
      )}
      {error && <p role="alert" className="mb-2 text-[11px]" style={{ color: "#A43432" }}>{error}</p>}
      {loading ? <p className="text-[11px]" style={{ color: C.textMuted }}>Loading invoices…</p>
        : summary.list.length ? summary.list.map((inv) => (
          <div key={inv.id} className="mb-2 flex flex-wrap items-center justify-between gap-2 rounded-lg p-2.5 text-[11px]" style={{ border: `1px solid ${C.rowBorder}` }}>
            <div>
              <div className="font-semibold" style={{ color: C.text }}>{kindLabel(inv.kind)} · #{inv.invoice_number} · {money(inv.amount)}</div>
              <div style={{ color: C.textMuted }}>{day(inv.invoice_date)}{inv.customer_name ? ` · ${inv.customer_name}` : ""} · {inv.paid_date ? `paid ${day(inv.paid_date)}` : "open"}</div>
            </div>
            <div className="flex items-center gap-2">
              {payFor === inv.id ? (<>
                <input type="date" aria-label="Payment date" value={payDate} onChange={(e) => setPayDate(e.target.value)} className="min-h-9 rounded-lg border border-slate-300 px-2 text-[12px]" />
                <button type="button" disabled={busy || !payDate} onClick={() => setPaid(inv, payDate)} className="min-h-9 rounded-lg bg-emerald-900 px-3 text-[12px] font-semibold text-white disabled:opacity-50">Save</button>
                <button type="button" onClick={() => setPayFor(null)} className="min-h-9 rounded-lg border px-3 text-[12px]">Cancel</button>
              </>) : inv.paid_date ? (
                <button type="button" disabled={busy} onClick={() => setPaid(inv, null)} className="min-h-9 rounded-lg border px-3 text-[12px]">Undo paid</button>
              ) : (<>
                <button type="button" disabled={busy} onClick={() => { setPayFor(inv.id); setPayDate(denverDate()); }} className="min-h-9 rounded-lg border px-3 text-[12px] font-semibold" style={{ color: C.accentText }}>Mark paid</button>
                <button type="button" disabled={busy} onClick={() => voidInvoice(inv)} className="min-h-9 rounded-lg border px-3 text-[12px]" style={{ color: C.textMuted }}>Void</button>
              </>)}
            </div>
          </div>
        )) : <p className="text-[11px]" style={{ color: C.textMuted }}>No customer invoices recorded for this job.</p>}
    </div>
  );
}
