import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ChevronDown } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import { isAgentCenterOwner } from "@/lib/agentCenterAccess";
import { base44 } from "@/api/base44Client";
import { computeFeeAmt, computeLaborAmt, withComputedAmounts } from "@/lib/feeMath";
import { buildSupersededSet, isReady, withCompanions } from "@/lib/invoicingFilters";
import { inInvoiceScope } from "@/lib/invoiceScope";
import { invoiceRegister } from "@/lib/invoiceRegister";
import { moneyBarSegments, moneyStrip } from "@/lib/invoiceMoneyBar";
import { planSplitLines, isHeldForPurchasing } from "@/lib/purchasingSplit";
import { purchasingBoardCards } from "@/lib/purchasingScopes";
import { paymentStage } from "@/lib/jobPayment";
import { companyYear, companyYearCsv, cashYear, cashYearCsv, withSplitPlan, monthName } from "@/lib/companyOverview";
import { bankCoverage, isWeeklyStream } from "@/lib/bankLines";
import { importedLaborDiagnostic } from "@/lib/companyPicture";
import { jobLedger, receiptsLedger, TAGS, GF_FEE_CHECK } from "@/lib/jobLedger";
import { yaOperatingYear, entityViews, OPERATING_GROUPS } from "@/lib/companyProfit";
import { BOOKS_PL, QBO_SALES, QBO_UNASSIGNED } from "@/lib/booksSnapshot";
import { purchasingRequest, money } from "@/components/budgets/ProcurementForms";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { PageShell } from "@/components/PageShell";

// Company overview (Gabe, Oct 26): YA Windows & Doors in separate views, each with its own source,
// period and basis, never mixed into one number:
//  1. Job ledger (jobLedger.js, the same rows Purchasing reads): management job margin over each
//     active job's lifetime, sale less all-in cost split 50/50, every figure tagged by source; the
//     completed jobs apart. Then the receipts ledger: every customer payment with its source, and
//     every customer deposit no job accounts for.
//  2. Company profit (companyProfit.js): YA's operating statement, cash basis from the bank lines,
//     genuine expenses only, pending classifications shown apart; YA, Glass Forge and combined.
//  3. Books YTD: QuickBooks' Profit and Loss, accrual and cash side by side (read-only snapshot).
//  4. Bank cash movement YTD: the Hub's bank lines by month (cashYear). Unreconciled cash movement.
// No full-year scenario: neither basis can be supported honestly yet (reasons on the page).
// The July imported-lines diagnostic is conditional and kept apart from every actual.
// Hub-recorded income (before crew pay) and Glass Forge's invoices stay below as reference.

// America/Denver today (inlined; new src files may not import base44/shared).
const denverDate = (value = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));

const BAND = "#0B3F3B", TITLE = "#F2EEE8", LABEL = "#C3CBCC", DIVIDER = "rgba(242,238,232,.18)";
const INK = "#101617", SECONDARY = "#566063", STRONG = "#34403F", RULE = "#D6CCBA", HEAD_BG = "#E9E2D4", LATE = "#A43432", AMBER = "#6F4E10";
const out = (v) => (v ? -v : 0); // money out reads as a negative number; zero stays $0.00
const pct = (r) => (r == null ? "—" : `${(r * 100).toFixed(1)}%`);
const dayLabel = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function Figure({ label, value, sub, title }) {
  return (
    <div title={title} className="min-w-0 px-5 max-[1023px]:px-3 max-[1023px]:py-2" style={{ borderLeft: `1px solid ${DIVIDER}` }}>
      <div className="whitespace-nowrap text-[13px] font-medium" style={{ color: LABEL }}>{label}</div>
      <div className="whitespace-nowrap text-[18px] font-bold tabular-nums max-[1023px]:text-[17px]" style={{ color: value < 0 ? "#F0A8A6" : TITLE, letterSpacing: "-0.01em" }}>{money(value)}</div>
      <div className="whitespace-nowrap text-[13px]" style={{ color: LABEL }}>{sub}</div>
    </div>
  );
}

// A view: title, what it is, and its source / coverage line.
function Sheet({ title, aside, source, children }) {
  return (
    <section className="overflow-hidden rounded-[12px]" style={{ backgroundColor: "#FFFFFF", border: "1px solid #B3A792" }}>
      <div style={{ padding: "12px 16px" }}>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="m-0 text-[16px] font-bold" style={{ color: INK, letterSpacing: "-0.01em" }}>{title}</h2>
          {aside ? <span className="text-[14px]" style={{ color: SECONDARY }}>{aside}</span> : null}
        </div>
        {source ? <div className="mt-1 text-[13px]" style={{ color: SECONDARY }}>{source}</div> : null}
      </div>
      <div className="overflow-x-auto">{children}</div>
    </section>
  );
}

const th = "whitespace-nowrap text-[13px] font-semibold uppercase tracking-[0.04em]";
function Head({ cols }) {
  return (
    <thead>
      <tr style={{ backgroundColor: HEAD_BG, borderBottom: `2px solid ${STRONG}` }}>
        {cols.map(([label, right, title]) => (
          <th key={label} title={title} className={th} style={{ padding: "8px 10px", color: STRONG, textAlign: right ? "right" : "left" }}>{label}</th>
        ))}
      </tr>
    </thead>
  );
}

// Cell kinds: money, out (money out as a negative), pct, unk (an unknown, never $0.00), r (any
// right-aligned node), or plain text.
function Row({ cells, tone = "", title }) {
  const total = tone === "total";
  return (
    <tr title={title} style={{ borderTop: total ? `2px solid ${STRONG}` : `1px solid ${RULE}`, backgroundColor: tone === "muted" ? "#F6F3EC" : undefined }}>
      {cells.map(([value, kind], i) => {
        const right = ["money", "out", "pct", "unk", "r"].includes(kind);
        const n = kind === "out" ? out(value) : value;
        const text = kind === "money" || kind === "out" ? money(n) : kind === "pct" ? pct(value) : value;
        const negative = kind === "money" && typeof n === "number" && n < 0;
        return (
          <td key={i} className={`${i === 0 ? "min-w-[96px] max-w-[220px]" : "whitespace-nowrap"} text-[14px] ${right ? "text-right tabular-nums" : ""} ${total ? "font-bold" : ""}`}
            style={{ padding: "8px 10px", color: kind === "unk" ? AMBER : negative ? LATE : INK }}>{text}</td>
        );
      })}
    </tr>
  );
}
const unk = (label = "Unknown") => [label, "unk"];
const tag = (v, label, neg = false) => [<span key="t">{money(neg ? out(v) : v)} <span className="text-[13px]" style={{ color: SECONDARY }}>{label}</span></span>, "r"];

const YA_COLS = [
  ["Month"], ["Labor billed", true, "Install labor billed to BFS: Invoicing's Labor total for the month"],
  ["Job sales", true, "Sale on outside jobs that were paid: the 50/50 profit-split lines on Invoicing"],
  ["Income", true, "Labor billed plus job sales"], ["Job cost", true, "Cost on those outside jobs (windows plus labor & material)"],
  ["Shop", true, "Shop and overhead purchases (POs with no job)"],
  ["Glass Forge", true, "What YA owes Glass Forge: the issued Glass Forge invoice where there is one, otherwise the Hub's 10% install fee plus half of each paid outside job's profit. Nothing before March 2026, when the agreement took effect"],
  ["Before crew pay", true, "Income less job cost, shop and Glass Forge. Crew pay and overhead are not in these Hub records"],
];
const GF_COLS = [
  ["Month"], ["Invoice", false, "Glass Forge's issued invoice to YA for the month (opens the document)"],
  ["Install fees", true, "10% of install labor"], ["Profit splits", true, "Glass Forge's share of outside job and product sales"],
  ["Glass Forge", true, "The invoice's amount due, or the Hub's figure for a month not invoiced yet"],
  ["Hub figure", true, "What the Hub's Invoicing lines come to for the month"], ["Difference", true, "Invoice less Hub figure"],
];
// The Invoice cell: the issued invoice's number (linked to the document), Not invoiced, or Before agreement.
function invoiceCell(m) {
  if (m.basis === "before") return <span style={{ color: SECONDARY }}>Before agreement</span>;
  if (m.basis === "hub") return <span className="font-semibold" style={{ color: AMBER }}>Not invoiced</span>;
  return m.invoice.docs.map((d) => (d.url
    ? <a key={d.number} href={d.url} target="_blank" rel="noreferrer" className="mr-2 font-semibold hover:underline" style={{ color: INK }}>{d.number}</a>
    : <span key={d.number} className="mr-2 font-semibold">{d.number}</span>));
}
const gfCells = (label, r, invoice) => [[label], [invoice], [r.fee, "money"], [r.split, "money"], [r.glassForge, "money"],
  r.basis === "before" ? [""] : [r.hubGlassForge, "money"], !(r.invoiced || r.basis === "invoice") ? [""] : [r.difference, "money"]];
const yaCells = (label, r) => [[label], [r.labor, "money"], [r.sales, "money"], [r.income, "money"], [r.jobCost, "out"], [r.shop, "out"], [r.glassForge, "out"], [r.profit, "money"]];

const CASH_COLS = [
  ["Month"], ["Money in", true, "Every deposit into the Mountain America account"],
  ["Crew pay", true, "Drafts and checks up to $3,500, except the weekly $2,500/$3,000 stream"],
  ["Weekly $2.5k / $3k", true, "The 48 checks/drafts of exactly $2,500 or $3,000 (Jan–Oct). 11 payees are verified from check images, 37 are not; their classification (wages, owner payments, other) is unknown, so this is cash out only, not an expense"],
  ["Overhead", true, "Payroll ACH, payroll taxes, insurance, equipment rental, taxes, fees"],
  ["Suppliers", true, "Supplier orders for Hub jobs, shop POs and suppliers with no Hub order"],
  ["Glass Forge paid", true, "Glass Forge invoices YA paid"],
  ["Other money out", true, "Amex card payments, loan payments, transfers and lines not sorted yet"],
  ["Net cash movement", true, "Money in less all money out. Cash movement, not profit"],
];
const cashCells = (label, r) => [[label], [r.moneyIn, "money"], [r.crewPay, "out"], [r.weekly, "out"], [r.overhead, "out"], [r.suppliers, "out"], [r.glassForge, "out"], [r.other, "out"], [r.net, "money"]];

const YEAR_LABEL = { "2026": "2026", "2026?": "2026, at risk", "2027": "2027", unknown: "Unknown" };

function CompanyOverviewContent() {
  const [state, setState] = useState({ loading: true, error: "", data: null });
  const loadSeq = useRef(0);
  const today = denverDate();
  const thisMonth = today.slice(0, 7);

  useEffect(() => {
    const seq = ++loadSeq.current;
    (async () => {
      try {
        const [fl, events, jobs, budgets, pos, vos, closes, invoices, bankLines, costInputs, board] = await Promise.all([
          base44.entities.FeeLines.list("-job_date", 5000),
          base44.entities.CalendarEvents.list("-event_date", 5000),
          base44.entities.Jobs.list("canonical_name", 5000),
          base44.entities.JobBudgets.list("-updated_date", 2000),
          base44.entities.PurchaseOrders.list("-created_date", 2000),
          base44.entities.VendorOrders.list("-created_date", 2000),
          base44.entities.MonthCloseSnapshot.list("-created_date", 100).catch(() => []),
          base44.entities.Invoices.list("-invoice_date", 2000).catch(() => []),
          base44.entities.BankTransactions.list("-posted_date", 10000).catch(() => []),
          base44.entities.JobCostInputs.list("-updated_date", 2000).catch(() => []),
          purchasingRequest({ action: "overview" }),
        ]);
        if (seq !== loadSeq.current) return;
        // Invoicing's rows exactly: Purchasing jobs' own lines held off, a Paid job's 50/50 split
        // line in place (pending here if Invoicing has not written it yet), companions resolved.
        const closedMonths = (closes || []).map((c) => c.month).filter(Boolean);
        const plan = planSplitLines({ jobs, budgets, purchase_orders: pos, vendor_orders: vos }, fl, { closedMonths });
        const feeLines = withComputedAmounts(withSplitPlan(fl, plan).filter((r) => !isHeldForPurchasing(r, plan.jobIds)));
        const rows = withCompanions(feeLines, events);
        const superseded = buildSupersededSet(rows, events);
        const reports = new Map(events.filter((e) => e.google_event_id).map((e) => [e.google_event_id, e.report_status]));
        setState({ loading: false, error: "", data: { rows, superseded, reports, feeLines, rawFeeLines: fl, invoices, pos, vos, budgets, costInputs, bankLines, cards: purchasingBoardCards(board, today) } });
      } catch (e) {
        if (seq === loadSeq.current) setState({ loading: false, error: `The overview could not load. ${e?.message || ""}`.trim(), data: null });
      }
    })();
    return () => { loadSeq.current++; };
  }, [today]);

  const year = useMemo(() => (state.data ? companyYear({ rows: state.data.rows, superseded: state.data.superseded, cards: state.data.cards, purchaseOrders: state.data.pos, invoices: state.data.invoices, bankLines: state.data.bankLines, today }) : null), [state.data, today]);
  const cy = useMemo(() => (year ? cashYear(year) : null), [year]);
  const bank = useMemo(() => (state.data ? bankCoverage(state.data.bankLines.filter((l) => String(l.posted_date || "").startsWith(today.slice(0, 4)))) : null), [state.data, today]);
  const weekly = useMemo(() => {
    if (!state.data) return null;
    const lines = state.data.bankLines.filter((l) => String(l.posted_date || "").startsWith(today.slice(0, 4)) && isWeeklyStream(l));
    return { count: lines.length, total: lines.reduce((n, l) => n - Number(l.amount || 0), 0) };
  }, [state.data, today]);
  const ledger = useMemo(() => (state.data ? jobLedger({ cards: state.data.cards, budgets: state.data.budgets, orders: state.data.vos, costInputs: state.data.costInputs, bankLines: state.data.bankLines, sales: QBO_SALES }) : null), [state.data]);
  const receipts = useMemo(() => (ledger ? receiptsLedger({ rows: [...ledger.active, ...ledger.completed], bankLines: state.data.bankLines, sales: QBO_SALES, unassigned: QBO_UNASSIGNED }) : null), [ledger, state.data]);
  const operating = useMemo(() => (state.data ? yaOperatingYear(state.data.bankLines, { from: `${today.slice(0, 4)}-01-01`, to: today }) : null), [state.data, today]);
  const entities = useMemo(() => (ledger && operating ? entityViews({ ledger: ledger.totals.active, operating }) : null), [ledger, operating]);
  const july = useMemo(() => (state.data ? importedLaborDiagnostic(state.data.rawFeeLines, `${today.slice(0, 4)}-07`) : null), [state.data, today]);
  // This month's Ready to invoice: Invoicing's own money strip.
  const strip = useMemo(() => {
    if (!state.data) return null;
    const { rows, superseded, reports, invoices, feeLines } = state.data;
    const monthRows = rows.filter((r) => inInvoiceScope(r, thisMonth));
    return { ...moneyStrip(moneyBarSegments(monthRows, reports, superseded, invoiceRegister(invoices, feeLines))), monthRows };
  }, [state.data, thisMonth]);

  const exportCsv = (cashBasis = false) => {
    const blob = new Blob([cashBasis ? cashYearCsv(year, cy) : companyYearCsv(year)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `ya-windows-${year.year}-${cashBasis ? "bank-cash-movement" : "hub-recorded-income"}.csv`; a.click(); URL.revokeObjectURL(url);
  };
  const [exportError, setExportError] = useState("");
  const exportStatement = async () => {
    setExportError("");
    try {
      const { exportInvoicePdf } = await import("@/lib/exportInvoicePdf");
      const { superseded, reports } = state.data;
      const ready = strip.monthRows.filter((r) => isReady(r, reports, superseded)).map((r) => ({ ...r, labor_amt: computeLaborAmt(r), fee_amt: computeFeeAmt(r) }));
      await exportInvoicePdf(thisMonth, ready);
    } catch (e) {
      setExportError(`The statement could not be made. ${e?.message || ""}`.trim());
    }
  };

  if (state.loading) {
    return (
      <PageShell>
        <div className="flex items-center justify-center py-24"><div className="h-7 w-7 animate-spin rounded-full border-2" style={{ borderColor: RULE, borderTopColor: BAND }} /></div>
      </PageShell>
    );
  }
  if (!year) return <PageShell><p role="alert" className="rounded-[12px] border bg-white p-4 text-[14px]" style={{ color: LATE }}>{state.error}</p></PageShell>;

  const { ytd } = year;
  const thisMonthName = monthName(thisMonth);
  const hasBank = cy.months.length > 0;
  const bankSpan = hasBank ? `${dayLabel(bank.first)} – ${dayLabel(bank.last)}, ${bank.last.slice(0, 4)}` : "";
  const cashLabel = (m) => (m.partial ? `${monthName(m.month)} · partial (bank ${m.coveredDays} of ${m.monthDays} days)` : monthName(m.month));
  const net = (label) => BOOKS_PL.rows.find((r) => r[0] === label);
  const julyMonth = year.months.find((m) => m.month === july.month);
  const t = ledger.totals.active, tc = ledger.totals.completed;
  const op = operating;
  const ov = cy.overlap;

  return (
    <PageShell width="max-w-[1480px]">
      <section className="rounded-[12px]" style={{ backgroundColor: BAND }}>
        <div className="flex flex-wrap items-center gap-y-2" style={{ minHeight: "68px", padding: "10px 12px 10px 20px" }}>
          <div className="min-w-0">
            <h1 className="m-0 text-[24px] font-bold max-[1023px]:text-[22px]" style={{ color: TITLE, letterSpacing: "-0.03em" }}>Company overview</h1>
            <div className="text-[13px] font-medium" style={{ color: LABEL }}>YA Windows & Doors · {year.year} to date · through {dayLabel(today)} · three views, each with its own source</div>
          </div>
          <div style={{ flex: 1 }} />
          <div className="grid grid-cols-4 max-[1023px]:order-last max-[1023px]:w-full max-[1023px]:grid-cols-2">
            <Figure label="Active jobs · job margin" value={t.profit} sub={`${t.jobs} jobs · lifetime · ${t.incomplete.jobs.length} before crew`} title="Job ledger: sale less all-in cost on the active jobs with a sale, over each job's lifetime (not a calendar period). Split 50/50 between YA and Glass Forge" />
            <Figure label="Active jobs · customers owe" value={t.leftToCollect} sub="sale less payments on file" title="Job ledger: sale less customer payments on file (receipts ledger). The same figure as Purchasing's Customers owe on Active" />
            <Figure label="Bank net cash movement" value={cy.ytd.net} sub={hasBank ? `${bankSpan} · unreconciled` : "no bank lines"} title="Every deposit less every payment in the Hub's Mountain America bank lines. Cash movement, not profit" />
            <Figure label="Books net income · accrual" value={net("Net income")[1]} sub="QuickBooks · incomplete" title="QuickBooks Profit and Loss, Jan 1 – Oct 26, accrual basis. Incomplete: most of the bank feed is unposted and the books are unreconciled. Not final profit" />
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="ml-2 inline-flex h-9 items-center gap-1.5 rounded-[8px] px-3 text-[14px] font-semibold" style={{ border: "1px solid rgba(242,238,232,.3)", background: "none", color: TITLE }}>
                Export <ChevronDown style={{ width: "16px", height: "16px" }} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[280px] p-1">
              {hasBank && <DropdownMenuItem className="flex min-h-9 cursor-pointer items-center text-[14px]" onSelect={() => exportCsv(true)}>Bank cash movement (CSV)</DropdownMenuItem>}
              <DropdownMenuItem className="flex min-h-9 cursor-pointer items-center text-[14px]" onSelect={() => exportCsv(false)}>Hub-recorded income (CSV)</DropdownMenuItem>
              <DropdownMenuItem className="flex min-h-9 cursor-pointer items-center text-[14px]" onSelect={exportStatement}>{thisMonthName} ready-to-invoice statement (PDF)</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </section>

      {exportError && <p role="alert" className="m-0 rounded-[12px] border bg-white p-3 text-[14px]" style={{ color: LATE }}>{exportError}</p>}

      {/* 1. Job ledger: the same rows Purchasing reads */}
      <Sheet title="1 · Job ledger · active jobs" aside={`${t.jobs} sold Purchasing jobs not yet Paid · management margin over each job's lifetime, not a calendar period`}
        source={<>Rule (owner-confirmed): every Purchasing job is an outside-BFS sale; profit = sale less all-in cost (materials + sub-labor + install material), split 50/50 between YA and Glass Forge, with no 10% fee and no overhead. Tags: <strong>feed</strong> = bank feed line matched to the job · <strong>invoice</strong> = QuickBooks document (read only, Oct 26) · <strong>est.</strong> = budget, PO, order, typed or entered figure · Unknown = no figure. Purchasing&apos;s Active view shows these same rows. <Link to="/purchasing" className="font-semibold hover:underline" style={{ color: INK }}>Purchasing →</Link></>}>
        <LedgerTable rows={ledger.active} totals={t} />
        <div className="text-[13px]" style={{ padding: "8px 16px", color: SECONDARY }}>
          Sold, cost and profit add the {t.priced} jobs with a sale{t.noSale.jobs.length ? `; ${t.noSale.jobs.join(", ")} has no sale yet (${money(-t.noSale.cost)} cost, kept out of cost and profit)` : ""}.
          {t.incomplete.jobs.length ? ` Crew cost unknown on ${t.incomplete.jobs.length} (${t.incomplete.jobs.join(", ")}): their ${money(t.incomplete.profit)} profit is before crew. Profit on the ${t.priced - t.incomplete.jobs.length} jobs with every cost on file: ${money(t.completeProfit)}.` : ""}
          {" "}Expected to earn: {["2026", "2026?", "2027", "unknown"].map((y) => [y, ledger.active.filter((r) => r.timing.year === y)]).filter(([, rows]) => rows.length).map(([y, rows]) => `${YEAR_LABEL[y]} ${rows.length} job${rows.length === 1 ? "" : "s"}`).join(" · ")}.
        </div>
        <FlagList rows={ledger.active} />
        <div style={{ borderTop: `2px solid ${STRONG}` }}>
          <div className="flex flex-wrap items-baseline gap-x-3" style={{ padding: "10px 16px 4px" }}>
            <h3 className="m-0 text-[15px] font-bold" style={{ color: INK }}>Completed (Paid) · {tc.jobs} jobs</h3>
            <span className="text-[13px]" style={{ color: SECONDARY }}>own totals, not in the active figures above</span>
          </div>
          <LedgerTable rows={ledger.completed} totals={tc} />
          <FlagList rows={ledger.completed} />
        </div>
      </Sheet>

      {/* 1b. Receipts ledger */}
      <Sheet title="Receipts ledger" aside={`${receipts.mapped.length} customer payments on ledger jobs · ${money(receipts.mappedTotal)}`}
        source="Sources: bank deposits matched to a job (feed), and QuickBooks payments whose deposit is a combined bank line or falls after the bank data ends (invoice). Each payment counts once. Customer deposits no ledger job accounts for are listed after, so nothing received is hidden.">
        <table className="w-full border-collapse">
          <Head cols={[["Date"], ["Job"], ["Amount", true], ["Tag"], ["Source"]]} />
          <tbody>
            {receipts.mapped.map((x, i) => <Row key={`${x.jobId}-${i}`} cells={[[dayLabel(x.date)], [x.job], [x.amount, "money"], [TAGS[x.tag]], [x.source]]} />)}
            <Row tone="total" cells={[["Total"], [""], [receipts.mappedTotal, "money"], [""], [""]]} />
          </tbody>
        </table>
        <div style={{ borderTop: `2px solid ${STRONG}` }}>
          <div style={{ padding: "10px 16px 4px" }}>
            <h3 className="m-0 text-[15px] font-bold" style={{ color: INK }}>Customer deposits no ledger job accounts for · {receipts.unmatched.length} · {money(receipts.unmatchedTotal)}</h3>
          </div>
          <table className="w-full border-collapse">
            <Head cols={[["Date"], ["Amount", true], ["Bank description"], ["What is known"]]} />
            <tbody>
              {receipts.unmatched.map((u) => <Row key={u.id} cells={[[dayLabel(u.date)], [u.amount, "money"], [u.description], [u.note || "—"]]} />)}
            </tbody>
          </table>
        </div>
        <ul className="m-0 list-disc text-[13px]" style={{ padding: "10px 16px 12px 34px", color: SECONDARY }}>
          {receipts.notInLedger.map((s) => <li key={s.ref}>{s.ref} · {s.customer} · {money(s.amount)}{s.open ? ` · ${money(s.open)} open` : " · paid"}: {s.note}</li>)}
        </ul>
      </Sheet>

      {/* 2. Company profit */}
      <Sheet title="2 · Company profit" aside={`YA operating statement · cash basis · ${dayLabel(op.period.from)} – ${dayLabel(op.period.to)}, ${op.period.to.slice(0, 4)} · bank lines, unreconciled`}
        source="One period and basis: every Mountain America bank line in the period. Only genuine operating expenses are deducted. Owner draws, loan payments and transfers are not expenses. Items still to classify are listed apart and not deducted, so the result is before them, not a final profit. Job-lifetime margins (view 1) are a different basis and are not added here.">
        <table className="w-full border-collapse">
          <Head cols={[["Line"], ["Amount", true]]} />
          <tbody>
            {OPERATING_GROUPS.filter(([, , k]) => k === "income").map(([key, label]) => <Row key={key} cells={[[label], [op.totals[key], "money"]]} />)}
            <Row tone="total" cells={[["Income"], [op.income, "money"]]} />
            {OPERATING_GROUPS.filter(([, , k]) => ["direct", "intercompany", "opex"].includes(k)).map(([key, label]) => <Row key={key} cells={[[label], [op.totals[key], "out"]]} />)}
            <Row tone="total" cells={[["Operating result before the items still to classify"], [op.resultBeforePending, "money"]]} />
            {OPERATING_GROUPS.filter(([, , k]) => k === "pending").map(([key, label]) => <Row key={key} tone="muted" cells={[[`To classify · ${label}`], [op.totals[key], "out"]]} />)}
            <Row tone="muted" cells={[["To classify, total (not deducted above)"], [op.pending, "out"]]} />
            {OPERATING_GROUPS.filter(([, , k]) => k === "excluded").map(([key, label]) => <Row key={key} cells={[[`Not an expense · ${label}`], [op.totals[key], "out"]]} />)}
          </tbody>
        </table>
        <div className="text-[13px]" style={{ padding: "8px 16px", color: SECONDARY }}>
          Tax payments, each to classify as employer payroll tax, income tax or other: {op.taxLines.map((x) => `${dayLabel(x.date)} ${x.description} ${money(x.amount)}`).join(" · ")}.
        </div>
        <table className="w-full border-collapse" style={{ borderTop: `2px solid ${STRONG}` }}>
          <Head cols={[["Basis"], ["YA", true], ["Glass Forge", true], ["Combined", true, "YA and Glass Forge together, with the amount between them counted once"]]} />
          <tbody>
            <Row cells={[[`Active jobs · job lifetime · ${t.priced} jobs with a sale (job ledger)`], [entities.jobs.ya, "money"], [entities.jobs.gf, "money"], [entities.jobs.combined, "money"]]} />
            <Row cells={[[`Cash basis · ${dayLabel(op.period.from)} – ${dayLabel(op.period.to)} · before items to classify`], [entities.cash.ya, "money"],
              [<span key="g">{money(entities.cash.gfFromYa)} <span className="text-[13px]" style={{ color: SECONDARY }}>from YA; own costs not in the Hub</span></span>, "r"], [entities.cash.combined, "money"]]} />
          </tbody>
        </table>
        <ul className="m-0 list-disc text-[13px]" style={{ padding: "10px 16px 12px 34px", color: SECONDARY }}>
          <li>Job lifetime: the job profit splits 50/50, so Combined is the whole job profit; Glass Forge&apos;s half is not subtracted again anywhere.</li>
          <li>Cash basis: YA&apos;s {money(entities.cash.eliminated)} of Glass Forge invoices paid is YA&apos;s expense and Glass Forge&apos;s income, so it cancels once in Combined. Glass Forge&apos;s other income and costs are not in the Hub.</li>
          <li>Glass Forge invoices vs the split rule ({GF_FEE_CHECK.invoices.join(", ")}, read {GF_FEE_CHECK.readAt}): {GF_FEE_CHECK.finding} {GF_FEE_CHECK.agren}</li>
          <li>{GF_FEE_CHECK.aside}</li>
        </ul>
      </Sheet>

      {/* 3. Books YTD */}
      <Sheet title="3 · Books year to date (QuickBooks)" aside="Profit and Loss, Jan 1 – Oct 26, 2026 · incomplete, not final profit"
        source={<>Source: {BOOKS_PL.source}, read only (accrual read {BOOKS_PL.readAt.accrual}; cash {BOOKS_PL.readAt.cash}). Each column is one basis; the two are never added together.</>}>
        <table className="w-full border-collapse">
          <Head cols={[["Line"], ["Accrual basis", true], ["Cash basis", true]]} />
          <tbody>
            {BOOKS_PL.rows.map(([label, accrual, cash, kind]) => {
              // Expenses read as money out (negative), like every other cost on the page.
              const how = kind === "expense" || label === "Total expenses" ? "out" : "money";
              return <Row key={label} tone={kind === "total" || kind === "net" ? "total" : ""} cells={[[label], [accrual, how], [cash, how]]} />;
            })}
          </tbody>
        </table>
        <ul className="m-0 list-disc text-[13px]" style={{ padding: "10px 16px 12px 34px", color: SECONDARY }}>
          {BOOKS_PL.coverage.map((c) => <li key={c}>{c}</li>)}
          <li>Accrual income is {money(net("Total income")[1] - net("Total income")[2])} more than cash income: QuickBooks&apos; open customer invoices.</li>
        </ul>
      </Sheet>

      {/* 4. Bank cash movement YTD */}
      {hasBank && (
        <Sheet title="4 · Bank cash movement year to date" aside="unreconciled cash movement, not profit"
          source={<>Source: the Hub&apos;s Mountain America bank lines ({bankSpan}; {bank.count} lines), not yet checked against bank statements{cy.missing.length ? ` · ${cy.missing.map(monthName).join(", ")} partial: the bank data ends ${dayLabel(bank.last)}` : ""} · <Link to="/operations/bank" className="font-semibold hover:underline" style={{ color: INK }}>Bank →</Link></>}>
          <table className="w-full border-collapse">
            <Head cols={CASH_COLS} />
            <tbody>
              {cy.months.map((m) => <Row key={m.month} cells={cashCells(cashLabel(m), m)} />)}
              <Row tone="total" cells={cashCells(`${year.year} to date`, cy.ytd)} />
            </tbody>
          </table>
          <div className="text-[13px]" style={{ padding: "10px 16px 12px", color: SECONDARY }}>
            Weekly $2.5k / $3k: {weekly.count} payments, {money(weekly.total)}. Cash out with the classification (wages, owner payments, other) unknown; some payees are verified from check images and the rest are not, so none is named here.
          </div>
        </Sheet>
      )}

      {/* Full-year scenario: left out, with the reasons */}
      <Sheet title="Full-year 2026 scenario · not shown" aside="neither basis can be supported honestly yet">
        <ul className="m-0 list-disc text-[14px]" style={{ padding: "0 16px 12px 34px", color: INK }}>
          <li><strong>Accrual basis:</strong> the books year to date (view 3) are incomplete. Crew pay, supplier costs and payroll aren&apos;t posted, so anchoring a full year to them would overstate profit.</li>
          <li>
            <strong>Cash basis:</strong> the Nov–Dec cash would have to come from a run rate. The {ov.months}-month average ({monthName(ov.from)}–{monthName(ov.to)}) is {money(ov.net)} a month net, and it already includes {money(ov.customerIn)} a month of customer payments (job deposits among them) and {money(ov.suppliers)} a month of supplier payments.
            The job ledger (view 1) adds those same kinds of flows again, so the old &quot;Projected 2026&quot; double-counted. Neither can be separated reliably from the labor business yet.
          </li>
          <li><strong>Also open:</strong> the weekly $2.5k / $3k stream&apos;s classification, the July imported lines below, and no bank-statement reconciliation.</li>
        </ul>
      </Sheet>

      {/* July diagnostic: conditional, apart from every actual */}
      <Sheet title={`${monthName(july.month)} diagnostic · pending your decision`} aside="conditional; not in any figure above">
        <table className="w-full border-collapse">
          <Head cols={[["Line"], ["Amount", true]]} />
          <tbody>
            <Row cells={[[`${monthName(july.month)} labor billed in the Hub (earned formula)`], [julyMonth?.labor ?? 0, "money"]]} />
            <Row cells={[[`Imported sheet lines left out: ${july.count} lines with a stored labor amount but no calendar amount, man hours or trips`], [july.labor, "money"]]} />
            <Row tone="total" cells={[[`${monthName(july.month)} labor IF these lines are valid`], [(julyMonth?.labor ?? 0) + july.labor, "money"]]} />
            <Row cells={[["Glass Forge's 10% on them, IF valid (a separate company's fee)"], [july.fee, "money"]]} />
          </tbody>
        </table>
        <div className="text-[13px]" style={{ padding: "8px 16px 12px", color: SECONDARY }}>
          Source: Hub FeeLines (source &quot;sheet-import&quot;). Per your review, 23 of these lines have mismatches; that count isn&apos;t re-checked here. Nothing is added to revenue or expenses until you decide.
        </div>
      </Sheet>

      {/* Reference: what the Hub's own records show */}
      <Sheet title="Reference · Hub-recorded income" aside="labor billed and paid outside-job sales, before crew pay and overhead (not a profit)"
        source="Source: Hub Invoicing lines (same rows as Invoicing) and Purchasing split lines; shop POs. July reads low: see the diagnostic above.">
        <table className="w-full border-collapse">
          <Head cols={YA_COLS} />
          <tbody>
            {year.months.map((m) => <Row key={m.month} cells={yaCells(monthName(m.month), m)} />)}
            <Row tone="total" cells={yaCells(`${year.year} to date`, ytd)} />
          </tbody>
        </table>
      </Sheet>

      <Sheet title="Reference · Glass Forge invoiced to YA" aside={`separate company · ${money(ytd.invoiced)} invoiced · ${money(ytd.notInvoiced)} not invoiced yet${strip ? ` · ${thisMonthName}: ${money(strip.ready.fee)} ready to invoice` : ""}`}
        source="Source: Glass Forge's issued invoices (Hub Invoices) and, for months not invoiced, the Hub's Invoicing figures.">
        <table className="w-full border-collapse">
          <Head cols={GF_COLS} />
          <tbody>
            {year.months.map((m) => <Row key={m.month} cells={gfCells(monthName(m.month), m, invoiceCell(m))} />)}
            <Row tone="total" cells={gfCells(`${year.year} to date`, ytd, `${year.months.filter((m) => m.basis === "invoice").length} invoiced`)} />
          </tbody>
        </table>
      </Sheet>
    </PageShell>
  );
}

export default function CompanyOverview() {
  const { user } = useAuth();
  if (!isAgentCenterOwner(user)) return <PageShell><p>Company overview is available to the owner.</p></PageShell>;
  return <CompanyOverviewContent key={user.id} />;
}
