import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyOnlineConfigurationResult } from '../shared/onlineConfigurationEvidence.js';
const clone = value => structuredClone(value);
// Synthetic online observations exercise validation only; these are not live
// prices, a customer quote, or evidence of catalog coverage.
function fixture() {
  const settings = { dealer: 'BFS', yard: 'BFS-UTAH DESIGN(11)', gross_margin: 30, color: 'White', glass: 'CozE (LowE)' };
  const line = { id: 'window-two', style: 'Hampton Casement', width: 48, height: 60, qty: 2, units: 'in', dimension_basis: 'frame', room: 'Bedroom', options: { series: 'Hampton', number_wide: 2, tempered: false, grilles: '5/8" Flat · Rectangular · 2W4H per lite · White' } };
  const nativeId = '12345678-1234-1234-1234-123456789abc';
  const verification = { reopened: true, dealer: settings.dealer, yard: settings.yard, gross_margin: 30, checked_at: '2026-09-10T12:01:00Z' };
  const observed = { ...line, frame_dimensions: { width: 48, height: 60, units: 'in' }, options: { ...line.options, exterior_color: 'White', interior_color: 'White', color: 'White', glass: 'CozE (LowE)', hardware: 'Standard' }, native_line_id: 'native-line', native_line_number: '100',
    unit_prices: { list: 200, dealer: 100, customer: 142.86 }, line_totals: { list: 400, dealer: 200, customer: 285.72 } };
  const child = { id: 'online-child', source_index: 1, selection_hash: 'a'.repeat(64), lines: [line], settings, checkpoint: { native_quote_id: nativeId }, agent_run: { operation_id: 'online-operation', started_at: '2026-09-10T12:00:00Z', verification },
    result: { verified: true, native_quote_id: nativeId, native_quote_number: '1234567', native_quote_url: 'https://amsco.wtsparadigm.com/quotes/' + nativeId + '/line-items', lines: [observed], totals: { currency: 'USD', list_total: 400, dealer_cost: 200, customer_total: 285.72, tax: 0, freight: 0, labor: 0 } } };
  return { child, line, settings, now: new Date('2026-09-10T12:02:00Z') };
}
test('a saved online observation is normalized to a reusable unit price while retaining its original quantity evidence', () => {
  const value = fixture(), checked = verifyOnlineConfigurationResult(value); assert.equal(checked.ok, true, JSON.stringify(checked));
  assert.equal(checked.verified.source, 'amsco_online'); assert.equal(checked.verified.result.lines[0].qty, 1); assert.equal(checked.verified.result.totals.customer_total, 142.86);
  assert.equal(checked.verified.online_evidence.original_quantity, 2); assert.equal(checked.verified.online_evidence.native_quote_number, '1234567');
});
test('wrong sizes, assembly, requested options, finishes, products, quantities and prices are rejected', () => {
  const edits = [x => x.width++, x => x.height++, x => x.qty = 1, x => x.room = 'Other room', x => x.dimension_basis = 'call', x => x.frame_dimensions.width++,
    x => x.style = 'Studio Single Hung', x => x.options.series = 'Studio', x => x.options.number_wide = 1, x => x.options.tempered = true,
    x => delete x.options.tempered, x => x.options.grilles = 'None', x => x.options.exterior_color = 'Black', x => x.options.glass = 'Clear',
    x => x.unit_prices.customer = 143, x => x.line_totals.customer = 285.73, x => x.unit_prices.dealer = 0, x => x.native_line_number = '0'];
  for (const edit of edits) { const value = fixture(); edit(value.child.result.lines[0]); assert.equal(verifyOnlineConfigurationResult(value).ok, false, String(edit)); }
});
test('unknown standard options are not demanded when they were never requested', () => {
  const value = fixture(); delete value.child.result.lines[0].options.hardware;
  assert.equal(verifyOnlineConfigurationResult(value).ok, true);
});
test('native identity, reopen timing, account and package totals must match the actual operation', () => {
  const edits = [x => x.checkpoint.native_quote_id = 'different', x => x.agent_run.verification.reopened = false,
    x => x.agent_run.verification.checked_at = '2026-09-10T11:59:00Z', x => x.agent_run.verification.checked_at = '2026-09-11T00:00:00Z',
    x => x.agent_run.verification.yard = 'other', x => x.agent_run.verification.gross_margin = 20, x => x.result.native_quote_url = 'https://example.test/quote',
    x => x.result.native_quote_number = '', x => x.result.totals.customer_total++, x => x.result.totals.dealer_cost++, x => x.result.totals.freight = 1,
    x => x.result.native_source = 'native_configurations'];
  for (const edit of edits) { const value = fixture(); edit(value.child); assert.equal(verifyOnlineConfigurationResult(value).ok, false, String(edit)); }
});
test('a per-window finish exception supersedes the package preference without changing it', () => {
  const value = fixture(); value.line.options.color = 'Black exterior / White interior'; Object.assign(value.child.result.lines[0].options, { exterior_color: 'Black', interior_color: 'White', color: 'Black exterior / White interior' });
  assert.equal(verifyOnlineConfigurationResult(value).ok, true); assert.equal(value.settings.color, 'White');
});
test('malformed online results return validation issues rather than an unhandled exception', () => {
  for (const result of [null, {}, { verified: true }, { ...fixture().child.result, lines: [null] }]) {
    const value = fixture(); value.child.result = clone(result); assert.equal(verifyOnlineConfigurationResult(value).ok, false);
  }
});
