// Company overview (Gabe, Oct 26): YA Windows & Doors' year in money, what Glass Forge made by
// invoicing YA, and YA's profit after Glass Forge. Pure: no React, no SDK.
//  - Each month is Invoicing's "All lines" for that month (the same rows and amounts), less
//    lines dated after today. Install lines give YA's labor billed and Glass Forge's 10% fee.
//    Profit-split lines give an outside job's sale and cost and Glass Forge's half.
//  - Shop / overhead POs (purchase_type 'shop') are YA costs in the month they were raised.
//  - Open Purchasing jobs (sold, not Paid) are the pipeline. A job lands in a month only once
//    it is Paid, through its 50/50 split line, so nothing is counted twice.
//  - Crew pay is not recorded in the Hub, so YA's profit is before crew pay (Gabe, Oct 26).
import { computeFeeAmt, computeLaborAmt } from './feeMath.js';
import { inInvoiceScope } from './invoiceScope.js';
import { cardFigures, isSold, isCompleted } from './purchasingSummary.js';
import { SPLIT_PCT } from './purchasingSplit.js';

const round = (n) => Math.round(n * 100) / 100;
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? 0 : Number(v));
const sum = (rows, f) => round(rows.reduce((n, r) => n + (f(r) || 0), 0));
export const isProfitSplit = (r) => r?.fee_type === 'profit_split';

// Base44 timestamps are UTC without a zone; months are counted in Denver time.
export function denverMonth(value) {
  if (!value) return '';
  const s = String(value);
  const d = new Date(/(Z|[+-]\d\d:?\d\d)$/.test(s) || s.length <= 10 ? s : `${s}Z`);
  if (Number.isNaN(d.getTime())) return '';
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit' }).format(d).slice(0, 7);
}

// FeeLines as Invoicing will hold them once it syncs the 50/50 split lines (planSplitLines):
// a job marked Paid since Invoicing last loaded still lands in its month here.
export function withSplitPlan(feeLines = [], plan = null) {
  if (!plan) return feeLines;
  const gone = new Set(plan.deletes || []);
  const patch = new Map((plan.updates || []).map(({ id, ...p }) => [id, p]));
  const kept = feeLines.filter((r) => !gone.has(r.id)).map((r) => (patch.has(r.id) ? { ...r, ...patch.get(r.id) } : r));
  return [...kept, ...(plan.creates || []).map((r) => ({ ...r, id: `pending-split-${r.purchasing_split_job_id}`, _pending_split: true }))];
}

export function shopCost(purchaseOrders = [], month) {
  return sum(purchaseOrders.filter((p) => p.purchase_type === 'shop' && p.status !== 'cancelled' && !p.deleted_at && denverMonth(p.created_date) === month), (p) => num(p.amount_dealer));
}

export function monthFigures(lines, month, shop = 0) {
  const splits = lines.filter(isProfitSplit);
  const install = lines.filter((r) => !isProfitSplit(r));
  const labor = sum(install, computeLaborAmt);
  const fee = sum(install, computeFeeAmt);
  const sales = sum(splits, (r) => num(r.sale_price));
  const jobCost = sum(splits, (r) => num(r.cost));
  const split = sum(splits, computeFeeAmt);
  const income = round(labor + sales);
  const glassForge = round(fee + split);
  const profit = round(income - jobCost - shop - glassForge);
  return { month, labor, sales, income, jobCost, shop, fee, split, glassForge, profit, margin: income ? profit / income : null, lines: lines.length };
}

const FIELDS = ['labor', 'sales', 'income', 'jobCost', 'shop', 'fee', 'split', 'glassForge', 'profit'];
function total(rows) {
  const t = Object.fromEntries(FIELDS.map((f) => [f, sum(rows, (r) => r[f])]));
  return { ...t, margin: t.income ? t.profit / t.income : null };
}

// Glass Forge's half of a job's profit, in cents the way the split line rounds it ($297.03 -> $148.52).
export const glassForgeHalf = (profit) => Math.round(Math.round(num(profit) * 100) * SPLIT_PCT) / 100;

// Open Purchasing jobs: sold (a stage past Sent to customer) and not Paid. Sale and Cost are
// the Purchasing row's own (cardFigures), so they tie to the Purchasing grid. Profit is Sale
// less Cost, so a job with a cost and no sale yet counts its cost; such a job (missing) has no
// split yet, so all of it sits with YA.
export function pipeline(cards = []) {
  const jobs = cards.filter((c) => isSold(c) && !isCompleted(c)).map((c) => {
    const f = cardFigures(c);
    const missing = !(f.sale > 0 && f.cost > 0);
    const profit = round(f.sale - f.cost);
    const gf = missing ? 0 : glassForgeHalf(profit);
    return { id: c.job?.id, name: c.job?.canonical_name || '', builder: c.job?.builder || '', stage: c.paymentStage || '', sale: f.sale, cost: f.cost, profit, glassForge: gf, ya: round(profit - gf), missing };
  }).sort((a, b) => b.sale - a.sale || a.name.localeCompare(b.name));
  return { jobs, sale: sum(jobs, (j) => j.sale), cost: sum(jobs, (j) => j.cost), profit: sum(jobs, (j) => j.profit), glassForge: sum(jobs, (j) => j.glassForge), ya: sum(jobs, (j) => j.ya), missing: jobs.filter((j) => j.missing).length };
}

// The year to date, month by month, then the projection: YTD + open Purchasing jobs + the
// months left at the year's monthly labor average (months before this one), less Glass
// Forge's fee at the year's fee rate.
// rows: Invoicing's display rows (withCompanions, Purchasing-held lines removed);
// superseded: buildSupersededSet of those rows; cards: Purchasing cards with paymentStage.
export function companyYear({ rows = [], superseded = new Set(), cards = [], purchaseOrders = [], today }) {
  const year = today.slice(0, 4);
  const thisMonth = Number(today.slice(5, 7));
  const keys = Array.from({ length: thisMonth }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  const shown = rows.filter((r) => !superseded.has(r.id) && !(r.job_date && r.job_date > today));
  const months = keys.map((m) => monthFigures(shown.filter((r) => inInvoiceScope(r, m)), m, shopCost(purchaseOrders, m)));
  const ytd = total(months);
  const prior = months.slice(0, -1);
  const left = 12 - thisMonth;
  const average = prior.length ? round(prior.reduce((n, m) => n + m.labor, 0) / prior.length) : 0;
  const feeRate = ytd.labor ? ytd.fee / ytd.labor : 0.1;
  const paceLabor = round(average * left);
  const pace = { months: left, average, labor: paceLabor, fee: round(paceLabor * feeRate), feeRate, from: keys[0], to: prior.length ? prior[prior.length - 1].month : '' };
  const open = pipeline(cards);
  // The rest of the year as month-table rows, then the projected year (YTD plus both).
  const rest = [
    { key: 'pipeline', labor: 0, sales: open.sale, income: open.sale, jobCost: open.cost, shop: 0, fee: 0, split: open.glassForge, glassForge: open.glassForge, profit: open.ya },
    { key: 'pace', labor: pace.labor, sales: 0, income: pace.labor, jobCost: 0, shop: 0, fee: pace.fee, split: 0, glassForge: pace.fee, profit: round(pace.labor - pace.fee) },
  ].map((r) => ({ ...r, margin: r.income ? r.profit / r.income : null }));
  const projected = total([ytd, ...rest]);
  return { year, today, months, ytd, pipeline: open, pace, rest, projected };
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthName = (key) => MONTH_NAMES[Number(String(key).slice(5, 7)) - 1] || key;

// The YA month table as CSV (costs as negative numbers, like the page).
export function companyYearCsv(y) {
  const head = ['Month', 'Labor billed', 'Job sales', 'Income', 'Job cost', 'Shop', 'Glass Forge fees', 'Glass Forge splits', 'Profit before crew pay'];
  const line = (label, r) => [label, r.labor, r.sales, r.income, -r.jobCost, -r.shop, -r.fee, -r.split, r.profit].map((v) => (typeof v === 'number' ? round(v || 0).toFixed(2) : `"${String(v).replace(/"/g, '""')}"`)).join(',');
  return [head.join(','), ...y.months.map((m) => line(`${monthName(m.month)} ${y.year}`, m)), line(`${y.year} to date`, y.ytd)].join('\n');
}
