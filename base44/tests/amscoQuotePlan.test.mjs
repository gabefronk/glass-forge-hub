import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildQuotePlan, verifyObservedQuote, ROUNDING_POLICY, roomMatchesRequest } from '../shared/amscoQuotePlan.js';

const clone = value => structuredClone(value);
const request = () => JSON.parse(fs.readFileSync(new URL('./fixtures/amsco-scripted-benchmark.json', import.meta.url), 'utf8'));
const plan = () => {
  const outcome = buildQuotePlan(request());assert.equal(outcome.ok, true, JSON.stringify(outcome));return outcome.plan;
};
const nativeId = '12345678-1234-1234-1234-123456789abc';
function observed(p = plan()) {
  // Historical fixture values test verification only; production never looks up
  // a price in this file or supplies it to the native configurator.
  const units = [{ list: 390.20, dealer: 177.78, customer: 252.92 }, { list: 415.60, dealer: 189.35, customer: 269.38 }];
  const lines = p.lines.map((line, index) => ({ ...clone(line), native_line_id: 'line-' + index, native_line_number: String((index + 1) * 100), gross_margin: p.settings.gross_margin, unit_prices: units[index], line_totals: Object.fromEntries(Object.entries(units[index]).map(([key, value]) => [key, Math.round(value * line.qty * 100) / 100])) }));
  return { quote_id: p.quote_id, input_revision: p.input_revision, native_quote_id: nativeId, native_quote_number: 'TEST-ONLY', native_quote_url: 'https://amsco.wtsparadigm.com/quotes/' + nativeId + '/line-items', reopened: true, checked_at: '2026-09-06T23:00:00Z', dealer: 'BFS', yard: 'BFS-UTAH DESIGN (11)', gross_margin: p.settings.gross_margin, lines, totals: { currency: 'USD', list_total: sum(lines, 'list'), dealer_cost: sum(lines, 'dealer'), customer_total: sum(lines, 'customer'), tax: 0, freight: 0, labor: 0 } };
}
function sum(lines, kind) { return lines.reduce((total, line) => total + Math.round(line.line_totals[kind] * 100), 0) / 100; }
function rejectsObservation(change, code) {
  const p = plan(), sample = observed(p);change(sample, p);
  const result = verifyObservedQuote(p, sample);assert.equal(result.ok, false);
  if (code) assert.ok(result.issues.some(item => item.code === code), JSON.stringify(result));
}

test('native None Assigned is accepted only as observed evidence for an unspecified room',()=>{
 assert.equal(roomMatchesRequest('None Assigned',''),true);
 for(const actual of [undefined,null,'Kitchen','none assigned'])assert.equal(roomMatchesRequest(actual,''),false);
 assert.equal(roomMatchesRequest('None Assigned','Kitchen'),false);
 const p=plan();p.lines.forEach(line=>{line.room='';});
 const sample=observed(p);sample.lines.forEach(line=>{line.room='None Assigned';});
 const result=verifyObservedQuote(p,sample);assert.equal(result.ok,true);assert.equal(result.result.lines[0].room,'');
 sample.lines[0].room='Kitchen';assert.equal(verifyObservedQuote(p,sample).ok,false);
});

test('explicit benchmark normalizes the supported product without changing the source or supplying finance', () => {
  const input = request(), before = clone(input), built = buildQuotePlan(input);
  assert.equal(built.ok, true);assert.deepEqual(input, before);
  assert.deepEqual(built.plan.settings, { dealer: 'BFS', yard: 'BFS-UTAH DESIGN(11)', gross_margin: 29.71 });
  assert.deepEqual(built.plan.lines.map(line => line.frame_dimensions), [{ width: 35.5, height: 59.5, units: 'in' }, { width: 35.5, height: 71.5, units: 'in' }]);
  assert.equal(built.plan.lines[0].options.hardware, 'Cam Latch');assert.equal(built.plan.lines[0].options.hardware_color, 'Taupe');
  assert.equal(built.plan.lines[0].options.unit_type, 'Complete Unit');assert.equal(built.plan.lines[0].options.capillary_tubes, false);
  assert.equal(built.plan.lines[0].unit_prices, undefined);assert.equal(built.plan.conversation, undefined);
});

test('missing explicit finance and free-text-only requests return questions without guessing', () => {
  const input = request();input.settings = {};input.lines = [];
  const result = buildQuotePlan(input);assert.equal(result.status, 'needs_details');assert.ok(!result.plan);
  for (const path of ['settings.dealer', 'settings.yard', 'settings.gross_margin', 'lines']) assert.ok(result.issues.some(item => item.path === path));
  assert.ok(result.questions.every(question => question.length > 20));
  const zero = request();zero.settings.gross_margin = 0;assert.equal(buildQuotePlan(zero).ok, true);
});

test('unknown options, unsupported dealers/charges, numeric strings and ambiguous products cannot pass', () => {
  const changes = [
    input => input.settings.dealer = 'BTB', input => input.settings.yard = 'PLEASE SELECT YARD',
    input => input.settings.gross_margin = '29.71', input => input.settings.gross_margin = 100,
    input => input.settings.markup_percent = 42.27, input => input.settings.labor = 200,
    input => input.settings.unknown_product_feature = 'yes', input => input.lines[0].options.unknown_feature = 'yes',
    input => input.lines[0].style = 'Single Vent', input => input.lines[0].options.series = 'Studio Flush Fin',
    input => input.lines[0].options.unit_type = 'Sash Only', input => input.lines[0].options.number_wide = 3,
    input => input.lines[0].options.tempered = true, input => input.lines[0].options.argon = true,
    input => input.lines[0].options.grilles = 'Colonial', input => input.lines[0].options.elevation = 'Sea Level',
    input => input.lines[0].options.glass = 'Clear', input => input.lines[0].options.glass_thickness = 'DS over DS',
    input => input.lines[0].width = '36', input => input.lines[0].qty = 1.5,
    input => input.lines[0].dimension_basis = 'rough_opening', input => input.lines[0].units = 'ft'
  ];
  for (const change of changes) { const input = request();change(input);const result = buildQuotePlan(input);assert.equal(result.ok, false, JSON.stringify(input));assert.equal(result.status, 'needs_details'); }
});

test('every required optional-feature selection must be explicit, including false rather than absent', () => {
  for (const key of ['unit_type', 'color', 'glass', 'glass_thickness', 'glazing_method', 'tempered', 'argon', 'super_spacer', 'capillary_tubes', 'grilles', 'hardware', 'screen', 'elevation', 'number_wide']) {
    const input = request();delete input.lines[0].options[key];assert.equal(buildQuotePlan(input).ok, false, key);
  }
});

test('allowed colors and explicit line overrides are supported without inferring missing sides or hardware', () => {
  for (const color of ['White', 'Taupe', 'Black outside / White inside']) {
    const input = request();input.lines[0].options.color = color;
    assert.equal(buildQuotePlan(input).ok, true, color);
  }
  const partial = request();delete partial.lines[0].options.color;partial.lines[0].options.exterior_color = 'Black';assert.equal(buildQuotePlan(partial).ok, false);
  partial.lines[0].options.interior_color = 'White';assert.equal(buildQuotePlan(partial).ok, true);
  partial.lines[0].options.color = 'Taupe';assert.equal(buildQuotePlan(partial).ok, false);
  const inherited = request();inherited.settings.color = 'White';assert.equal(buildQuotePlan(inherited).plan.lines[0].options.color, 'Taupe');
  delete inherited.lines[0].options.color;assert.equal(buildQuotePlan(inherited).plan.lines[0].options.color, 'White');
  const hardware = request();hardware.lines[0].options.hardware = 'Cam Latch';assert.equal(buildQuotePlan(hardware).ok, false);
  hardware.lines[0].options.hardware_color = 'White';assert.equal(buildQuotePlan(hardware).ok, true);
});

test('observed persisted benchmark passes exact field verification and returns native prices only', () => {
  const p = plan(), sample = observed(p), before = clone(sample), result = verifyObservedQuote(p, sample);
  assert.equal(result.ok, true, JSON.stringify(result));assert.deepEqual(sample, before);
  assert.equal(result.result.totals.customer_total, 522.30);assert.equal(result.result.lines[1].unit_prices.customer, 269.38);
  assert.equal(result.result.lines[0].width, 36);assert.equal(result.result.lines[0].frame_dimensions.width, 35.5);
  assert.deepEqual(result.result.verification.rounding_policy, ROUNDING_POLICY);
});

test('reopen, revision, native identity, dealer, yard and verification time must all be present and match', () => {
  for (const key of ['reopened', 'quote_id', 'input_revision', 'native_quote_id', 'native_quote_number', 'native_quote_url', 'dealer', 'yard', 'gross_margin', 'checked_at']) rejectsObservation(sample => delete sample[key]);
  rejectsObservation(sample => sample.input_revision++, 'request_mismatch');
  rejectsObservation(sample => sample.native_quote_url = 'https://amsco.wtsparadigm.com/quotes/other/line-items', 'native_identity_mismatch');
  rejectsObservation(sample => sample.native_quote_url += '?token=anything', 'native_identity_mismatch');
  rejectsObservation(sample => sample.yard = 'BFS-OTHER DESIGN (11)', 'yard_mismatch');
  rejectsObservation(sample => sample.yard = 'BFS-UTAH DESIGN (12)', 'yard_mismatch');
  rejectsObservation(sample => sample.yard = 'BFS-UTAH DESIGN', 'yard_mismatch');
  rejectsObservation((sample, p) => p.native_quote_id = 'another-native-draft', 'checkpoint_mismatch');
});

test('no missing field in a persisted line can receive blanket verification', () => {
  for (const key of ['native_line_id', 'native_line_number', 'qty', 'width', 'height', 'units', 'dimension_basis', 'frame_dimensions', 'style', 'room', 'options', 'gross_margin', 'unit_prices', 'line_totals']) rejectsObservation(sample => delete sample.lines[0][key]);
  for (const key of Object.keys(plan().lines[0].options)) rejectsObservation(sample => {
    delete sample.lines[0].options[key];
    if (['exterior_color', 'interior_color'].includes(key)) delete sample.lines[0].options.color;
    if (key === 'color') { delete sample.lines[0].options.exterior_color;delete sample.lines[0].options.interior_color; }
  });
});

test('different dimensions/options and duplicate identities fail even with plausible totals', () => {
  rejectsObservation(sample => sample.lines[1].height = 60, 'call_dimensions_mismatch');
  rejectsObservation(sample => sample.lines[1].frame_dimensions.height = 59.5, 'frame_dimensions_mismatch');
  rejectsObservation(sample => sample.lines[1].options.screen = 'White', 'option_mismatch');
  rejectsObservation(sample => sample.lines[1].options.color = 'White', 'option_mismatch');
  rejectsObservation(sample => sample.lines[1].native_line_id = sample.lines[0].native_line_id, 'line_identity_invalid');
  rejectsObservation(sample => sample.lines[1].native_line_number = sample.lines[0].native_line_number, 'line_number_invalid');
});

test('observed gross margin and price-derived margin are both checked', () => {
  rejectsObservation(sample => sample.gross_margin = 0, 'margin_mismatch');
  rejectsObservation(sample => sample.lines[0].gross_margin = 0, 'margin_mismatch');
  rejectsObservation(sample => { sample.lines[0].unit_prices.customer = 177.78;sample.lines[0].line_totals.customer = 177.78;sample.totals.customer_total = sum(sample.lines, 'customer'); }, 'customer_margin_mismatch');
});

test('rounding tolerance is one cent per unit only, with exact extensions and aggregate cents', () => {
  const p = plan(), sample = observed(p);
  const idealCents = Math.round(sample.lines[0].unit_prices.dealer * 100 / (1 - p.settings.gross_margin / 100));
  sample.lines[0].unit_prices.customer = (idealCents - 1) / 100;sample.lines[0].line_totals.customer = sample.lines[0].unit_prices.customer;sample.totals.customer_total = sum(sample.lines, 'customer');
  assert.equal(verifyObservedQuote(p, sample).ok, true);
  sample.lines[0].unit_prices.customer = (idealCents - 2) / 100;sample.lines[0].line_totals.customer = sample.lines[0].unit_prices.customer;sample.totals.customer_total = sum(sample.lines, 'customer');
  assert.ok(verifyObservedQuote(p, sample).issues.some(item => item.code === 'customer_margin_mismatch'));
  rejectsObservation(value => value.totals.customer_total += 0.01, 'total_mismatch');
  const multi = request();multi.lines[0].qty = 3;const mp = buildQuotePlan(multi).plan, mo = observed(mp);
  assert.equal(verifyObservedQuote(mp, mo).ok, true);
  mo.lines[0].line_totals.customer += 0.01;mo.totals.customer_total = sum(mo.lines, 'customer');
  assert.ok(verifyObservedQuote(mp, mo).issues.some(item => item.code === 'extension_mismatch'));
});

test('native monetary values require actual numeric cents and explicit zero ancillary charges', () => {
  for (const bad of [undefined, null, NaN, Infinity, '252.92', -1, 0, 252.921]) rejectsObservation(sample => sample.lines[0].unit_prices.customer = bad, 'missing_native_price');
  for (const key of ['tax', 'freight', 'labor']) { rejectsObservation(sample => delete sample.totals[key], 'unsupported_or_missing_charge');rejectsObservation(sample => sample.totals[key] = 1, 'unsupported_or_missing_charge'); }
  rejectsObservation(sample => sample.totals.total = 999, 'total_alias_mismatch');
});

test('revalidated plan cannot change derived frame dimensions or bypass unsupported product rules', () => {
  const p = plan(), sample = observed(p);p.lines[0].frame_dimensions.width = 99;
  assert.equal(verifyObservedQuote(p, sample).ok, true); // Recomputes the supported conversion.
  sample.lines[0].frame_dimensions.width = 99;assert.equal(verifyObservedQuote(p, sample).ok, false);
  p.lines[0].options.series = 'Heritage';assert.equal(verifyObservedQuote(p, sample).ok, false);
});

test('unrelated observed price/totals payload fields are not copied into verified results', () => {
  const p = plan(), sample = observed(p);
  sample.lines[0].unit_prices.unrelated = 'not-result-data';sample.totals.unrelated = 'not-result-data';
  const result = verifyObservedQuote(p, sample);assert.equal(result.ok, true);assert.ok(!JSON.stringify(result.result).includes('not-result-data'));
});

test('line-specific questions identify the affected line instead of silently applying another line choices', () => {
  const input = request();delete input.lines[1].options.capillary_tubes;
  const result = buildQuotePlan(input);assert.equal(result.ok, false);
  assert.ok(result.questions.some(question => question.startsWith('Line 2: ') && question.includes('capillary tubes')));
});

test('core size and quantity bounds are enforced without claiming catalog availability', () => {
  for (const key of ['width', 'height', 'qty']) {
    const input = request();input.lines[0][key] = 1001;
    assert.equal(buildQuotePlan(input).ok, false, key);
    input.lines[0][key] = 1000;
    assert.equal(buildQuotePlan(input).ok, true, key); // Shape limit only; AMSCO must still validate the product.
  }
});

test('native quote identity must be a GUID while app request identity may remain a generic ID', () => {
  const p = plan();assert.equal(p.quote_id, 'scripted-runner-benchmark-20260906');
  const sample = observed(p);sample.native_quote_id = 'generic-native-id';
  sample.native_quote_url = 'https://amsco.wtsparadigm.com/quotes/generic-native-id/line-items';
  const result = verifyObservedQuote(p, sample);
  assert.equal(result.ok, false);assert.ok(result.issues.some(item => item.code === 'native_identity_missing'));
});
