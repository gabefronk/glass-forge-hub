// The canonical job ledger (Gabe, Oct 26): one row per sold Purchasing job. Purchasing and the
// Company overview both read their job money from here, so the two pages cannot disagree. Pure.
//
// Split rule (owner-confirmed, Oct 26): every Purchasing job is an outside-BFS sale. Profit is the
// sale less the job's all-in cost (materials + sub/crew labor + other install material), split
// 50/50 between YA and Glass Forge. No 10% fee on these jobs and no overhead loading, so nothing is
// deducted twice. A cost that is not known stays null and the row is flagged; it is never filled
// with 0 or an allowance.
//
// Every figure carries a tag saying how it is known:
//   feed     - a Mountain America bank feed line (BankTransactions) matched to the job
//   invoice  - a QuickBooks invoice or sales receipt (booksSnapshot.js, read only)
//   estimate - a budget, PO, supplier order or typed figure (incl. an entered crew actual that
//              no bank payment confirms)
//   unknown  - no figure
import { isSold, isCompleted } from './purchasingSummary.js';
import { SPLIT_PCT } from './purchasingSplit.js';
import { cardFigure, earnTiming } from './companyPicture.js';

export const TAGS = { feed: 'Feed-verified', invoice: 'Invoice-verified', estimate: 'Estimate', unknown: 'Unknown' };

const round = (n) => Math.round(n * 100) / 100;
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const sum = (rows, f) => round(rows.reduce((n, r) => n + (num(f(r)) || 0), 0));
const same = (a, b) => a != null && b != null && Math.abs(a - b) < 0.005;
const usd = (v) => `${v < 0 ? '-' : ''}$${Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const half = (profit) => Math.round(Math.round(profit * 100) * SPLIT_PCT) / 100;

// Findings that need the owner, from the source documents (read Oct 26). Shown on the job's row;
// nothing here changes a figure.
export const LEDGER_NOTES = {
  '6ab10cdaa3f7840f482189b2': ['For Gabriel: the Sep 18 down-payment wire ($82,617.88) is $14,085.79 less than half the sale ($96,703.67). What down payment was agreed is not on file (bank, QuickBooks and email searched), so the ledger counts only the wire received and does not assume half.'],
  '6acf9d64bc78f66ea67324a6': ['Owner-confirmed Oct 26: the sale is the QuickBooks invoice 1006 pricing, $14,023.73 (AMSCO windows $2,457.38 + Windor doors $11,566.35). Cost incl. tax is $10,249.11 (AMSCO $1,860.49, Windor $8,388.62); the customer installs the windows; YA installs the doors ($400 labor + $200 install material).'],
  '6ab65a0af4c7aab207863abb': ['For Gabriel: QuickBooks bills $2,406.60 in all (invoice 1002 $1,474.71 + invoice 1013 $931.89, memo "final payment"); the Hub sale is $2,863.79, $457.19 more. Which one is the agreed price is not on file.'],
  '6ac9042f38f6acd458b62de1': ['Supplier tax dispute open: 7.45% computed ($9,393.34) vs 4.75% charged ($5,989.04). The cost uses what was charged and paid.'],
  '6ad905765c09889963f111b3': ['For Gabriel: ABC Supply was paid $1,506.49 on Oct 22 for PO "TOBY HOLMES" (payment confirmation #370416113); the budget cost is $1,403.10, $103.39 less (consistent with sales tax). The cost is left at the budget figure until you confirm.'],
  '6adb07ab10207439dec8647a': ['For Gabriel: marked Paid, but no $600 payment is in the bank feed, QuickBooks or email. No receipt is assumed.'],
  '6ac0842bdacabf0b5ef5a31f': ['For Gabriel: Glass Forge invoices GF-2026-002/003 bill "Holmes Homes - Agren" install lines at 10% (April $4,544.00, $350.00, $75.00, $695.00 job values; May $300.00 service). Whether that is the same job as this October cash sale is not on file. No invoice changed.'],
};

// Owner confirmation (Gabriel, Oct 26): every supplier on the active Purchasing jobs is paid. A paid
// bill stays in the job's cost; it is never shown as cash still to pay. A payment found in the bank
// feed is shown as feed-verified; the rest is owner-confirmed.
export const SUPPLIERS_PAID = { at: 'Oct 26, 2026', by: 'Gabriel', scope: 'active' };

// Issued Glass Forge invoices checked against the split rule: no 10% fee on an outside-BFS ledger job
// (read from the four invoice documents in Drive, Oct 26). Listed for the owner; nothing is adjusted.
export const GF_FEE_CHECK = {
  readAt: 'Oct 26, 2026',
  invoices: ['GF-2026-001 (March)', 'GF-2026-002 (April)', 'GF-2026-003 (May)', 'GF-2026-004 (June)'],
  conflicts: [],
  finding: 'None of the four lists one of the 16 active ledger jobs: they bill March–June install work at 10% and product or profit splits at 50%. No 10% fee is charged on an active outside-BFS job, so there is no conflict. No Glass Forge invoice covers July–October yet.',
  agren: 'To confirm: "Holmes Homes - Agren" install lines are billed at 10% in April ($4,544.00, $350.00, $75.00 and $695.00 job values) and May ($300.00 service). The completed ledger job Agren Res - Highland ($442.94 sale, October, cash customer) looks like separate later work; if it is the same job, that is a 10% fee on an outside-BFS job.',
  aside: 'Outside the ledger, for the owner: Hillwood - Tyson Res is billed at 10% in May ($1,667.40) and again as a profit split in June ($7,337.00); GF-2026-001 lists three "(Visit 2)" lines at the same values as the first visits.',
};

// The budgets a job's money comes from: each quote-budget scope on a multi-scope job, else the
// budget the Purchasing row reads (card.chosenBudget).
function jobBudgets(card, budgets) {
  const scopes = card.scopes || [];
  const ids = scopes.length > 1
    ? scopes.filter((s) => String(s.key || '').startsWith('budget:')).map((s) => s.key.slice(7))
    : [card.chosenBudget?.id].filter(Boolean);
  return budgets.filter((b) => ids.includes(b.id));
}

// One ledger row. card: a Purchasing card (purchasingBoardCards). The record lists may be
// unfiltered; they are filtered by job id here.
export function ledgerJob(card, { budgets = [], orders = [], costInputs = [], bankLines = [], sales = [], notes = LEDGER_NOTES, suppliersPaid = null } = {}) {
  const id = card.job?.id;
  const flags = [];
  const typed = card.windows?.display?.source === 'owner';
  const used = jobBudgets(card, budgets);
  const multi = (card.scopes || []).length > 1;
  const jobSales = sales.filter((s) => s.jobId === id);

  // Sale: the Purchasing figure (budget sell or typed customer total). Invoice-verified when a
  // QuickBooks document implies the same whole sale; a different implied sale is a conflict.
  const saleValue = cardFigure(card, 'sale');
  const implied = jobSales.find((s) => num(s.impliedSale) != null)?.impliedSale ?? null;
  const saleTag = saleValue == null ? 'unknown' : same(implied, saleValue) ? 'invoice' : 'estimate';
  const sale = {
    value: saleValue, tag: saleTag,
    source: [card.sale?.display?.label, ...used.map((b) => `budget ${b.id}`), same(implied, saleValue) ? jobSales.find((s) => same(s.impliedSale, saleValue)).ref : ''].filter(Boolean).join(' · '),
  };
  if (saleValue == null) flags.push('No sale price yet: its cost is kept out of the profit totals');
  else if (implied != null && !same(implied, saleValue)) flags.push(`Sale conflict: QuickBooks implies ${usd(implied)}, the Hub has ${usd(saleValue)} (${usd(round(saleValue - implied))})`);

  // Materials: windows/doors/glass incl. tax (or the typed all-in cost). Feed-verified when the
  // bank's supplier payments matched to the job add up to it exactly.
  const matValue = cardFigure(card, 'windows');
  const paidLines = bankLines.filter((l) => l.job_id === id && l.category === 'job_cost');
  const paid = sum(paidLines, (l) => -l.amount);
  const matSources = multi
    ? card.scopes.map((s) => `${s.label}: ${s.windows?.label || 'no figure'}`)
    : [typed ? 'Typed all-in job cost (labor inside)' : card.windows?.display?.label].filter(Boolean);
  const materials = {
    value: matValue, tag: matValue == null ? 'unknown' : (!typed && same(paid, matValue)) ? 'feed' : 'estimate',
    sources: [...matSources, ...used.map((b) => `budget ${b.id}`), ...paidLines.map((l) => `bank ${l.posted_date} ${usd(l.amount)} (${l.id})`)],
    paid,
  };
  if (matValue == null) flags.push('Materials cost unknown');
  else if (paid > 0 && !same(paid, matValue)) flags.push(`Bank feed shows ${usd(paid)} paid to suppliers against ${usd(matValue)} materials${suppliersPaid ? '; the rest is owner-confirmed paid' : ''}`);
  // How the supplier bills are known to be paid: feed (all of it in the bank feed), feed + owner,
  // owner (owner-confirmed, no bank line matched), or none (not confirmed).
  materials.paidBasis = !(matValue > 0) ? 'none' : same(paid, matValue) || paid > matValue ? 'feed' : paid > 0 ? (suppliersPaid ? 'feed+owner' : 'partial') : suppliersPaid ? 'owner' : 'none';

  // Sub/crew labor: an entered actual (job cost inputs), inside a typed cost, the budget's estimate,
  // or unknown. Crew drafts are not matched to jobs in the bank, so none is feed-verified.
  const budgetLabor = used.some((b) => num(b.inputs?.labor_cost_sub_pay) != null) ? sum(used, (b) => b.inputs?.labor_cost_sub_pay) : null;
  const jci = costInputs.filter((c) => c.job_id === id).sort((a, b) => String(b.updated_date || '').localeCompare(String(a.updated_date || '')))[0];
  let subLabor;
  if (num(jci?.actual_labor_cost) != null) subLabor = { value: num(jci.actual_labor_cost), tag: 'estimate', basis: 'actual', source: `Entered actual (job cost inputs ${jci.id}); no bank payment matched` };
  else if (typed) subLabor = { value: null, tag: 'estimate', basis: 'typed', source: 'Inside the typed all-in cost' };
  else if (budgetLabor > 0) subLabor = { value: budgetLabor, tag: 'estimate', basis: 'estimate', source: `Budget estimate (${used.map((b) => b.id).join(', ')})` };
  else subLabor = { value: null, tag: 'unknown', basis: 'unknown', source: 'No crew figure on file' };
  if (subLabor.basis === 'unknown' && saleValue != null) flags.push('Crew cost unknown: profit is before crew');
  if (subLabor.basis === 'typed') flags.push('Typed cost already includes labor; not added again');

  // Other: the budget's additional install material (Purchasing's labor & material less labor).
  const rough = cardFigure(card, 'rough');
  const otherValue = typed ? 0 : rough == null ? null : round(rough - (budgetLabor || 0));
  const other = { value: otherValue, tag: otherValue == null ? 'unknown' : 'estimate', source: typed ? 'Inside the typed all-in cost' : otherValue == null ? 'No budget' : 'Budget install material' };

  const cost = matValue == null ? null : round(matValue + (subLabor.value || 0) + (otherValue || 0));
  const costComplete = matValue != null && subLabor.basis !== 'unknown' && otherValue != null;
  const profit = saleValue == null || cost == null ? null : round(saleValue - cost);
  const gf = profit == null ? null : half(profit);
  const ya = profit == null ? null : round(profit - gf);

  // Receipts: bank deposits matched to the job (feed), and QuickBooks payments whose deposit is a
  // combined bank line or after the bank data ends (invoice). A deposit is counted once.
  const receipts = [];
  for (const l of bankLines.filter((x) => x.job_id === id && x.category === 'customer_payment')) {
    const doc = jobSales.find((s) => s.deposit?.bankLineId === l.id);
    receipts.push({ date: l.posted_date, amount: num(l.amount), tag: 'feed', source: `Bank ${l.posted_date} "${l.description}" (${l.id})${doc ? ` = ${doc.ref}` : ''}` });
  }
  for (const s of jobSales) {
    const paidAmt = round(s.amount - (s.open || 0));
    if (!s.deposit || !(paidAmt > 0) || s.deposit.linked) continue;
    receipts.push({ date: s.date, amount: paidAmt, tag: 'invoice', source: `${s.ref} (${s.customer})${s.deposit.note ? `: ${s.deposit.note}` : ''}` });
  }
  receipts.sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const received = sum(receipts, (r) => r.amount);
  const leftToCollect = saleValue == null ? null : round(saleValue - received);
  const invoices = jobSales.map((s) => ({ ref: s.ref, date: s.date, amount: s.amount, open: s.open || 0 }));
  if (isCompleted(card) && !receipts.length) flags.push('Marked Paid, but no payment is on file in the bank feed or QuickBooks');

  for (const b of used) {
    if (b.status === 'needs_review') flags.push(`Budget "${b.title}" needs review: figures not confirmed`);
    if (b.budget_usage === 'draft') flags.push(`Budget "${b.title}" is a Draft (not counted in budget)`);
  }
  if (jci?.route === 'bfs_installed_sale') flags.push('Job cost inputs route says "BFS installed sale"; the owner rule treats this job as outside BFS (route left unchanged)');
  flags.push(...(notes[id] || []));

  return {
    id, name: card.job?.canonical_name || '', builder: card.job?.builder || '', stage: card.paymentStage || '', completed: isCompleted(card),
    sale, materials, subLabor, other, cost, costComplete, profit, ya, gf,
    invoices, invoicedOpen: sum(invoices, (i) => i.open), receipts, received, leftToCollect,
    timing: earnTiming(card.paymentStage, orders.filter((o) => o.job_id === id)),
    flags,
  };
}

// Totals over ledger rows, on one basis: Sold, cost and profit add the jobs with a sale price, so
// cost and profit always cover the same jobs; a job with no sale is reported on its own.
export function ledgerTotals(rows = []) {
  const priced = rows.filter((r) => r.sale.value != null);
  const unpriced = rows.filter((r) => r.sale.value == null);
  const incomplete = priced.filter((r) => !r.costComplete);
  return {
    jobs: rows.length, priced: priced.length,
    sale: sum(priced, (r) => r.sale.value), cost: sum(priced, (r) => r.cost), profit: sum(priced, (r) => r.profit),
    ya: sum(priced, (r) => r.ya), gf: sum(priced, (r) => r.gf),
    received: sum(rows, (r) => r.received), leftToCollect: sum(priced, (r) => r.leftToCollect), invoicedOpen: sum(rows, (r) => r.invoicedOpen),
    materials: sum(priced, (r) => r.materials.value), paidFeed: sum(rows, (r) => r.materials.paid), subLabor: sum(priced, (r) => r.subLabor.value), other: sum(priced, (r) => r.other.value),
    noSale: { jobs: unpriced.map((r) => r.name), cost: sum(unpriced, (r) => r.cost) },
    incomplete: { jobs: incomplete.map((r) => r.name), profit: sum(incomplete, (r) => r.profit) },
    completeProfit: sum(priced.filter((r) => r.costComplete), (r) => r.profit),
  };
}

// The ledger for the sold Purchasing jobs: active (sold, not Paid) and completed (Paid) apart.
export function jobLedger({ cards = [], ...records } = {}) {
  const rows = cards.filter(isSold).map((c) => ledgerJob(c, { ...records, suppliersPaid: isCompleted(c) ? null : SUPPLIERS_PAID }));
  const active = rows.filter((r) => !r.completed);
  const completed = rows.filter((r) => r.completed);
  return { active, completed, byId: new Map(rows.map((r) => [r.id, r])), totals: { active: ledgerTotals(active), completed: ledgerTotals(completed) } };
}

// The receipts ledger: every customer payment on a ledger job with its source, then every customer
// deposit in the bank feed that no ledger job accounts for (with the QuickBooks document where one
// explains it), so nothing received is hidden.
export function receiptsLedger({ rows = [], bankLines = [], sales = [], unassigned = [] } = {}) {
  const mapped = rows.flatMap((r) => r.receipts.map((x) => ({ ...x, jobId: r.id, job: r.name })))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const ids = new Set(rows.map((r) => r.id));
  const explained = new Set(sales.filter((s) => ids.has(s.jobId) && s.deposit?.bankLineId).map((s) => s.deposit.bankLineId));
  const unmatched = bankLines
    .filter((l) => l.category === 'customer_payment' && !ids.has(l.job_id) && !explained.has(l.id))
    .map((l) => {
      const doc = unassigned.find((u) => u.bankLineId === l.id);
      return { id: l.id, date: l.posted_date, amount: num(l.amount), description: l.description, note: doc ? `${doc.ref} ${doc.customer}: ${doc.note}` : (l.match_note || '') };
    })
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  return { mapped, unmatched, mappedTotal: sum(mapped, (x) => x.amount), unmatchedTotal: sum(unmatched, (x) => x.amount), notInLedger: unassigned };
}
