import test from 'node:test';
import assert from 'node:assert/strict';
import { buildQuotePlan, assertSupportedPlan, verifyObservedQuote } from '../shared/amscoQuotePlan.js';
import { getProductProfileById, PROFILE_CONTRACT_VERSION, PROFILE_CONTRACT_HASH } from '../shared/mixedProductProfiles.js';

const profile = getProductProfileById('studio-setback-xo-v1');
const fields = Object.keys(profile.native_default_rules).sort();
const request = () => ({
  id: 'native-default-backend-test', input_revision: 1, title: 'Synthetic backend regression only',
  settings: { dealer: 'BFS', yard: 'BFS-UTAH DESIGN (11)', gross_margin: 30 },
  lines: [{ width: 60, height: 72, units: 'in', dimension_basis: 'call', qty: 1, room: '', style: 'XO Slider',
    options: { fin: 'nail fin', color: 'White', ...Object.fromEntries(Object.entries(profile.defaults).filter(([key]) => !fields.includes(key))) } }]
});
const build = (q = request()) => {
  const result = buildQuotePlan(q);
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.plan;
};
// Entire observation is synthetic test data. It is not a catalog lookup or a
// claim that these prices came from a completed native quote.
function observation(plan) {
  const nativeId = '11111111-2222-3333-4444-555555555555';
  const resolved = { capillary_tubes: false, glass_thickness: 'DS over DS', glazing_method: '3/4 inch Insulated Glass', super_spacer: false };
  const stages = Object.fromEntries(['before_save', 'after_save', 'reopened'].map(stage => [stage,
    Object.fromEntries((plan.lines[0].native_default_fields || []).map(key => [key, resolved[key]]))]));
  return {
    quote_id: plan.quote_id, input_revision: plan.input_revision, native_quote_id: nativeId, native_quote_number: 'TEST-ONLY',
    native_quote_url: `https://amsco.wtsparadigm.com/quotes/${nativeId}/line-items`, reopened: true,
    checked_at: '2026-09-08T00:00:00Z', dealer: 'BFS', yard: plan.settings.yard, gross_margin: 30,
    lines: [{ ...structuredClone(plan.lines[0]), options: { ...plan.lines[0].options, ...resolved },
      native_line_id: 'synthetic-line', native_line_number: '100', room: 'None Assigned', gross_margin: 30,
      native_default_evidence: stages,
      unit_prices: { list: 300, dealer: 100, customer: 142.86 }, line_totals: { list: 300, dealer: 100, customer: 142.86 } }],
    totals: { currency: 'USD', list_total: 300, dealer_cost: 100, customer_total: 142.86, tax: 0, freight: 0, labor: 0 }
  };
}

test('omitted declared ancillary choices produce canonical native-default fields without changing the request', () => {
  const q = request(), before = structuredClone(q), p = build(q);
  assert.deepEqual(q, before);
  assert.deepEqual(p.lines[0].native_default_fields, fields);
  fields.forEach(key => assert.equal(Object.hasOwn(p.lines[0].options, key), false));
  assert.equal(p.profile_contract_version, PROFILE_CONTRACT_VERSION);
  assert.equal(p.profile_contract_hash, PROFILE_CONTRACT_HASH);
  assert.equal(assertSupportedPlan(p).ok, true);
});

test('explicit SS thickness remains an exact requirement while omitted thickness can resolve to native DS', () => {
  const omitted = build();
  assert.equal(verifyObservedQuote(omitted, observation(omitted)).ok, true);
  const q = request(); q.lines[0].options.glass_thickness = 'SS over SS';
  const explicit = build(q);
  assert.equal(explicit.lines[0].options.glass_thickness, 'SS over SS');
  assert.equal(explicit.lines[0].native_default_fields.includes('glass_thickness'), false);
  assert.equal(verifyObservedQuote(explicit, observation(explicit)).ok, false);
  const global = request(); global.settings.glass_thickness = 'SS over SS';
  assert.equal(build(global).lines[0].options.glass_thickness, 'SS over SS');
});

test('forged default metadata cannot waive explicit or required product choices', () => {
  const q = request(); q.lines[0].native_default_fields = ['tempered'];
  assert.equal(buildQuotePlan(q).ok, false);
  const p = build(); p.lines[0].native_default_fields.push('tempered');
  assert.equal(assertSupportedPlan(p).ok, false);
  const missing = request(); delete missing.lines[0].options.tempered;
  assert.equal(buildQuotePlan(missing).ok, false);
});

test('missing, changed, incorrectly typed or extra evidence cannot produce Ready', () => {
  const p = build();
  for (const change of [
    line => delete line.native_default_evidence,
    line => delete line.native_default_evidence.after_save,
    line => line.native_default_evidence.after_save.glass_thickness = 'SS over SS',
    line => line.native_default_evidence.reopened.super_spacer = 'false',
    line => line.native_default_evidence.before_save.tempered = false,
    line => line.options.glass_thickness = 'SS over SS'
  ]) {
    const observed = observation(p); change(observed.lines[0]);
    assert.equal(verifyObservedQuote(p, observed).ok, false);
  }
});

test('verified result returns actual native DS and preserves pricing, margin and product validation', () => {
  const p = build(), observed = observation(p), result = verifyObservedQuote(p, observed);
  assert.equal(result.ok, true, JSON.stringify(result));
  assert.equal(result.result.lines[0].options.glass_thickness, 'DS over DS');
  assert.deepEqual(result.result.lines[0].native_default_evidence, observed.lines[0].native_default_evidence);
  assert.equal(result.result.totals.customer_total, 142.86);
  for (const change of [
    o => o.lines[0].unit_prices.customer = 150,
    o => o.lines[0].gross_margin = 20,
    o => o.totals.customer_total = 150,
    o => o.reopened = false,
    o => o.lines[0].options.tempered = true
  ]) {
    const changed = structuredClone(observed); change(changed);
    assert.equal(verifyObservedQuote(p, changed).ok, false);
  }
});
