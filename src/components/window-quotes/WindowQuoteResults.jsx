import AmscoQuoteSchedule from "./AmscoQuoteSchedule";
import QuotePricingPanel from "./QuotePricingPanel";
import { savedScheduleData } from "./quoteScheduleModel";
import { Link } from "react-router-dom";
import { ArrowUpRight, BriefcaseBusiness, CheckCircle2, FileText, Wrench } from "lucide-react";

const primaryClass = "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[#2A5EA8] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#234F8E] disabled:cursor-not-allowed disabled:opacity-50";
const present = (value) => value !== undefined && value !== null && value !== "";
const numeric = (value) => present(value) && typeof value !== "boolean" && Number.isFinite(Number(value)) ? Number(value) : null;
const positive = (value) => numeric(value) > 0 ? numeric(value) : null;
const display = (value) => value === true ? "Yes" : value === false ? "No" : present(value) ? String(value) : "Not supplied";
function money(value, currency) {
  const number = numeric(value);
  if (number === null) return "Not supplied";
  try { return new Intl.NumberFormat("en-US", { style: "currency", currency: currency || "USD" }).format(number); }
  catch { return `${number.toFixed(2)} ${currency || "USD"}`; }
}
function Specification({ label, value }) {
  return <div className="min-w-0"><dt className="text-[10px] font-medium uppercase tracking-wide text-[#77839A]">{label}</dt><dd className="mt-1 break-words text-xs leading-relaxed text-[#131A26]">{display(value)}</dd></div>;
}
import { InstallTotals } from './InstallBudgetEditor';
import { quoteInstallSummary } from '../../../base44/shared/installBudget.js';

export default function WindowQuoteResults({ quote, onWon, onPricingSave, onQuickInstall, busy }) {
  const result = quote?.result;
  const verified = quote?.worker_status === "ready" && result?.verified === true;
  if (!verified) return <div className="rounded-xl border border-dashed border-[#CBD4E1] bg-[#F6F8FC] px-5 py-10 text-center"><FileText size={28} className="mx-auto mb-3 text-[#77839A]" /><h3 className="font-semibold text-[#131A26]">Your verified quote will appear here</h3><p className="mx-auto mt-2 max-w-sm text-sm text-[#616D81]">Window schematics, saved specifications and prices appear after the quote has been checked.</p></div>;
  const lines = Array.isArray(result.lines) ? result.lines : [];
  const quantities = lines.map((line) => positive(line.qty ?? line.quantity));
  const count = quantities.length && quantities.every((qty) => qty !== null) ? quantities.reduce((sum, qty) => sum + qty, 0) : null;
  const totals = result.totals || {};
  const installSummary = quote.install_summary || quoteInstallSummary(quote);
  const currency = totals.currency || result.currency || "USD";
  const summaryRows = [["Subtotal", totals.subtotal], ["Labor", totals.labor], ["Delivery", totals.delivery], ["Freight", totals.freight], ["Tax", totals.tax]].filter(([, value]) => present(value));
  const notices = Array.isArray(result.notices) ? result.notices.filter(present) : [];
  const revision = result.input_revision ?? quote.input_revision;
  return <div className="space-y-5">
    {installSummary.enabled && <InstallTotals summary={installSummary} linked />}
    <section className="overflow-hidden rounded-2xl border border-[#DDE3EC] bg-white">
      <div className="flex flex-wrap items-start justify-between gap-4 p-5"><div><span className="mb-3 inline-flex items-center gap-1.5 rounded-full bg-[#EAF5EE] px-2.5 py-1 text-[11px] font-semibold text-[#276449]"><CheckCircle2 size={12} />Verified quote</span><h3 className="break-words font-heading text-xl font-semibold text-[#131A26]">{present(result.native_quote_number) ? `AMSCO quote ${result.native_quote_number}` : result.native_source === "desktop_native" ? "Saved AMSCO desktop quote" : result.native_source === "native_configurations" ? "Priced AMSCO window package" : "Window quote"}</h3><p className="mt-1 text-xs text-[#616D81]">{lines.length} {lines.length === 1 ? "line" : "lines"}{count !== null ? ` · ${count} ${count === 1 ? "window / assembly" : "windows / assemblies"}` : " · quantity not supplied"}{present(revision) ? ` · Revision ${revision}` : ""}</p></div><div className="sm:text-right"><p className="text-[10px] font-semibold uppercase tracking-wider text-[#77839A]">Customer total</p><p className="mt-1 break-all text-2xl sm:text-3xl font-semibold tracking-tight tabular-nums text-[#1E4A85]">{money(totals.total ?? totals.customer_total, currency)}</p></div></div>
      <dl className="grid gap-3 border-t border-[#E9EDF4] bg-[#F6F8FC] px-5 py-4 sm:grid-cols-2"><Specification label="Dealer" value={result.dealer_name || result.dealer || quote.settings?.dealer} /><Specification label="Shipping yard" value={result.yard || quote.settings?.yard} /></dl>
    </section>
    {!installSummary.enabled && onQuickInstall && quote.sales_status !== "won" && !quote.accepted_revision && !quote.job_id && <section className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-[#DDE3EC] bg-white p-4">
      <div className="min-w-0 flex-1"><h4 className="text-sm font-semibold text-[#131A26]">Install labor</h4><p className="mt-1 text-xs leading-relaxed text-[#616D81]">One tap adds installation from the 2026 BFS price sheet, rated by each window's size. Minimum $275 for the trip out for the job. Doors and specials stay flagged for the Install budget tab.</p></div>
      <button type="button" className={primaryClass} disabled={busy} onClick={onQuickInstall}><Wrench size={15} />Add install labor</button>
    </section>}
    <QuotePricingPanel quote={quote} onSave={onPricingSave} busy={busy} />
    {notices.length > 0 && <section className="rounded-2xl border border-[#EEDAB4] bg-[#FCF5E9] p-4 text-[#8A5A10]">
      <h4 className="text-sm font-semibold">Product notice</h4>
      <ul className="mt-2 space-y-1 text-xs leading-relaxed">{notices.map((notice, index) => <li key={`${index}-${notice}`}>{notice}</li>)}</ul>
    </section>}
    <AmscoQuoteSchedule {...savedScheduleData(quote)} />
    {!lines.length && <p className="rounded-xl border border-[#DDE3EC] p-5 text-sm text-[#616D81]">Line details were not supplied in this result.</p>}
    <section className="rounded-2xl border border-[#DDE3EC] bg-white p-5">
      <h4 className="text-sm font-semibold text-[#131A26]">Package totals</h4>
      <dl className="mt-4 space-y-2.5 text-sm">{summaryRows.map(([label, value]) => <div key={label} className="flex flex-wrap justify-between gap-x-4 gap-y-1"><dt className="text-[#616D81]">{label}</dt><dd className="break-all tabular-nums text-[#131A26]">{money(value, currency)}</dd></div>)}<div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 border-t border-[#E9EDF4] pt-3"><dt className="font-semibold text-[#131A26]">Customer total</dt><dd className="break-all text-xl font-semibold tabular-nums text-[#1E4A85]">{money(totals.total ?? totals.customer_total, currency)}</dd></div></dl>
      {[totals.list_total, totals.dealer_total ?? totals.dealer_cost, totals.gross_margin].some(present) && <details className="mt-4 border-t border-[#E9EDF4] pt-3"><summary className="cursor-pointer text-xs font-medium text-[#616D81]">Package cost and margin</summary><dl className="mt-3 space-y-2 text-xs">{[["List total", totals.list_total], ["Dealer cost", totals.dealer_total ?? totals.dealer_cost]].filter(([, value]) => present(value)).map(([label, value]) => <div key={label} className="flex flex-wrap justify-between gap-x-4 gap-y-1"><dt className="text-[#616D81]">{label}</dt><dd className="break-all tabular-nums text-[#131A26]">{money(value, currency)}</dd></div>)}{present(totals.gross_margin) && <div className="flex flex-wrap justify-between gap-x-4 gap-y-1"><dt className="text-[#616D81]">Gross margin</dt><dd className="text-[#131A26]">{display(totals.gross_margin)}%</dd></div>}</dl></details>}
      <p className="mt-4 text-[11px] leading-relaxed text-[#77839A]">Prices are the saved quote values. Schematics show overall proportions and are not fabrication drawings.</p>
    </section>
    {quote.job_id ? <Link to={`/jobs/${encodeURIComponent(quote.job_id)}`} className="flex items-center justify-between rounded-xl border border-[#CADFCF] bg-[#EAF5EE] p-4 text-sm font-semibold text-[#276449]"><span className="flex items-center gap-2"><BriefcaseBusiness size={17} />Won · Open linked job</span><ArrowUpRight size={16} /></Link> : <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#DDE3EC] bg-white p-4"><div><h4 className="text-sm font-semibold text-[#131A26]">Won the sale?</h4><p className="mt-1 text-xs text-[#616D81]">Accept this revision and move it into Jobs.</p></div><button type="button" className={primaryClass} disabled={busy || quote.sales_status === "won" || (installSummary.enabled && !installSummary.complete)} onClick={onWon}><CheckCircle2 size={15} />Mark won</button></div>}
  </div>;
}

