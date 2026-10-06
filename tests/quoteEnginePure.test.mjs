import test from 'node:test';
import assert from 'node:assert/strict';
import {
  rnd01, frameArea, ceilCell, priceAmsco, pricePella, strSim,
  checkQuoteAccess, validateQuoteLines, summarizeValidationRules
} from '../base44/shared/quoteEnginePure.js';

// ---- fixtures ----
const grid = [
  { price_code: 'STU', max_width: 24, max_height: 48, base_price: 400 },
  { price_code: 'STU', max_width: 36, max_height: 60, base_price: 600 },
  { price_code: 'STU', max_width: 48, max_height: 84, base_price: 900 },
  { price_code: 'PD', max_width: 72, max_height: 96, base_price: 1942.2 },
];
const series = [
  { vendor: 'AMSCO', series_name: 'Studio', product_type: 'window', price_code: 'STU', color_factors: { White: 1, Bronze: 1.05 } },
  { vendor: 'AMSCO', series_name: 'Heritage PD', product_type: 'patio-door', price_code: 'PD', color_factors: { White: 1, Bronze: 1.05 } },
];
const adders = [
  { name: 'tempered', rate: 14.6 },
  { name: 'debris_protect', notes: JSON.stringify({ Both: 3.7, Inside: 1.9, Outside: 1.9 }) },
  { name: 'grille_igai', notes: JSON.stringify({ 1: 3.3, 2: 4.2, 3: 8.5, 4: 9.8 }) },
];
const tiers = [{ tier_code: 'VMULT', factor: 0.4556 }];
const pellaAnchors = [
  { series: '250', width: 36, height: 60, list_price: 800, description: '250 SH white', source_anchor: 'quote-1' },
  { series: '250', width: 36, height: 60, list_price: 820, description: '250 SH white grilles', source_anchor: 'quote-2' },
  { series: '250', width: 48, height: 72, list_price: 1200, description: '250 casement white', source_anchor: 'quote-3' },
];

test('rnd01 rounds up to one decimal', () => {
  assert.equal(rnd01(194.22), 194.3);
  assert.equal(rnd01(0), 0);
});

test('frameArea rounds up to whole square feet', () => {
  assert.equal(frameArea(24, 48), 8);
  assert.equal(frameArea(23.5, 47.5), 8); // 1116.25/144 = 7.75 -> 8
});

test('ceilCell picks the smallest bracket that contains the dims', () => {
  const c = ceilCell(grid, 'STU', 24, 48);
  assert.deepEqual([c.cw, c.ch], [24, 48]);
  assert.equal(c.base, 400);
  const c2 = ceilCell(grid, 'STU', 30, 52);
  assert.deepEqual([c2.cw, c2.ch], [36, 60]);
  assert.equal(c2.base, 600);
});

test('ceilCell returns over-grid when no bracket contains the dims', () => {
  const c = ceilCell(grid, 'STU', 60, 90);
  assert.equal(c.base, null);
  assert.equal(c.cw, null);
  assert.equal(c.ch, null);
});

test('ceilCell returns base null when code has no rows', () => {
  const c = ceilCell(grid, 'NOPE', 24, 48);
  assert.deepEqual(c, { cw: null, ch: null, base: null });
});

test('priceAmsco prices a base window with color factor and tier discount', () => {
  const r = priceAmsco({ product: 'Studio', width: 24, height: 48, qty: 1, ext_color: 'Bronze' }, grid, adders, tiers, series);
  assert.equal(r.error, undefined);
  assert.equal(r.base, 400);
  assert.equal(r.color_factor, 1.05);
  assert.equal(r.unit_list, 420); // 400 * 1.05 = 420
  assert.equal(r.unit_dealer, 191.35); // 420 * 0.4556 = 191.352 -> 191.35
  assert.equal(r.line_list, 420);
  assert.equal(r.confidence, 'high');
});

test('priceAmsco applies tempered adder for windows but not patio doors', () => {
  const win = priceAmsco({ product: 'Studio', width: 24, height: 48, qty: 1, ext_color: 'White', tempered: true }, grid, adders, tiers, series);
  assert.ok(win.adders.tempered > 0);
  const pd = priceAmsco({ product: 'Heritage PD', width: 71.5, height: 95.5, qty: 1, ext_color: 'Bronze', tempered: true }, grid, adders, tiers, series);
  assert.equal(pd.adders.tempered, undefined); // patio door: tempered is standard
  assert.equal(pd.unit_list, 2039.4); // 1942.2 * 1.05 = 2039.31 -> 2039.4
});

test('priceAmsco applies debris and grille adders by frame area', () => {
  const r = priceAmsco({ product: 'Studio', width: 36, height: 60, qty: 1, ext_color: 'White', debris: 'Both', grille_igai: 2 }, grid, adders, tiers, series);
  assert.equal(r.frame_area_sf, 15); // 36*60/144 = 15
  assert.equal(r.adders.debris, rnd01(15 * 3.7)); // 55.5
  assert.equal(r.adders.grille, rnd01(15 * 4.2)); // 63
});

test('priceAmsco multiplies unit price by qty for line totals', () => {
  const r = priceAmsco({ product: 'Studio', width: 24, height: 48, qty: 3, ext_color: 'White' }, grid, adders, tiers, series);
  assert.equal(r.unit_list, 400);
  assert.equal(r.line_list, 1200);
  assert.equal(r.line_dealer, Math.round(400 * 0.4556 * 3 * 100) / 100);
});

test('priceAmsco returns error for unknown product', () => {
  const r = priceAmsco({ product: 'Mystery', width: 24, height: 48, qty: 1, ext_color: 'White' }, grid, adders, tiers, series);
  assert.equal(r.error, 'unknown AMSCO product');
  assert.equal(r.product, 'Mystery');
});

test('priceAmsco returns over-grid error when dims exceed every bracket', () => {
  const r = priceAmsco({ product: 'Studio', width: 60, height: 90, qty: 1, ext_color: 'White' }, grid, adders, tiers, series);
  assert.equal(r.error, 'over-grid');
  assert.equal(r.grid_code, 'STU');
});

test('pricePella returns high confidence on an exact anchor match', () => {
  const r = pricePella({ series: '250', width: 48, height: 72, qty: 1, description: '250 casement white' }, pellaAnchors);
  assert.equal(r.unit_list, 1200);
  assert.equal(r.line_list, 1200);
  assert.equal(r.confidence, 'high');
  assert.equal(r.evidence, 'empirical_anchor');
  assert.equal(r.estimated, undefined);
});

test('pricePella flags anchor_conflict when exact dims have divergent prices', () => {
  const r = pricePella({ series: '250', width: 36, height: 60, qty: 1, description: '250 SH white' }, pellaAnchors);
  assert.ok(r.anchor_conflict);
  assert.equal(r.anchor_conflict.count, 2);
  assert.equal(r.confidence, 'medium');
});

test('pricePella interpolates and degrades confidence with size deviation', () => {
  // 24x48 = 1152 vs anchor 48x72 = 3456 -> dev ~0.667 -> low
  const r = pricePella({ series: '250', width: 24, height: 48, qty: 1, description: '250 SH white' }, pellaAnchors);
  assert.equal(r.estimated, true);
  assert.equal(r.evidence, 'empirical_interp');
  assert.equal(r.confidence, 'low');
  assert.ok(r.size_deviation > 0.25);
  // near-anchor 38x62 = 2356 vs 36x60 = 2160 dev ~0.09 -> medium
  const r2 = pricePella({ series: '250', width: 38, height: 62, qty: 1, description: '250 SH white' }, pellaAnchors);
  assert.equal(r2.confidence, 'medium');
});

test('pricePella returns error when no anchors exist for the series', () => {
  const r = pricePella({ series: '999', width: 36, height: 60, qty: 1, description: '' }, pellaAnchors);
  assert.equal(r.error, 'no anchors for series');
  assert.equal(r.vendor, 'Pella');
});

test('strSim scores identical strings at 1 and disjoint at 0', () => {
  assert.equal(strSim('white casement', 'white casement'), 1);
  assert.equal(strSim('white casement', 'bronze awning'), 0);
  assert.ok(strSim('white casement', 'white awning') > 0 && strSim('white casement', 'white awning') < 1);
});

test('checkQuoteAccess denies crew and unauthenticated callers', () => {
  assert.equal(checkQuoteAccess(null).allowed, false);
  assert.equal(checkQuoteAccess({ role: 'user' }).allowed, false);
  assert.equal(checkQuoteAccess({ role: 'user' }).reason, "role 'user' may not view pricing");
});

test('checkQuoteAccess allows admin and manager', () => {
  assert.equal(checkQuoteAccess({ role: 'admin' }).allowed, true);
  assert.equal(checkQuoteAccess({ role: 'manager' }).allowed, true);
  assert.equal(checkQuoteAccess({ role: 'MANAGER' }).allowed, true); // case-insensitive
});

test('validateQuoteLines rejects non-array, bad dims, bad vendor, missing product/series', () => {
  assert.deepEqual(validateQuoteLines(null), ['lines must be an array']);
  const errs = validateQuoteLines([
    { vendor: 'AMSCO', width: 0, height: 48, qty: 1, product: 'Studio' },
    { vendor: 'Pella', width: 36, height: 60, qty: 0, series: '250' },
    { vendor: 'Weird', width: 36, height: 60, qty: 1 },
    { vendor: 'AMSCO', width: 36, height: 60, qty: 1 },
    { vendor: 'Pella', width: 36, height: 60, qty: 1 },
  ]);
  assert.ok(errs.some(e => e.includes('width must be a positive number')));
  assert.ok(errs.some(e => e.includes('qty must be a positive integer')));
  assert.ok(errs.some(e => e.includes('vendor must be AMSCO or Pella')));
  assert.ok(errs.some(e => e.includes('AMSCO lines require a product')));
  assert.ok(errs.some(e => e.includes('Pella lines require a series')));
});

test('validateQuoteLines passes a well-formed payload', () => {
  const errs = validateQuoteLines([
    { vendor: 'AMSCO', width: 24, height: 48, qty: 2, product: 'Studio' },
    { vendor: 'Pella', width: 36, height: 60, qty: 1, series: '250' },
  ]);
  assert.deepEqual(errs, []);
});

test('summarizeValidationRules flags the table as loaded-but-not-enforced', () => {
  const s = summarizeValidationRules([{ vendor: 'AMSCO', rule_type: 'size_limit', rule: {}, severity: 'error' }]);
  assert.equal(s.rules_loaded, 1);
  assert.equal(s.enforced, false);
  assert.match(s.note, /not yet enforced/);
  const empty = summarizeValidationRules([]);
  assert.equal(empty.rules_loaded, 0);
  assert.match(empty.note, /no ValidationRule rows present/);
});