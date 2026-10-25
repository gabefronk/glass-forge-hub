// Purchasing jobs are sold outside BFS and split differently (Gabe, Oct 25). Their Invoicing
// lines are not billed one by one: until the job's stage is Paid they are held off Invoicing,
// and once it is Paid the Hub writes ONE profit-split line for the job: half of the Purchasing
// Est. profit (sale less windows less labor & material, the same figures as the Purchasing row).
// Pure: no React, no SDK. The Invoicing page applies the plan.
import { buildPurchasingCards } from './purchasingViewModel.js';
import { jobMoneyHeadline } from './jobMoneyPanel.js';

export const SPLIT_PCT = 0.5;
const round = (n) => Math.round(n * 100) / 100;
const denverDay = (value) => new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Denver', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(value));

// Jobs that have a Purchasing row (a live quote/budget, PO or supplier order).
export function purchasingJobIds({ jobs = [], budgets = [], purchase_orders = [], vendor_orders = [] } = {}) {
  return new Set(buildPurchasingCards({ jobs, budgets, purchase_orders, vendor_orders }).map((c) => c.job.id));
}

export const isSplitLine = (r) => Boolean(r?.purchasing_split_job_id);

// A Purchasing job's own Invoicing lines stay off Invoicing; lines already billed stay as history.
export const isHeldForPurchasing = (r, jobIds) => jobIds.has(r?.job_id) && !isSplitLine(r) && !r?.billed_to_bfs;

// The split's figures, from the job's Purchasing row. Null when the row has no sale, windows
// or labor & material figure yet.
export function splitFigures(jobId, { jobs = [], budgets = [], purchase_orders = [], vendor_orders = [] } = {}) {
  const head = jobMoneyHeadline(jobId, [], { jobs, budgets, purchaseOrders: purchase_orders, vendorOrders: vendor_orders });
  if (!head || head.sale == null || head.cost == null || head.laborMaterial == null) return null;
  const cost = round(head.cost + head.laborMaterial);
  // In cents, so a half cent rounds up the same way every time ($297.03 -> $148.52).
  const profitCents = Math.round(head.sale * 100) - Math.round(cost * 100);
  return { sale: head.sale, cost, fee: Math.round(profitCents * SPLIT_PCT) / 100 };
}

const isOpen = (r) => !r.billed_to_bfs && !r.invoiced_to_ya && !r.paid_to_ya;
const differs = (r, f) => ['sale_price', 'cost', 'fee_amt', 'needs_review'].some((k) => (r[k] ?? null) !== (f[k] ?? null));

// What to create, update and delete so each Paid Purchasing job has exactly one split line.
// Billed lines are never touched. The line is dated the day the job was marked Paid; if that
// month is closed it lands in the current month.
export function planSplitLines(data = {}, feeLines = [], { today = denverDay(Date.now()), closedMonths = [] } = {}) {
  const jobIds = purchasingJobIds(data);
  const jobsById = new Map((data.jobs || []).map((j) => [j.id, j]));
  const splits = feeLines.filter(isSplitLine).sort((a, b) => String(a.created_date || '').localeCompare(String(b.created_date || '')) || String(a.id).localeCompare(String(b.id)));
  const creates = [], updates = [], deletes = [];
  for (const job of data.jobs || []) {
    if (!jobIds.has(job.id) || job.payment_status !== 'paid') continue;
    const f = splitFigures(job.id, data);
    const fields = f ? { sale_price: f.sale, cost: f.cost, fee_amt: f.fee, needs_review: false } : { sale_price: null, cost: null, fee_amt: 0, needs_review: true };
    const mine = splits.filter((r) => r.purchasing_split_job_id === job.id);
    if (!mine.length) {
      let day = job.payment_status_at ? denverDay(job.payment_status_at) : today;
      if (closedMonths.includes(day.slice(0, 7))) day = today;
      const name = String(job.canonical_name || 'Purchasing job').trim();
      creates.push({
        purchasing_split_job_id: job.id, job_id: job.id, job_date: day, invoice_month: day.slice(0, 7),
        job_name_raw: `${name} · 50/50 profit split`, job_name_norm: name.toLowerCase(),
        line_description: 'Purchasing job marked Paid: half of the Est. profit (sale less windows less labor & material).',
        labor_amt: 0, fee_type: 'profit_split', fee_pct: 0, split_pct: SPLIT_PCT, billable: true,
        manually_adjusted: true, source: 'purchasing', written_by: 'app', match_confidence: 'high', ...fields,
      });
      continue;
    }
    const [keep, ...extra] = mine;
    if (isOpen(keep) && differs(keep, fields)) updates.push({ id: keep.id, ...fields });
    for (const r of extra) if (isOpen(r)) deletes.push(r.id);
  }
  for (const r of splits) {
    const job = jobsById.get(r.purchasing_split_job_id);
    if ((!job || job.payment_status !== 'paid' || !jobIds.has(job.id)) && isOpen(r) && !deletes.includes(r.id)) deletes.push(r.id);
  }
  return { creates, updates, deletes, jobIds };
}
