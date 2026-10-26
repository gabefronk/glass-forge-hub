import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { Upload } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { isAgentCenterOwner } from "@/lib/agentCenterAccess";
import { base44 } from "@/api/base44Client";
import { BANK_ACCOUNT, BANK_CATEGORIES, bankByCategory, bankCategory, bankCoverage, planBankImport } from "@/lib/bankLines";
import { cardFigures } from "@/lib/purchasingSummary";
import { purchasingBoardCards } from "@/lib/purchasingScopes";
import { monthName } from "@/lib/companyOverview";
import { purchasingRequest, money } from "@/components/budgets/ProcurementForms";
import { PageShell } from "@/components/PageShell";

// Bank (Gabe, Oct 26): YA Windows & Doors' bank lines, imported from QuickBooks' bank-feed CSV,
// each with one category. The Company overview takes crew pay, overhead and other costs from
// here; lines the Hub already counts (labor payments, customer payments, job orders, shop POs)
// stay out of its profit. Sorting and matching live in src/lib/bankLines.js.

const denverDate = (value = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));
const dayLabel = (iso) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" }) : "");

const BAND = "#0B3F3B", TITLE = "#F2EEE8", LABEL = "#C3CBCC", DIVIDER = "rgba(242,238,232,.18)";
const INK = "#101617", SECONDARY = "#566063", STRONG = "#34403F", RULE = "#D6CCBA", HEAD_BG = "#E9E2D4", LATE = "#A43432";
const th = "whitespace-nowrap text-[13px] font-semibold uppercase tracking-[0.04em]";
const td = "whitespace-nowrap text-[14px]";
const cell = { padding: "7px 12px" };

function Figure({ label, value }) {
  return (
    <div className="min-w-0 px-5 max-[1023px]:px-3 max-[1023px]:py-2" style={{ borderLeft: `1px solid ${DIVIDER}` }}>
      <div className="whitespace-nowrap text-[13px] font-medium" style={{ color: LABEL }}>{label}</div>
      <div className="whitespace-nowrap text-[18px] font-bold tabular-nums" style={{ color: value < 0 ? "#F0A8A6" : TITLE }}>{money(value)}</div>
    </div>
  );
}

function Sheet({ title, aside, right, children }) {
  return (
    <section className="overflow-hidden rounded-[12px]" style={{ backgroundColor: "#FFFFFF", border: "1px solid #B3A792" }}>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2" style={{ padding: "12px 16px" }}>
        <h2 className="m-0 text-[16px] font-bold" style={{ color: INK }}>{title}</h2>
        {aside ? <span className="text-[14px]" style={{ color: SECONDARY }}>{aside}</span> : null}
        <div style={{ flex: 1 }} />
        {right}
      </div>
      <div className="overflow-x-auto">{children}</div>
    </section>
  );
}

const Money = ({ value, bold }) => (
  <td className={`${td} text-right tabular-nums ${bold ? "font-bold" : ""}`} style={{ ...cell, color: value < 0 ? LATE : INK }}>{money(value)}</td>
);

function BankContent({ user }) {
  const [state, setState] = useState({ loading: true, error: "", lines: [], jobs: new Map() });
  const [filter, setFilter] = useState("all");
  const [pending, setPending] = useState(null); // { file, plan } awaiting Import
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const fileRef = useRef(null);

  const load = async () => {
    try {
      const [lines, jobs] = await Promise.all([
        base44.entities.BankTransactions.list("-posted_date", 5000),
        base44.entities.Jobs.list("canonical_name", 5000),
      ]);
      setState({ loading: false, error: "", lines, jobs: new Map(jobs.map((j) => [j.id, j.canonical_name || j.job_name || j.id])) });
    } catch (e) {
      setState((s) => ({ ...s, loading: false, error: `The bank lines could not load. ${e?.message || ""}`.trim() }));
    }
  };
  useEffect(() => { load(); }, []);

  const chooseFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    setMessage(""); setBusy("Reading the file…");
    try {
      const [text, pos, vos, board] = await Promise.all([
        file.text(),
        base44.entities.PurchaseOrders.list("-created_date", 2000),
        base44.entities.VendorOrders.list("-created_date", 2000),
        purchasingRequest({ action: "overview" }),
      ]);
      const sales = purchasingBoardCards(board, denverDate()).map((c) => ({ id: c.job?.id, name: c.job?.canonical_name || "", sale: cardFigures(c).sale })).filter((j) => j.id && j.sale > 0);
      const plan = planBankImport(text, { existing: state.lines, purchaseOrders: pos, vendorOrders: vos, sales });
      setPending({ file: file.name, plan });
    } catch (err) {
      setMessage(err?.message || "The file could not be read.");
    } finally {
      setBusy("");
    }
  };

  const runImport = async () => {
    const { file, plan } = pending;
    setBusy(`Importing ${plan.lines.length} lines…`);
    try {
      const at = new Date().toISOString();
      const batch = `${denverDate()} ${file}`;
      const rows = plan.lines.map((l) => ({ ...l, import_batch: batch, source_file: file, categorized_by_email: user?.email || "", categorized_at: at }));
      for (let i = 0; i < rows.length; i += 100) await base44.entities.BankTransactions.bulkCreate(rows.slice(i, i + 100));
      setMessage(`Imported ${rows.length} new lines from ${file}${plan.skipped ? `; ${plan.skipped} were already here` : ""}.`);
      setPending(null);
      await load();
    } catch (err) {
      setMessage(`The import stopped. ${err?.message || ""}`.trim());
      await load();
    } finally {
      setBusy("");
    }
  };

  const setCategory = async (line, category) => {
    const patch = { category, match: "manual", categorized_by_email: user?.email || "", categorized_at: new Date().toISOString() };
    setState((s) => ({ ...s, lines: s.lines.map((l) => (l.id === line.id ? { ...l, ...patch } : l)) }));
    try {
      await base44.entities.BankTransactions.update(line.id, patch);
    } catch (err) {
      setMessage(`That change didn't save. ${err?.message || ""}`.trim());
      await load();
    }
  };

  const coverage = useMemo(() => bankCoverage(state.lines), [state.lines]);
  const byCategory = useMemo(() => bankByCategory(state.lines), [state.lines]);
  const shown = useMemo(() => state.lines.filter((l) => filter === "all" || l.category === filter), [state.lines, filter]);
  const totals = useMemo(() => {
    const moneyIn = state.lines.reduce((n, l) => n + Math.max(0, l.amount || 0), 0);
    const moneyOut = state.lines.reduce((n, l) => n + Math.min(0, l.amount || 0), 0);
    const counted = state.lines.filter((l) => bankCategory(l.category).column && l.amount < 0).reduce((n, l) => n + l.amount, 0);
    return { moneyIn, moneyOut, net: moneyIn + moneyOut, counted };
  }, [state.lines]);

  if (state.loading) {
    return <PageShell><div className="flex items-center justify-center py-24"><div className="h-7 w-7 animate-spin rounded-full border-2" style={{ borderColor: RULE, borderTopColor: BAND }} /></div></PageShell>;
  }

  const sub = coverage.count ? `${BANK_ACCOUNT} · ${coverage.count} lines · ${dayLabel(coverage.first)} – ${dayLabel(coverage.last)}, ${coverage.last.slice(0, 4)}` : `${BANK_ACCOUNT} · no lines yet`;
  const shownTotal = shown.reduce((n, l) => n + (l.amount || 0), 0);

  return (
    <PageShell>
      <section className="rounded-[12px]" style={{ backgroundColor: BAND }}>
        <div className="flex flex-wrap items-center gap-y-2" style={{ minHeight: "68px", padding: "10px 12px 10px 20px" }}>
          <div className="min-w-0">
            <h1 className="m-0 text-[24px] font-bold" style={{ color: TITLE, letterSpacing: "-0.03em" }}>Bank</h1>
            <div className="text-[13px] font-medium" style={{ color: LABEL }}>{sub}</div>
          </div>
          <div style={{ flex: 1 }} />
          <div className="grid grid-cols-4 max-[1023px]:order-last max-[1023px]:w-full max-[1023px]:grid-cols-2">
            <Figure label="Money in" value={totals.moneyIn} />
            <Figure label="Money out" value={totals.moneyOut} />
            <Figure label="Net" value={totals.net} />
            <Figure label="Costs on the overview" value={totals.counted} />
          </div>
          <input ref={fileRef} type="file" accept=".csv,text/csv" className="hidden" aria-label="Bank CSV" onChange={chooseFile} />
          <button type="button" disabled={Boolean(busy)} onClick={() => fileRef.current?.click()} className="ml-2 inline-flex h-9 items-center gap-1.5 rounded-[8px] px-3 text-[14px] font-semibold" style={{ border: "1px solid rgba(242,238,232,.3)", background: "none", color: TITLE }}>
            <Upload style={{ width: "16px", height: "16px" }} /> Import CSV
          </button>
        </div>
      </section>

      {(busy || message || pending) && (
        <div role="status" className="flex flex-wrap items-center gap-3 rounded-[12px] border bg-white p-3 text-[14px]" style={{ borderColor: "#B3A792", color: INK }}>
          {busy ? <span>{busy}</span> : pending ? (
            <>
              <span><strong>{pending.file}</strong>: {pending.plan.lines.length} new lines{pending.plan.skipped ? ` · ${pending.plan.skipped} already here` : ""}</span>
              <div style={{ flex: 1 }} />
              <button type="button" disabled={!pending.plan.lines.length} onClick={runImport} className="inline-flex h-9 items-center rounded-[8px] px-3 font-semibold" style={{ backgroundColor: BAND, color: TITLE }}>Import {pending.plan.lines.length} lines</button>
              <button type="button" onClick={() => setPending(null)} className="inline-flex h-9 items-center rounded-[8px] border px-3 font-semibold" style={{ borderColor: RULE }}>Cancel</button>
            </>
          ) : <span style={{ color: /stopped|didn't|could not|no Date/.test(message) ? LATE : INK }}>{message}</span>}
        </div>
      )}
      {state.error && <p role="alert" className="m-0 rounded-[12px] border bg-white p-3 text-[14px]" style={{ color: LATE }}>{state.error}</p>}

      <Sheet title="By category" aside={<>Export the bank feed from QuickBooks as CSV and import it here. <Link to="/operations/overview" className="font-semibold hover:underline" style={{ color: INK }}>Company overview →</Link></>}>
        <table className="w-full border-collapse">
          <thead>
            <tr style={{ backgroundColor: HEAD_BG, borderBottom: `2px solid ${STRONG}` }}>
              <th className={th} style={{ ...cell, color: STRONG, textAlign: "left" }}>Category</th>
              <th className={th} style={{ ...cell, color: STRONG, textAlign: "right" }}>Lines</th>
              {byCategory.months.map((m) => <th key={m} className={th} style={{ ...cell, color: STRONG, textAlign: "right" }}>{monthName(m)}</th>)}
              {byCategory.months.length > 1 && <th className={th} style={{ ...cell, color: STRONG, textAlign: "right" }}>Total</th>}
              <th className={th} style={{ ...cell, color: STRONG, textAlign: "left" }}>On the overview</th>
            </tr>
          </thead>
          <tbody>
            {byCategory.rows.map((r) => (
              <tr key={r.key} style={{ borderTop: `1px solid ${RULE}` }}>
                <td className={`${td} font-semibold`} style={{ ...cell, color: INK }}>{r.label}</td>
                <td className={`${td} text-right tabular-nums`} style={{ ...cell, color: INK }}>{r.count}</td>
                {byCategory.months.map((m) => <Money key={m} value={r.byMonth[m]} />)}
                {byCategory.months.length > 1 && <Money value={r.total} bold />}
                <td className={td} style={{ ...cell, color: r.column ? INK : SECONDARY }}>{r.note}</td>
              </tr>
            ))}
            <tr style={{ borderTop: `2px solid ${STRONG}` }}>
              <td className={`${td} font-bold`} style={cell}>Net</td>
              <td className={`${td} text-right font-bold tabular-nums`} style={cell}>{coverage.count}</td>
              {byCategory.months.map((m) => <Money key={m} bold value={byCategory.rows.reduce((n, r) => n + r.byMonth[m], 0)} />)}
              {byCategory.months.length > 1 && <Money bold value={totals.net} />}
              <td style={cell} />
            </tr>
          </tbody>
        </table>
      </Sheet>

      <Sheet
        title="Lines"
        aside={`${shown.length} lines · ${money(shownTotal)}`}
        right={(
          <select aria-label="Show category" value={filter} onChange={(e) => setFilter(e.target.value)} className="h-9 rounded-[8px] border bg-white px-2 text-[14px]" style={{ borderColor: RULE, color: INK }}>
            <option value="all">All categories</option>
            {BANK_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        )}
      >
        <table className="w-full border-collapse">
          <thead>
            <tr style={{ backgroundColor: HEAD_BG, borderBottom: `2px solid ${STRONG}` }}>
              {[["Date"], ["Bank description"], ["Amount", true], ["Category"], ["Job"], ["Matched to"]].map(([l, right]) => (
                <th key={l} className={th} style={{ ...cell, color: STRONG, textAlign: right ? "right" : "left" }}>{l}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {shown.map((l) => (
              <tr key={l.id} style={{ borderTop: `1px solid ${RULE}` }}>
                <td className={`${td} tabular-nums`} style={{ ...cell, color: INK }}>{dayLabel(l.posted_date)}</td>
                <td className={td} style={{ ...cell, color: INK }} title={l.qb_category ? `QuickBooks guessed: ${l.qb_category}` : undefined}>{l.description}{l.from_to && l.from_to !== l.description ? <span style={{ color: SECONDARY }}> · {l.from_to}</span> : null}</td>
                <Money value={l.amount} />
                <td style={{ padding: "4px 12px" }}>
                  <select aria-label={`Category for ${l.description} ${money(l.amount)}`} value={l.category} onChange={(e) => setCategory(l, e.target.value)} className="h-8 rounded-[6px] border bg-white px-1.5 text-[14px]" style={{ borderColor: RULE, color: INK }}>
                    {BANK_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </select>
                </td>
                <td className={td} style={{ ...cell, color: INK }}>{l.job_id ? <Link to={`/jobs/${l.job_id}`} className="font-semibold hover:underline" style={{ color: INK }}>{state.jobs.get(l.job_id) || "Job"}</Link> : <span style={{ color: SECONDARY }}>—</span>}</td>
                <td className={td} style={{ ...cell, color: SECONDARY }}>{l.match === "manual" ? "Set by hand" : l.match_note || ""}</td>
              </tr>
            ))}
            {!shown.length && <tr><td colSpan={6} className="text-[14px]" style={{ ...cell, color: SECONDARY }}>No lines yet. Import the bank feed CSV from QuickBooks.</td></tr>}
          </tbody>
        </table>
      </Sheet>
    </PageShell>
  );
}

export default function Bank() {
  const { user } = useAuth();
  if (!isAgentCenterOwner(user)) return <PageShell><p>Bank is available to the owner.</p></PageShell>;
  return <BankContent key={user.id} user={user} />;
}
