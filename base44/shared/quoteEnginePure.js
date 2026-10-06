// Pure pricing + validation logic for the GF Quoting Engine.
// Extracted from quoteEngine/entry.ts so it can be unit-tested with node:test
// without the Base44 SDK or any database access. No side effects, no I/O.

export function rnd01(x) { return Math.ceil(Number((x * 10).toFixed(6))) / 10; }
export function frameArea(tw, th) { return Math.ceil(tw * th / 144); }

export function ceilCell(gridRows, code, w, h) {
  const cells = gridRows.filter(r => r.price_code === code);
  if (!cells.length) return { cw: null, ch: null, base: null };
  const ws = [...new Set(cells.map(c => c.max_width))].sort((a, b) => a - b);
  const hs = [...new Set(cells.map(c => c.max_height))].sort((a, b) => a - b);
  const cw = ws.find(x => x >= w - 1e-9) ?? null;
  const ch = hs.find(x => x >= h - 1e-9) ?? null;
  if (cw === null || ch === null) return { cw, ch, base: null };
  const hit = cells.find(c => Math.abs(c.max_width - cw) < 1e-9 && Math.abs(c.max_height - ch) < 1e-9);
  return { cw, ch, base: hit ? hit.base_price : null };
}

export function priceAmsco(line, gridRows, adders, tiers, seriesRows) {
  const series = seriesRows.find(s => s.vendor === 'AMSCO' && s.series_name === line.product);
  if (!series) return { error: 'unknown AMSCO product', product: line.product };
  const code = series.price_code;
  const { cw, ch, base } = ceilCell(gridRows, code, line.width, line.height);
  if (base === null) return { error: 'over-grid', grid_code: code, cell: [cw, ch] };
  const cf = (series.color_factors && series.color_factors[line.ext_color]) ?? 1.0;
  let listp = rnd01(base * cf);
  const fa = frameArea(cw, ch);
  const applied = {};
  const add = (key, rate, unit) => { if (!rate) return; applied[key] = unit === 'sf' ? rnd01(fa * rate) : rate; };
  // Patio doors: tempered glass is standard and priced into the grid base ($0 adder).
  if (line.tempered && series.product_type !== 'patio-door') add('tempered', (adders.find(a => a.name === 'tempered') || {}).rate ?? 14.60, 'sf');
  if (line.debris && line.debris !== 'None') {
    const d = adders.find(a => a.name === 'debris_protect');
    const rate = d && d.notes ? (JSON.parse(d.notes)[line.debris] ?? 0) : ({ Both: 3.70, Inside: 1.90, Outside: 1.90 }[line.debris] ?? 0);
    add('debris', rate, 'sf');
  }
  if (line.grille_igai) {
    const g = adders.find(a => a.name === 'grille_igai');
    const table = g && g.notes ? JSON.parse(g.notes) : { 1: 3.30, 2: 4.20, 3: 8.50, 4: 9.80, 9: 52.00, 11: 57.20 };
    add('grille', table[String(line.grille_igai)] ?? 37.70, 'sf');
  }
  listp = Math.round((listp + Object.values(applied).reduce((a, b) => a + b, 0)) * 100) / 100;
  const tier = tiers.find(t => t.tier_code === 'VMULT');
  const df = tier ? tier.factor : 0.4556;
  const dealer = Math.round(listp * df * 100) / 100;
  const qty = line.qty ?? 1;
  return {
    grid_code: code, cell: [cw, ch], base, color_factor: cf, frame_area_sf: fa, adders: applied,
    unit_list: listp, unit_dealer: dealer, qty,
    line_list: Math.round(listp * qty * 100) / 100, line_dealer: Math.round(dealer * qty * 100) / 100,
    evidence: 'grid_formula', confidence: 'high', vendor: 'AMSCO'
  };
}

export function strSim(a, b) {
  a = (a || '').toLowerCase(); b = (b || '').toLowerCase();
  if (a === b) return 1;
  const set = new Set(a.split(/\s+/).filter(Boolean));
  const ws = b.split(/\s+/).filter(Boolean);
  const inter = ws.filter(w => set.has(w)).length;
  return inter / Math.max(set.size, ws.length, 1);
}

export function pricePella(line, anchors) {
  const cand = anchors.filter(u => u.series && u.series.toLowerCase() === String(line.series || '').toLowerCase());
  if (!cand.length) return { error: 'no anchors for series', series: line.series, vendor: 'Pella' };
  const qty = line.qty ?? 1;
  const exact = cand.filter(u => Math.abs(u.width - line.width) < 0.01 && Math.abs(u.height - line.height) < 0.01);
  if (exact.length) {
    exact.sort((x, y) => strSim(y.description, line.description) - strSim(x.description, line.description));
    const best = exact[0];
    const prices = [...new Set(exact.map(u => u.list_price))];
    const out = {
      unit_list: best.list_price, qty, line_list: Math.round(best.list_price * qty * 100) / 100,
      anchor: best.description, source: best.source_anchor, evidence: 'empirical_anchor',
      confidence: 'high', vendor: 'Pella'
    };
    if (prices.length > 1) {
      const lo = Math.min(...prices), hi = Math.max(...prices);
      if ((hi - lo) / lo > 0.01) {
        out.anchor_conflict = { min: lo, max: hi, count: prices.length, note: 'multiple anchors at these dims differ on price (uncaptured options); verify against full spec' };
        out.confidence = 'medium';
      }
    }
    return out;
  }
  const area = line.width * line.height;
  const scored = cand.map(u => ({ u, dev: Math.abs(u.width * u.height - area) / area, sim: strSim(u.description, line.description) }));
  scored.sort((x, y) => (x.dev - y.dev) || (y.sim - x.sim));
  const best = scored[0].u;
  const ua = best.width * best.height;
  const est = Math.round(best.list_price * (area / ua) * 100) / 100;
  const dev = scored[0].dev;
  return {
    unit_list_estimated: est, qty, line_list_estimated: Math.round(est * qty * 100) / 100,
    anchor: best.description, anchor_dims: [best.width, best.height], size_deviation: Math.round(dev * 1000) / 1000,
    confidence: dev < 0.25 ? 'medium' : 'low', evidence: 'empirical_interp', estimated: true, vendor: 'Pella'
  };
}

// Authorize a quote request per vendor. As of Oct 6 the owner's "everybody" ruling
// (open AMSCO to all authenticated Hub users) is ON HOLD pending a check on Jeremy Burr's
// account, whose standing rule is no-pricing. Until the owner gives final word, AMSCO
// AND Pella quoting are admin/manager only; role 'user' is denied for every vendor.
// `lines` is retained for signature stability but no longer affects the decision.
// Admins retain full cost; managers receive sale-only fields. Returns { allowed, reason }.
export function authorizeQuoteRequest(user, lines) {
  if (!user) return { allowed: false, reason: 'unauthenticated' };
  const role = String(user.role || '').toLowerCase();
  if (role === 'admin' || role === 'manager') return { allowed: true };
  return { allowed: false, reason: `role '${user.role || 'none'}' may not view pricing` };
}

// Validate the inbound lines payload before any pricing work. Returns an array
// of per-line error strings; empty array means all lines are well-formed.
export function validateQuoteLines(lines) {
  const errors = [];
  if (!Array.isArray(lines)) return ['lines must be an array'];
  lines.forEach((line, i) => {
    const ctx = `line ${i + 1}`;
    if (!line || typeof line !== 'object') { errors.push(`${ctx}: not an object`); return; }
    if (line.vendor !== 'AMSCO' && line.vendor !== 'Pella') errors.push(`${ctx}: vendor must be AMSCO or Pella`);
    const w = Number(line.width), h = Number(line.height);
    if (!Number.isFinite(w) || w <= 0) errors.push(`${ctx}: width must be a positive number`);
    if (!Number.isFinite(h) || h <= 0) errors.push(`${ctx}: height must be a positive number`);
    const q = Number(line.qty ?? 1);
    if (!Number.isInteger(q) || q < 1) errors.push(`${ctx}: qty must be a positive integer`);
    if (line.vendor === 'AMSCO' && !String(line.product || '').trim()) errors.push(`${ctx}: AMSCO lines require a product`);
    if (line.vendor === 'Pella' && !String(line.series || '').trim()) errors.push(`${ctx}: Pella lines require a series`);
  });
  return errors;
}

// ValidationRule rows are authored in the catalog but quoteEngine does not yet
// enforce them. Surface that fact in the response instead of silently ignoring
// the table, so the unsupported contract is visible to callers.
export function summarizeValidationRules(rules) {
  const count = Array.isArray(rules) ? rules.length : 0;
  return {
    rules_loaded: count,
    enforced: false,
    note: count
      ? 'ValidationRule rows exist but are not yet enforced by quoteEngine; sizes/options are not validated against them'
      : 'no ValidationRule rows present'
  };
}

// ---- Response projection (cost redaction for non-admin callers) ----
// Sale-quote fields safe to return to any permitted caller (manager or admin).
// Cost/catalog internals are excluded for non-admins so a manager generating a sale
// quote never sees dealer net cost, grid base, adder amounts, color factors, or anchor
// provenance. Admins retain the full pricing object. The sale price is the LIST price
// (unit_list / line_list) — what is quoted to the customer; dealer cost is internal.
const SALE_PRICING_FIELDS = [
  'vendor', 'qty', 'unit_list', 'unit_list_estimated', 'line_list', 'line_list_estimated',
  'estimated', 'confidence', 'evidence', 'error', 'anchor_conflict'
];
// Top-level line fields safe to echo back (the line spec the caller supplied). The input
// line is NEVER spread unchecked into the response, so a caller cannot inject arbitrary
// keys (e.g. admin_override, is_admin) and have them echoed back to any caller.
const SALE_LINE_FIELDS = ['vendor', 'width', 'height', 'qty'];

export function projectPricing(pricing, { isAdmin }) {
  if (!pricing || typeof pricing !== 'object') return pricing;
  if (isAdmin) return { ...pricing };
  const out = {};
  for (const k of SALE_PRICING_FIELDS) if (k in pricing) out[k] = pricing[k];
  return out;
}

export function projectQuoteResult(line, pricing, { isAdmin }) {
  const out = {};
  for (const k of SALE_LINE_FIELDS) if (line && k in line) out[k] = line[k];
  out.pricing = projectPricing(pricing, { isAdmin });
  return out;
}