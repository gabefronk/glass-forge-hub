import { INSTALL_CATALOG } from './installCatalog.js';

export { INSTALL_CATALOG };
export const INSTALL_DEFAULTS = Object.freeze({ enabled: false, material: 'vinyl', method: 'standard', selections: {}, extras: [], finance: { tax_rate: 7.45, material_margin: 30, labor_margin: 27, labor_mode: 'rates', overhead_mode: 'workbook', product_cost: null, extra_material: 0, equipment: 0 } });
const object = v => v && typeof v === 'object' && !Array.isArray(v);
const present = v => v !== undefined && v !== null && v !== '';
const numeric = v => present(v) && Number.isFinite(Number(v));
export const roundMoney = n => Math.round((n + Number.EPSILON) * 100) / 100;
const byId = new Map(INSTALL_CATALOG.rates.map(r => [r.id, r]));
const materials = ['vinyl', 'composite', 'wood'];
export function newInstallBudget(enabled = false) { return structuredClone({ ...INSTALL_DEFAULTS, enabled }); }
export function validateInstallBudget(value) {
  if (!object(value)) throw new Error('Install budget must be an object.');
  if (JSON.stringify(value).length > 120000) throw new Error('Install budget is too large.');
  const out = newInstallBudget();
  if (typeof value.enabled !== 'boolean') throw new Error('Choose whether installation is included.');
  out.enabled = value.enabled;
  if (value.material !== undefined && !materials.includes(value.material)) throw new Error('Choose vinyl, composite/fiberglass, or wood/aluminum.');
  out.material = value.material || out.material;
  const cleanSelection = s => {
    if (!object(s)) throw new Error('Invalid install selection.');
    const clean = {};
    if (s.enabled !== undefined) { if (typeof s.enabled !== 'boolean') throw new Error('Invalid install selection.'); clean.enabled = s.enabled; }
    if (s.material !== undefined && s.material !== '') { if (!materials.includes(s.material)) throw new Error('Invalid install material.'); clean.material = s.material; }
    for (const key of ['method', 'rate_id']) if (present(s[key])) {
      if (typeof s[key] !== 'string' || key === 'method' && s[key] !== 'standard' && byId.get(s[key])?.category !== 'method' || key === 'rate_id' && byId.get(s[key])?.category !== 'base') throw new Error('Choose a listed install rate.');
      clean[key] = s[key];
    }
    if (present(s.billing_qty)) { if (!Number.isInteger(Number(s.billing_qty)) || Number(s.billing_qty) < 1 || Number(s.billing_qty) > 1000) throw new Error('Confirm a whole install billing quantity from 1 to 1000.'); clean.billing_qty = Number(s.billing_qty); }
    if (s.adders !== undefined) {
      if (!Array.isArray(s.adders) || s.adders.length > 30 || new Set(s.adders).size !== s.adders.length || s.adders.some(id => byId.get(id)?.category !== 'adder')) throw new Error('Invalid or duplicate install adders.');
      clean.adders = [...s.adders];
    }
    return clean;
  };
  out.method = cleanSelection({ method: value.method || 'standard' }).method;
  if (value.selections !== undefined) {
    if (!object(value.selections) || Object.keys(value.selections).length > 300) throw new Error('Invalid per-unit install selections.');
    out.selections = Object.fromEntries(Object.entries(value.selections).map(([id, selection]) => {
      if (!/^[a-zA-Z0-9_-]{1,160}$/.test(id)) throw new Error('Invalid install line ID.');
      return [id, cleanSelection(selection)];
    }));
  }
  if (value.extras !== undefined) {
    if (!Array.isArray(value.extras) || value.extras.length > 100) throw new Error('Use at most 100 additional install charges.');
    out.extras = value.extras.map(e => {
      if (!object(e) || !byId.has(e.rate_id) || !Number.isInteger(Number(e.qty)) || Number(e.qty) < 1 || Number(e.qty) > 1000) throw new Error('Additional charges need a listed rate and whole quantity from 1 to 1000.');
      return { rate_id: e.rate_id, qty: Number(e.qty) };
    });
  }
  const f = value.finance || {};
  if (!object(f)) throw new Error('Invalid material budget.');
  for (const key of ['tax_rate', 'material_margin', 'labor_margin', 'product_cost', 'extra_material', 'equipment']) {
    if (!Object.hasOwn(f, key)) continue;
    if (!present(f[key]) && key === 'product_cost') { out.finance[key] = null; continue; }
    if (!numeric(f[key]) || Number(f[key]) < 0 || Number(f[key]) > (key === 'tax_rate' ? 100 : key.endsWith('margin') ? 99.99 : 1000000000)) throw new Error('Enter a valid nonnegative ' + key.replaceAll('_', ' ') + '.');
    out.finance[key] = Number(f[key]);
  }
  if (present(f.labor_mode) && !['rates', 'margin'].includes(f.labor_mode)) throw new Error('Invalid labor sale basis.');
  if (present(f.overhead_mode) && !['workbook', 'once'].includes(f.overhead_mode)) throw new Error('Invalid overhead basis.');
  out.finance.labor_mode = f.labor_mode || 'rates';
  out.finance.overhead_mode = f.overhead_mode || 'workbook';
  return out;
}
export function installLineKey(line, index) { return /^[a-zA-Z0-9_-]{1,160}$/.test(line?.id || '') ? line.id : `line-${index + 1}`; }
export function automaticBaseRate(material, sqft) {
  if (!Number.isFinite(sqft) || sqft <= 0) return null;
  // Continuous square-foot bands: compare the unrounded measured area.
  if (material === 'wood') return sqft < 1 || sqft >= 90 ? null : byId.get('wood-left-' + (sqft < 20 ? 11 : sqft < 40 ? 12 : sqft < 60 ? 13 : sqft < 80 ? 14 : 15));
  if (!['vinyl', 'composite'].includes(material)) return null;
  return byId.get(`vf-${material}-` + (sqft < 30 ? 13 : sqft < 48 ? 14 : sqft <= 60 ? 15 : 16));
}
export function compatibleInstallRate(rate, material, kind) {
  return !!rate && (rate.material === material || rate.material === 'vinyl_composite' && ['vinyl', 'composite'].includes(material)) && rate.kind === kind;
}
export function installOptions(material, kind, category) { return INSTALL_CATALOG.rates.filter(r => r.category === category && compatibleInstallRate(r, material, kind)); }
export function resolveInstallSelection(line, index, config) {
  const key = installLineKey(line, index), selection = config.selections?.[key] || {};
  const material = selection.material || line.material || config.material || 'vinyl';
  return { ...selection, key, material, enabled: selection.enabled !== false, method: selection.method || config.method || 'standard', rate_id: selection.rate_id || line.rate_id || '', adders: selection.adders || [] };
}
/** @param {any[]} [lines] @param {Record<string, any>} [raw] @param {Record<string, any>} [context] */
export function calculateInstall(lines = [], raw = INSTALL_DEFAULTS, context = {}) {
  let config;
  try { config = validateInstallBudget(raw); } catch (error) { return { enabled: raw?.enabled === true, complete: false, issues: [error.message], lines: [], cost: null, sell: null, version: INSTALL_CATALOG.version }; }
  const out = { enabled: config.enabled, complete: true, issues: [], lines: [], extras: [], quantity: 0, cost: 0, sell: 0, rate_sell: 0, version: INSTALL_CATALOG.version };
  if (!config.enabled) return out;
  if (!Array.isArray(lines) || !lines.length) out.issues.push('Add at least one opening to calculate installation.');
  const ids = new Set();
  for (const [index, line] of lines.entries()) {
    const s = resolveInstallSelection(line, index, config);
    if (ids.has(s.key)) { out.issues.push('Window IDs must be unique for installation.'); continue; } ids.add(s.key);
    if (!s.enabled) { out.lines.push({ key: s.key, included: false }); continue; }
    const label = line.mark || line.label || `Opening ${index + 1}`;
    const issues = [], qty = Number(s.billing_qty ?? line.qty), width = Number(line.width), height = Number(line.height);
    let sqft = width * height / 144;
    if (line.units === 'ft') sqft = width * height;
    else if (line.units && line.units !== 'in') issues.push(`${label}: unsupported measurement unit.`);
    const explicit = s.rate_id ? byId.get(s.rate_id) : null;
    if (context.linked && explicit?.unit === 'panel' && !s.billing_qty) issues.push(`${label}: confirm the total panel quantity to install.`);
    const door = explicit?.kind === 'door' || /door|bifold|multislide|pivot|lfg/i.test(line.style || line.label || '');
    const kind = door ? 'door' : 'window';
    if (!Number.isInteger(qty) || qty < 1 || qty > 1000) issues.push(`${label}: enter a whole quantity from 1 to 1000.`);
    // Only known AMSCO windows are inferred in linked quotes. Other products need an explicit material selection.
    if (context.linked && !s.material) issues.push(`${label}: select its installation material.`);
    if (context.linked && !s.rate_id && !config.selections?.[s.key]?.material && !/^Studio\b|^AMSCO\b/i.test(line.style || '')) issues.push(`${label}: confirm the installation material for this product.`);
    if (!explicit && (!Number.isFinite(sqft) || width <= 0 || height <= 0)) issues.push(`${label}: enter width and height.`);
    if (door && !explicit) issues.push(`${label}: choose a door rate and confirm whether quantity counts panels or systems.`);
    const base = explicit || (!door ? automaticBaseRate(s.material, sqft) : null);
    if (!base) issues.push(`${label}: no listed base rate for this opening; choose a listed rate or price separately.`);
    if (base && !compatibleInstallRate(base, s.material, kind)) issues.push(`${label}: the base rate does not match its material.`);
    const charges = base ? [base] : [];
    if (s.method !== 'standard') {
      const method = byId.get(s.method);
      if (!compatibleInstallRate(method, s.material, kind)) issues.push(`${label}: choose an install method for this material and opening type.`);
      else charges.push(method);
    }
    // AMSCO dark exterior requires extra screws. The automatic line is never counted again if also selected manually.
    const color = String(line.options?.color || line.color || context.settings?.color || '');
    const exterior = color.split(/\s*\/\s*/)[0];
    const amsco = /^Studio\b|AMSCO/i.test(line.style || '') || /amsco/i.test(line.manufacturer || context.manufacturer || '');
    const autoId = amsco && s.material === 'vinyl' && /black|bronze/i.test(exterior) ? `vf-${kind}-adder-26` : null;
    const adders = [...new Set([...s.adders, ...(autoId ? [autoId] : [])])];
    for (const id of adders) {
      const rate = byId.get(id);
      if (!compatibleInstallRate(rate, s.material, kind)) issues.push(`${label}: ${rate?.label || 'adder'} does not match this opening.`);
      else charges.push(rate);
    }
    const costEach = charges.reduce((sum, r) => sum + r.cost, 0), rateSellEach = charges.reduce((sum, r) => sum + r.sell, 0);
    const sellEach = config.finance.labor_mode === 'margin' ? costEach / (1 - config.finance.labor_margin / 100) : rateSellEach;
    out.lines.push({ key: s.key, label, included: true, kind, material: s.material, qty, sqft: Number.isFinite(sqft) ? sqft : null, unit: base?.unit, charges, auto_adder: autoId, issues, cost_each: roundMoney(costEach), sell_each: roundMoney(sellEach), cost: roundMoney(costEach * qty), sell: roundMoney(sellEach * qty) });
    out.issues.push(...issues);
    if (!issues.length) { out.quantity += qty; out.cost += roundMoney(costEach * qty); out.sell += roundMoney(sellEach * qty); out.rate_sell += roundMoney(rateSellEach * qty); }
  }
  for (const extra of config.extras) {
    const rate = byId.get(extra.rate_id), cost = roundMoney(rate.cost * extra.qty), sale = config.finance.labor_mode === 'margin' ? cost / (1 - config.finance.labor_margin / 100) : rate.sell * extra.qty;
    out.extras.push({ ...extra, label: rate.label, unit: rate.unit, cost, sell: roundMoney(sale), source: rate.source });
    out.cost += cost; out.sell += roundMoney(sale); out.rate_sell += rate.sell * extra.qty;
  }
  out.complete = !out.issues.length;
  if (!out.complete) { out.cost = null; out.sell = null; out.rate_sell = null; return out; }
  out.cost = roundMoney(out.cost); out.sell = roundMoney(out.sell); out.rate_sell = roundMoney(out.rate_sell);
  out.margin = out.sell ? (out.sell - out.cost) / out.sell : null;
  const f = config.finance;
  const productCost = f.product_cost ?? (numeric(context.product_cost) ? Number(context.product_cost) : null);
  const productSell = numeric(context.product_sell) ? Number(context.product_sell) : null;
  const extraCost = f.extra_material + f.equipment;
  const extraSell = roundMoney(extraCost * (1 + f.tax_rate / 100) / (1 - f.material_margin / 100));
  out.product_sell = productSell;
  out.extra_sell = extraSell;
  out.customer_total = productSell === null ? null : roundMoney(productSell + out.sell + extraSell);
  if (productCost !== null) {
    // WINDOW BUDGET C16, C17, C20, C21 and C27, preserving the original overhead allocation.
    const overheadUnits = out.cost / 0.74 - out.cost;
    const materialOverhead = overheadUnits * 0.2;
    const secondOverhead = f.overhead_mode === 'workbook' ? overheadUnits * 0.2 : 0;
    const useTax = (productCost + extraCost) * f.tax_rate / 100;
    const materialCost = productCost + materialOverhead + extraCost + useTax;
    const materialSell = materialCost / (1 - f.material_margin / 100);
    const totalCost = materialCost + out.cost + secondOverhead;
    const targetSale = materialSell + out.sell;
    const actualSale = out.customer_total ?? targetSale;
    out.budget = { product_cost: productCost, overhead_units: overheadUnits, material_overhead: roundMoney(materialOverhead), second_overhead: roundMoney(secondOverhead), use_tax: roundMoney(useTax), material_cost: roundMoney(materialCost), material_target_sell: roundMoney(materialSell), total_cost: roundMoney(totalCost), target_sale: roundMoney(targetSale), quoted_sale: roundMoney(actualSale), profit: roundMoney(actualSale - totalCost), margin: actualSale ? (actualSale - totalCost) / actualSale : null };
  }
  return out;
}
export function quoteInstallSummary(quote) {
  if (quote?.sales_status === 'won' && quote.accepted_snapshot?.install_summary) return quote.accepted_snapshot.install_summary;
  const totals = quote?.result?.totals || {};
  return calculateInstall(quote?.lines || [], quote?.install_budget || INSTALL_DEFAULTS, { linked: true, settings: quote?.settings, product_cost: totals.dealer_total ?? totals.dealer_cost, product_sell: quote?.worker_status === 'ready' && quote?.result?.verified === true ? totals.total ?? totals.customer_total : null });
}
