import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Send, PanelsTopLeft, Search, ArrowLeft, ArrowUpRight, CheckCircle2, Clock3, AlertCircle, Loader2, Settings2, ListChecks, MessageSquare, Monitor, BriefcaseBusiness, FileText, RefreshCw } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { C } from "@/lib/feeUI";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import TakeoffEditor, { inputClass, secondaryClass } from "@/components/window-quotes/TakeoffEditor";
import { normalizeLines, validateLines, validateSettings } from "@/components/window-quotes/takeoff";

const primaryClass = "inline-flex items-center justify-center gap-2 rounded-lg bg-[#2A5EA8] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#234F8E] disabled:cursor-not-allowed disabled:opacity-50";
const statusInfo = {
  draft: { label: "Draft", color: "#616D81", bg: "#F6F8FC", text: "Review the request and start quoting when the details are ready." },
  queued: { label: "Queued", color: "#1E4A85", bg: "#E7EEFA", text: "Your request is in the queue. You can leave this page while it waits." },
  running: { label: "Quoting", color: "#1E4A85", bg: "#E7EEFA", text: "The quoting computer is building and checking your AMSCO draft." },
  needs_details: { label: "Needs details", color: "#8A5A10", bg: "#FCF5E9", text: "Answer the questions below or update the schedule, then send the request back to quoting." },
  needs_sign_in: { label: "Needs sign-in", color: "#8A5A10", bg: "#FCF5E9", text: "Sign into the correct AMSCO account on the quoting computer, then retry this request. Keep passwords out of this conversation." },
  failed: { label: "Needs attention", color: "#8A4038", bg: "#FBEDEA", text: "The quote could not be completed. Review the latest message before retrying." },
  ready: { label: "Ready", color: "#276449", bg: "#EAF5EE", text: "The returned AMSCO draft has been checked. Review the result before accepting the sale." },
};
const uid = () => crypto.randomUUID();
const money = (value, currency = "USD") => value !== null && value !== undefined && Number.isFinite(Number(value)) ? new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(value)) : "—";
const date = (value) => value && !Number.isNaN(new Date(value).getTime()) ? new Date(value).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "";
const errorText = (error) => {
  const body = error?.response?.data;
  const detail = Array.isArray(body?.details) ? body.details.join(" ") : "";
  return [body?.error || body?.message || error?.message || "Something went wrong. Please try again.", detail].filter(Boolean).join(" ");
};
async function api(action, data = {}) {
  const response = await base44.functions.invoke("windowQuotes", { action, ...data });
  if (response.data?.error) throw new Error(response.data.error);
  return response.data;
}
function nativeURL(url) {
  try { const parsed = new URL(url); return parsed.protocol === "https:" && parsed.hostname === "amsco.wtsparadigm.com" ? parsed.href : null; } catch { return null; }
}
function StatusBadge({ quote }) {
  const info = statusInfo[quote?.worker_status] || statusInfo.draft;
  return <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap" style={{ color: info.color, background: info.bg }}>{["queued", "running"].includes(quote?.worker_status) ? <Loader2 size={11} className={quote.worker_status === "running" ? "animate-spin" : ""} /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}{quote?.sales_status === "won" ? "Won" : info.label}</span>;
}
function Field({ label, children }) { return <label className="block min-w-0"><span className="mb-1.5 block text-xs font-medium text-[#535E72]">{label}</span>{children}</label>; }
function QuoteForm({ quote, busy, onSave, onCancel }) {
  const [title, setTitle] = useState(quote?.title || "");
  const [message, setMessage] = useState(quote?.request_text || "");
  const [settings, setSettings] = useState({ dealer: "", yard: "", gross_margin: "", ...quote?.settings });
  const [lines, setLines] = useState(quote?.lines || []);
  const [source, setSource] = useState(quote?.source || null);
  const [errors, setErrors] = useState([]);
  const requestID = useRef(uid());
  const save = (queue) => {
    const issues = [...validateLines(lines), ...(queue ? validateSettings(settings) : [])];
    if (!quote && !message.trim() && !lines.length) issues.push("Describe your windows or add a window schedule.");
    if (issues.length) { setErrors(issues); return; }
    setErrors([]);
    const normalizedSettings = { ...settings, yard: String(settings.yard || "").trim(), gross_margin: settings.gross_margin === "" || settings.gross_margin === null || settings.gross_margin === undefined ? null : Number(settings.gross_margin) };
    onSave({ request_id: requestID.current, title: title.trim(), message: message.trim(), settings: normalizedSettings, lines: normalizeLines(lines), source }, queue);
  };
  return <div className="space-y-5">
    <Field label="Request name"><input autoFocus className={inputClass} placeholder="e.g. Lakeview • Lot 216" maxLength={180} value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy} /></Field>
    {!quote && <Field label="What would you like quoted?"><textarea className={inputClass + " min-h-24 resize-y"} placeholder="Describe the window package, or add your checked takeoff below. Include sizes, colors and glass where known." value={message} maxLength={20000} onChange={(e) => setMessage(e.target.value)} disabled={busy} /></Field>}
    <div className="rounded-xl border border-[#DDE3EC] bg-[#F6F8FC] p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#131A26]"><Settings2 size={15} />Quoting settings</div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Dealer account *"><select className={inputClass} value={settings.dealer} onChange={(e) => setSettings({ ...settings, dealer: e.target.value })} disabled={busy}><option value="">Choose account…</option><option value="BFS">BFS</option><option value="BTB">BTB / B2B</option></select></Field>
        <Field label="Shipping yard *"><input className={inputClass} placeholder="Exact AMSCO yard" value={settings.yard} onChange={(e) => setSettings({ ...settings, yard: e.target.value })} disabled={busy} /></Field>
        <Field label="Gross margin (%) *"><input className={inputClass} type="number" min="0" max="99.9999" step="any" placeholder="Enter your margin" value={settings.gross_margin ?? ""} onChange={(e) => setSettings({ ...settings, gross_margin: e.target.value })} disabled={busy} /></Field>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-[#616D81]">Your selected dealer and yard determine cost. AMSCO derives the selling price from gross margin. Save a draft if these settings are not yet known.</p>
    </div>
    <TakeoffEditor lines={lines} onChange={setLines} source={source} onSourceChange={setSource} disabled={busy} />
    {errors.length > 0 && <div role="alert" className="rounded-lg bg-[#FBEDEA] p-3 text-sm text-[#8A4038]"><ul className="list-disc space-y-1 pl-4">{errors.slice(0, 10).map((error) => <li key={error}>{error}</li>)}</ul></div>}
    <div className="flex flex-wrap justify-end gap-2 border-t border-[#E9EDF4] pt-4"><button className={secondaryClass} onClick={onCancel} disabled={busy}>Cancel</button><button className={secondaryClass} onClick={() => save(false)} disabled={busy}>{quote ? "Save changes" : "Save draft"}</button><button className={primaryClass} onClick={() => save(true)} disabled={busy}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}Save & start quote</button></div>
  </div>;
}
function WonForm({ quote, busy, onSubmit, onCancel }) {
  const [customer, setCustomer] = useState("");
  const [address, setAddress] = useState("");
  const [builder, setBuilder] = useState("");
  return <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); onSubmit({ customer_name: customer.trim(), address: address.trim(), builder: builder.trim() }); }}>
    <p className="text-sm leading-relaxed text-[#616D81]">Accept this verified revision and create one linked job. The original quote and conversation stay here.</p>
    <div className="rounded-xl bg-[#EAF5EE] p-4"><div className="text-sm font-medium text-[#276449]">{quote.title || "Window quote"}</div><div className="mt-1 text-2xl font-semibold text-[#131A26]">{money(quote.result?.totals?.total)}</div><div className="mt-1 text-xs text-[#616D81]">AMSCO {quote.result?.native_quote_number || "draft"} · Revision {quote.input_revision}</div></div>
    <Field label="Customer name (optional)"><input className={inputClass} value={customer} onChange={(e) => setCustomer(e.target.value)} disabled={busy} /></Field>
    <Field label="Job address (optional)"><input className={inputClass} value={address} onChange={(e) => setAddress(e.target.value)} disabled={busy} /></Field>
    <Field label="Builder (optional)"><input className={inputClass} value={builder} onChange={(e) => setBuilder(e.target.value)} disabled={busy} /></Field>
    <p className="text-xs text-[#616D81]">This creates an internal job. It does not place an AMSCO order or schedule installation.</p>
    <div className="flex justify-end gap-2"><button type="button" className={secondaryClass} onClick={onCancel} disabled={busy}>Cancel</button><button type="submit" className={primaryClass} disabled={busy}>{busy ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}Mark won & create job</button></div>
  </form>;
}
function ScheduleView({ quote }) {
  const lines = quote.lines || [];
  return <div className="space-y-4">
    <div className="grid grid-cols-3 gap-2">
      {[["Dealer", quote.settings?.dealer || "Not set"], ["Yard", quote.settings?.yard || "Not set"], ["Gross margin", quote.settings?.gross_margin !== null && quote.settings?.gross_margin !== undefined ? `${quote.settings.gross_margin}%` : "Not set"]].map(([label, value]) => <div key={label} className="rounded-xl border border-[#DDE3EC] bg-[#F6F8FC] p-3"><div className="text-[10px] font-semibold uppercase tracking-wider text-[#77839A]">{label}</div><div className="mt-1 break-words text-sm font-medium text-[#131A26]">{value}</div></div>)}
    </div>
    <div><h3 className="text-sm font-semibold text-[#131A26]">Requested windows</h3><p className="mt-1 text-xs text-[#616D81]">{lines.length ? `${lines.length} lines · ${lines.reduce((sum, line) => sum + (Number(line.qty) || 0), 0)} windows / assemblies` : "The quoting worker will review your written request and ask for any missing details."}</p></div>
    {lines.map((line, index) => <div key={index} className="rounded-xl border border-[#DDE3EC] p-4">
      <div className="flex items-start justify-between gap-2"><div className="text-sm font-semibold text-[#131A26]">{line.mark ? `${line.mark} · ` : `${index + 1}. `}{line.style}</div><span className="whitespace-nowrap rounded bg-[#E7EEFA] px-2 py-1 text-xs font-semibold text-[#1E4A85]">Qty {line.qty}</span></div>
      <p className="mt-1 text-sm text-[#535E72]">{line.width} × {line.height} {line.units} · {(line.dimension_basis || "").replaceAll("_", " ")}{line.room ? ` · ${line.room}` : ""}</p>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">{Object.entries(line.options || {}).filter(([, value]) => value !== "" && value !== null && typeof value !== "object").map(([key, value]) => <span key={key} className="text-xs text-[#616D81]">{key.replaceAll("_", " ")}: <span className="text-[#131A26]">{String(value)}</span></span>)}</div>
    </div>)}
    {quote.source?.filename && <p className="break-all text-xs text-[#616D81]">Takeoff source: {quote.source.filename}</p>}
  </div>;
}
function ResultView({ quote, onWon, busy }) {
  const result = quote.result;
  const verified = quote.worker_status === "ready" && result?.verified === true;
  if (!verified) return <div className="rounded-xl border border-dashed border-[#CBD4E1] bg-[#F6F8FC] px-5 py-10 text-center"><FileText size={28} className="mx-auto mb-3 text-[#77839A]" /><h3 className="font-semibold text-[#131A26]">Your verified quote will appear here</h3><p className="mx-auto mt-2 max-w-sm text-sm text-[#616D81]">AMSCO draft details, line prices and totals are shown after the quoting worker completes its checks.</p></div>;
  const url = nativeURL(result.native_quote_url);
  const totals = result.totals || {};
  return <div className="space-y-4">
    <div className="rounded-xl border border-[#CADFCF] bg-[#EAF5EE] p-5">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><div className="mb-2 inline-flex items-center gap-1.5 text-xs font-semibold text-[#276449]"><CheckCircle2 size={14} />Verified AMSCO draft</div><h3 className="text-lg font-semibold text-[#131A26]">Quote {result.native_quote_number || "ready"}</h3><p className="mt-1 text-xs text-[#616D81]">Revision {quote.input_revision} · {quote.settings?.dealer} · {quote.settings?.yard}</p></div>{url && <a href={url} target="_blank" rel="noopener noreferrer" className={secondaryClass}>Open in AMSCO<ArrowUpRight size={14} /></a>}</div>
      <div className="mt-5 text-xs font-medium uppercase tracking-wide text-[#616D81]">Quote total</div><div className="mt-1 text-3xl font-semibold tracking-tight text-[#131A26]">{money(totals.total, totals.currency || "USD")}</div>
      <dl className="mt-4 grid grid-cols-2 gap-x-5 gap-y-2 text-sm">{[["Subtotal", totals.subtotal], ["Dealer cost", totals.dealer_total ?? totals.dealer_cost], ["Labor", totals.labor], ["Delivery", totals.delivery], ["Freight", totals.freight], ["Tax", totals.tax]].filter(([, value]) => value !== undefined && value !== null).map(([label, value]) => <div className="flex flex-wrap justify-between gap-1" key={label}><dt className="text-[#616D81]">{label}</dt><dd className="font-medium text-[#131A26]">{money(value, totals.currency || "USD")}</dd></div>)}</dl>
    </div>
    {(result.lines || []).length > 0 && <div className="overflow-x-auto rounded-xl border border-[#DDE3EC]"><table className="w-full min-w-[430px] text-left text-xs"><thead className="bg-[#F6F8FC] text-[#616D81]"><tr><th className="p-3 font-medium">Verified line</th><th className="p-3 text-right font-medium">Qty</th><th className="p-3 text-right font-medium">Unit price</th><th className="p-3 text-right font-medium">Total</th></tr></thead><tbody>{result.lines.map((line, i) => <tr key={line.id || i} className="border-t border-[#E9EDF4]"><td className="p-3 text-[#131A26]">{line.description || line.style || line.mark || `Line ${i + 1}`}</td><td className="p-3 text-right">{line.qty ?? line.quantity ?? "—"}</td><td className="p-3 text-right">{money(line.customer_unit ?? line.customer_price ?? line.unit_price)}</td><td className="p-3 text-right">{money(line.customer_extended ?? line.extended_price ?? line.total)}</td></tr>)}</tbody></table></div>}
    {quote.job_id ? <Link to={`/jobs/${encodeURIComponent(quote.job_id)}`} className="flex items-center justify-between rounded-xl border border-[#DDE3EC] bg-white p-4 text-sm font-semibold text-[#1E4A85]"><span className="flex items-center gap-2"><BriefcaseBusiness size={17} />Won · Open linked job</span><ArrowUpRight size={16} /></Link> : <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#DDE3EC] p-4"><div><h4 className="text-sm font-semibold text-[#131A26]">Won the sale?</h4><p className="mt-1 text-xs text-[#616D81]">Accept this revision and move it into Jobs.</p></div><button className={primaryClass} disabled={busy || quote.sales_status === "won"} onClick={onWon}><CheckCircle2 size={15} />Mark won</button></div>}
  </div>;
}

export default function WindowQuotes() {
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const selectedID = params.get("quote");
  const [form, setForm] = useState(params.get("new") === "1" ? "new" : null);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("conversation");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const messageID = useRef(null);
  const latestMessage = useRef(null);
  const [wonOpen, setWonOpen] = useState(false);
  const listQuery = useQuery({ queryKey: ["windowQuotes"], queryFn: () => api("list"), refetchInterval: 12000, retry: 1 });
  const detailQuery = useQuery({ queryKey: ["windowQuotes", selectedID], queryFn: () => api("detail", { quote_id: selectedID }), enabled: !!selectedID, refetchInterval: 7000, retry: 1 });
  const quotes = listQuery.data?.quotes || [];
  const worker = listQuery.data?.worker;
  const quote = detailQuery.data?.quote;
  const messages = detailQuery.data?.messages || [];
  const locked = ["queued", "running"].includes(quote?.worker_status) || quote?.sales_status === "won";
  const visible = quotes.filter((q) => `${q.title || ""} ${q.request_text || ""} ${q.result?.native_quote_number || ""}`.toLowerCase().includes(search.toLowerCase()));
  const activeStatus = statusInfo[quote?.worker_status] || statusInfo.draft;
  const refresh = async () => { await client.invalidateQueries({ queryKey: ["windowQuotes"] }); };
  useEffect(() => { setMessage(""); messageID.current = null; setError(""); }, [selectedID]);
  useEffect(() => { if (tab === "conversation") latestMessage.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }); }, [messages.length, tab]);
  const select = (id) => { setParams({ quote: id }); setTab("conversation"); };
  const operate = async (task) => {
    if (busy) return;
    setBusy(true); setError("");
    try { await task(); await refresh(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  const saveForm = (data, queue) => operate(async () => {
    const result = form === "edit" ? await api("update", { quote_id: selectedID, title: data.title, settings: data.settings, lines: data.lines, source: data.source }) : await api("create", data);
    const id = result.quote?.id;
    if (!id) throw new Error("The request was not returned. Refresh before retrying.");
    setForm(null); select(id);
    await refresh();
    if (queue) await api("queue", { quote_id: id });
  });
  const queue = () => operate(async () => {
    const errors = [...validateSettings(quote?.settings), ...validateLines(quote?.lines || [])];
    if (errors.length) { setForm("edit"); throw new Error(errors.join(" ")); }
    await api("queue", { quote_id: selectedID });
  });
  const send = (event) => {
    event.preventDefault();
    if (!message.trim() || locked || busy) return;
    if (!messageID.current) messageID.current = uid();
    operate(async () => {
      await api("message", { quote_id: selectedID, message: message.trim(), client_message_id: messageID.current });
      setMessage(""); messageID.current = null;
    });
  };
  const convert = (data) => operate(async () => {
    await api("convert_won", { quote_id: selectedID, ...data }); setWonOpen(false); setTab("result");
  });
  return <div className="min-h-screen px-[18px] py-5 min-[700px]:px-[26px]" style={{ background: C.pageBg }}>
    <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div><div className="mono-label-sm mb-1.5">Glass Forge · Sales</div><h1 className="font-heading text-[28px] font-semibold tracking-tight text-[#131A26]">Window Quotes</h1><p className="mt-1 text-sm text-[#616D81]">From window takeoff to verified AMSCO quote.</p></div>
      <button className={primaryClass} onClick={() => { setForm("new"); setError(""); }}><Plus size={16} />New request</button>
    </header>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#DDE3EC] bg-white px-4 py-3">
      <div className="flex min-w-0 items-center gap-2.5"><Monitor size={17} className="shrink-0 text-[#616D81]" /><div className="text-xs text-[#616D81]"><span className="font-semibold text-[#131A26]">{listQuery.isPending ? "Checking quoting computer…" : listQuery.isError ? "Worker status unavailable" : worker?.online ? "Quoting computer online" : "Quoting computer offline"}</span><span className="ml-2">{!listQuery.isPending && !listQuery.isError && !worker?.online ? "Requests stay queued until it reconnects." : worker?.name || ""}</span>{worker?.last_seen_at && !worker.online && <span className="ml-2">Last seen {date(worker.last_seen_at)}</span>}</div></div>
      <button className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-[#1E4A85]" onClick={refresh} disabled={listQuery.isFetching}><RefreshCw size={13} className={listQuery.isFetching ? "animate-spin" : ""} />Refresh</button>
    </div>
    {(error || listQuery.isError || (selectedID && detailQuery.isError)) && <div role="alert" className="mb-4 rounded-xl border border-[#EFD2CA] bg-[#FBEDEA] p-3 text-sm text-[#8A4038]">{error || errorText(detailQuery.error || listQuery.error)}</div>}
    <div className="grid items-start gap-4 min-[1050px]:grid-cols-[270px_minmax(0,1fr)]">
      <aside className={`rounded-2xl border border-[#DDE3EC] bg-white card-shadow ${selectedID ? "hidden min-[1050px]:block" : ""}`}>
        <div className="border-b border-[#E9EDF4] p-4"><div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold text-[#131A26]">Requests</h2><span className="text-xs text-[#77839A]">{quotes.length}</span></div><div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-[#77839A]" /><input aria-label="Search quote requests" className={inputClass + " pl-9"} placeholder="Search requests" value={search} onChange={(e) => setSearch(e.target.value)} /></div></div>
        <div className="max-h-[650px] overflow-y-auto p-2">
          {listQuery.isPending ? <div className="p-8 text-center text-sm text-[#77839A]">Loading requests…</div> : visible.length ? visible.map((q) => <button key={q.id} onClick={() => select(q.id)} className={`mb-1 block w-full rounded-xl border p-3 text-left transition-colors ${selectedID === q.id ? "border-[#C3D4EE] bg-[#E7EEFA]" : "border-transparent hover:bg-[#F6F8FC]"}`}><div className="truncate text-sm font-semibold text-[#131A26]">{q.title || "Untitled window request"}</div><div className="mt-1 line-clamp-2 text-xs leading-relaxed text-[#616D81]">{q.request_text || `${q.lines?.length || 0} takeoff lines`}</div><div className="mt-3 flex flex-wrap items-center justify-between gap-2"><StatusBadge quote={q} /><span className="text-[10px] text-[#77839A]">{date(q.updated_date || q.created_date)}</span></div></button>) : <div className="p-6 text-center text-sm text-[#77839A]">{search ? "No requests match." : "Your new quote requests will appear here."}</div>}
        </div>
      </aside>
      <section className={`min-w-0 overflow-hidden rounded-2xl border border-[#DDE3EC] bg-white card-shadow ${!selectedID ? "hidden min-[1050px]:block" : ""}`}>
        {!selectedID ? <div className="flex min-h-[510px] flex-col items-center justify-center px-6 py-12 text-center"><div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-[#C3D4EE] bg-[#E7EEFA]"><PanelsTopLeft size={28} className="text-[#2A5EA8]" /></div><h2 className="font-heading text-xl font-semibold text-[#131A26]">Your next window package starts here</h2><p className="mt-3 max-w-md text-sm leading-relaxed text-[#616D81]">Describe a package or upload a checked CSV / JSON takeoff. Review your dealer, yard and margin, then send it to the quoting computer.</p><button className={primaryClass + " mt-6"} onClick={() => setForm("new")}><Plus size={15} />Start a request</button><p className="mt-4 text-xs text-[#77839A]">A job is created only when you mark a verified quote won.</p></div> : detailQuery.isPending ? <div className="flex min-h-[400px] items-center justify-center gap-2 text-sm text-[#616D81]"><Loader2 size={18} className="animate-spin" />Loading request…</div> : quote ? <>
          <div className="border-b border-[#E9EDF4] px-4 py-4 sm:px-5">
            <button onClick={() => setParams({})} className="mb-3 inline-flex items-center gap-1 text-xs font-medium text-[#1E4A85] min-[1050px]:hidden"><ArrowLeft size={13} />All requests</button>
            <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1"><div className="mb-2 flex flex-wrap items-center gap-2"><StatusBadge quote={quote} /><span className="text-[11px] text-[#77839A]">Revision {quote.input_revision || 1}</span></div><h2 className="break-words text-lg font-semibold text-[#131A26]">{quote.title || "Untitled window request"}</h2></div><div className="flex flex-wrap gap-2"><button className={secondaryClass} onClick={() => setForm("edit")} disabled={locked || busy}><Settings2 size={14} /><span>Details</span></button>{!locked && quote.worker_status !== "ready" && <button className={primaryClass} onClick={queue} disabled={busy}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}{["failed", "needs_sign_in"].includes(quote.worker_status) ? "Retry quote" : "Start quote"}</button>}</div></div>
            <div className="mt-4 flex items-start gap-2 rounded-lg p-3 text-xs leading-relaxed" style={{ background: activeStatus.bg, color: activeStatus.color }}>{quote.worker_status === "ready" ? <CheckCircle2 size={15} className="shrink-0" /> : ["failed", "needs_sign_in", "needs_details"].includes(quote.worker_status) ? <AlertCircle size={15} className="shrink-0" /> : <Clock3 size={15} className="shrink-0" />}<span>{quote.sales_status === "won" ? "This revision was accepted. Its snapshot is linked to the job below." : activeStatus.text}</span></div>
            <div className="mt-4 flex gap-1 overflow-x-auto" role="tablist" aria-label="Quote sections">{[["conversation", "Conversation", MessageSquare], ["schedule", "Schedule", ListChecks], ["result", "Quote result", FileText]].map(([key, label, Icon]) => <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)} className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold ${tab === key ? "bg-[#E7EEFA] text-[#1E4A85]" : "text-[#616D81] hover:bg-[#F6F8FC]"}`}><Icon size={14} />{label}{key === "result" && quote.worker_status === "ready" && <span className="h-1.5 w-1.5 rounded-full bg-[#276449]" />}</button>)}</div>
          </div>
          {tab === "conversation" ? <>
            <div className="max-h-[520px] min-h-[290px] space-y-4 overflow-y-auto px-4 py-5 sm:px-5">
              {(quote.missing_details || []).length > 0 && <div className="rounded-xl border border-[#EEDAB4] bg-[#FCF5E9] p-4 text-sm text-[#8A5A10]"><h3 className="font-semibold">A few details are needed</h3><ul className="mt-2 list-disc space-y-1 pl-4">{quote.missing_details.map((item, index) => <li key={index}>{item}</li>)}</ul></div>}
              {!messages.length && <div className="rounded-xl bg-[#F6F8FC] p-4 text-sm leading-relaxed text-[#535E72]">{quote.request_text || "Your schedule is saved. Start the quote when your dealer, yard and margin are ready."}</div>}
              {messages.map((item) => <article key={item.id || item.client_message_id} className={`flex ${item.role === "user" ? "justify-end" : "justify-start"}`}><div className={`max-w-[92%] rounded-2xl px-4 py-3 sm:max-w-[85%] ${item.role === "user" ? "rounded-br-md bg-[#E7EEFA]" : "rounded-bl-md border border-[#DDE3EC] bg-[#F6F8FC]"}`}><div className="mb-1.5 flex flex-wrap items-center gap-2 text-[10px] font-semibold text-[#77839A]"><span>{item.role === "user" ? "You" : item.role === "system" ? "Quote update" : "Quoting assistant"}</span><span className="font-normal">{date(item.created_date)}</span></div><p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-[#131A26]">{item.content}</p></div></article>)}
              <div ref={latestMessage} />
            </div>
            <form onSubmit={send} className="border-t border-[#E9EDF4] bg-[#F6F8FC] p-4">
              <label htmlFor="quote-message" className="sr-only">Reply to this quote request</label><div className="flex items-end gap-2"><textarea id="quote-message" className={inputClass + " min-h-[76px] resize-y"} value={message} maxLength={20000} onChange={(e) => { setMessage(e.target.value); messageID.current = null; }} placeholder={locked ? quote.sales_status === "won" ? "Accepted revision — start a new request for changes." : "The request is being quoted. Replies reopen when input is needed." : "Add details or answer a question…"} disabled={locked || busy} onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") send(e); }} /><button type="submit" aria-label="Send message" className={primaryClass + " h-10 px-3"} disabled={!message.trim() || locked || busy}>{busy ? <Loader2 size={17} className="animate-spin" /> : <Send size={17} />}</button></div><p className="mt-2 text-[11px] text-[#77839A]">{locked ? "Saved requests and progress remain available while the quoting computer works." : "Sending saves your reply. Use Start quote to send the updated request to the worker."}</p>
            </form>
          </> : <div className="p-4 sm:p-5">{tab === "schedule" ? <ScheduleView quote={quote} /> : <ResultView quote={quote} onWon={() => setWonOpen(true)} busy={busy} />}</div>}
          {quote.job_id && tab !== "result" && <Link to={`/jobs/${encodeURIComponent(quote.job_id)}`} className="flex items-center justify-between border-t border-[#E9EDF4] p-4 text-sm font-semibold text-[#1E4A85]"><span className="flex items-center gap-2"><BriefcaseBusiness size={16} />Open linked job</span><ArrowUpRight size={15} /></Link>}
        </> : <div className="p-10 text-center text-sm text-[#616D81]">This request is unavailable. Choose another request or refresh.</div>}
      </section>
    </div>
    <Dialog open={!!form} onOpenChange={(open) => { if (!open && !busy) setForm(null); }}><DialogContent className="max-h-[90dvh] max-w-3xl overflow-y-auto rounded-2xl bg-white"><DialogHeader><DialogTitle>{form === "edit" ? "Request details" : "New window quote"}</DialogTitle><DialogDescription>{form === "edit" ? "Changes create a new request revision. Previous verified results are kept in history." : "Start with a description or a checked takeoff. No job record is required."}</DialogDescription></DialogHeader>{error && <p role="alert" className="rounded-lg bg-[#FBEDEA] p-3 text-sm text-[#8A4038]">{error}</p>}{form && <QuoteForm key={form === "edit" ? selectedID : "new"} quote={form === "edit" ? quote : null} busy={busy} onSave={saveForm} onCancel={() => setForm(null)} />}</DialogContent></Dialog>
    <Dialog open={wonOpen} onOpenChange={(open) => { if (!busy) setWonOpen(open); }}><DialogContent className="max-h-[90dvh] overflow-y-auto rounded-2xl bg-white"><DialogHeader><DialogTitle>Accept quote & create job</DialogTitle><DialogDescription>Keep an accepted snapshot of this quote revision.</DialogDescription></DialogHeader>{error && <p role="alert" className="rounded-lg bg-[#FBEDEA] p-3 text-sm text-[#8A4038]">{error}</p>}{wonOpen && quote && <WonForm quote={quote} busy={busy} onSubmit={convert} onCancel={() => setWonOpen(false)} />}</DialogContent></Dialog>
  </div>;
}
