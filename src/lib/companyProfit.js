// Company profit views (Gabe, Oct 26). Pure.
//  - yaOperatingYear: YA's full-year operating statement on ONE stated period and basis: cash basis,
//    from the Hub's Mountain America bank lines. Only genuine operating expenses are deducted.
//    Owner draws, loan payments and transfers are not expenses. Tax payments are listed one by one
//    because employer payroll tax and income tax cannot be told apart from the bank line.
//    Payroll ACH and the weekly $2,500/$3,000 stream wait for the bookkeeper's ruling, and Amex and
//    unsorted lines are not classified, so they are shown as pending, never netted into the result.
//  - entityViews: YA and Glass Forge standalone, and combined with the intercompany amount
//    eliminated once (Glass Forge's share is never subtracted twice).
// Active-job lifetime margins (the job ledger) are a different period and basis; they are shown
// beside this statement, never added to it.
import { isWeeklyStream } from './bankLines.js';

const round = (n) => Math.round(n * 100) / 100;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// A tax payment by its bank description or the category note ("Taxes").
export const isTaxLine = (l) => /internal revenue|\btax\b/i.test(String(l.description || '')) || /^taxes$/i.test(String(l.match_note || '').trim());

// [key, label, kind]. kind: income | direct | intercompany | opex | pending | excluded
export const OPERATING_GROUPS = [
  ['labor', 'BFS install labor received', 'income'],
  ['customers', 'Customer payments (outside jobs)', 'income'],
  ['otherIncome', 'Other income', 'income'],
  ['suppliers', 'Suppliers (job materials, incl. supplier payments with no Hub order)', 'direct'],
  ['crew', 'Crew pay (drafts and checks; the weekly stream is apart)', 'direct'],
  ['shop', 'Shop purchases', 'direct'],
  ['glassForge', 'Glass Forge invoices paid (intercompany)', 'intercompany'],
  ['opex', 'Operating expenses (insurance, fees, office, meals, equipment rental)', 'opex'],
  ['taxes', 'Tax payments: employer payroll tax or income tax, to confirm line by line', 'pending'],
  ['payroll', 'Payroll ACH (Israel, the only QuickBooks Payroll employee): treatment with the bookkeeper', 'pending'],
  ['weekly', 'Weekly $2,500 / $3,000 stream: classification with the bookkeeper', 'pending'],
  ['card', 'Amex card payments: purchases not itemized', 'pending'],
  ['unsorted', 'Money out not sorted yet', 'pending'],
  ['loans', 'Loan payments (principal / interest split unknown)', 'excluded'],
  ['ownerDraws', 'Owner draws', 'excluded'],
  ['transfers', 'Transfers', 'excluded'],
];
const KIND = Object.fromEntries(OPERATING_GROUPS.map(([k, , kind]) => [k, kind]));

export function operatingGroup(l) {
  const a = num(l.amount);
  if (a > 0) return l.category === 'labor_payment' ? 'labor' : l.category === 'customer_payment' ? 'customers' : 'otherIncome';
  if (isTaxLine(l)) return 'taxes';
  if (isWeeklyStream(l)) return 'weekly';
  switch (l.category) {
    case 'job_cost': case 'supplier': return 'suppliers';
    case 'crew_pay': return 'crew';
    case 'shop': return 'shop';
    case 'glass_forge': return 'glassForge';
    case 'overhead': return 'opex';
    case 'payroll': return 'payroll';
    case 'card': return 'card';
    case 'loan': return 'loans';
    case 'owner_draw': return 'ownerDraws';
    case 'transfer': return 'transfers';
    default: return 'unsorted';
  }
}

export function yaOperatingYear(bankLines = [], { from = '2026-01-01', to = '2026-12-31' } = {}) {
  const lines = bankLines.filter((l) => { const d = String(l.posted_date || ''); return d >= from && d <= to; });
  const totals = Object.fromEntries(OPERATING_GROUPS.map(([k]) => [k, 0]));
  const taxLines = [];
  for (const l of lines) {
    const g = operatingGroup(l);
    totals[g] += Math.abs(num(l.amount));
    if (g === 'taxes') taxLines.push({ id: l.id, date: l.posted_date, description: l.description, amount: -num(l.amount) });
  }
  for (const k of Object.keys(totals)) totals[k] = round(totals[k]);
  const by = (kind) => round(OPERATING_GROUPS.filter(([, , kd]) => kd === kind).reduce((n, [k]) => n + totals[k], 0));
  const income = by('income'), direct = by('direct'), intercompany = by('intercompany'), opex = by('opex');
  const last = lines.reduce((m, l) => (String(l.posted_date) > m ? String(l.posted_date) : m), '');
  return {
    period: { from, to: last || to }, basis: 'cash (bank lines, unreconciled)', lines: lines.length, totals, kind: KIND,
    income, direct, intercompany, opex,
    // Income less direct job costs, Glass Forge and genuine operating expenses. The pending groups
    // are NOT deducted: each could be an expense, a draw or a balance-sheet item.
    resultBeforePending: round(income - direct - intercompany - opex),
    pending: by('pending'), excluded: by('excluded'),
    taxLines: taxLines.sort((a, b) => String(a.date).localeCompare(String(b.date))),
  };
}

// YA, Glass Forge and combined, on the two bases kept apart.
//  Job lifetime (the job ledger's active jobs): profit splits 50/50; combined is the whole job profit.
//  Full-year cash (yaOperatingYear): Glass Forge's income from YA is YA's intercompany payment, so
//  combined = YA's result + Glass Forge's receipts from YA, which cancels that payment exactly once.
//  Glass Forge's own other income and costs are not in the Hub: unknown.
export function entityViews({ ledger, operating }) {
  const jobs = { ya: ledger.ya, gf: ledger.gf, combined: ledger.profit };
  const yaCash = operating.resultBeforePending;
  const gfFromYa = operating.intercompany;
  return {
    jobs,
    cash: { ya: yaCash, gfFromYa, gfOther: null, combined: round(yaCash + gfFromYa), eliminated: gfFromYa },
  };
}
