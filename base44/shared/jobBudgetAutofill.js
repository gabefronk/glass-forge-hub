// Job Budgets autofill: turn an extracted vendor quote into the Window Budget Sheet's
// yellow cells so Gabe only fixes what the PDF can't tell us. Pure, no I/O; shared by
// jobBudgetIngest (drop + refill) and the Numbers editor (to show where each number came from).
//
//   material_true_cost  dealer cost printed on the quote, else the quote's pre-tax subtotal
//                       when the quote is a vendor's price to us (BTB / YA / WTS / BFS order).
//                       A quote Gabe prepared for his customer carries no cost -> left blank.
//   labor_cost_sub_pay  2026 BFS Window Master Install Price Sheet sub-pay by opening size and
//   labor_sell_price    material (installCatalog.js); glass-only panes use the glass rate
//                       (default $125 sub pay a pane, sold at the sheet's 27% labor margin);
//                       the $275 trip minimum applies to the labor sell.
//   actual_total_sell   customer total when the quote prints one (AMSCO dealer pricing, or
//                       Gabe's own quote); otherwise the sheet target: material @30% + labor.

import { INSTALL_CATALOG, INSTALL_TRIP_MINIMUM, automaticBaseRate } from './installBudget.js';
import { computeJobBudget, roundMoney, BUDGET_DEFAULTS } from './jobBudgetMath.js';

export const GLASS_LABOR_COST_EACH = 125; // Agren glass replacement, Oct 2026
const rateById = new Map(INSTALL_CATALOG.rates.map((r) => [r.id, r]));
const n = (v) => { const x = Number(String(v ?? '').replace(/[$,\s]/g, '')); return Number.isFinite(x) ? x : null; };
const pos = (v) => { const x = n(v); return x !== null && x > 0 ? x : null; };
const money = (v) => '$' + Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// Names a quote prints when it isn't telling us the job.
const GENERIC_NAME = /^(cash\s*(customer|cust\.?|sale)?|none|n\/?a|quote|unknown|tbd|-+)$/i;
export const isGenericName = (s) => !String(s || '').trim() || GENERIC_NAME.test(String(s).trim());

// Gabe names quote files "JOB - SCOPE - BRAND.pdf", e.g.
// "SANDY EAGLE MTN - GLASSS REPLACEMENT - AMSCO.pdf", "AMMON CABIN - BLACK WHITE - ANDERSEN 100 (MULL KITS).pdf".
export function fileNameHints(fileName) {
  const base = String(fileName || '').replace(/\.pdf$/i, '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim();
  if (!base) return { job_name: null, scope: '', brand: '', glass_only: false };
  const parts = base.split(/\s+-\s+/).map((s) => s.trim()).filter(Boolean);
  // A bare system file name (oeepa-rcr1260716180602) says nothing about the job.
  const looksSystem = parts.length === 1 && /\d{6,}/.test(base);
  const scope = parts.slice(1).join(' - ');
  return {
    job_name: looksSystem ? null : parts[0],
    scope,
    brand: parts.length > 2 ? parts[parts.length - 1] : '',
    glass_only: /glas+\s*(replace|only|swap)|reglaz|\bIGU\b|glass\s*unit/i.test(scope),
  };
}

// Install-rate material from the brand/product words.
export function installMaterialFor(quote = {}, hints = {}) {
  const hay = [quote.manufacturer, quote.vendor, hints.brand, hints.scope, ...(quote.lines || []).map((l) => l?.description)].filter(Boolean).join(' ');
  if (/andersen\s*100|fibrex|fiberglass|composite|milgard\s*(ultra|trinsic)|impervia|elevate|essential|infinity/i.test(hay)) return 'composite';
  if (/amsco|vinyl|milgard|western\s*window|simonton|ply\s*gem|tuscany|studio\b|windor|cascade/i.test(hay)) return 'vinyl';
  if (/\bwood\b|clad|paradigm|\bwts\b|marvin|pella|loewen|sierra\s*pacific|kolbe|andersen\s*(400|e-?series|a-?series)/i.test(hay)) return 'wood';
  return 'vinyl';
}

export function lineKind(line = {}, hints = {}) {
  const k = String(line.kind || '').toLowerCase();
  const d = String(line.description || '');
  if (/glass\s*only|\bIGU\b|insulated\s*glass\s*unit|replacement\s*glass|sash\s*glass/i.test(d) || k === 'glass') return 'glass';
  if (k === 'door' || /\bdoor|slider|patio|bifold|multi-?slide|french/i.test(d)) return 'door';
  if (k === 'part' || k === 'other' || /screen|mull\s*kit|grille|hardware|trim|freight|donation|labor|fee|kit\b/i.test(d)) return 'part';
  if (k === 'window' || /window|casement|single\s*hung|double\s*hung|picture|awning|slider|hung/i.test(d)) return 'window';
  if (hints.glass_only) return 'glass';
  return (pos(line.width_in) && pos(line.height_in)) ? 'window' : 'part';
}

function doorRate(material, line) {
  const d = String(line.description || '');
  const h = n(line.height_in) || 0;
  if (material === 'wood') return rateById.get(/\b(single|1)\s*-?\s*panel|swing|entry/i.test(d) ? 'wood-left-18' : 'wood-left-19');
  const id = /\b(3|4|three|four)\s*-?\s*panel/i.test(d) ? 20 : h >= 90 ? 19 : 18;
  return rateById.get(`vf-${material === 'composite' ? 'composite' : 'vinyl'}-${id}`);
}

// Labor from the install price sheet. Returns { cost, sell, priced, unpriced, lines, trip_minimum }.
export function laborFromLines(lines = [], { material = 'vinyl', glassEach = GLASS_LABOR_COST_EACH, hints = {}, openings = null } = {}) {
  const labMargin = BUDGET_DEFAULTS.labor_margin;
  const out = { cost: 0, sell: 0, priced: 0, unpriced: [], lines: [] };
  let list = Array.isArray(lines) ? lines.filter(Boolean) : [];
  // No line detail: a glass-only file with a unit count is still priceable.
  if (!list.length && hints.glass_only && pos(openings)) list = [{ qty: openings, kind: 'glass', description: 'Glass only' }];
  for (const [i, line] of list.entries()) {
    const qty = Math.max(1, Math.round(pos(line.qty) || 1));
    const kind = lineKind(line, hints);
    const label = line.mark || line.description?.slice(0, 40) || `Line ${i + 1}`;
    if (kind === 'part') continue;
    let cost = null, sell = null, rate = null;
    if (kind === 'glass') {
      cost = glassEach; sell = glassEach / (1 - labMargin);
    } else if (kind === 'window') {
      const w = pos(line.width_in), h = pos(line.height_in);
      rate = w && h ? automaticBaseRate(material, (w * h) / 144) : null;
      if (rate) { cost = rate.cost; sell = rate.sell; }
    } else if (kind === 'door') {
      rate = doorRate(material, line);
      if (rate) { cost = rate.cost; sell = rate.sell; }
    }
    if (cost === null) { out.unpriced.push(label); continue; }
    out.priced += qty;
    out.cost += cost * qty; out.sell += sell * qty;
    out.lines.push({ label, kind, qty, rate_id: rate?.id || (kind === 'glass' ? 'glass-only' : null), rate_label: rate?.label || (kind === 'glass' ? 'Glass only' : ''), cost_each: roundMoney(cost), sell_each: roundMoney(sell) });
  }
  out.cost = roundMoney(out.cost); out.sell = roundMoney(out.sell);
  if (out.sell > 0 && out.sell < INSTALL_TRIP_MINIMUM) { out.trip_minimum = INSTALL_TRIP_MINIMUM; out.sell = INSTALL_TRIP_MINIMUM; }
  return out;
}

export const isOurQuote = (q = {}) => /gabriel|\bgabe\b|fronk|glass\s*forge/i.test(String(q.quoted_by || '') + ' ' + String(q.prepared_by || ''));

// The budget inputs plus where each came from.
// Returns { inputs, sources: {field: text}, notes: [text], hints, install_material, labor }.
export function autofillBudget(quote = {}, { fileName = '', glassEach = GLASS_LABOR_COST_EACH } = {}) {
  const hints = fileNameHints(fileName);
  const sources = {};
  const notes = [];
  const ours = isOurQuote(quote);

  // Material (C15).
  // Gabe's own quote prints his sell, never his cost, unless it shows two price levels.
  let material = pos(quote.dealer_subtotal) ?? (ours && quote.price_levels !== 'dealer_and_customer' ? null : pos(quote.material_true_cost));
  if (material !== null) sources.material_true_cost = 'Dealer cost on the quote';
  else if (!ours) {
    const sub = pos(quote.customer_sub_total) ?? pos(quote.net_total)
      ?? (pos(quote.actual_total_sell) !== null ? roundMoney(pos(quote.actual_total_sell) - (n(quote.customer_tax) || 0)) : null);
    if (sub !== null) { material = sub; sources.material_true_cost = 'Quote subtotal before tax (the vendor\'s price to you)'; }
  }
  if (material === null) notes.push(ours ? 'This is your quote to the customer, so it has no dealer cost — type the material cost.' : 'No cost found on the quote — type the material cost.');

  // Labor (C24 / C25).
  const install_material = installMaterialFor(quote, hints);
  const labor = laborFromLines(quote.lines || [], { material: install_material, glassEach, hints, openings: quote.openings_qty });
  if (labor.priced) {
    const kinds = [...new Set(labor.lines.map((l) => l.kind))];
    const what = kinds.length === 1 && kinds[0] === 'glass' ? `glass only, ${money(glassEach)} sub pay a pane at the sheet's 27% labor margin` : `${install_material} rates from the 2026 install price sheet`;
    sources.labor_cost_sub_pay = `${labor.priced} unit${labor.priced === 1 ? '' : 's'}, ${what}`;
    sources.labor_sell_price = labor.trip_minimum ? `Trip minimum ${money(labor.trip_minimum)}` : sources.labor_cost_sub_pay;
    if (labor.unpriced.length) notes.push(`Labor leaves out ${labor.unpriced.length} line${labor.unpriced.length === 1 ? '' : 's'} with no listed rate (${labor.unpriced.slice(0, 3).join('; ')}) — add them.`);
    if (install_material !== 'vinyl' || !/amsco|vinyl|milgard|western|studio/i.test([quote.manufacturer, hints.brand].join(' '))) {
      if (!kinds.every((k) => k === 'glass')) notes.push(`Install rates assume ${install_material}; change the labor if that's wrong.`);
    }
    if (labor.lines.some((l) => l.kind === 'door')) notes.push('Door labor uses the 2-panel system rate — check panel count.');
  } else {
    notes.push('No sized openings on the quote to price labor — type labor cost and sell.');
  }

  // Total sell (B28).
  const printedTotal = pos(quote.customer_total) ?? pos(quote.actual_total_sell);
  // Two price levels (AMSCO "Dealer Total Pricing"): a dealer cost AND a customer total well
  // above it. A cost + tax pair is not two levels.
  const dealerCost = pos(quote.dealer_subtotal) ?? pos(quote.material_true_cost);
  const twoLevels = quote.price_levels === 'dealer_and_customer'
    || (quote.price_levels !== 'single' && dealerCost !== null && printedTotal !== null && printedTotal > dealerCost * 1.1);
  let sell = null;
  if (ours && printedTotal !== null) { sell = printedTotal; sources.actual_total_sell = 'Your quote total to the customer'; }
  else if (twoLevels && printedTotal !== null) { sell = printedTotal; sources.actual_total_sell = 'Customer total printed on the quote'; }
  const inputs = {
    material_true_cost: material ?? 0,
    labor_cost_sub_pay: labor.priced ? labor.cost : 0,
    labor_sell_price: labor.priced ? labor.sell : 0,
    additional_install_material: 0,
    additional_equipment: 0,
    actual_total_sell: 0,
  };
  if (sell === null && material !== null) {
    sell = computeJobBudget(inputs).suggested_total_sell;
    sources.actual_total_sell = 'Sheet target: material @30% margin + labor sell';
  }
  inputs.actual_total_sell = sell ?? 0;
  return { inputs, sources, notes, hints, install_material, labor, filled: Object.keys(sources) };
}

// The quote/job name to show: the quote's own name unless it's generic, else the file name's job part.
export function budgetNameFor(quote = {}, hints = {}) {
  for (const v of [quote.quote_name, quote.project_name]) if (!isGenericName(v)) return String(v).trim();
  return hints.job_name || quote.quote_name || quote.project_name || null;
}
