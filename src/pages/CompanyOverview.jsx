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
import { bankCoverage } from "@/lib/bankLines";
import { purchasingRequest, money } from "@/components/budgets/ProcurementForms";
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent, DropdownMenuItem } from "@/components/ui/dropdown-menu";
import { PageShell } from "@/components/PageShell";

// Company overview (Gabe, Oct 26): the year to date the way QuickBooks' business overview
// reads. YA Windows & Doors' income (install labor billed plus job sales), what Glass Forge
// made by invoicing YA, YA's profit after Glass Forge and the costs in YA's bank lines (crew
// pay, overhead, other costs; months with no bank lines are before crew pay), and the year
// projected from the open Purchasing jobs and the install-labor pace. The figures come from
// companyYear (src/lib/companyOverview.js) over the same rows Invoicing and Purchasing show.
// Field reports and other operational lists live on Invoicing and the job pages, not here.

// America/Denver today (inlined; new src files may not import base44/shared).
const denverDate = (value = new Date()) =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "America/Denver", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(value));

const BAND = "#0B3F3B", TITLE = "#F2EEE8", LABEL = "#C3CBCC", DIVIDER = "rgba(242,238,232,.18)", BRASS_LT = "#E0C994";
const INK = "#101617", SECONDARY = "#566063", STRONG = "#34403F", RULE = "#D6CCBA", HEAD_BG = "#E9E2D4", LATE = "#A43432";
const out = (v) => (v ? -v : 0); // money out reads as a negative number; zero stays $0.00
const pct = (r) => (r == null ? "—" : `${(r * 100).toFixed(1)}%`);
const dayLabel = (iso) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

function Figure({ label, value, title, color = TITLE }) {
  return (
    <div title={title} className="min-w-0 px-5 max-[1023px]:px-3 max-[1023px]:py-2" style={{ borderLeft: `1px solid ${DIVIDER}` }}>
      <div className="whitespace-nowrap text-[13px] font-medium" style={{ color: LABEL }}>{label}</div>
      <div className="whitespace-nowrap text-[18px] font-bold tabular-nums max-[1023px]:text-[17px]" style={{ color, letterSpacing: "-0.01em" }}>{money(value)}</div>
    </div>
  );
}

function Sheet({ title, aside, children }) {
  return (
    <section className="overflow-hidden rounded-[12px]" style={{ backgroundColor: "#FFFFFF", border: "1px solid #B3A792" }}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1" style={{ padding: "12px 16px" }}>
        <h2 className="m-0 text-[16px] font-bold" style={{ color: INK, letterSpacing: "-0.01em" }}>{title}</h2>
        {aside ? <span className="text-[14px]" style={{ color: SECONDARY }}>{aside}</span> : null}
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

function Row({ cells, tone = "", title }) {
  const total = tone === "total" || tone === "projected";
  return (
    <tr title={title} style={{ borderTop: total ? `2px solid ${STRONG}` : `1px solid ${RULE}`, backgroundColor: tone === "projected" ? "#F6F3EC" : undefined }}>
      {cells.map(([value, kind], i) => {
        const isMoney = kind === "money" || kind === "out" || kind === "pct" || kind === "dash";
        const n = kind === "out" ? out(value) : value;
        const text = kind === "money" || kind === "out" ? money(n) : kind === "pct" ? pct(value) : value;
        const negative = kind === "money" && typeof n === "number" && n < 0;
        return (
          <td key={i} className={`${i === 0 ? "min-w-[96px] max-w-[190px]" : "whitespace-nowrap"} text-[14px] ${isMoney ? "text-right tabular-nums" : ""} ${total ? "font-bold" : ""}`} style={{ padding: "8px 10px", color: negative ? LATE : INK }}>{text}</td>
        );
      })}
    </tr>
  );
}

const YA_COLS = [
  ["Month"], ["Labor billed", true, "Install labor billed to BFS: Invoicing's Labor total for the month"],
  ["Job sales", true, "Sale on outside jobs that were paid: the 50/50 profit-split lines on Invoicing"],
  ["Income", true, "Labor billed plus job sales, plus any bank deposit sorted as Other income"], ["Job cost", true, "Cost on those outside jobs (windows plus labor & material)"],
  ["Shop", true, "Shop and overhead purchases (POs with no job)"],
  ["Crew pay", true, "From YA's bank lines (Bank page): drafts sorted as crew pay. — means no bank lines for the month yet"],
  ["Overhead", true, "From YA's bank lines: payroll, insurance, equipment rental, card payments and fees"],
  ["Other costs", true, "From YA's bank lines: supplier payments with no Hub order, and lines not sorted yet. Still money out, so they count"],
  ["Glass Forge", true, "What YA owes Glass Forge: the issued Glass Forge invoice where there is one, otherwise the Hub's 10% install fee plus half of each paid outside job's profit. Nothing before March 2026, when the agreement took effect"],
  ["Profit", true, "Income less job cost, shop, crew pay, overhead, other costs and Glass Forge. A month with no bank lines is before crew pay and overhead"],
  ["Margin", true, "Profit ÷ income"],
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
  if (m.basis === "hub") return <span className="font-semibold" style={{ color: "#6F4E10" }}>Not invoiced</span>;
  return m.invoice.docs.map((d) => (d.url
    ? <a key={d.number} href={d.url} target="_blank" rel="noreferrer" className="mr-2 font-semibold hover:underline" style={{ color: INK }}>{d.number}</a>
    : <span key={d.number} className="mr-2 font-semibold">{d.number}</span>));
}
const gfCells = (label, r, invoice, projection = false) => [[label], [invoice], [r.fee, "money"], [r.split, "money"], [r.glassForge, "money"],
  projection || r.basis === "before" ? [""] : [r.hubGlassForge, "money"], projection || !(r.invoiced || r.basis === "invoice") ? [""] : [r.difference, "money"]];
// bank: true for a month or total row (no bank lines reads —), false for the projection rows.
const yaCells = (label, r, bank = true) => {
  const b = (v) => (!bank ? [""] : r.hasBank === false ? ["—", "dash"] : [v, "out"]);
  return [[label], [r.labor, "money"], [r.sales, "money"], [r.income, "money"], [r.jobCost, "out"], [r.shop, "out"], b(r.crewPay), b(r.overhead), b(r.otherCost), [r.glassForge, "out"], [r.profit, "money"], [r.margin, "pct"]];
};

function CompanyOverviewContent() {
  const [state, setState] = useState({ loading: true, error: "", data: null });
  const loadSeq = useRef(0);
  const today = denverDate();
  const thisMonth = today.slice(0, 7);

  useEffect(() => {
    const seq = ++loadSeq.current;
    (async () => {
      try {
        const [fl, events, jobs, budgets, pos, vos, closes, invoices, bankLines, board] = await Promise.all([
          base44.entities.FeeLines.list("-job_date", 5000),
          base44.entities.CalendarEvents.list("-event_date", 5000),
          base44.entities.Jobs.list("canonical_name", 5000),
          base44.entities.JobBudgets.list("-updated_date", 2000),
          base44.entities.PurchaseOrders.list("-created_date", 2000),
          base44.entities.VendorOrders.list("-created_date", 2000),
          base44.entities.MonthCloseSnapshot.list("-created_date", 100).catch(() => []),
          base44.entities.Invoices.list("-invoice_date", 2000).catch(() => []),
          base44.entities.BankTransactions.list("-posted_date", 10000).catch(() => []),
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
        setState({ loading: false, error: "", data: { rows, superseded, reports, feeLines, invoices, pos, bankLines, cards: purchasingBoardCards(board, today) } });
      } catch (e) {
        if (seq === loadSeq.current) setState({ loading: false, error: `The overview could not load. ${e?.message || ""}`.trim(), data: null });
      }
    })();
    return () => { loadSeq.current++; };
  }, [today]);

  const year = useMemo(() => (state.data ? companyYear({ rows: state.data.rows, superseded: state.data.superseded, cards: state.data.cards, purchaseOrders: state.data.pos, invoices: state.data.invoices, bankLines: state.data.bankLines, today }) : null), [state.data, today]);
  const cy = useMemo(() => (year ? cashYear(year, state.data.bankLines) : null), [year, state.data]);
  const bank = useMemo(() => (state.data ? bankCoverage(state.data.bankLines.filter((l) => String(l.posted_date || "").startsWith(today.slice(0, 4)))) : null), [state.data, today]);
  // This month's Ready to invoice and Invoiced, unpaid: Invoicing's own money strip.
  const strip = useMemo(() => {
    if (!state.data) return null;
    const { rows, superseded, reports, invoices, feeLines } = state.data;
    const monthRows = rows.filter((r) => inInvoiceScope(r, thisMonth));
    return { ...moneyStrip(moneyBarSegments(monthRows, reports, superseded, invoiceRegister(invoices, feeLines))), monthRows };
  }, [state.data, thisMonth]);

  const exportCsv = (cashBasis = false) => {
    const blob = new Blob([cashBasis ? cashYearCsv(year, cy) : companyYearCsv(year)], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `ya-windows-${year.year}-${cashBasis ? "cash" : "earned"}-to-date.csv`; a.click(); URL.revokeObjectURL(url);
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

  const { ytd, pace, pipeline, projected } = year;
  // No labor pace in December (no months left) or in January (no month before to average).
  const rest = year.rest.filter((r) => r.key !== "pace" || (pace.months > 0 && pace.to));
  const paceLabel = `${monthName(`${year.year}-${String(13 - pace.months).padStart(2, "0")}`)}–Dec labor at the ${monthName(pace.from)}–${monthName(pace.to)} average`;
  const restLabel = { pipeline: `Open Purchasing jobs · ${pipeline.jobs.length}`, pace: paceLabel };
  const thisMonthName = monthName(thisMonth);
  // Which months the profit takes crew pay and overhead from the bank for, and how fully.
  const noBank = year.months.filter((m) => !m.hasBank).map((m) => monthName(m.month));
  const partial = year.months.filter((m) => m.hasBank && m.bank.coveredDays < m.monthDays);
  const monthLabel = (m) => (m.hasBank && m.bank.coveredDays < m.monthDays ? `${monthName(m.month)} · bank ${m.bank.coveredDays} of ${m.monthDays} days` : monthName(m.month));
  // The headline is on a cash basis when there are bank lines (Gabe, Oct 26).
  const onCash = cy.months.length > 0;
  const cashLabel = (m) => (m.partial ? `${monthName(m.month)} · bank ${m.coveredDays} of ${m.monthDays} days` : monthName(m.month));
  const gap = cy.ytd.moneyIn - cy.ytd.earned;
  const cashRest = { pipeline: `Open Purchasing jobs · still to collect and pay`, pace: cy.full ? `${monthName(`${year.year}-${String(13 - cy.rest[1].months).padStart(2, "0")}`)}–Dec at the ${monthName(cy.rest[1].from)}–${monthName(cy.rest[1].to)} average` : "" };
  const cashCells = (label, r, { earned = true } = {}) => [[label], [r.moneyIn, "money"], [r.crewPay, "out"], [r.overhead, "out"], [r.suppliers, "out"], [r.glassForge, "out"], [r.other, "out"], [r.profit, "money"], [r.moneyIn ? r.profit / r.moneyIn : null, "pct"],
    earned ? [r.earned, "money"] : [""], earned ? [r.moneyIn - r.earned, "money"] : [""]];
  const profitLabel = !ytd.bankMonths.length ? "YA profit, before crew pay" : !noBank.length ? "YA profit" : `YA profit · crew pay ${ytd.bankMonths.length === 1 ? `${monthName(ytd.bankMonths[0])} only` : `${ytd.bankMonths.length} months`}`;
  const bankAside = !bank?.count
    ? <>No bank lines yet, so profit is before crew pay. <Link to="/operations/bank" className="font-semibold hover:underline" style={{ color: INK }}>Import the bank CSV →</Link></>
    : <>Crew pay, overhead and other costs from the bank, {dayLabel(bank.first)} – {dayLabel(bank.last)}{noBank.length ? ` · ${noBank.join(", ")} before crew pay (no bank lines)` : ""}{partial.length ? ` · ${partial.map((m) => monthName(m.month)).join(", ")} only partly covered` : ""} · <Link to="/operations/bank" className="font-semibold hover:underline" style={{ color: INK }}>Bank →</Link></>;

  return (
    <PageShell width="max-w-[1480px]">
      <section className="rounded-[12px]" style={{ backgroundColor: BAND }}>
        <div className="flex flex-wrap items-center gap-y-2" style={{ minHeight: "68px", padding: "10px 12px 10px 20px" }}>
          <div className="min-w-0">
            <h1 className="m-0 text-[24px] font-bold max-[1023px]:text-[22px]" style={{ color: TITLE, letterSpacing: "-0.03em" }}>Company overview</h1>
            <div className="text-[13px] font-medium" style={{ color: LABEL }}>{year.year} to date · through {dayLabel(today)}</div>
          </div>
          <div style={{ flex: 1 }} />
          <div className="grid grid-cols-4 max-[1023px]:order-last max-[1023px]:w-full max-[1023px]:grid-cols-2">
            {onCash
              ? <Figure label="YA income · bank deposits" value={cy.ytd.moneyIn} title={`Every deposit into YA's account, ${dayLabel(bank.first)} – ${dayLabel(bank.last)}. The Hub counts ${money(cy.ytd.earned)} as earned for the same months`} />
              : <Figure label="YA income" value={ytd.income} title="Install labor billed plus outside job sales, January to today" />}
            <Figure label="Glass Forge income" value={ytd.glassForge} title={`Issued Glass Forge invoices (${money(ytd.invoiced)}) plus months not invoiced yet at the Hub's figures (${money(ytd.notInvoiced)}), from March 2026`} />
            {onCash ? (
              <>
                <Figure label="YA profit · cash" value={cy.ytd.profit} title={`Bank deposits (${money(cy.ytd.moneyIn)}) less everything paid out of YA's account (transfers and owner draws aside), ${dayLabel(bank.first)} – ${dayLabel(bank.last)}${cy.missing.length ? `. ${cy.missing.map(monthName).join(" and ")} are only partly covered by the exports` : ""}. Cash until the Hub's income is fixed`} color={cy.ytd.profit < 0 ? "#F0A8A6" : TITLE} />
                <Figure label={`Projected ${year.year} · cash`} value={cy.projected.profit} title="Cash to date, plus the open Purchasing jobs' sales still to collect less costs still to pay and Glass Forge's half, plus the months left at the average of the fully covered months" color={BRASS_LT} />
              </>
            ) : (
              <>
                <Figure label={profitLabel} value={ytd.profit} title="YA income less job cost, shop purchases and Glass Forge. Crew pay is not recorded in the Hub" color={ytd.profit < 0 ? "#F0A8A6" : TITLE} />
                <Figure label={`Projected ${year.year} YA profit`} value={projected.profit} title="Profit to date, plus YA's half of the open Purchasing jobs, plus the rest of the year's install labor at this year's monthly average less Glass Forge's fee" color={BRASS_LT} />
              </>
            )}
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button className="ml-2 inline-flex h-9 items-center gap-1.5 rounded-[8px] px-3 text-[14px] font-semibold" style={{ border: "1px solid rgba(242,238,232,.3)", background: "none", color: TITLE }}>
                Export <ChevronDown style={{ width: "16px", height: "16px" }} />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-[260px] p-1">
              <DropdownMenuItem className="flex min-h-9 cursor-pointer items-center text-[14px]" onSelect={() => exportCsv(false)}>YA earned table (CSV)</DropdownMenuItem>
              {onCash && <DropdownMenuItem className="flex min-h-9 cursor-pointer items-center text-[14px]" onSelect={() => exportCsv(true)}>YA cash table (CSV)</DropdownMenuItem>}
              <DropdownMenuItem className="flex min-h-9 cursor-pointer items-center text-[14px]" onSelect={exportStatement}>{thisMonthName} ready-to-invoice statement (PDF)</DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </section>

      {exportError && <p role="alert" className="m-0 rounded-[12px] border bg-white p-3 text-[14px]" style={{ color: LATE }}>{exportError}</p>}

      {onCash && (
        <Sheet title="YA Windows & Doors · cash" aside={<>Bank deposits in, everything paid out of the account out · the headline until the Hub&apos;s income is fixed{cy.missing.length ? ` · ${cy.missing.map(monthName).join(", ")} only partly covered` : ""} · <Link to="/operations/bank" className="font-semibold hover:underline" style={{ color: INK }}>Bank →</Link></>}>
          <table className="w-full border-collapse">
            <Head cols={[["Month"], ["Money in", true, "Every deposit"], ["Crew pay", true, "Drafts and checks up to $3,500"], ["Overhead", true, "Payroll, payroll taxes, insurance, equipment rental, taxes, fees"],
              ["Suppliers", true, "Supplier orders for Hub jobs, shop POs and suppliers with no Hub order"], ["Glass Forge", true, "Glass Forge invoices YA paid"], ["Other costs", true, "Amex card payments, loan payments and lines not sorted yet"],
              ["Profit", true, "Money in less all of the above"], ["Margin", true, "Profit ÷ money in"], ["Earned (Hub)", true, "The month's YA income in the Hub (the earned table below)"], ["In less earned", true, "Deposits less the Hub's income. Positive: money came in that the Hub doesn't count (earlier work, customers not in the Hub, deposits on open jobs)"]]} />
            <tbody>
              {cy.months.map((m) => <Row key={m.month} cells={cashCells(cashLabel(m), m)} title={m.partial ? `The bank exports cover ${m.coveredDays} of this month's ${m.monthDays} days` : undefined} />)}
              <Row tone="total" cells={cashCells(`${year.year} to date`, cy.ytd)} />
              {cy.rest.filter((r) => r.key === "pipeline" || cy.full).map((r) => <Row key={r.key} cells={cashCells(cashRest[r.key], r, { earned: false })} title={r.key === "pipeline" ? "Sale still to collect (less customer payments matched to the job in the bank), cost still to pay (less supplier payments matched to the job) and Glass Forge's half of the profit" : `The fully covered months' average × ${r.months}`} />)}
              <Row tone="projected" cells={cashCells(`Projected ${year.year}`, cy.projected, { earned: false })} />
            </tbody>
          </table>
        </Sheet>
      )}

      <Sheet title={onCash ? "YA Windows & Doors · earned (Hub income)" : "YA Windows & Doors"} aside={<>{onCash ? `Income the Hub counts: ${money(gap)} less than came into the bank · ` : ""}{bankAside}</>}>
        <table className="w-full border-collapse">
          <Head cols={YA_COLS} />
          <tbody>
            {year.months.map((m) => <Row key={m.month} cells={yaCells(monthLabel(m), m)} title={m.hasBank && m.bank.coveredDays < m.monthDays ? `The bank exports cover ${m.bank.coveredDays} of this month's ${m.monthDays} days, so its crew pay and costs are incomplete` : undefined} />)}
            <Row tone="total" cells={yaCells(`${year.year} to date`, ytd)} />
            {rest.map((r) => <Row key={r.key} cells={yaCells(restLabel[r.key], r, false)} title={r.key === "pace" ? `${money(pace.average)} a month × ${pace.months}, less Glass Forge's ${(pace.feeRate * 100).toFixed(1)}%. No crew pay or overhead projected` : "Sold Purchasing jobs not yet Paid. Each splits 50/50 with Glass Forge when Paid"} />)}
            <Row tone="projected" cells={yaCells(`Projected ${year.year}`, projected)} />
          </tbody>
        </table>
      </Sheet>


      <Sheet title="Glass Forge · invoiced to YA" aside={`${money(ytd.invoiced)} invoiced · ${money(ytd.notInvoiced)} not invoiced yet${strip ? ` · ${thisMonthName}: ${money(strip.ready.fee)} ready to invoice` : ""}`}>
        <table className="w-full border-collapse">
          <Head cols={GF_COLS} />
          <tbody>
            {year.months.map((m) => <Row key={m.month} cells={gfCells(monthName(m.month), m, invoiceCell(m))} title={m.basis === "invoice" ? `Hub figure ${money(m.hubGlassForge)}; the invoice is ${money(m.difference)} ${m.difference < 0 ? "less" : "more"}` : undefined} />)}
            <Row tone="total" cells={gfCells(`${year.year} to date`, ytd, `${year.months.filter((m) => m.basis === "invoice").length} invoiced`)} />
            {rest.map((r) => <Row key={r.key} cells={gfCells(restLabel[r.key], r, "Projected", true)} />)}
            <Row tone="projected" cells={gfCells(`Projected ${year.year}`, projected, "", true)} />
          </tbody>
        </table>
      </Sheet>

      <Sheet title="Open Purchasing jobs" aside={`Sold, not yet Paid${pipeline.missing ? ` · ${pipeline.missing} with no sale or cost yet` : ""}`}>
        <table className="w-full border-collapse">
          <Head cols={[["Job"], ["Stage"], ["Sale", true], ["Cost", true], ["Est. profit", true, "Sale less cost"], ["YA half", true], ["Glass Forge half", true, "Written to Invoicing as a 50/50 split line when the job is marked Paid"]]} />
          <tbody>
            {pipeline.jobs.map((j) => (
              <Row key={j.id} cells={[[<Link key="l" to={`/jobs/${j.id}`} className="font-semibold hover:underline" style={{ color: INK }}>{j.name}</Link>], [paymentStage(j.stage)?.label || "—"], [j.sale, "money"], [j.cost, "out"], [j.profit, "money"], [j.ya, "money"], [j.glassForge, "money"]]} />
            ))}
            <Row tone="total" cells={[[`${pipeline.jobs.length} open jobs`], [""], [pipeline.sale, "money"], [pipeline.cost, "out"], [pipeline.profit, "money"], [pipeline.ya, "money"], [pipeline.glassForge, "money"]]} />
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
