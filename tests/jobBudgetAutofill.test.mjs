import test from 'node:test';
import assert from 'node:assert/strict';
import { autofillBudget, fileNameHints, installMaterialFor, laborFromLines, budgetNameFor, isGenericName } from '../base44/shared/jobBudgetAutofill.js';
import { normalizeVendorQuote } from '../base44/shared/vendorQuoteParse.js';

// WTS Paradigm 3526703 as the new schema reads it (SANDY EAGLE MTN glass replacement).
const wts = normalizeVendorQuote({
  vendor: 'WTS Paradigm', manufacturer: 'WTS Paradigm', quote_number: '3526703', project_name: 'CASH CUSTOMER',
  customer_po: 'YA-0007', quoted_by: 'israelyedra', bill_to: 'BTB HOME IMPROVEMENTS', openings_qty: 1,
  price_levels: 'single', net_total: 108.24, customer_sub_total: 108.24, customer_total: 108.24,
  lines: [{ qty: 1, width_in: 33.625, height_in: 55.5, kind: 'glass', description: '33.625 x 55.5 - Glass Only', extended: 108.24 }],
});

test('file name gives the job, scope and glass-only hint', () => {
  const h = fileNameHints('SANDY EAGLE MTN - GLASSS REPLACEMENT - AMSCO.pdf');
  assert.equal(h.job_name, 'SANDY EAGLE MTN');
  assert.equal(h.glass_only, true);
  assert.equal(h.brand, 'AMSCO');
  assert.equal(fileNameHints('oeepa-rcr1260716180602.pdf').job_name, null);
  assert.equal(fileNameHints('AMMON CABIN - BLACK WHITE - ANDERSEN 100 (MULL KITS).pdf').glass_only, false);
});

test('generic quote names fall back to the file name', () => {
  assert.ok(isGenericName('CASH CUSTOMER'));
  assert.equal(budgetNameFor(wts, fileNameHints('SANDY EAGLE MTN - GLASSS REPLACEMENT - AMSCO.pdf')), 'SANDY EAGLE MTN');
  assert.equal(budgetNameFor({ quote_name: 'AGREN RES', project_name: 'CASH CUSTOMER' }, {}), 'AGREN RES');
});

test('WTS glass-only quote fills every box', () => {
  const f = autofillBudget(wts, { fileName: 'SANDY EAGLE MTN - GLASSS REPLACEMENT - AMSCO.pdf' });
  assert.equal(f.inputs.material_true_cost, 108.24); // net price, not list, and never the sell
  assert.equal(f.inputs.labor_cost_sub_pay, 125);
  assert.equal(f.inputs.labor_sell_price, 275); // trip minimum
  assert.ok(f.inputs.actual_total_sell > 400 && f.inputs.actual_total_sell < 500);
  assert.deepEqual(f.filled.sort(), ['actual_total_sell', 'labor_cost_sub_pay', 'labor_sell_price', 'material_true_cost']);
  assert.match(f.sources.actual_total_sell, /Sheet target/);
  assert.deepEqual(f.notes, []);
});

test('old-schema Agren extraction (studio quote, no lines) still fills', () => {
  const q = normalizeVendorQuote({ vendor: 'BTB HOME IMPROVEMENTS', manufacturer: 'AMSCO WINDOWS', quote_name: 'AGREN RES', quoted_by: 'israelyedra', openings_qty: 1, actual_total_sell: 83.97, customer_sub_total: 78.15, customer_tax: 5.82 });
  const f = autofillBudget(q, { fileName: 'AGREN - GLASS REPLACEMENT - AMSCO STUDIO.pdf' });
  assert.equal(f.inputs.material_true_cost, 78.15); // what Gabe typed
  assert.equal(f.inputs.labor_cost_sub_pay, 125);
  assert.equal(f.inputs.labor_sell_price, 275);
  assert.equal(f.inputs.actual_total_sell, 407.51);
});

test('AMSCO dealer pricing keeps the printed customer total as the sell', () => {
  const q = normalizeVendorQuote({ vendor: 'Amsco', manufacturer: 'Amsco', quote_name: 'BAXTER - GLASS', price_levels: 'dealer_and_customer', dealer_subtotal: 2748.78, material_true_cost: 2748.78, customer_total: 7022.31, actual_total_sell: 7022.31,
    lines: [{ qty: 3, width_in: 35.5, height_in: 59.5, kind: 'window', description: 'Single Hung' }, { qty: 1, width_in: 71.5, height_in: 79.5, kind: 'door', description: '2 Panel Slider 6/8' }] });
  const f = autofillBudget(q, { fileName: 'BAXTER - WINDOWS - AMSCO.pdf' });
  assert.equal(f.inputs.material_true_cost, 2748.78);
  assert.equal(f.inputs.actual_total_sell, 7022.31);
  // 35.5 x 59.5 = 14.7 sq ft -> vinyl under-30 ($36/$52) x3, door 2-panel 6/8 ($66/$95)
  assert.equal(f.inputs.labor_cost_sub_pay, 36 * 3 + 66);
  assert.equal(f.inputs.labor_sell_price, 52 * 3 + 95);
  assert.equal(f.install_material, 'vinyl');
});

test("Gabe's own quote: sell is the total, cost left for him", () => {
  const q = normalizeVendorQuote({ vendor: 'Builders FirstSource', manufacturer: 'Andersen', quote_name: 'AMMON CABIN', quoted_by: 'Gabriel Fronk', price_levels: 'single', customer_sub_total: 6535.42, customer_tax: 486.89, customer_total: 7022.31, material_true_cost: 6535.42,
    lines: [{ qty: 2, width_in: 36, height_in: 60, kind: 'window', description: 'Andersen 100 casement' }] });
  const f = autofillBudget(q, { fileName: 'AMMON CABIN - BLACK WHITE - ANDERSEN 100 (MULL KITS).pdf' });
  assert.equal(f.inputs.material_true_cost, 0);
  assert.ok(!f.filled.includes('material_true_cost'));
  assert.equal(f.inputs.actual_total_sell, 7022.31);
  assert.equal(f.install_material, 'composite');
  assert.equal(f.inputs.labor_cost_sub_pay, 46 * 2); // composite under 30 sq ft
  assert.ok(f.notes.some((t) => /material cost/.test(t)));
});

test('unpriced lines are called out, parts are skipped', () => {
  const l = laborFromLines([{ qty: 1, kind: 'window', description: 'Picture' }, { qty: 4, kind: 'part', description: 'Mull kit' }], { material: 'vinyl' });
  assert.equal(l.priced, 0);
  assert.equal(l.unpriced.length, 1);
});

test('install material from the brand', () => {
  assert.equal(installMaterialFor({ manufacturer: 'WTS Paradigm' }), 'wood');
  assert.equal(installMaterialFor({ manufacturer: 'AMSCO WINDOWS' }), 'vinyl');
  assert.equal(installMaterialFor({ manufacturer: 'Andersen' }, { brand: 'ANDERSEN 100 (MULL KITS)' }), 'composite');
});
