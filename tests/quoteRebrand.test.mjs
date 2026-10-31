// YA copy of a supplier quote: supplier detection, what gets covered, what YA writes, and
// prices scaled to sell. Text items come from the real AMSCO dealer quote 3355407 and the
// BFS / Andersen quote 10106054 (positions in PDF points from the top-left).
import test from 'node:test';
import assert from 'node:assert/strict';
import { detectSupplier, pagePlan, priceFactor, repriceText, productSell, quoteTotal, guideLabel, rebrandPlan } from '../src/lib/quoteRebrand.js';

const it = (str, x, y, w, h = 8) => ({ str, x, y, w, h });
const company = { invoice_company_name: 'Y A Windows Doors LLC', invoice_company_address: '1138 S 1300 W, Salt Lake City, UT 84104', invoice_phone: '', invoice_email: '' };
const job = { canonical_name: 'HANDLEY RES', address: '1 Main St, Lehi, UT' };

const amsco = { width: 612, height: 792, items: [
  it('Dealer Quote', 264, 43, 84, 14), it('P:', 123, 92, 9), it('F:', 208, 92, 9),
  it('Billing Information:', 39, 183, 83, 9), it('OX GLASS LLC', 37, 195, 59), it('305 S 850 E SUITE 108A', 37, 205, 93), it('P: 801-691-3524', 37, 227, 61),
  it('Shipping Information:', 228, 183, 94, 9), it('OX GLASS LLC', 226, 195, 59), it('P: 801-358-5548', 226, 227, 61),
  it('Order Comments:', 417, 183, 77, 9), it('Line# | Qty | Dimensions | Pricing', 39, 282, 259),
  it('Dealer Price:', 58, 365, 49), it('$16,139.34', 107, 365, 42),
  it('Studio Slider Frame Picture Window, 71.5 x 59.5', 222, 371, 177),
  it('Quoted by:', 37, 740, 37, 7), it('Administrator User', 78, 740, 57, 7), it('Sales Rep:', 181, 740, 36, 7), it('Brett Naylor', 222, 740, 36, 7),
] };
const pqm = { width: 792, height: 612, items: [
  it('Abbreviated Quote Report - Customer Pricing', 37, 185, 325, 15), it('SOLD BY:', 188, 86, 57, 12), it('SOLD TO:', 437, 86, 57, 12),
  it('Builders FirstSource - Lehi American', 188, 104, 147, 9), it('Fork', 188, 115, 18, 9), it('Fax: (801) 731-0838', 188, 146, 82, 9),
  it('OWNER', 664, 150, 35, 9), it('Gabriel Fronk', 654, 163, 55, 9),
  it('$931.19', 634, 280, 36, 10), it('100CS3060, Unit, 100 Series Single Casement-CW', 165, 300, 400, 10),
  it('TOTAL:', 591, 97, 33, 9), it('$29,045.91', 680, 96, 50, 10), it('Thank you for choosing Andersen Windows & Doors', 50, 199, 325, 14),
] };
const strs = (plan) => plan.write.map((w) => w.text);
const covered = (plan, item) => plan.erase.some((r) => r.x <= item.x && r.y <= item.y && r.x + r.w >= item.x + item.w && r.y + r.h >= item.y + item.h);

test('detects the supplier layout', () => {
  assert.equal(detectSupplier([amsco]), 'amsco');
  assert.equal(detectSupplier([pqm]), 'pqm');
  assert.equal(detectSupplier([{ items: [it('Quote', 0, 0, 10)] }]), 'generic');
});

test('AMSCO: billing, shipping, logo block, dealer wording and sales rep are replaced', () => {
  const f = priceFactor(93066.72, 140000);
  const plan = pagePlan(amsco, { supplier: 'amsco', factor: f, company, job, pageIndex: 0 });
  for (const s of ['OX GLASS LLC', '305 S 850 E SUITE 108A', 'P: 801-691-3524', 'P: 801-358-5548', 'Brett Naylor', 'Sales Rep:', 'Administrator User']) {
    assert.ok(amsco.items.filter((i) => i.str === s).every((i) => covered(plan, i)), `${s} is covered`);
  }
  assert.ok(strs(plan).includes('Y A Windows Doors LLC'));
  assert.ok(strs(plan).includes('HANDLEY RES'));
  assert.ok(strs(plan).includes('Quote'));
  assert.ok(strs(plan).includes('Price:'));
  assert.ok(strs(plan).includes('Y A Windows & Doors'));
  assert.equal(plan.logos.length, 1);
  assert.ok(strs(plan).includes(repriceText('$16,139.34', f)));
  assert.ok(!covered(plan, amsco.items.find((i) => /Studio Slider/.test(i.str))), 'product text stays');
});

test('BFS / Andersen: SOLD BY becomes YA, BFS and fax go, thank-you line is YA, owner stays', () => {
  const plan = pagePlan(pqm, { supplier: 'pqm', factor: 2, company, job, pageIndex: 0 });
  for (const s of ['Builders FirstSource - Lehi American', 'Fork', 'Fax: (801) 731-0838']) assert.ok(covered(plan, pqm.items.find((i) => i.str === s)), `${s} is covered`);
  assert.ok(!covered(plan, pqm.items.find((i) => i.str === 'Gabriel Fronk')));
  assert.ok(strs(plan).includes('Y A Windows Doors LLC'));
  assert.ok(strs(plan).includes('Thank you for choosing Y A Windows & Doors'));
  assert.ok(strs(plan).includes('$1,862.38'));
  assert.ok(strs(plan).includes('$58,091.82'));
});

// Pella "Proposal - Detailed" from BFS (Becky Retro, quote 21464768), page 1 header.
const pella = { width: 612, height: 792, items: [
  it('Proposal - Detailed', 120, 40, 140, 14), it('268 East 1600 South', 120, 60, 70, 8),
  it('Sales Rep Name:', 360, 52, 60, 8), it('BFSSAND, Y', 425, 52, 45, 8), it('Sales Rep Phone:', 360, 62, 60, 8),
  it('Customer Information', 108, 108, 80, 9), it('Project/Delivery Address', 302, 108, 95, 9), it('Order Information', 490, 108, 70, 9),
  it('PO BOX 70006', 108, 126, 50, 7), it('Primary Phone: (801) 5052479', 108, 156, 110, 7), it('Customer Number: 1009982318', 108, 208, 110, 7),
  it('YA WINDOWS', 302, 120, 40, 7), it('08035 - BUILDERS FIRST WAREHOU', 302, 128, 120, 7), it('Owner Phone: (801) 5052479', 302, 200, 100, 7),
  it('Quote Number:', 490, 150, 50, 8), it('21464768', 545, 150, 35, 8),
  it('Line #', 108, 262, 20, 7), it('$1,033.37', 560, 285, 35, 7),
] };

test('Pella proposal: BFS address, sales rep and customer / delivery columns become YA and the job', () => {
  assert.equal(detectSupplier([pella]), 'pella');
  const plan = pagePlan(pella, { supplier: 'pella', factor: 2, company, job, pageIndex: 0 });
  for (const s of ['268 East 1600 South', 'BFSSAND, Y', 'PO BOX 70006', 'Primary Phone: (801) 5052479', 'Customer Number: 1009982318', 'YA WINDOWS', '08035 - BUILDERS FIRST WAREHOU', 'Owner Phone: (801) 5052479']) {
    assert.ok(covered(plan, pella.items.find((i) => i.str === s)), `${s} is covered`);
  }
  assert.ok(!covered(plan, pella.items.find((i) => i.str === '21464768')), 'order information stays');
  assert.ok(strs(plan).includes('Y A Windows Doors LLC'));
  assert.ok(strs(plan).includes('HANDLEY RES'));
  assert.ok(strs(plan).includes('$2,066.74'));
});

test('prices scale so the quote total lands on the product sell', () => {
  const f = priceFactor(29045.91, 45000);
  assert.equal(repriceText('$29,045.91', f), '$45,000.00');
  assert.equal(repriceText('Customer Price: $931.19 each', 1.5), 'Customer Price: $1,396.79 each');
  assert.equal(priceFactor(0, 100), null);
});

test('product sell splits the budget sell by cost share', () => {
  const becky = { inputs: { material_true_cost: 37580.5, labor_cost_sub_pay: 2000, actual_total_sell: 59318.51 }, quote: { customer_total: 37580.5 } };
  const s = productSell(becky);
  assert.equal(s.product, 56321.15);
  assert.equal(s.install, 2997.36);
  assert.equal(quoteTotal(becky), 37580.5);
  assert.equal(productSell({ inputs: { material_true_cost: 100, actual_total_sell: 0 } }), null);
});

test('rebrandPlan plans every page; guide labels drop the copy suffix', () => {
  const p = rebrandPlan([amsco, amsco], { factor: 1, company, job });
  assert.equal(p.supplier, 'amsco');
  assert.equal(p.pages[1].logos.length, 0);
  assert.equal(guideLabel('1F Standard Flat Wall Nail-on 405 NO Sill Pan (1).pdf'), '1F Standard Flat Wall Nail-on 405 NO Sill Pan');
  assert.equal(guideLabel('HOLMES HOMES RECESSED WINDOW INSTALL.pdf'), 'HOLMES HOMES RECESSED WINDOW INSTALL');
});
