import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Send, PanelsTopLeft, Search, ArrowLeft, ArrowUpRight, CheckCircle2, Clock3, AlertCircle, Loader2, Settings2, ListChecks, MessageSquare, BriefcaseBusiness, FileText, RefreshCw, Trash2 } from "lucide-react";
import { base44 } from "@/api/base44Client";
import { C } from "@/lib/feeUI";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import TakeoffEditor, { inputClass, secondaryClass } from "@/components/window-quotes/TakeoffEditor";
import ConnectClaude from "@/components/window-quotes/ConnectClaude";
import WindowQuoteResults from "@/components/window-quotes/WindowQuoteResults";
import WindowQuoteBuilder from "@/components/window-quotes/WindowQuoteBuilder";
import { normalizeLines, validateLines } from "@/components/window-quotes/takeoff";
import { useAuth } from "@/lib/AuthContext";
import { initialQuoteFormValues, loadQuotePreferences, saveQuotePreferences } from "@/lib/windowQuotePreferences";

import { normalizeEasyRequest, STANDARD_STUDIO_PROFILE } from "@/lib/easyRequest";

const primaryClass = "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg bg-[#2A5EA8] px-4 py-2.5 text-sm font-semibold text-white hover:bg-[#234F8E] disabled:cursor-not-allowed disabled:opacity-50";
const statusInfo = {
  draft: { label: "Draft", color: "#616D81", bg: "#F6F8FC", text: "Send your request to the quoting agent when you’re ready. It will ask for any missing details." },
  queued: { label: "Queued", color: "#1E4A85", bg: "#E7EEFA", text: "Your request is in the queue. You can leave this page while it waits." },
  running: { label: "Quoting", color: "#1E4A85", bg: "#E7EEFA", text: "We’re building and checking your window quote." },
  needs_details: { label: "Needs details", color: "#8A5A10", bg: "#FCF5E9", text: "Reply to the questions below to continue, or update the schedule and send it back to quoting." },
  needs_sign_in: { label: "Needs sign-in", color: "#8A5A10", bg: "#FCF5E9", text: "Your request is saved. The account owner needs to reconnect the quoting browser before this quote can continue." },
  failed: { label: "Needs attention", color: "#8A4038", bg: "#FBEDEA", text: "Your quote needs attention before it can be completed. Your quoting team must check the saved work before continuing." },
  ready: { label: "Ready", color: "#276449", bg: "#EAF5EE", text: "Your quote is ready to be viewed." },
};
const uid = () => crypto.randomUUID();
const money = (value, currency = "USD") => value !== null && value !== undefined && Number.isFinite(Number(value)) ? new Intl.NumberFormat("en-US", { style: "currency", currency }).format(Number(value)) : "—";
const date = (value) => {
  if (!value) return "";
  // Base44 timestamps without an offset are UTC, like its explicit-Z message timestamps.
  const raw = String(value).trim();
  const normalized = /^[0-9]{4}-[0-9]{2}-[0-9]{2}[T ][0-9]{2}:[0-9]{2}(?::[0-9]{2}(?:[.][0-9]+)?)?$/.test(raw) ? raw.replace(" ", "T") + "Z" : raw;
  const parsed = new Date(normalized);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
};
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
function currentIntakeAssessment(quote) {
  const assessment = quote?.intake_assessment;
  return assessment?.input_revision != null && quote?.input_revision != null && assessment.input_revision === quote.input_revision ? assessment : null;
}
function quoteStatusInfo(quote) {
  const info = statusInfo[quote?.worker_status] || statusInfo.draft;
  if (quote?.worker_status === "needs_details" && currentIntakeAssessment(quote)?.status === "product_review") {
    return { ...info, label: "Needs product review", text: "Some requested products or options need review before quoting can continue. Check the review below and reply with any clarifications." };
  }
  if (quote?.worker_status === "needs_details" && currentIntakeAssessment(quote)?.status === "unavailable") {
    return { ...info, label: "Review unavailable", text: "Your request is saved. Use Send to quoting to retry the AI review." };
  }
  return info;
}
function StatusBadge({ quote }) {
  const info = quoteStatusInfo(quote);
  return <span className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold whitespace-nowrap" style={{ color: info.color, background: info.bg }}>{["queued", "running"].includes(quote?.worker_status) ? <Loader2 size={11} className={quote.worker_status === "running" ? "animate-spin" : ""} /> : <span className="h-1.5 w-1.5 rounded-full bg-current" />}{quote?.sales_status === "won" ? "Won" : info.label}</span>;
}
function IntakeAssessment({ quote }) {
  const assessment = currentIntakeAssessment(quote);
  if (!assessment) return null;
  const textItems = (items) => Array.isArray(items) ? items.filter((item) => typeof item === "string" && item.trim()) : [];
  const questions = textItems(assessment.questions);
  const productReview = textItems(assessment.product_review);
  const assumptions = textItems(assessment.assumptions);
  const summary = typeof assessment.summary === "string" ? assessment.summary.trim() : "";
  const info = {
    ready: { heading: "Request understood", note: quote.worker_status === "ready" ? "The request was organized for this quote. Open Quote result to see the verified pricing." : "The request has been organized. Pricing still needs to be checked before the quote is marked Ready.", color: "#276449", bg: "#EAF5EE" },
    needs_details: { heading: "A few details needed", note: "Reply in the conversation with what you know. You can use your own words.", color: "#8A5A10", bg: "#FCF5E9" },
    product_review: { heading: "Needs product review", note: "The items below need review before they can be quoted. Clarifying the request does not confirm product availability or pricing.", color: "#8A5A10", bg: "#FCF5E9" },
    unavailable: { heading: "Request review unavailable", note: "Your request is saved, but the automatic review did not complete. Check the conversation for the next step.", color: "#616D81", bg: "#F6F8FC" },
  }[assessment.status];
  if (!info) return null;
  return <section aria-label="Request review" className="mt-4 min-w-0 rounded-xl border border-[#DDE3EC] p-3 sm:p-4">
    <div className="flex flex-wrap items-start justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2 text-sm font-semibold text-[#131A26]"><ListChecks size={16} className="shrink-0" /><h3>Request review</h3></div>
      <span className="max-w-full break-words rounded-lg px-2.5 py-1 text-xs font-semibold" style={{ color: info.color, background: info.bg }}>{info.heading}</span>
    </div>
    {summary && <p className="mt-3 whitespace-pre-wrap break-words text-sm leading-relaxed text-[#131A26]">{summary}</p>}
    <p className="mt-2 text-xs leading-relaxed text-[#616D81]">{info.note}</p>
    {(questions.length > 0 || productReview.length > 0) && <div className={"mt-3 grid min-w-0 gap-3 " + (questions.length > 0 && productReview.length > 0 ? "sm:grid-cols-2" : "")}>
      {[{ heading: "Details to clarify", items: questions }, { heading: "Products or options to review", items: productReview }].filter(({ items }) => items.length > 0).map(({ heading, items }) => <div key={heading} className="min-w-0 rounded-lg bg-[#F6F8FC] p-3">
        <h4 className="text-xs font-semibold text-[#535E72]">{heading}</h4>
        <ul className="mt-2 list-disc space-y-1.5 pl-4 text-sm leading-relaxed text-[#131A26]">{items.map((item, index) => <li key={index} className="break-words">{item}</li>)}</ul>
      </div>)}
    </div>}
    {assumptions.length > 0 && <details className="mt-3 min-w-0 border-t border-[#E9EDF4] pt-2">
      <summary className="cursor-pointer py-2 text-xs font-semibold text-[#535E72]">Assumptions used ({assumptions.length})</summary>
      <p className="mt-1 text-xs text-[#616D81]">Reply if any of these differ from what you intended.</p>
      <ul className="mt-2 list-disc space-y-1.5 pl-4 text-sm leading-relaxed text-[#131A26]">{assumptions.map((item, index) => <li key={index} className="break-words">{item}</li>)}</ul>
    </details>}
  </section>;
}
function Field({ label, children }) { return <label className="block min-w-0"><span className="mb-1.5 block text-xs font-medium text-[#535E72]">{label}</span>{children}</label>; }
const colorChoices = [
  ["White", "White — inside & outside"],
  ["Taupe", "Taupe — inside & outside"],
  ["Black exterior / White interior", "Black outside / White inside"],
  ["Other / mixed — see notes", "Other / mixed — describe in notes"],
];
const glassChoices = [
  ["CozE (LowE)", "CozE (Low-E)"],
  ["Other / mixed — see notes", "Other / mixed — describe in notes"],
];
const productLabel = (value, choices) => choices.find(([key]) => key === value)?.[1] || (value && typeof value === "object" ? JSON.stringify(value) : value) || "Ask the quoting agent";
function ProductChoice({ label, value, choices, onChange, disabled }) {
  // Keep imported or previously saved custom selections until the user changes them.
  const savedCustom = value !== undefined && value !== null && value !== "" && !choices.some(([key]) => key === value);
  return <Field label={label}><select className={inputClass} value={savedCustom ? "__saved_selection__" : value || ""} onChange={(e) => onChange(e.target.value)} disabled={disabled}>
    <option value="">Not sure — ask the quoting agent</option>
    {choices.map(([key, text]) => <option key={key} value={key}>{text}</option>)}
    {savedCustom && <option value="__saved_selection__">{productLabel(value, choices)}</option>}
  </select></Field>;
}
function QuoteForm({ quote, seed, preferenceUserId, busy, onSave, onCancel }) {
  const initial = quote || seed;
  const [defaults] = useState(() => initialQuoteFormValues(initial, loadQuotePreferences(preferenceUserId)));
  const [title, setTitle] = useState(initial?.title || "");
  const [message, setMessage] = useState(initial?.request_text || "");
  const [settings, setSettings] = useState(defaults.settings);
  const [lines, setLines] = useState(initial?.lines || []);
  const [source, setSource] = useState(initial?.source || null);
  const [errors, setErrors] = useState([]);
  const requestID = useRef(uid());
  const [useStandard, setUseStandard] = useState(defaults.use_standard);
  const [dimensionBasis, setDimensionBasis] = useState(defaults.dimension_basis);
  const requestSource = useMemo(() => ({ ...(source || {}), easy_request: {
    profile_id: STANDARD_STUDIO_PROFILE.id, profile_revision: STANDARD_STUDIO_PROFILE.revision,
    confirmed: useStandard, dimension_basis: dimensionBasis, units: "in"
  } }), [source, useStandard, dimensionBasis]);
  const normalizedSettings = useMemo(() => ({ ...settings, yard: String(settings.yard || "").trim(),
    gross_margin: settings.gross_margin === "" || settings.gross_margin == null ? null : Number(settings.gross_margin)
  }), [settings]);
  const preview = useMemo(() => normalizeEasyRequest({
    id: quote?.id || requestID.current, input_revision: quote?.input_revision || 1,
    request_text: quote ? "" : message, settings: normalizedSettings, lines: normalizeLines(lines), source: requestSource
  }), [quote?.id, quote?.input_revision, message, normalizedSettings, lines, requestSource]);
  const save = (queue) => {
    const issues = [...validateLines(lines)];
    const hasMargin = settings.gross_margin !== "" && settings.gross_margin !== null && settings.gross_margin !== undefined;
    if (hasMargin && (!Number.isFinite(Number(settings.gross_margin)) || Number(settings.gross_margin) < 0 || Number(settings.gross_margin) >= 100)) issues.push("Gross margin must be a number from 0 up to, but not including, 100%.");
    if (!quote && !message.trim() && !lines.length) issues.push("Describe your windows or add a window schedule.");
    if (issues.length) { setErrors(issues); return; }
    setErrors([]);
    onSave({ request_id: requestID.current, title: title.trim(), message: message.trim(), settings: normalizedSettings, lines: normalizeLines(lines), source: requestSource }, queue);
  };
  return <div className="space-y-5">
    <Field label="Request name (optional)"><input autoFocus className={inputClass} placeholder="e.g. Lakeview • Lot 216" maxLength={180} value={title} onChange={(e) => setTitle(e.target.value)} disabled={busy} /></Field>
    <div className="space-y-4 rounded-xl border border-[#DDE3EC] p-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-[#131A26]"><ListChecks size={16} />Describe your request</div>
      {!quote && <><Field label="What would you like quoted?"><textarea className={inputClass + " min-h-28 resize-y"} placeholder="e.g. I need two 3050 single-hung windows for the bedrooms and one 3060 for the kitchen, all white with Low-E glass. These are call sizes." value={message} maxLength={18000} onChange={(e) => setMessage(e.target.value)} disabled={busy} /></Field><p className="text-xs leading-relaxed text-[#616D81]">Write it as you would explain it to a person. The AI will organize your full message when you send it and ask about details it cannot determine. Add quantities, sizes, styles and special options when you know them.</p></>}
      <Field label="Sizes in notes are"><select className={inputClass} value={dimensionBasis} onChange={(e) => setDimensionBasis(e.target.value)} disabled={busy}>
        <option value="">Choose dimension basis…</option><option value="call">Call size — e.g. 3050 = 36 × 60 inches</option><option value="frame">Actual frame size — review required</option><option value="rough_opening">Rough opening — review required</option>
      </select></Field>
      <div className="rounded-lg border border-[#C3D4EE] bg-[#F6F8FC] p-3">
        <label className="flex min-h-11 cursor-pointer items-start gap-2 py-2 text-sm font-medium text-[#131A26]"><input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[#2A5EA8]" checked={useStandard} onChange={(e) => setUseStandard(e.target.checked)} disabled={busy} /><span>Use standard Studio nail-fin preferences</span></label>
        <p className="ml-7 mt-1 text-xs leading-relaxed text-[#616D81]">Start with the Studio 1⅜-inch fin setback and standard options for each window type. Your written request and schedule can override these preferences. Uncheck for a fully custom request.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <ProductChoice label="Window color" value={settings.color} choices={colorChoices} onChange={(color) => setSettings({ ...settings, color })} disabled={busy} />
        <ProductChoice label="Low-E glass" value={settings.glass} choices={glassChoices} onChange={(glass) => setSettings({ ...settings, glass })} disabled={busy} />
      </div>
      <p className="text-xs leading-relaxed text-[#616D81]">These are editable starting preferences. Each window’s own specification takes priority. AMSCO checks availability and pricing before a quote is marked Ready.</p>
    </div>
    <div className="rounded-xl border border-[#DDE3EC] bg-[#F6F8FC] p-4">
      <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-[#131A26]"><Settings2 size={15} />Quoting settings</div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Dealer account"><select className={inputClass} value={settings.dealer} onChange={(e) => setSettings({ ...settings, dealer: e.target.value })} disabled={busy}><option value="">Choose account…</option><option value="BFS">BFS</option><option value="BTB">BTB / B2B</option></select></Field>
        <Field label="Shipping yard"><select className={inputClass} value={settings.yard} onChange={(e) => setSettings({ ...settings, yard: e.target.value })} disabled={busy}><option value="">Choose yard…</option><option value="BFS-UTAH DESIGN(11)">BFS — Utah Design (11)</option>{settings.yard && settings.yard !== "BFS-UTAH DESIGN(11)" && <option value={settings.yard}>{settings.yard}</option>}</select></Field>
        <Field label="Gross margin (%)"><input className={inputClass} type="number" min="0" max="99.9999" step="any" placeholder="Enter your margin" value={settings.gross_margin ?? ""} onChange={(e) => setSettings({ ...settings, gross_margin: e.target.value })} disabled={busy} /></Field>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-[#616D81]">Dealer and yard determine cost; gross margin sets the selling price. Check these settings before sending. After you save, your chosen settings are remembered for new requests in this browser.</p>
    </div>
    <TakeoffEditor lines={lines} onChange={setLines} source={source} onSourceChange={setSource} disabled={busy} />
    {(message.trim() || lines.length > 0) && <div className="space-y-3 rounded-xl border border-[#DDE3EC] p-4" aria-label="Request preview">
      <div className="flex flex-wrap items-center justify-between gap-2"><h3 className="text-sm font-semibold text-[#131A26]">Preliminary window preview</h3>{preview.preview.length > 0 && <span className="text-xs text-[#616D81]">{preview.preview.length} lines shown · {preview.preview.reduce((sum, line) => sum + (Number(line.qty) || 0), 0)} windows shown</span>}</div>
      <p className="text-xs leading-relaxed text-[#616D81]">This quick preview may show only part of a written request. When you send it, the AI reviews the full message along with your schedule and settings. The quoting service then checks whether it can proceed or needs more details or product review.</p>
      {preview.preview.map((line, index) => <div key={index} className="flex flex-wrap justify-between gap-3 rounded-lg bg-[#F6F8FC] p-3 text-sm"><div className="min-w-0 break-words"><span className="font-medium text-[#131A26]">{line.style || "Style to clarify"}</span><div className="mt-1 text-xs text-[#616D81]">{line.width} × {line.height} {line.units || "units to clarify"} · {line.dimension_basis?.replaceAll("_", " ") || "dimension basis to clarify"}{line.room ? " · " + line.room : ""}</div></div><span className="whitespace-nowrap font-semibold text-[#1E4A85]">Qty {line.qty}</span></div>)}
      {preview.preview.length === 0 && <p className="rounded-lg bg-[#F6F8FC] p-3 text-sm text-[#535E72]">No window lines are shown yet. You can still send your written request for review.</p>}
      {(!message.trim() || quote) && !preview.ok && preview.questions.length > 0 && <div><p className="text-xs font-semibold text-[#535E72]">Schedule details to check</p><ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-[#616D81]">{preview.questions.slice(0, 6).map((question, index) => <li key={index} className="break-words">{question}</li>)}</ul></div>}
    </div>}
    {errors.length > 0 && <div role="alert" className="rounded-lg bg-[#FBEDEA] p-3 text-sm text-[#8A4038]"><ul className="list-disc space-y-1 pl-4">{errors.slice(0, 10).map((error) => <li key={error}>{error}</li>)}</ul></div>}
    <div className="flex flex-col sm:flex-row sm:flex-wrap justify-end gap-2 border-t border-[#E9EDF4] pt-4"><button className={secondaryClass} onClick={onCancel} disabled={busy}>Cancel</button><button className={secondaryClass} onClick={() => save(false)} disabled={busy}>{quote ? "Save changes" : "Save draft"}</button><button className={primaryClass} onClick={() => save(true)} disabled={busy}>{busy ? <Loader2 size={15} className="animate-spin" /> : <Send size={15} />}{quote ? "Save & send request" : "Send quote request"}</button></div>
  </div>;
}
function RetryFailedForm({ quote, busy, onSubmit, onCancel }) {
  const [reviewed, setReviewed] = useState(false);
  const retryID = useRef(uid());
  const review = quote.retry_review;
  return <form className="space-y-4" onSubmit={(event) => {
    event.preventDefault();
    if (!reviewed || busy) return;
    onSubmit({ quote_id: quote.id, retry_id: retryID.current, expected_revision: review.expected_revision, expected_state_version: review.expected_state_version, expected_native_quote_id: review.native_quote_id, reviewed_previous_draft: true });
  }}>
    <p className="text-sm leading-relaxed text-[#535E72]">This retries the same request by creating a fresh AMSCO quote. {review.native_quote_number ? `Previous draft ${review.native_quote_number}` : 'The previous attempt'} stays in this request’s history. Its saved work will not be changed or reused.</p>
    <label className="flex min-h-11 cursor-pointer items-start gap-3 rounded-lg border border-[#DDE3EC] bg-[#F6F8FC] p-3 text-sm leading-relaxed text-[#131A26]"><input type="checkbox" className="mt-0.5 h-5 w-5 shrink-0 accent-[#2A5EA8]" checked={reviewed} onChange={(event) => setReviewed(event.target.checked)} disabled={busy} /><span>I reviewed the previous attempt and want a fresh quote.</span></label>
    <div className="flex flex-col justify-end gap-2 sm:flex-row"><button type="button" className={secondaryClass} onClick={onCancel} disabled={busy}>Cancel</button><button type="submit" className={primaryClass} disabled={!reviewed || busy}>{busy ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />}Retry with a fresh quote</button></div>
  </form>;
}
function WonForm({ quote, busy, onSubmit, onCancel }) {
  const [customer, setCustomer] = useState("");
  const [address, setAddress] = useState("");
  const [builder, setBuilder] = useState("");
  return <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); onSubmit({ customer_name: customer.trim(), address: address.trim(), builder: builder.trim() }); }}>
    <p className="text-sm leading-relaxed text-[#616D81]">Accept this verified revision and create one linked job. The original quote and conversation stay here.</p>
    <div className="rounded-xl bg-[#EAF5EE] p-4"><div className="text-sm font-medium text-[#276449]">{quote.title || "Window quote"}</div><div className="mt-1 text-2xl font-semibold text-[#131A26]">{money(quote.result?.totals?.total)}</div><div className="mt-1 text-xs text-[#616D81]">{quote.result?.native_quote_number ? `AMSCO ${quote.result.native_quote_number}` : quote.result?.native_source === "desktop_native" ? "Saved AMSCO desktop quote" : "AMSCO draft"} · Revision {quote.input_revision}</div></div>
    <Field label="Customer name (optional)"><input className={inputClass} value={customer} onChange={(e) => setCustomer(e.target.value)} disabled={busy} /></Field>
    <Field label="Job address (optional)"><input className={inputClass} value={address} onChange={(e) => setAddress(e.target.value)} disabled={busy} /></Field>
    <Field label="Builder (optional)"><input className={inputClass} value={builder} onChange={(e) => setBuilder(e.target.value)} disabled={busy} /></Field>
    <p className="text-xs text-[#616D81]">This creates an internal job. It does not place an AMSCO order or schedule installation.</p>
    <div className="flex flex-col sm:flex-row sm:flex-wrap justify-end gap-2"><button type="button" className={secondaryClass} onClick={onCancel} disabled={busy}>Cancel</button><button type="submit" className={primaryClass} disabled={busy}>{busy ? <Loader2 size={15} className="animate-spin" /> : <CheckCircle2 size={15} />}Mark won & create job</button></div>
  </form>;
}
function ScheduleView({ quote }) {
  const lines = quote.lines || [];
  return <div className="space-y-4">
    <div className="grid grid-cols-1 min-[400px]:grid-cols-2 gap-2 sm:grid-cols-3">
      {[["Color", productLabel(quote.settings?.color, colorChoices)], ["Low-E glass", productLabel(quote.settings?.glass, glassChoices)], ["Dealer", quote.settings?.dealer || "Not set"], ["Yard", quote.settings?.yard || "Not set"], ["Gross margin", quote.settings?.gross_margin !== null && quote.settings?.gross_margin !== undefined ? `${quote.settings.gross_margin}%` : "Not set"]].map(([label, value]) => <div key={label} className="rounded-xl border border-[#DDE3EC] bg-[#F6F8FC] p-3"><div className="text-[10px] font-semibold uppercase tracking-wider text-[#77839A]">{label}</div><div className="mt-1 break-words text-sm font-medium text-[#131A26]">{value}</div></div>)}
    </div>
    <div><h3 className="text-sm font-semibold text-[#131A26]">Requested windows</h3><p className="mt-1 text-xs text-[#616D81]">{lines.length ? `${lines.length} lines · ${lines.reduce((sum, line) => sum + (Number(line.qty) || 0), 0)} windows / assemblies` : "The quoting agent will review your written request and ask for any missing details."}</p></div>
    {lines.map((line, index) => <div key={index} className="rounded-xl border border-[#DDE3EC] p-4">
      <div className="flex items-start justify-between gap-2"><div className="min-w-0 break-words text-sm font-semibold text-[#131A26]">{line.mark ? `${line.mark} · ` : `${index + 1}. `}{line.style}</div><span className="whitespace-nowrap rounded bg-[#E7EEFA] px-2 py-1 text-xs font-semibold text-[#1E4A85]">Qty {line.qty}</span></div>
      <p className="mt-1 break-words text-sm text-[#535E72]">{line.width} × {line.height} {line.units} · {(line.dimension_basis || "").replaceAll("_", " ")}{line.room ? ` · ${line.room}` : ""}</p>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">{Object.entries(line.options || {}).filter(([, value]) => value !== "" && value !== null && typeof value !== "object").map(([key, value]) => <span key={key} className="text-xs text-[#616D81]">{key.replaceAll("_", " ")}: <span className="text-[#131A26]">{String(value)}</span></span>)}</div>
    </div>)}
    {quote.source?.filename && <p className="break-all text-xs text-[#616D81]">Takeoff source: {quote.source.filename}</p>}
  </div>;
}
export default function WindowQuotes() {
  const { user } = useAuth();
  const client = useQueryClient();
  const [params, setParams] = useSearchParams();
  const selectedID = params.get("quote");
  const [revisionSeed, setRevisionSeed] = useState(null);
  const [form, setForm] = useState(params.get("new") === "1" ? "new" : null);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState("conversation");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const messageID = useRef(null);
  const [wonOpen, setWonOpen] = useState(false);
  const [retryReview, setRetryReview] = useState(null);
  const listQuery = useQuery({ queryKey: ["windowQuotes"], queryFn: () => api("list"), refetchInterval: 12000, retry: 1 });
  const detailQuery = useQuery({ queryKey: ["windowQuotes", selectedID], queryFn: () => api("detail", { quote_id: selectedID }), enabled: !!selectedID, refetchInterval: 7000, retry: 1 });
  const quotes = listQuery.data?.quotes || [];
  const worker = listQuery.data?.worker;
  const quote = detailQuery.data?.quote;
  const messages = detailQuery.data?.messages || [];
  const locked = ["queued", "running"].includes(quote?.worker_status) || quote?.sales_status === "won";
  const needsRetryReview = !!quote?.retry_review;
  const visible = quotes.filter((q) => `${q.title || ""} ${q.request_text || ""} ${q.result?.native_quote_number || ""}`.toLowerCase().includes(search.toLowerCase()));
  const serviceStatus = listQuery.isPending ? "Checking service…" : listQuery.isError || worker?.configured === undefined ? "Status unavailable"
    : !worker.configured ? "Not configured" : !worker.online ? "Quoting computer offline — requests stay queued"
    : worker.runner_status === "running" ? "Building a quote"
    : worker.runner_status === "attention" ? "Needs attention — pickup paused"
    : worker.runner_status === "stopping" ? "Quoting computer stopping"
    : worker.browser_state === "needs_sign_in" ? "Account owner needs to sign in"
    : worker.browser_authenticated === true ? "Ready — automatic pickup is on" : "Checking quoting browser…";
  const activeStatus = quoteStatusInfo(quote);
  const refresh = async () => { await client.invalidateQueries({ queryKey: ["windowQuotes"] }); };
  useEffect(() => { setMessage(""); messageID.current = null; setError(""); }, [selectedID]);
  const select = (id) => { setParams({ quote: id }); setTab("schedule"); };
  const operate = async (task) => {
    if (busy) return;
    setBusy(true); setError("");
    try { await task(); await refresh(); } catch (e) { setError(errorText(e)); } finally { setBusy(false); }
  };
  const saveForm = (data, queue) => operate(async () => {
    const isEditing = form === "edit";
    const result = isEditing ? await api("update", { quote_id: selectedID, title: data.title, settings: data.settings, lines: data.lines, source: data.source }) : await api("create", { ...data, auto_start: queue });
    const id = result.quote?.id;
    if (!id) throw new Error("The request was not returned. Refresh before retrying.");
    saveQuotePreferences(user?.id, { settings: data.settings, dimension_basis: data.source?.easy_request?.dimension_basis, use_standard: data.source?.easy_request?.confirmed });
    setForm(null); select(id);
    if (result.quote?.worker_status === "ready") setTab("result");
    await refresh();
    if (queue && isEditing) await api("queue", { quote_id: id });
  });
  const queue = () => operate(async () => {
    // Partial AI schedules go back to the conversation for clarification.
    // The server checks completeness before any AMSCO execution.
    await api("queue", { quote_id: selectedID });
  });
  const send = (event) => {
    event.preventDefault();
    if (!message.trim() || locked || needsRetryReview || busy) return;
    if (!messageID.current) messageID.current = uid();
    operate(async () => {
      await api("message", { quote_id: selectedID, message: message.trim(), client_message_id: messageID.current });
      setMessage(""); messageID.current = null;
    });
  };
  const convert = (data) => operate(async () => {
    await api("convert_won", { quote_id: selectedID, ...data }); setWonOpen(false); setTab("result");
  });
  const retryFailed = (data) => operate(async () => {
    const result = await api("retry_failed", data);
    if (result.quote?.id !== data.quote_id) throw new Error("The retry was not confirmed. Keep this review open and retry to check the same attempt.");
    setRetryReview(null); select(data.quote_id);
  });
  const remove = () => operate(async () => {
    if (!confirm("Delete this quote request? This cannot be undone.")) return;
    await api("delete", { quote_id: selectedID });
    setParams({});
  });
  if (form === "new") return <div className="min-h-screen px-[18px] py-5 min-[700px]:px-[26px]" style={{ background: C.pageBg }}><WindowQuoteBuilder key={revisionSeed?.title || "new"} seed={revisionSeed} preferenceUserId={user?.id} busy={busy} saveError={error} onSave={saveForm} onCancel={() => setForm(null)} /></div>;
  return <div className="min-h-screen px-[18px] py-5 min-[700px]:px-[26px]" style={{ background: C.pageBg }}>
    <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
      <div><div className="mono-label-sm mb-1.5">Glass Forge · Window Quote Pro</div><h1 className="font-heading text-[28px] font-semibold tracking-tight text-[#131A26]">Window Quotes</h1><p className="mt-1 text-sm text-[#616D81]">Build your windows, review the schedule, and get verified AMSCO pricing.</p></div>
      <div className="flex flex-wrap gap-2"><ConnectClaude /><button className={primaryClass} onClick={() => { setRevisionSeed(null); setForm("new"); setError(""); }}><Plus size={16} />New quote</button></div>
    </header>
    <div className="mb-4 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[#DDE3EC] bg-white px-4 py-3">
      <div className="flex min-w-0 items-center gap-2.5"><MessageSquare size={17} className="shrink-0 text-[#616D81]" /><div className="text-xs text-[#616D81]"><span className="font-semibold text-[#131A26]">{worker?.name || "Window quoting"}</span><span className="ml-2">{serviceStatus}</span></div></div>
      <button className="inline-flex shrink-0 items-center gap-1.5 text-xs font-medium text-[#1E4A85]" onClick={refresh} disabled={listQuery.isFetching}><RefreshCw size={13} className={listQuery.isFetching ? "animate-spin" : ""} />Refresh</button>
    </div>
    {(error || listQuery.isError || (selectedID && detailQuery.isError)) && <div role="alert" className="mb-4 rounded-xl border border-[#EFD2CA] bg-[#FBEDEA] p-3 text-sm text-[#8A4038]">{error || errorText(detailQuery.error || listQuery.error)}</div>}
    <div className="grid items-start gap-4 xl:grid-cols-[270px_minmax(0,1fr)]">
      <aside className={`rounded-2xl border border-[#DDE3EC] bg-white card-shadow ${selectedID ? "hidden xl:block" : ""}`}>
        <div className="border-b border-[#E9EDF4] p-4"><div className="mb-3 flex items-center justify-between"><h2 className="text-sm font-semibold text-[#131A26]">Requests</h2><span className="text-xs text-[#77839A]">{quotes.length}</span></div><div className="relative"><Search className="absolute left-3 top-2.5 h-4 w-4 text-[#77839A]" /><input aria-label="Search quote requests" className={inputClass + " pl-9"} placeholder="Search requests" value={search} onChange={(e) => setSearch(e.target.value)} /></div></div>
        <div className="p-2 xl:max-h-[650px] xl:overflow-y-auto">
          {listQuery.isPending ? <div className="p-8 text-center text-sm text-[#77839A]">Loading requests…</div> : visible.length ? visible.map((q) => <button key={q.id} onClick={() => select(q.id)} className={`mb-1 block w-full rounded-xl border p-3 text-left transition-colors ${selectedID === q.id ? "border-[#C3D4EE] bg-[#E7EEFA]" : "border-transparent hover:bg-[#F6F8FC]"}`}><div className="truncate text-sm font-semibold text-[#131A26]">{q.title || "Untitled window request"}</div><div className="mt-1 line-clamp-2 text-xs leading-relaxed text-[#616D81]">{q.request_text || `${q.lines?.length || 0} takeoff lines`}</div><div className="mt-3 flex flex-wrap items-center justify-between gap-2"><StatusBadge quote={q} /><span className="text-[10px] text-[#77839A]">{date(q.updated_date || q.created_date)}</span></div></button>) : <div className="p-6 text-center text-sm text-[#77839A]">{search ? "No requests match." : "Your new quote requests will appear here."}</div>}
        </div>
      </aside>
      <section className={`min-w-0 overflow-hidden rounded-2xl border border-[#DDE3EC] bg-white card-shadow ${!selectedID ? "hidden xl:block" : ""}`}>
        {!selectedID ? <div className="flex min-h-[510px] flex-col items-center justify-center px-6 py-12 text-center"><div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl border border-[#C3D4EE] bg-[#E7EEFA]"><PanelsTopLeft size={28} className="text-[#2A5EA8]" /></div><h2 className="font-heading text-xl font-semibold text-[#131A26]">Your next window package starts here</h2><p className="mt-3 max-w-md text-sm leading-relaxed text-[#616D81]">Build your windows with visual controls, describe them to the AI guide, or import a schedule. Review the sizes and options, then request verified AMSCO pricing.</p><button className={primaryClass + " mt-6"} onClick={() => { setRevisionSeed(null); setForm("new"); }}><Plus size={15} />Build a window quote</button><p className="mt-4 text-xs text-[#77839A]">A job is created only when you mark a verified quote won.</p></div> : detailQuery.isPending ? <div className="flex min-h-[400px] items-center justify-center gap-2 text-sm text-[#616D81]"><Loader2 size={18} className="animate-spin" />Loading request…</div> : quote ? <>
          <div className="border-b border-[#E9EDF4] px-4 py-4 sm:px-5">
            <button onClick={() => setParams({})} className="mb-3 inline-flex min-h-11 items-center gap-1 text-xs font-medium text-[#1E4A85] xl:hidden"><ArrowLeft size={13} />All requests</button>
            <div className="flex flex-wrap items-start justify-between gap-3"><div className="min-w-0 flex-1"><div className="mb-2 flex flex-wrap items-center gap-2"><StatusBadge quote={quote} /><span className="text-[11px] text-[#77839A]">Revision {quote.input_revision || 1}</span></div><h2 className="break-words text-lg font-semibold text-[#131A26]">{quote.title || "Untitled window request"}</h2></div><div className="flex flex-wrap gap-2"><button className={secondaryClass} onClick={() => {
              if (quote.worker_status === "ready") {
                setRevisionSeed({ title: quote.title, request_text: "", settings: quote.settings, lines: quote.lines, source: { ...quote.source, revision_of: quote.id } });setForm("new");
              } else setForm("edit");
            }} disabled={locked || needsRetryReview || busy}><Settings2 size={14} /><span>{quote.worker_status === "ready" ? "Revise quote" : "Details"}</span></button>{!locked && !["ready", "failed"].includes(quote.worker_status) && <button className={primaryClass} onClick={queue} disabled={busy}>{busy ? <Loader2 size={14} className="animate-spin" /> : <Send size={14} />}{quote.worker_status === "needs_sign_in" ? "Retry after sign-in" : "Send to quoting"}</button>}<button className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-lg border border-[#EFD2CA] bg-white px-3 py-2.5 text-sm font-semibold text-[#8A4038] hover:bg-[#FBEDEA] disabled:cursor-not-allowed disabled:opacity-50" onClick={remove} disabled={locked || busy} title="Delete this quote request" aria-label="Delete this quote request"><Trash2 size={14} /></button></div></div>
            {quote.worker_status !== "ready" && <div className="mt-4 flex items-start gap-2 rounded-lg p-3 text-xs leading-relaxed" style={{ background: activeStatus.bg, color: activeStatus.color }}>{quote.worker_status === "ready" ? <CheckCircle2 size={15} className="shrink-0" /> : ["failed", "needs_sign_in", "needs_details"].includes(quote.worker_status) ? <AlertCircle size={15} className="shrink-0" /> : <Clock3 size={15} className="shrink-0" />}<span>{activeStatus.text}</span></div>}
            <IntakeAssessment quote={quote} />
            {quote.worker_status === "failed" && quote.retry_review && !locked && <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[#DDE3EC] bg-[#F6F8FC] p-3"><p className="min-w-0 flex-1 text-sm leading-relaxed text-[#535E72]">After reviewing the previous attempt, you can retry this request with a fresh quote.</p><button className={primaryClass} disabled={busy} onClick={() => { setError(""); setRetryReview(quote); }}><RefreshCw size={15} />Review & retry</button></div>}
            {quote.previous_attempts?.length > 0 && <details className="mt-3 text-xs text-[#616D81]"><summary className="min-h-11 cursor-pointer py-3 font-medium">Previous drafts retained ({quote.previous_attempts.length})</summary><ul className="list-disc space-y-1 pl-4">{quote.previous_attempts.map((attempt) => <li key={attempt.revision}>Revision {attempt.revision}{attempt.native_quote_number ? ` · AMSCO ${attempt.native_quote_number}` : ' · No saved quote'} · retained for review</li>)}</ul></details>}
            <div className="mt-4 flex gap-1 overflow-x-auto" role="tablist" aria-label="Quote sections">{[["conversation", "Conversation", MessageSquare], ["schedule", "Schedule", ListChecks], ["result", "Quote result", FileText]].map(([key, label, Icon]) => <button key={key} role="tab" aria-selected={tab === key} onClick={() => setTab(key)} className={`inline-flex min-h-11 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold ${tab === key ? "bg-[#E7EEFA] text-[#1E4A85]" : "text-[#616D81] hover:bg-[#F6F8FC]"}`}><Icon size={14} />{label}{key === "result" && quote.worker_status === "ready" && <span className="h-1.5 w-1.5 rounded-full bg-[#276449]" />}</button>)}</div>
          </div>
          {tab === "conversation" ? <>
            <div className="space-y-4 px-4 py-5 sm:px-5">
              {!messages.length && <div className="rounded-xl bg-[#F6F8FC] p-4 break-words text-sm leading-relaxed text-[#535E72]">{quote.request_text || "Your schedule is saved. Send it to the quoting agent to continue."}</div>}
              {messages.map((item) => <article key={item.id || item.client_message_id} className={`flex ${item.role === "user" ? "justify-end" : "justify-start"}`}><div className={`min-w-0 max-w-full rounded-2xl px-4 py-3 sm:max-w-[85%] ${item.role === "user" ? "rounded-br-md bg-[#E7EEFA]" : "rounded-bl-md border border-[#DDE3EC] bg-[#F6F8FC]"}`}><div className="mb-1.5 flex flex-wrap items-center gap-2 text-[10px] font-semibold text-[#77839A]"><span>{item.role === "user" ? "You" : item.role === "system" ? "Quote update" : "Quoting assistant"}</span><span className="font-normal">{date(item.created_date)}</span></div><p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-[#131A26]">{item.content}</p>{item.kind === "ready" && <button type="button" className={primaryClass + " mt-3"} onClick={() => setTab("result")}><FileText size={15} />View quote</button>}</div></article>)}
            </div>
            {!["ready", "failed"].includes(quote.worker_status) && quote.sales_status !== "won" && <form onSubmit={send} className="border-t border-[#E9EDF4] bg-[#F6F8FC] p-4">
              <label htmlFor="quote-message" className="sr-only">Reply to this quote request</label><div className="flex items-end gap-2"><textarea id="quote-message" className={inputClass + " min-h-[76px] resize-y"} value={message} maxLength={18000} onChange={(e) => { setMessage(e.target.value); messageID.current = null; }} placeholder={needsRetryReview ? "Review and retry the previous attempt to continue this request." : locked ? quote.sales_status === "won" ? "Accepted revision — start a new request for changes." : "The request is being quoted. Replies reopen when input is needed." : "Reply in your own words — add details or tell us what to change…"} disabled={locked || needsRetryReview || busy} onKeyDown={(e) => { if ((e.metaKey || e.ctrlKey) && e.key === "Enter") send(e); }} /><button type="submit" aria-label="Send message" className={primaryClass + " min-h-11 shrink-0 px-3"} disabled={!message.trim() || locked || needsRetryReview || busy}>{busy ? <Loader2 size={17} className="animate-spin" /> : <Send size={17} />}</button></div><p className="mt-2 text-[11px] text-[#77839A]">{locked ? "We’ll let you know here if we need a detail or your quote is ready." : "The AI reviews your reply with the rest of this request, then checks whether quoting can continue."}</p>
            </form>}
          </> : <div className="p-4 sm:p-5">{tab === "schedule" ? <ScheduleView quote={quote} /> : <WindowQuoteResults quote={quote} onWon={() => setWonOpen(true)} busy={busy} />}</div>}
          {quote.job_id && tab !== "result" && <Link to={`/jobs/${encodeURIComponent(quote.job_id)}`} className="flex items-center justify-between border-t border-[#E9EDF4] p-4 text-sm font-semibold text-[#1E4A85]"><span className="flex items-center gap-2"><BriefcaseBusiness size={16} />Open linked job</span><ArrowUpRight size={15} /></Link>}
        </> : <div className="p-10 text-center text-sm text-[#616D81]">This request is unavailable. Choose another request or refresh.</div>}
      </section>
    </div>
    <Dialog open={!!form} onOpenChange={(open) => { if (!open && !busy) setForm(null); }}><DialogContent className="max-h-[90dvh] max-w-3xl overflow-y-auto rounded-2xl bg-white"><DialogHeader><DialogTitle>{form === "edit" ? "Request details" : revisionSeed ? "Revise window quote" : "New window quote"}</DialogTitle><DialogDescription>{form === "edit" ? "Changes create a new request revision. Previous verified results are kept in history." : revisionSeed ? "This creates a fresh request and AMSCO quote. The previous verified quote stays unchanged." : "Describe what you need in your own words and add any settings you know. The AI reviews your full request when you send it."}</DialogDescription></DialogHeader>{error && <p role="alert" className="rounded-lg bg-[#FBEDEA] p-3 text-sm text-[#8A4038]">{error}</p>}{form && <QuoteForm key={form === "edit" ? selectedID : "new"} quote={form === "edit" ? quote : null} seed={form === "new" ? revisionSeed : null} preferenceUserId={user?.id} busy={busy} onSave={saveForm} onCancel={() => setForm(null)} />}</DialogContent></Dialog>
    <Dialog open={!!retryReview} onOpenChange={(open) => { if (!open && !busy) setRetryReview(null); }}><DialogContent className="max-h-[90dvh] overflow-y-auto rounded-2xl bg-white"><DialogHeader><DialogTitle>Retry this quote request</DialogTitle><DialogDescription>Review the previous attempt before starting a new quote.</DialogDescription></DialogHeader>{error && <p role="alert" className="rounded-lg bg-[#FBEDEA] p-3 text-sm text-[#8A4038]">{error}</p>}{retryReview && <RetryFailedForm quote={retryReview} busy={busy} onSubmit={retryFailed} onCancel={() => setRetryReview(null)} />}</DialogContent></Dialog>
    <Dialog open={wonOpen} onOpenChange={(open) => { if (!busy) setWonOpen(open); }}><DialogContent className="max-h-[90dvh] overflow-y-auto rounded-2xl bg-white"><DialogHeader><DialogTitle>Accept quote & create job</DialogTitle><DialogDescription>Keep an accepted snapshot of this quote revision.</DialogDescription></DialogHeader>{error && <p role="alert" className="rounded-lg bg-[#FBEDEA] p-3 text-sm text-[#8A4038]">{error}</p>}{wonOpen && quote && <WonForm quote={quote} busy={busy} onSubmit={convert} onCancel={() => setWonOpen(false)} />}</DialogContent></Dialog>
  </div>;
}
