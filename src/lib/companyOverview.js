// Company overview (Gabe, Oct 26): YA Windows & Doors' year in money, what Glass Forge made by
// invoicing YA, and YA's profit after Glass Forge. Pure: no React, no SDK.
//  - Each month is Invoicing's "All lines" for that month (the same rows and amounts), less
//    lines dated after today. Install lines give YA's labor billed and Glass Forge's 10% fee.
//    Profit-split lines give an outside job's sale and cost and Glass Forge's half.
//  - Shop / overhead POs (purchase_type 'shop') are YA costs in the month they were raised.
//  - Open Purchasing jobs (sold, not Paid) are the pipeline. A job lands in a month only once
//    it is Paid, through its 50/50 split line, so nothing is counted twice.
//  - The earned figures are the Hub's own: profit before crew pay and overhead. Crew pay and
//    overhead exist only in YA's bank lines (BankTransactions, src/lib/bankLines.js), which
//    cashYear turns into the cash profit and loss. The two are never mixed: the Hub's income is
//    short of what came into the bank, so earned income less bank costs reads far too low.
//  - Glass Forge's consulting agreement with YA took effect in March 2026 (invoice GF-2026-001),
//    so earlier months owe Glass Forge nothing. A month Glass Forge has invoiced (an Invoices
//    record of kind 'glass_forge', recorded from the issued document) counts the invoice's
//    amounts; other months count the Hub's figures, and both are kept for the comparison.
import { computeFeeAmt, computeLaborAmt } from './feeMath.js';
import { inInvoiceScope } from './invoiceScope.js';
import { cardFigures, isSold, isCompleted } from './purchasingSummary.js';
import { SPLIT_PCT } from './purchasingSplit.js';
import { bankMonth, bankDays } from './bankLines.js';

const round = (n) => Math.round(n * 100) / 100;
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? 0 : Number(v));
const sum = (rows, f) => round(rows.reduce((n, r) => n + (f(r) || 0), 0));
export const isProfitSplit = (r) => r?.fee_type === 'profit_split';
export const GLASS_FORGE_START = '2026-03';
export const GLASS_FORGE_RATE = 0.1; // of install labor, per the consulting agreement

// Glass Forge's issued invoices to YA by service month (two in one month add together).
export function glassForgeInvoices(invoices = []) {
  const byMonth = new Map();
  for (const i of invoices) {
    if (i.kind !== 'glass_forge' || i.voided_at) continue;
    const month = i.service_month || String(i.invoice_date || '').slice(0, 7);
    if (!month) continue;
    const prev = byMonth.get(month);
    const doc = { number: i.invoice_number, date: i.invoice_date, url: i.source_url || '', paidDate: i.paid_date || null };
    byMonth.set(month, {
      amount: round((prev?.amount || 0) + num(i.amount)),
      split: round((prev?.split || 0) + num(i.split_amount)),
      jobValue: round((prev?.jobValue || 0) + num(i.job_value)),
      docs: [...(prev?.docs || []), doc],
    });
  }
  return byMonth;
}

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

// basis: 'invoice' (Glass Forge invoiced this month), 'hub' (not invoiced: the Hub's figures)
// or 'before' (before the agreement: nothing owed, so no Hub figure to compare either).
// bank: bankMonth(...) for the month (crew pay, overhead, other costs and other income).
export function monthFigures(lines, month, shop = 0, { invoice = null, start = GLASS_FORGE_START, bank = null } = {}) {
  const splits = lines.filter(isProfitSplit);
  const install = lines.filter((r) => !isProfitSplit(r));
  const labor = sum(install, computeLaborAmt);
  const sales = sum(splits, (r) => num(r.sale_price));
  const jobCost = sum(splits, (r) => num(r.cost));
  const hubFee = sum(install, computeFeeAmt);
  const hubSplit = sum(splits, computeFeeAmt);
  const basis = month < start ? 'before' : invoice ? 'invoice' : 'hub';
  const hubGlassForge = basis === 'before' ? 0 : round(hubFee + hubSplit);
  const split = basis === 'before' ? 0 : basis === 'invoice' ? invoice.split : hubSplit;
  const fee = basis === 'before' ? 0 : basis === 'invoice' ? round(invoice.amount - invoice.split) : hubFee;
  const b = bank || bankMonth([], month);
  const income = round(labor + sales);
  const glassForge = round(fee + split);
  const profit = round(income - jobCost - shop - glassForge);
  return {
    month, labor, sales, income, jobCost, shop, hasBank: b.hasBank, bank: b,
    fee, split, glassForge, profit, margin: income ? profit / income : null, lines: lines.length,
    basis, invoice, hubGlassForge,
    invoiced: basis === 'invoice' ? glassForge : 0,
    notInvoiced: basis === 'hub' ? glassForge : 0,
    difference: basis === 'invoice' ? round(glassForge - hubGlassForge) : 0,
  };
}

const FIELDS = ['labor', 'sales', 'income', 'jobCost', 'shop', 'fee', 'split', 'glassForge', 'profit', 'hubGlassForge', 'invoiced', 'notInvoiced', 'difference'];
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
// Forge's 10% (GLASS_FORGE_RATE). invoices: Invoices records (the 'glass_forge' ones are used);
// start: the month Glass Forge's agreement took effect.
// rows: Invoicing's display rows (withCompanions, Purchasing-held lines removed);
// superseded: buildSupersededSet of those rows; cards: Purchasing cards with paymentStage.
// bankLines: BankTransactions records (any account).
export function companyYear({ rows = [], superseded = new Set(), cards = [], purchaseOrders = [], invoices = [], bankLines = [], today, start = GLASS_FORGE_START }) {
  const year = today.slice(0, 4);
  const thisMonth = Number(today.slice(5, 7));
  const keys = Array.from({ length: thisMonth }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
  const shown = rows.filter((r) => !superseded.has(r.id) && !(r.job_date && r.job_date > today));
  const issued = glassForgeInvoices(invoices);
  const days = bankDays(bankLines);
  // Days in the month so far (this month: through today), to say how much of it the bank covers.
  const monthDays = (m) => (m === today.slice(0, 7) ? Number(today.slice(8, 10)) : new Date(Date.UTC(Number(m.slice(0, 4)), Number(m.slice(5, 7)), 0)).getUTCDate());
  const months = keys.map((m) => ({
    ...monthFigures(shown.filter((r) => inInvoiceScope(r, m)), m, shopCost(purchaseOrders, m), { invoice: issued.get(m) || null, start, bank: bankMonth(bankLines, m, days) }),
    monthDays: monthDays(m),
  }));
  const ytd = { ...total(months), bankMonths: months.filter((m) => m.hasBank).map((m) => m.month) };
  const prior = months.slice(0, -1);
  const left = 12 - thisMonth;
  const average = prior.length ? round(prior.reduce((n, m) => n + m.labor, 0) / prior.length) : 0;
  const feeRate = GLASS_FORGE_RATE;
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

// Bank cash movement by month (Gabe, Oct 26): unreconciled cash movement, NOT profit. Each month
// with bank lines is its bankCash: money in, then crew pay, the weekly $2,500/$3,000 stream
// (classification unknown), overhead, suppliers, Glass Forge paid and other money out. No
// projection: a run rate over these months already carries customer job receipts and supplier
// payments, so adding open jobs on top would count the same work twice. `overlap` measures that
// on the fully covered months before this one.
const CASH_FIELDS = ['moneyIn', 'customerIn', 'crewPay', 'weekly', 'overhead', 'suppliers', 'jobSuppliers', 'glassForge', 'other', 'net'];
const cashTotal = (rows) => Object.fromEntries(CASH_FIELDS.map((f) => [f, sum(rows, (r) => r[f])]));
export function cashYear(y) {
  const months = y.months.filter((m) => m.hasBank).map((m) => ({ month: m.month, ...m.bank.cash, coveredDays: m.bank.coveredDays, monthDays: m.monthDays, partial: m.bank.coveredDays < m.monthDays }));
  const ytd = cashTotal(months);
  const thisMonth = y.today.slice(0, 7);
  const full = months.filter((m) => !m.partial && m.month < thisMonth);
  const per = (f) => (full.length ? round(sum(full, (m) => m[f]) / full.length) : 0);
  const overlap = { months: full.length, from: full[0]?.month || '', to: full[full.length - 1]?.month || '', net: per('net'), customerIn: per('customerIn'), suppliers: per('suppliers') };
  const missing = months.filter((m) => m.partial).map((m) => m.month);
  return { months, ytd, missing, overlap };
}

const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export const monthName = (key) => MONTH_NAMES[Number(String(key).slice(5, 7)) - 1] || key;

// The bank cash movement table as CSV (money out as negative numbers, like the page).
export function cashYearCsv(y, c) {
  const head = ['Month', 'Bank days', 'Money in', 'Crew pay', 'Weekly $2,500/$3,000 (classification unknown)', 'Overhead', 'Suppliers', 'Glass Forge paid', 'Other money out', 'Net cash movement (unreconciled)'];
  const line = (label, r, days) => [label, days, r.moneyIn, -r.crewPay, -r.weekly, -r.overhead, -r.suppliers, -r.glassForge, -r.other, r.net].map((v) => (typeof v === 'number' ? round(v || 0).toFixed(2) : `"${String(v).replace(/"/g, '""')}"`)).join(',');
  return [head.join(','), ...c.months.map((m) => line(`${monthName(m.month)} ${y.year}`, m, `${m.coveredDays} of ${m.monthDays}`)), line(`${y.year} to date`, c.ytd, '')].join('\n');
}

// The YA month table as CSV (costs as negative numbers, like the page).
export function companyYearCsv(y) {
  const head = ['Month', 'Labor billed', 'Job sales', 'Income', 'Job cost', 'Shop', 'Glass Forge fees', 'Glass Forge splits', 'Profit before crew pay'];
  const line = (label, r) => [label, r.labor, r.sales, r.income, -r.jobCost, -r.shop, -r.fee, -r.split, r.profit].map((v) => (typeof v === 'number' ? round(v || 0).toFixed(2) : `"${String(v).replace(/"/g, '""')}"`)).join(',');
  return [head.join(','), ...y.months.map((m) => line(`${monthName(m.month)} ${y.year}`, m)), line(`${y.year} to date`, y.ytd)].join('\n');
}
