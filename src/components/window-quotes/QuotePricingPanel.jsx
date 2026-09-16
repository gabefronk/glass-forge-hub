import { useMemo, useState } from "react";
import { Calculator, CheckCircle2 } from "lucide-react";
import { savedScheduleData } from "./quoteScheduleModel";
import { inputClass, secondaryClass } from "./TakeoffEditor";

const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
const money = (value) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(value);

// Quote pricing panel (approved build 2026-09-16): per-quote gross margin and
// tax rates applied to the saved dealer costs. Rounding rule, stated in the
// caption below: sell subtotal = dealer cost / (1 - margin), rounded to cents;
// tax = sell subtotal x tax rate, rounded to cents; final = sell + tax.
// Lines without a resolved dealer price are excluded and listed.
export default function QuotePricingPanel({ quote, onSave, busy }) {
  const data = savedScheduleData(quote);
  const { priced, excluded } = useMemo(() => {
    const priced = [], excluded = [];
    data.lines.forEach((line, index) => {
      const price = data.prices[index];
      const dealer = Number(price?.line_totals?.dealer);
      if (price && Number.isFinite(dealer)) priced.push({ line, dealer });
      else excluded.push({ line, index });
    });
    return { priced, excluded };
  }, [quote]);
  const savedMargin = Number(data.settings?.gross_margin);
  const savedTax = Number(data.settings?.tax_pct);
  const defaultMargin = Number.isFinite(savedMargin) ? String(savedMargin) : "30";
  const defaultTax = Number.isFinite(savedTax) ? String(savedTax) : "7.45";
  const [margin, setMargin] = useState(defaultMargin);
  const [taxPct, setTaxPct] = useState(defaultTax);
  const m = Number(margin), t = Number(taxPct);
  const marginOk = margin.trim() !== "" && Number.isFinite(m) && m >= 0 && m < 100;
  const taxOk = taxPct.trim() !== "" && Number.isFinite(t) && t >= 0 && t <= 25;
  const dealerSubtotal = round2(priced.reduce((sum, x) => sum + x.dealer, 0));
  const sellSubtotal = marginOk ? round2(dealerSubtotal / (1 - m / 100)) : null;
  const taxAmount = sellSubtotal !== null && taxOk ? round2(sellSubtotal * (t / 100)) : null;
  const finalTotal = sellSubtotal !== null && taxAmount !== null ? round2(sellSubtotal + taxAmount) : null;
  const unchanged = margin === defaultMargin && taxPct === defaultTax;
  return <section className="rounded-2xl border border-[#DDE3EC] bg-white p-5">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h4 className="flex items-center gap-2 text-sm font-semibold text-[#131A26]"><Calculator size={15} />Quote pricing</h4>
      <button type="button" className={secondaryClass} disabled={busy || !marginOk || !taxOk || unchanged || typeof onSave !== "function"} onClick={() => onSave({ gross_margin: m, tax_pct: t })}><CheckCircle2 size={14} />Save rates</button>
    </div>
    <div className="mt-4 grid gap-3 sm:grid-cols-2">
      <label className="block min-w-0"><span className="mb-1.5 block text-xs font-medium text-[#616D81]">Gross margin (%)</span><input className={inputClass} type="number" min="0" max="99.9999" step="any" value={margin} onChange={(e) => setMargin(e.target.value)} disabled={busy} /></label>
      <label className="block min-w-0"><span className="mb-1.5 block text-xs font-medium text-[#616D81]">Tax (%)</span><input className={inputClass} type="number" min="0" max="25" step="any" value={taxPct} onChange={(e) => setTaxPct(e.target.value)} disabled={busy} /></label>
    </div>
    {!marginOk && <p className="mt-2 text-xs text-[#A43432]">Gross margin must be a number from 0 up to, but not including, 100%.</p>}
    {!taxOk && <p className="mt-2 text-xs text-[#A43432]">Tax must be a number from 0 to 25%.</p>}
    <dl className="mt-4 space-y-2.5 text-sm">
      <div className="flex flex-wrap justify-between gap-x-4 gap-y-1"><dt className="text-[#616D81]">Dealer cost subtotal</dt><dd className="break-all tabular-nums text-[#131A26]">{money(dealerSubtotal)}</dd></div>
      <div className="flex flex-wrap justify-between gap-x-4 gap-y-1"><dt className="text-[#616D81]">Sell subtotal{marginOk ? ` at ${m}% margin` : ""}</dt><dd className="break-all tabular-nums text-[#131A26]">{sellSubtotal === null ? "—" : money(sellSubtotal)}</dd></div>
      <div className="flex flex-wrap justify-between gap-x-4 gap-y-1"><dt className="text-[#616D81]">Tax{taxOk ? ` at ${t}%` : ""}</dt><dd className="break-all tabular-nums text-[#131A26]">{taxAmount === null ? "—" : money(taxAmount)}</dd></div>
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-[#E9EDF4] pt-3"><dt className="font-semibold text-[#131A26]">Final total</dt><dd className="break-all text-xl font-semibold tabular-nums text-[#1E4A85]">{finalTotal === null ? "—" : money(finalTotal)}</dd></div>
    </dl>
    {excluded.length > 0 && <div className="mt-4 rounded-lg border border-[#EEDAB4] bg-[#FCF5E9] p-3">
      <p className="text-xs font-semibold text-[#8A5A10]">Not included in this total - {excluded.length} unresolved {excluded.length === 1 ? "line" : "lines"}</p>
      <ul className="mt-1.5 list-disc space-y-1 pl-4 text-xs leading-relaxed text-[#8A5A10]">{excluded.map(({ line, index }) => <li key={index}>{line.id || line.mark || `Line ${index + 1}`}{line.style ? ` · ${line.style}` : ""} - unresolved price</li>)}</ul>
    </div>}
    <p className="mt-4 text-[11px] leading-relaxed text-[#77839A]">Sell subtotal = dealer cost / (1 - margin), rounded to cents. Tax = sell subtotal x tax rate, rounded to cents. Rates save per quote; quotes without saved rates default to 30% margin and 7.45% tax. Saved customer prices from the quoting run are unchanged.</p>
  </section>;
}
