// Shared, read-only purchasing helpers. Job identity is never inferred from names.
import { computeJobBudget, roundMoney } from './jobBudgetMath.js';
export const text = value => String(value ?? '').trim();
export const amount = value => {
  if (value === null || value === undefined || text(value) === '') return null;
  const n = Number(text(value).replace(/[$,\s]/g, ''));
  return Number.isFinite(n) ? roundMoney(n) : null;
};
export const includedBudget = row => !['reference', 'draft'].includes(row?.budget_usage);
export const budgetVersion = row => JSON.stringify([row?.id, row?.job_id, row?.updated_date, row?.budget_usage, row?.replaces_budget_id, row?.quote_number, row?.vendor, row?.manufacturer, row?.inputs, row?.numbers_reviewed_at]);

const ref = value => text(value).toUpperCase();
const vendorKey = value => text(value).toLowerCase().replace(/\b(windows?|doors?|and|llc|inc|the)\b/g, ' ').replace(/[^a-z0-9]/g, '');
export function sameVendor(a, b) {
  const keys = [a?.vendor, a?.manufacturer].map(vendorKey).filter(Boolean);
  return [b?.vendor, b?.manufacturer].map(vendorKey).some(k => k && keys.includes(k));
}
export function budgetForPO(po, budgets = []) {
  if (!text(po?.job_id)) return { budget: null, reason: 'Job not linked' };
  if (text(po?.budget_id)) {
    const b = budgets.find(row => row.id === po.budget_id);
    return b && b.job_id === po.job_id ? { budget: b, explicit: true } : { budget: null, reason: 'Source budget / job conflict' };
  }
  const candidates = budgets.filter(b => b.job_id === po.job_id && ref(b.quote_number) && ref(b.quote_number) === ref(po.vendor_quote_ref) && sameVendor(po, b));
  return candidates.length === 1 ? { budget: candidates[0], explicit: false } : { budget: null, reason: candidates.length > 1 ? 'More than one source quote matches' : 'No source budget linked' };
}
export function prepareBudgetPO(budget) {
  if (!budget?.id || !budget.job_id) throw new Error('Link the quote to an existing job first.');
  const q = budget.quote || {};
  const ownQuote = /gabriel|\bgabe\b|fronk|glass\s*forge/i.test(`${q.quoted_by || ''} ${q.prepared_by || ''}`);
  const supplierTotal = q.price_levels === 'single' && !ownQuote ? amount(q.customer_total) : null;
  return {
    form: { job_id: budget.job_id, budget_id: budget.id, vendor: text(budget.vendor || budget.manufacturer), vendor_quote_ref: text(budget.quote_number), amount_dealer: supplierTotal === null ? '' : String(supplierTotal), amount_customer: '', notes: '', budget_version: budgetVersion(budget) },
    supplier_hint: supplierTotal === null ? 'Enter the supplier payable after reviewing tax, freight and the source quote.' : 'Printed supplier total; verify tax and freight before issuing.',
    budget_sell: amount(budget.inputs?.actual_total_sell),
  };
}
export const poRefs = value => [...new Set(text(value).toUpperCase().match(/\bYA-\d+\b/g) || [])];
export function referenceConflicts(purchaseOrders = [], vendorOrders = [], jobs = []) {
  const refs = new Map();
  const add = (number, row, kind) => {
    if (!refs.has(number)) refs.set(number, []);
    refs.get(number).push({ kind, id: row.id, job_id: row.job_id || (kind === 'job' ? row.id : ''), label: row.po_number || row.title || row.canonical_name || number });
  };
  for (const row of purchaseOrders) for (const p of poRefs(row.po_number)) add(p, row, 'po');
  for (const row of vendorOrders) for (const p of poRefs(row.po_name)) add(p, row, 'supplier');
  for (const row of jobs.filter(j => !j.merged_into && !j.is_sample)) for (const p of (row.po_numbers || []).flatMap(poRefs)) add(p, row, 'job');
  return [...refs].flatMap(([number, rows]) => {
    const ids = [...new Set(rows.map(r => r.job_id).filter(Boolean))];
    return ids.length > 1 || rows.filter(r => r.kind === 'po').length > 1 ? [{ number, rows, job_ids: ids, reason: 'Conflicting PO references: review before linking.' }] : [];
  });
}
export function nextPurchaseOrderNumber(pos = [], orders = [], jobs = [], budgets = [], last = 0) {
  const values = [...pos.map(p => p.po_number), ...orders.map(o => o.po_name), ...jobs.flatMap(j => j.po_numbers || []), ...budgets.map(b => b.quote?.customer_po)];
  const max = values.flatMap(poRefs).reduce((n, p) => Math.max(n, Number(p.slice(3))), Number(last) || 0);
  if (!Number.isSafeInteger(max + 1)) throw new Error('PO sequence requires review.');
  return `YA-${String(max + 1).padStart(4, '0')}`;
}
export function supplierForPO(po, orders = []) {
  const candidates = orders.filter(o => o.purchase_order_id ? o.purchase_order_id === po.id : text(po.job_id) && o.job_id === po.job_id && poRefs(o.po_name).includes(ref(po.po_number)) && sameVendor(po, o));
  const valid = candidates.filter(o => o.job_id === po.job_id);
  return valid.length === 1 ? valid[0] : null;
}

export function budgetFigures(row = {}) {
  const inputs = row.inputs || {};
  const calculated = computeJobBudget(Object.fromEntries(Object.entries(inputs).map(([key, value]) => [key, amount(value)])));
  const material = amount(inputs.material_true_cost), sell = amount(inputs.actual_total_sell);
  const warnings = [];
  const hasCost = ['material_true_cost', 'labor_cost_sub_pay', 'additional_install_material', 'additional_equipment'].some(k => (amount(inputs[k]) ?? 0) > 0);
  if (material === null || material < 0 || ((!hasCost || (material === 0 && row.quote?.material_true_cost == null && row.openings_qty > 0)) && !row.numbers_reviewed_at)) warnings.push('Cost needs review');
  if (sell === null || sell <= 0) warnings.push('Customer sell needs review');
  for (const k of ['labor_cost_sub_pay', 'labor_sell_price', 'additional_install_material', 'additional_equipment']) {
    if (text(inputs[k]) && (amount(inputs[k]) === null || amount(inputs[k]) < 0)) warnings.push(`Check ${k.replaceAll('_', ' ')}`);
  }
  if (row.autofill?.notes?.length && !row.numbers_reviewed_at) warnings.push('Review quote and labor assumptions');
  if (row.budget_usage && !row.numbers_reviewed_at) warnings.push('Numbers not reviewed yet');
  const ready = warnings.length === 0;
  return { cost: ready ? calculated.total_cost_overhead : null, sell, margin_dollars: ready ? roundMoney(sell - calculated.total_cost_overhead) : null, margin_pct: ready ? calculated.actual_margin_pct : null, calculated, warnings, ready };
}

// Preserve source records; exclude reference copies and replaced versions from totals.
export function activeBudgets(rows = []) {
  const included = rows.filter(includedBudget);
  const replaced = new Set(included.filter(r => r.replaces_budget_id && rows.some(old => old.id === r.replaces_budget_id && old.job_id === r.job_id)).map(r => r.replaces_budget_id));
  return included.filter(r => !replaced.has(r.id));
}
export function budgetRollup(rows = []) {
  const active = activeBudgets(rows);
  const warnings = [];
  const items = active.map(row => ({ row, figures: budgetFigures(row) }));
  for (const { row, figures } of items) for (const warning of figures.warnings) warnings.push(`${row.title || row.id}: ${warning}`);
  for (let i = 0; i < active.length; i++) for (let j = i + 1; j < active.length; j++) {
    const a = active[i], b = active[j];
    if (a.job_id === b.job_id && ((a.source_sha256 && a.source_sha256 === b.source_sha256) || (ref(a.quote_number) && ref(a.quote_number) === ref(b.quote_number) && sameVendor(a, b)))) warnings.push(`Possible duplicate scope: ${a.quote_number || a.title}. Keep one version in the budget.`);
  }
  const complete = active.length > 0 && !warnings.length;
  const sum = fn => roundMoney(items.reduce((v, item) => v + (fn(item) || 0), 0));
  const cost = complete ? sum(i => i.figures.cost) : null;
  const sell = complete ? sum(i => i.figures.sell) : null;
  return { version: 1, status: complete ? 'ready' : active.length ? 'needs_review' : 'empty', count: active.length,
    source_budget_ids: active.map(r => r.id), source_versions: active.map(budgetVersion),
    cost, sell, margin_dollars: complete ? roundMoney(sell - cost) : null,
    margin_pct: complete && sell > 0 ? (sell - cost) / sell : null,
    material_estimate: complete ? sum(i => amount(i.row.inputs?.material_true_cost)) : null,
    labor_cost_estimate: complete ? sum(i => amount(i.row.inputs?.labor_cost_sub_pay)) : null,
    labor_sell_estimate: complete ? sum(i => amount(i.row.inputs?.labor_sell_price)) : null,
    warnings: [...new Set(warnings)],
  };
}
export function setupBudgetSource(rows = []) {
  const estimate = budgetRollup(rows);
  if (estimate.status !== 'ready') return { budget: {}, warnings: estimate.warnings };
  const active = activeBudgets(rows);
  const fields = ['material_true_cost', 'labor_cost_sub_pay', 'labor_sell_price', 'additional_install_material', 'additional_equipment', 'actual_total_sell'];
  const inputs = Object.fromEntries(fields.map(key => [key, roundMoney(active.reduce((sum, row) => sum + (amount(row.inputs?.[key]) || 0), 0))]));
  return { budget: { inputs, quote: { lines: active.flatMap(row => row.quote?.lines || []) } }, warnings: [] };
}
export const validMonth = value => /^\d{4}-(0[1-9]|1[0-2])$/.test(text(value));
export function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text(value))) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}
export function estimatePatch(snapshot, by, at) {
  // No actual-cost, revenue, route, fee, invoice or payment fields are written.
  return { budget_snapshot: snapshot, budget_synced_by: by, budget_synced_at: at };
}
