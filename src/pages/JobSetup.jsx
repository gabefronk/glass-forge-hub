import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { ArrowLeft, Check, FileText, Plus, Printer, Save } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { useAuth } from "@/lib/AuthContext";
import PageNotFound from "@/lib/PageNotFound";
import { isPurchaseOrderOwner } from "@/lib/purchaseOrderAccess";
import { buildSetupDraft, computeSetupTotals, contractTermsReady, toContractViewModel } from "@/lib/jobSetup";

const money = (v) => v === "" || v === null || v === undefined || !Number.isFinite(Number(v)) ? "—" : Number(v).toLocaleString("en-US", { style: "currency", currency: "USD" });
const field = "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900";
const label = "mb-1 block text-xs font-semibold text-slate-600";
const blankLine = () => ({ mark: "", qty: "", size: "", product: "", description: "", customer_price: "" });

function Field({ title, value, onChange, type = "text", placeholder = "" }) {
  return <label><span className={label}>{title}</span><input className={field} type={type} value={value ?? ""} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} /></label>;
}
function Area({ title, value, onChange, placeholder = "" }) {
  return <label><span className={label}>{title}</span><textarea className={`${field} min-h-24`} value={value || ""} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} /></label>;
}
function Card({ title, note = "", children }) {
  return <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="text-lg font-bold text-slate-900">{title}</h2>{note && <p className="mt-1 text-xs text-slate-500">{note}</p>}<div className="mt-4">{children}</div></section>;
}

export default function JobSetup() {
  const { user } = useAuth();
  if (!isPurchaseOrderOwner(user)) return <PageNotFound />;
  return <JobSetupOwner user={user} />;
}

function JobSetupOwner({ user }) {
  const { id } = useParams();
  const [job, setJob] = useState(null), [sheet, setSheet] = useState(null);
  const [recordId, setRecordId] = useState(""), [busy, setBusy] = useState(true), [message, setMessage] = useState("");
  const [contract, setContract] = useState(false);
  const load = useCallback(async () => {
    setBusy(true); setMessage("");
    try {
      const [j, setups, budgets, costs] = await Promise.all([
        base44.entities.Jobs.get(id), base44.entities.JobSetupSheets.filter({ job_id: id }, "-updated_date", 2),
        base44.entities.JobBudgets.filter({ job_id: id }, "-updated_date", 1).catch(() => []),
        base44.entities.JobCostInputs.filter({ job_id: id }, "-updated_date", 1).catch(() => []),
      ]);
      const installs = j.source_window_quote_id ? await base44.entities.InstallBudgets.filter({ request_id: j.source_window_quote_id }, "-updated_date", 1).catch(() => []) : [];
      setJob(j);
      if (setups[0]) { setSheet(setups[0]); setRecordId(setups[0].id); }
      else setSheet(buildSetupDraft({ job: j, budget: budgets[0], costInput: costs[0], installBudget: installs[0] }));
    } catch (e) { setMessage(e?.message || "Setup sheet could not load."); }
    finally { setBusy(false); }
  }, [id]);
  useEffect(() => { load(); }, [load]);
  const totals = useMemo(() => computeSetupTotals(sheet || {}), [sheet]);
  const setCustomer = (key, value) => setSheet((s) => ({ ...s, customer: { ...s.customer, [key]: value } }));
  const setCost = (key, value) => setSheet((s) => ({ ...s, costs: { ...s.costs, [key]: value } }));
  const setPricing = (key, value) => setSheet((s) => ({ ...s, pricing: { ...s.pricing, [key]: value } }));
  const setTerms = (key, value) => setSheet((s) => ({ ...s, terms: { ...s.terms, [key]: value } }));
  async function save(patch = {}) {
    const next = { ...sheet, ...patch };
    if (next.status === "approved" && (!String(next.approver_name || "").trim() || !next.approved_date || !contractTermsReady(next))) {
      setMessage("Enter and review all contract terms, approver name, and date before marking this sheet approved. Typed fields do not verify the named person's approval.");
      return;
    }
    setBusy(true); setMessage("");
    try {
      const payload = { ...next, job_id: id, created_by_email: sheet.created_by_email || user.email };
      delete payload.id; delete payload.created_date; delete payload.updated_date; delete payload.created_by;
      const saved = recordId ? await base44.entities.JobSetupSheets.update(recordId, payload) : await base44.entities.JobSetupSheets.create(payload);
      setRecordId(saved.id); setSheet(saved); setMessage("Setup sheet saved.");
    } catch (e) { setMessage(e?.message || "Could not save."); }
    finally { setBusy(false); }
  }
  if (busy && !sheet) return <div className="p-10 text-sm text-slate-500">Loading setup sheet…</div>;
  if (!job || !sheet) return <div className="p-10"><p className="text-red-700">{message || "Job not found."}</p><Link to={`/jobs/${id}`}>Back to job</Link></div>;
  if (contract) return <ContractPage model={toContractViewModel(sheet, job)} termsReady={contractTermsReady(sheet)} onBack={() => setContract(false)} />;
  const sources = sheet.sources || {};
  return <main className="min-h-screen bg-slate-50 px-4 py-6 text-slate-900 sm:px-7">
    <div className="mx-auto max-w-6xl">
      <Link to={`/jobs/${id}`} className="inline-flex items-center gap-1 text-sm text-blue-800"><ArrowLeft size={15} />Back to job</Link>
      <div className="mt-3 flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-wider text-amber-700">Owner only</p><h1 className="text-3xl font-bold">Job Setup &amp; Contract</h1><p className="text-sm text-slate-500">{job.canonical_name}</p></div><div className="flex flex-wrap gap-2"><button className="rounded-lg border bg-white px-3 py-2 text-sm" onClick={() => setContract(true)}><FileText className="mr-1 inline" size={15} />Customer contract</button><button className="rounded-lg bg-blue-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled={busy} onClick={() => save()}><Save className="mr-1 inline" size={15} />Save</button></div></div>
      {message && <p role="status" className="mt-3 rounded-lg bg-blue-50 p-3 text-sm text-blue-900">{message}</p>}
      <div className="mt-5 grid gap-5">
        <Card title="Customer & job"><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{[["name","Customer name"],["phone","Phone"],["email","Email"],["billing_address","Billing address"],["job_site_address","Job site address"],["builder_gc","Builder / GC"]].map(([k,t]) => <Field key={k} title={t} value={sheet.customer?.[k]} onChange={(v) => setCustomer(k,v)} />)}</div></Card>
        <Card title="Scope schedule" note="Prefilled from the accepted quote when available, otherwise from the linked job budget. Customer prices are the only line prices printed on the contract.">
          <div className="overflow-x-auto"><table className="w-full min-w-[850px] text-sm"><thead><tr>{["Mark","Qty","Size","Product","Description","Customer price",""] .map((x) => <th key={x} className="p-2 text-left text-xs text-slate-500">{x}</th>)}</tr></thead><tbody>{sheet.scope_lines.map((line,i) => <tr key={i} className="border-t"><td className="p-1"><input className={field} value={line.mark} onChange={(e) => setSheet(s => ({...s,scope_lines:s.scope_lines.map((x,j)=>j===i?{...x,mark:e.target.value}:x)}))}/></td>{["qty","size","product","description","customer_price"].map(k => <td className="p-1" key={k}><input className={field} type={["qty","customer_price"].includes(k)?"number":"text"} value={line[k] ?? ""} onChange={(e) => setSheet(s => ({...s,scope_lines:s.scope_lines.map((x,j)=>j===i?{...x,[k]:e.target.value}:x)}))}/></td>)}<td><button aria-label="Remove line" className="px-2 text-red-700" onClick={() => setSheet(s=>({...s,scope_lines:s.scope_lines.filter((_,j)=>j!==i)}))}>×</button></td></tr>)}</tbody></table></div>
          <button className="mt-3 text-sm font-semibold text-blue-800" onClick={() => setSheet(s=>({...s,scope_lines:[...s.scope_lines,blankLine()]}))}><Plus className="inline" size={14}/> Add manual line</button>
          <div className="mt-4 grid gap-3 md:grid-cols-3"><Area title="Scope notes" value={sheet.scope_notes} onChange={v=>setSheet(s=>({...s,scope_notes:v}))}/><Area title="Inclusions" value={sheet.inclusions} onChange={v=>setSheet(s=>({...s,inclusions:v}))}/><Area title="Exclusions" value={sheet.exclusions} onChange={v=>setSheet(s=>({...s,exclusions:v}))}/></div>
        </Card>
        <Card title="Budget & pricing" note="Uses the existing Window Budget Sheet for internal cost and target sell. Its 7.45% use tax is not customer sales tax; verify the customer tax separately. Source labels show where prefilled values came from.">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">{[["material_product","Material / product cost"],["labor","Labor cost"],["install_materials","Install materials"],["equipment","Equipment"],["other","Other cost"]].map(([k,t])=><div key={k}><Field title={t} type="number" value={sheet.costs?.[k]} onChange={v=>setCost(k,v)}/><p className="mt-1 text-[11px] text-slate-500">Source: {sources[k] || "Manual"}</p></div>)}</div>
          <div className="mt-4 grid gap-3 sm:grid-cols-3">{[["sell_price","Sell price"],["tax","Tax"],["contract_total","Contract total"]].map(([k,t])=><div key={k}><Field title={t} type="number" value={sheet.pricing?.[k]} onChange={v=>setPricing(k,v)}/><p className="mt-1 text-[11px] text-slate-500">Source: {sources[k] || (sheet.pricing?.[k] === "" ? "Computed target" : "Manual")}</p></div>)}</div>
          <dl className="mt-5 grid gap-3 rounded-xl bg-slate-900 p-4 text-white sm:grid-cols-3 lg:grid-cols-6">{[["Cost budget",money(totals.cost_budget)],["Sell price",money(totals.sell_price)],["Tax",money(totals.tax)],["Contract total",money(totals.contract_total)],["Gross profit",money(totals.gross_profit)],["Profit margin",totals.profit_margin_pct===null?"—":`${(totals.profit_margin_pct*100).toFixed(1)}%`]].map(([a,b])=><div key={a}><dt className="text-xs text-slate-300">{a}</dt><dd className="font-semibold">{b}</dd></div>)}</dl>
        </Card>
        <Card title="Terms" note="No standard deposit, payment schedule, lead time, warranty or validity is assumed. Enter and verify each term for this job before marking the sheet approved or printing."><div className="grid gap-3 sm:grid-cols-2"><Field title="Deposit %" type="number" value={sheet.terms?.deposit_pct} onChange={v=>setTerms("deposit_pct",v)}/><Field title="Deposit amount (computed)" value={sheet.terms?.deposit_pct === "" ? "—" : money(totals.contract_total*Number(sheet.terms?.deposit_pct)/100)} onChange={()=>{}}/><Area title="Payment schedule" value={sheet.terms?.payment_schedule} onChange={v=>setTerms("payment_schedule",v)}/><Area title="Warranty" value={sheet.terms?.warranty_text} onChange={v=>setTerms("warranty_text",v)}/><Field title="Estimated lead time" value={sheet.terms?.estimated_lead_time} onChange={v=>setTerms("estimated_lead_time",v)}/><Field title="Estimated start" type="date" value={sheet.terms?.estimated_start} onChange={v=>setTerms("estimated_start",v)}/><Field title="Quote valid for days" type="number" value={sheet.terms?.quote_valid_days} onChange={v=>setTerms("quote_valid_days",v)}/></div></Card>
        <Card title="Approval" note="Approval only records status. It does not send anything or create a purchase order."><div className="flex flex-wrap items-end gap-3"><label><span className={label}>Status</span><select className={field} value={sheet.status} onChange={e=>setSheet(s=>({...s,status:e.target.value}))}><option value="draft">Draft</option><option value="sent_for_approval">Sent for approval</option><option value="approved">Approved</option></select></label>{sheet.status==="approved"&&<><Field title="Approver name (typed)" value={sheet.approver_name} onChange={v=>setSheet(s=>({...s,approver_name:v}))}/><Field title="Approved date" type="date" value={sheet.approved_date} onChange={v=>setSheet(s=>({...s,approved_date:v}))}/></>}<button className="rounded-lg bg-blue-800 px-4 py-2 text-sm font-semibold text-white" onClick={()=>save()}><Check className="mr-1 inline" size={15}/>Save status</button></div>{sheet.status==="approved"&&<p className="mt-4 rounded-lg bg-amber-50 p-3 font-semibold text-amber-800">Marked approved in Hub; entered approver fields are not independently verified. Review before any order. · <Link className="underline" to="/purchase-orders">Open Purchase Orders</Link></p>}</Card>
      </div>
    </div>
  </main>;
}

function ContractPage({ model, termsReady, onBack }) {
  return <main className="contract-page min-h-screen bg-slate-100 p-5 text-slate-950 print:bg-white print:p-0"><style>{`@media print{body *{visibility:hidden}${termsReady ? ".contract-document,.contract-document *{visibility:visible}" : ""}${termsReady ? ".contract-document{position:absolute;left:0;top:0;width:100%;box-shadow:none}" : ".contract-document{display:none!important}"}.contract-actions{display:none!important}}`}</style><div className="contract-actions mx-auto mb-4 flex max-w-4xl justify-between"><button onClick={onBack}><ArrowLeft className="inline" size={15}/> Back to setup</button><button disabled={!termsReady} title={!termsReady ? "Enter and review contract terms before printing" : undefined} className="rounded-lg bg-slate-900 px-4 py-2 text-white disabled:opacity-50" onClick={()=>window.print()}><Printer className="mr-1 inline" size={15}/>Print / Save PDF</button></div>{!termsReady && <p role="alert" className="mx-auto mb-4 max-w-4xl rounded-lg border border-amber-400 bg-amber-50 p-3 text-sm font-semibold text-amber-900">Draft only. Contract details are incomplete. Printing is disabled until customer, site, scope, prices, customer tax and terms are set and reviewed.</p>}<article className="contract-document mx-auto max-w-4xl bg-white p-10 shadow"><header className="border-b-4 border-[#0B3F3B] pb-5"><p className="text-sm font-bold uppercase tracking-[.2em] text-[#0B3F3B]">YA Windows and Doors</p><h1 className="text-3xl font-bold">Customer Contract</h1><p>{model.job_name}</p></header><section className="mt-6 grid grid-cols-2 gap-6 text-sm"><div><h2 className="font-bold">Customer</h2><p>{model.customer.name}</p><p>{model.customer.phone}</p><p>{model.customer.email}</p><p>{model.customer.billing_address}</p></div><div><h2 className="font-bold">Job</h2><p>{model.customer.job_site_address}</p><p>Builder / GC: {model.customer.builder_gc}</p></div></section><table className="mt-7 w-full text-sm"><thead><tr className="border-b-2">{["Mark","Qty","Size","Product / description","Price"].map(x=><th key={x} className="py-2 text-left">{x}</th>)}</tr></thead><tbody>{model.scope_lines.map((x,i)=><tr className="border-b" key={i}><td className="py-2">{x.mark}</td><td>{x.qty}</td><td>{x.size}</td><td>{[x.product,x.description].filter(Boolean).join(" — ")}</td><td>{money(x.customer_price)}</td></tr>)}</tbody></table><section className="mt-6 grid grid-cols-2 gap-8 text-sm"><div><h2 className="font-bold">Scope & terms</h2>{model.scope_notes&&<p className="whitespace-pre-line">{model.scope_notes}</p>}<h3 className="mt-3 font-semibold">Inclusions</h3><p className="whitespace-pre-line">{model.inclusions}</p><h3 className="mt-3 font-semibold">Exclusions</h3><p className="whitespace-pre-line">{model.exclusions}</p><h3 className="mt-3 font-semibold">Warranty</h3><p className="whitespace-pre-line">{model.warranty_text}</p></div><dl className="space-y-2"><div className="flex justify-between"><dt>Subtotal</dt><dd>{money(model.sell_price)}</dd></div><div className="flex justify-between"><dt>Tax</dt><dd>{money(model.tax)}</dd></div><div className="flex justify-between border-t-2 pt-2 text-lg font-bold"><dt>Total</dt><dd>{money(model.contract_total)}</dd></div><div className="flex justify-between"><dt>Deposit ({model.deposit_pct??"—"}%)</dt><dd>{money(model.deposit_amount)}</dd></div><p className="pt-2 whitespace-pre-line">{model.payment_schedule}</p><p>Lead time: {model.estimated_lead_time||"—"}</p><p>Estimated start: {model.estimated_start||"—"}</p><p>Quote valid for {model.quote_valid_days??"—"} days.</p></dl></section><section className="mt-16 grid grid-cols-2 gap-12 text-sm"><div className="border-t pt-2">Customer signature / date</div><div className="border-t pt-2">YA Windows and Doors signature / date</div></section></article></main>;
}
