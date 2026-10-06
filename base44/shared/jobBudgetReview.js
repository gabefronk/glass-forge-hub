// Job Budgets review step: what happens to a budget row after the PDF drop. Two owner /
// manager moves, both pure here and wired in jobBudgetIngest (set_inputs, link_job):
//   - type the yellow-cell numbers (material cost, labor cost, labor sell, total sell) when
//     the vendor PDF did not carry them (Andersen quotes never print dealer cost) or Gabe
//     wants to correct them; the Hub recomputes the workbook math and rewrites the sheet.
//   - link the row to a Hub job (pick one, or create the job from the quote), which refiles
//     the Drive folder under Glass Forge Jobs/<Builder>/<Job> and feeds JobCostInputs.

const money = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
};
const clean = (v) => String(v ?? '').replace(/\s+/g, ' ').trim();

export const INPUT_FIELDS = ['material_true_cost', 'labor_cost_sub_pay', 'labor_sell_price', 'additional_install_material', 'additional_equipment', 'actual_total_sell'];

// { ok, errors: [field...], values }. Material cost and total sell are required (0 material
// is fine for pure-labor work; total sell must be > 0 or there is no margin to compute);
// everything else blank means 0. Negatives and non-numbers fail by field name.
export function validateBudgetInputs(raw = {}) {
  const errors = [];
  const values = {};
  for (const k of INPUT_FIELDS) {
    const n = money(raw[k]);
    if (Number.isNaN(n) || (n !== null && n < 0)) { errors.push(k); values[k] = 0; continue; }
    values[k] = n === null ? 0 : n;
  }
  if (!errors.includes('material_true_cost') && money(raw.material_true_cost) === null) errors.push('material_true_cost');
  if (!errors.includes('actual_total_sell') && !(values.actual_total_sell > 0)) errors.push('actual_total_sell');
  errors.sort((a, b) => INPUT_FIELDS.indexOf(a) - INPUT_FIELDS.indexOf(b));
  return { ok: errors.length === 0, errors, values };
}

// JobCostInputs patch for the job's month. A new row carries identity; an existing row only
// gets the numbers so nothing set elsewhere (route, overhead, notes) is disturbed. Labor
// numbers are written only when non-zero — a blank labor line must not erase a quick entry.
export function reviewCostInputPatch(existing, values, { jobId, jobNameNorm, month, quoteNumber }) {
  const patch = {};
  if (quoteNumber) patch.quote_number = quoteNumber;
  patch.product_cost = values.material_true_cost;
  patch.product_sell = values.actual_total_sell;
  if (values.labor_cost_sub_pay > 0) patch.actual_labor_cost = values.labor_cost_sub_pay;
  if (values.labor_sell_price > 0) patch.installation_revenue = values.labor_sell_price;
  if (existing) return patch;
  return { month, job_id: jobId, job_name_norm: jobNameNorm, material_source: 'manual', ...patch };
}

// A job can carry several budgets (base quote + add-on quote). The job's cost-input row is
// the sum of all of them, with `current` (the row being saved) standing in for its stored copy.
export function sumBudgetInputs(rows = [], current = null) {
  const totals = { material_true_cost: 0, labor_cost_sub_pay: 0, labor_sell_price: 0, additional_install_material: 0, additional_equipment: 0, actual_total_sell: 0 };
  const quotes = [];
  const seen = new Set();
  const all = current ? [current, ...rows.filter((r) => r.id !== current.id)] : rows;
  for (const r of all) {
    if (!r || seen.has(r.id)) continue;
    seen.add(r.id);
    const i = r.inputs || {};
    for (const k of Object.keys(totals)) totals[k] += Number(i[k]) || 0;
    if (r.quote_number && !quotes.includes(String(r.quote_number))) quotes.push(String(r.quote_number));
  }
  for (const k of Object.keys(totals)) totals[k] = Math.round(totals[k] * 100) / 100;
  return { values: totals, quote_number: quotes.join(', '), count: seen.size };
}

// Jobs.create payload from a budget row plus what the owner typed in the "new job" form.
export function newJobFromBudget(budget = {}, over = {}) {
  const name = clean(over.name ?? budget.job_name ?? budget.quote_name);
  if (!name) throw new Error('A job name is required.');
  const builder = clean(over.builder ?? budget.builder);
  const address = clean(over.address ?? budget.quote?.lot_or_address);
  return {
    canonical_name: name,
    ...(builder ? { builder } : {}),
    ...(address ? { address } : {}),
    aliases: [], po_numbers: [], oe_numbers: [],
  };
}

// JobBudgets patch once a job is chosen and the Drive folder has moved.
export function linkedBudgetPatch(job, byEmail, folder) {
  const jobName = job.canonical_name || job.name || '';
  return {
    job_id: job.id, job_name: jobName, builder: job.builder || undefined, status: 'filed',
    job_match: { status: 'matched', job_id: job.id, job_name: jobName, reason: `chosen on Job Budgets by ${byEmail}`, candidates: [] },
    drive_job_folder_id: folder.id, drive_job_folder_path: folder.path,
  };
}

// Header cells for fillBudgetXlsx: the job (when linked) wins over what the PDF said.
export function sheetValuesFor(budget = {}, job, dateIso) {
  const out = {
    sales_rep: budget.quoted_by || '',
    date_iso: dateIso,
    builder: (job && job.builder) || budget.builder || '',
    manufacturer: budget.manufacturer || budget.vendor || '',
    openings_qty: budget.openings_qty || null,
  };
  const address = clean((job && job.address) || budget.quote?.lot_or_address);
  if (address) out.address = address;
  return out;
}
