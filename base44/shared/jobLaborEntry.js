// Quick labor entry for a job: the install price charged to the builder and what the crew
// actually cost, typed straight in — no vendor quote, no workbook. Pure helpers shared by the
// jobBudgetIngest function (set_labor / job_costs actions) and the job page card. The numbers
// land on the job's JobCostInputs row, which the Invoicing profitability panel and the Job
// Setup sheet already read.

const NOTE_CAP = 500;

const money = (v) => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(String(v).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : NaN;
};
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const round4 = (n) => Math.round((Number(n) + Number.EPSILON) * 10000) / 10000;

// { ok, errors: [field...], values: { installation_revenue, actual_labor_cost, notes, month } }
// A blank number means "leave it as it is"; at least one number must be given.
export function validateLaborEntry(body = {}, { today = new Date().toISOString().slice(0, 10) } = {}) {
  const errors = [];
  const sell = money(body.installation_revenue);
  const cost = money(body.actual_labor_cost);
  if (Number.isNaN(sell) || (sell !== null && sell < 0)) errors.push('installation_revenue');
  if (Number.isNaN(cost) || (cost !== null && cost < 0)) errors.push('actual_labor_cost');
  if (sell === null && cost === null && !errors.length) errors.push('installation_revenue');
  const monthRaw = String(body.month || '').trim();
  const month = monthRaw || String(today).slice(0, 7);
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) errors.push('month');
  const notes = String(body.notes ?? '').replace(/\s+/g, ' ').trim().slice(0, NOTE_CAP);
  return { ok: errors.length === 0, errors, values: { installation_revenue: Number.isNaN(sell) ? null : sell, actual_labor_cost: Number.isNaN(cost) ? null : cost, notes, month } };
}

export function laborMargin(sell, cost) {
  const s = money(sell), c = money(cost);
  if (s === null || c === null || Number.isNaN(s) || Number.isNaN(c) || s === 0) return { profit: null, margin_pct: null };
  const profit = round2(s - c);
  return { profit, margin_pct: round4(profit / s) };
}

// Patch for JobCostInputs. A new row carries the identity fields; an existing row only gets
// the numbers that were typed (blank = untouched) so a manager's quick entry never wipes what
// the owner set elsewhere (route, product cost, overhead).
export function buildCostInputPatch(existing, values, { jobId, jobNameNorm }) {
  const patch = {};
  if (values.installation_revenue !== null && values.installation_revenue !== undefined) patch.installation_revenue = values.installation_revenue;
  if (values.actual_labor_cost !== null && values.actual_labor_cost !== undefined) patch.actual_labor_cost = values.actual_labor_cost;
  if (values.notes) patch.notes = values.notes;
  if (existing) return patch;
  return { month: values.month, job_id: jobId, job_name_norm: jobNameNorm, route: 'bfs_installed_sale', material_source: 'manual', ...patch };
}

// What the job page card shows: labor (quick entry) and the newest vendor-quote budget.
export function summarizeJobCosts({ costInput, budget }) {
  let labor = null;
  if (costInput && (costInput.installation_revenue != null || costInput.actual_labor_cost != null)) {
    const sell = money(costInput.installation_revenue), cost = money(costInput.actual_labor_cost);
    labor = { installation_revenue: Number.isNaN(sell) ? null : sell, actual_labor_cost: Number.isNaN(cost) ? null : cost, ...laborMargin(sell, cost), notes: String(costInput.notes || ''), month: costInput.month || '', updated_at: costInput.updated_date || costInput.created_date || '' };
  }
  let b = null;
  if (budget) {
    const inputs = budget.inputs || {}, computed = budget.computed || {};
    b = { id: budget.id, status: budget.status || '', vendor: budget.vendor || '', quote_number: budget.quote_number || '', file_name: budget.source_pdf_name || '', material_cost: money(inputs.material_true_cost), material_cost_with_tax: money(computed.cost_material_tax), material_sell: money(computed.sell_material_tax), margin_pct: computed.actual_margin_pct ?? null, created_at: budget.created_date || '' };
    for (const k of ['material_cost', 'material_cost_with_tax', 'material_sell']) if (Number.isNaN(b[k])) b[k] = null;
  }
  return { labor, budget: b };
}
