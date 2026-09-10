import test from 'node:test';
import assert from 'node:assert/strict';
import { builderPricePreview, normalizeManualBuilderDraft, validateBuilderDraft } from '../shared/windowQuoteBuilder.js';
import { buildQuotePlan } from '../shared/amscoQuotePlan.js';
const now = Date.parse('2026-09-10T12:00:00Z');
const fresh = () => ({ settings: { dealer: 'BFS', yard: 'BFS-UTAH DESIGN(11)', gross_margin: 30, color: 'White', glass: 'CozE (LowE)' }, source: { easy_request: { profile_id: 'studio-sh-standard', profile_revision: 1, confirmed: true, units: 'in', dimension_basis: 'call' } },
  lines: [{ id: 'one', style: 'Studio Single Hung', qty: 2, width: 36, height: 60, units: 'in', dimension_basis: 'call', options: {} }] });
function cached() {
  const normalized = normalizeManualBuilderDraft(fresh()), plan = buildQuotePlan({ ...normalized.quote, id: 'cached', input_revision: 1 }).plan;
  return { ...normalized.quote, input_revision: 1, worker_status: 'ready', result: { verified: true, input_revision: 1, verification: { checked_at: '2026-09-10T11:00:00Z' },
    lines: plan.lines.map(line => ({ ...line, unit_prices: { dealer: 169.30, list: 371.60 } })) } };
}
const preview = (draft, quote) => builderPricePreview(draft, { QuoteRequests: { list: async () => [quote] } }, { now });
test('one unsupported Hampton window and one incomplete editor cannot blank a known Studio price', async () => {
  const draft = fresh();
  draft.lines.push({ ...draft.lines[0], id: 'hampton', style: 'Hampton Casement', options: { series: 'Hampton', grilles: '5/8 Flat 2W4H' } });
  draft.lines.push({ id: 'unfinished', style: 'Studio Single Hung', qty: 1, units: 'in', dimension_basis: 'call', options: {} });
  const result = await preview(validateBuilderDraft(draft), cached());
  assert.deepEqual(result.lines.map(line => line.status), ['priced', 'amsco_lookup_needed', 'needs_details']);
  assert.equal(result.lines[0].line_totals.customer, 483.72);
  assert.equal(result.priced_subtotal, 483.72);
  assert.equal(result.total, null);
  assert.equal(result.missing_count, 1);
  assert.equal(result.needs_details_count, 1);
});
test('null, empty, old, future, revision-mismatched and reordered evidence cannot supply a price', async () => {
  const mutations = [
    quote => { quote.result.lines[0].unit_prices.dealer = null; },
    quote => { quote.result.lines[0].unit_prices.dealer = ''; },
    quote => { quote.result.lines[0].unit_prices.dealer = 0; },
    quote => { quote.result.verification.checked_at = '2026-09-08T11:00:00Z'; },
    quote => { quote.result.verification.checked_at = '2026-09-11T11:00:00Z'; },
    quote => { delete quote.result.verification.checked_at; },
    quote => { quote.result.input_revision = 0; },
    quote => { quote.result.lines[0].source_index = 1; }
  ];
  for (const mutate of mutations) {
    const source = cached(); mutate(source);
    const result = await preview(fresh(), source);
    assert.equal(result.lines[0].status, 'native_calculation_needed');
    assert.equal(result.total, null);
  }
});
test('color and account differences are not eligible for an exact configuration price', async () => {
  const draft = fresh(); draft.lines[0].options.color = 'Black';
  assert.equal((await preview(draft, cached())).lines[0].status, 'amsco_lookup_needed');
});
