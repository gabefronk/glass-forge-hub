// The Company overview's signed-job pipeline and the July diagnostic (Gabe, Oct 26). Pure.
//  - A signed job is a Purchasing card that is sold and not Paid (isSold && !isCompleted).
//  - Sale and cost come from the Purchasing card (budget or typed figures); cash received comes
//    from the Hub's bank lines matched to the job; billed / invoiced-unpaid come from the dated
//    QuickBooks snapshot (booksSnapshot.js). Every figure keeps its basis so the page can say
//    where it came from; an unknown cost stays null (shown as unknown), never 0.
//  - Overhead is never allocated to jobs anywhere, so no job has every cost supported and the
//    total expected job profit is withheld; the page shows the known margin before unknown costs.
//  - YA's and Glass Forge's shares are separate (Glass Forge takes half of a job's profit).
import { computeLaborAmt } from './feeMath.js';
import { isSold, isCompleted } from './purchasingSummary.js';
import { SPLIT_PCT } from './purchasingSplit.js';

const round = (n) => Math.round(n * 100) / 100;
const num = (v) => (v === null || v === undefined || v === '' || !Number.isFinite(Number(v)) ? null : Number(v));
const add = (rows, f) => round(rows.reduce((n, r) => n + (num(f(r)) || 0), 0));
const half = (profit) => Math.round(Math.round(profit * 100) * SPLIT_PCT) / 100;

// When the job is expected to earn: installed or delivered jobs are this year; otherwise the
// latest ETA on its pending supplier orders. A December ETA is flagged: install may slip to 2027.
export function earnTiming(stage, orders = []) {
  if (['installed', 'delivered'].includes(stage)) return { year: '2026', label: '2026 (installed / delivered)' };
  const etas = orders.filter((o) => !o.received_date && o.eta_date).map((o) => String(o.eta_date).slice(0, 10)).sort();
  const eta = etas[etas.length - 1];
  if (!eta) return { year: 'unknown', label: 'Unknown (no supplier ETA)' };
  if (eta > '2026-12-31') return { year: '2027', label: `2027 (ETA ${eta})`, eta };
  if (eta >= '2026-12-01') return { year: '2026?', label: `2026, at risk (ETA ${eta})`, eta };
  return { year: '2026', label: `2026 (ETA ${eta})`, eta };
}

// A Purchasing card's figure the way Purchasing shows it: the job row's own value, or, when a
// multi-scope job row withholds it (applyScopeRollup), the sum of its scope rows. Unlike the
// Purchasing bar's totals, a missing figure stays null here (unknown, never 0).
const ACCESS = { windows: [(c) => c.windows?.display, (s) => s.windows], rough: [(c) => c.rough?.display, (s) => s.rough], sale: [(c) => c.sale?.display, (s) => s.sale] };
export function cardFigure(card, field) {
  const [job, scope] = ACCESS[field];
  const own = job(card);
  if (!own?.suppressed) return num(own?.value);
  const values = (card.scopes || []).map((s) => num(scope(s)?.value));
  return !values.length || values.some((v) => v == null) ? null : round(values.reduce((n, v) => n + v, 0));
}

// One signed job. card: a Purchasing card; budgets / orders / costInputs / bankLines / sales: the
// records for this job (unfiltered lists are fine; they are filtered by job id here).
export function pipelineJob(card, { budgets = [], orders = [], costInputs = [], bankLines = [], sales = [] } = {}) {
  const id = card.job?.id;
  const sale = cardFigure(card, 'sale');
  const windows = cardFigure(card, 'windows');
  const rough = cardFigure(card, 'rough');
  const typed = card.windows?.display?.source === 'owner';
  const budget = budgets.find((b) => b.id === card.chosenBudget?.id) || null;
  const labor = num(budget?.inputs?.labor_cost_sub_pay);
  const jci = costInputs.filter((c) => c.job_id === id).sort((a, b) => String(b.updated_date || '').localeCompare(String(a.updated_date || '')))[0];
  const actualCrew = num(jci?.actual_labor_cost);

  let crew;
  if (actualCrew != null) crew = { value: actualCrew, basis: 'actual', label: 'Entered actual (job cost inputs)' };
  else if (typed) crew = { value: null, basis: 'typed', label: 'Inside the typed job cost' };
  else if (labor != null && labor > 0) crew = { value: labor, basis: 'estimate', label: 'Budget estimate' };
  else crew = { value: null, basis: 'unknown', label: 'Unknown' };
  // Supplier cost: Purchasing's job cost (windows incl. tax + the budget's labor & install material,
  // or the typed job cost) less the budget labor it carries, so crew is never counted twice.
  const cost = windows == null ? null : round(windows + (rough || 0));
  const laborInCost = !typed && labor != null && labor > 0 && (rough || 0) >= labor ? labor : 0;
  const materials = cost == null ? null : round(cost - laborInCost);

  const mine = (l) => l.job_id === id;
  const receivedLinked = add(bankLines.filter((l) => mine(l) && l.category === 'customer_payment'), (l) => l.amount);
  const supplierPaid = add(bankLines.filter((l) => mine(l) && l.category === 'job_cost'), (l) => -l.amount);
  const jobSales = sales.filter((s) => s.jobId === id);
  const billed = jobSales.length ? add(jobSales, (s) => s.amount) : null;
  const invoicedUnpaid = add(jobSales, (s) => s.open);
  const paidInBankUnlinked = add(jobSales.filter((s) => s.deposit?.inBank && !s.deposit?.linked), (s) => s.amount - s.open);
  const paidAfterBank = add(jobSales.filter((s) => s.deposit && !s.deposit.inBank), (s) => s.amount - s.open);
  const received = round(receivedLinked + paidInBankUnlinked);
  const collected = round(received + paidAfterBank);

  const toCollect = sale == null ? null : round(sale - collected);
  const toBill = sale == null || billed == null ? null : round(sale - billed);
  const supplierLeft = materials == null ? null : round(Math.max(0, materials - supplierPaid));
  const crewLeft = crew.value; // crew drafts are not matched to jobs in the bank, so none counts as paid

  const unknowns = [];
  if (sale == null) unknowns.push('sale');
  if (materials == null) unknowns.push('supplier cost');
  if (crew.basis === 'unknown') unknowns.push('crew');
  unknowns.push('overhead');
  const costKnown = sale != null && materials != null;
  const knownMargin = costKnown ? round(sale - materials - (crew.value || 0)) : null;
  const totalProfit = unknowns.length ? null : knownMargin;
  const netRemaining = costKnown ? round(toCollect - supplierLeft - (crewLeft || 0)) : null;
  const gfShare = knownMargin == null || !(sale > 0) ? null : half(knownMargin);
  const yaShare = gfShare == null ? null : round(knownMargin - gfShare);
  const timing = earnTiming(card.paymentStage, orders.filter((o) => o.job_id === id));

  return {
    id, name: card.job?.canonical_name || '', stage: card.paymentStage || '',
    sale, saleSource: card.sale?.display?.label || '', materials, materialsSource: card.windows?.display?.label || '', typed,
    crew, overhead: { value: null, basis: 'unknown', label: 'Unknown (not allocated to jobs)' },
    billed, invoicedUnpaid, received, receivedLinked, paidInBankUnlinked, paidAfterBank, collected, toCollect, toBill,
    supplierPaid, supplierLeft, crewLeft, knownMargin, totalProfit, netRemaining, yaShare, gfShare, unknowns, timing,
    notes: jobSales.map((s) => `${s.ref} ${s.customer}: ${s.evidence}${s.deposit?.note ? ` (${s.deposit.note})` : ''}`),
  };
}

export function pipelineView({ cards = [], ...records } = {}) {
  const jobs = cards.filter((c) => isSold(c) && !isCompleted(c)).map((c) => pipelineJob(c, records))
    .sort((a, b) => (b.sale || 0) - (a.sale || 0) || a.name.localeCompare(b.name));
  const fields = ['sale', 'billed', 'invoicedUnpaid', 'received', 'paidAfterBank', 'toCollect', 'supplierPaid', 'supplierLeft', 'crewLeft', 'knownMargin', 'netRemaining', 'yaShare', 'gfShare'];
  const totals = Object.fromEntries(fields.map((f) => [f, add(jobs, (j) => j[f])]));
  totals.crewUnknown = jobs.filter((j) => j.crew.basis === 'unknown').length;
  totals.crewTyped = jobs.filter((j) => j.crew.basis === 'typed').length;
  totals.saleUnknown = jobs.filter((j) => j.sale == null).length;
  totals.marginWithheld = jobs.filter((j) => j.knownMargin == null).length;
  totals.byYear = ['2026', '2026?', '2027', 'unknown'].map((y) => ({ year: y, jobs: jobs.filter((j) => j.timing.year === y).length, toCollect: add(jobs.filter((j) => j.timing.year === y), (j) => j.toCollect) }));
  return { jobs, totals };
}

// July diagnostic (Gabe, Oct 26): imported sheet lines the earned formula leaves out because they
// carry a stored labor amount but no calendar amount, man hours or trips. Shown only as "July would
// be X if these lines are valid"; never added to actuals.
export function importedLaborDiagnostic(feeLines = [], month = '2026-07') {
  const lines = feeLines.filter((r) => r.invoice_month === month && r.source === 'sheet-import' && r.billable !== false
    && !r.superseded_by && (num(r.labor_amt) || 0) > 0 && computeLaborAmt(r) === 0);
  const labor = add(lines, (r) => r.labor_amt);
  return { month, count: lines.length, labor, fee: round(labor * 0.1) };
}
