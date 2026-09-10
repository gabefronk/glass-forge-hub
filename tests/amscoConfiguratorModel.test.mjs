import test from 'node:test';
import assert from 'node:assert/strict';
import { changeSeries, colorParts, changeColor, parseGrilles, serializeGrilles, stylesForSeries } from '../src/components/window-quotes/amscoConfiguratorModel.js';
import { createBuilderLine } from '../src/components/window-quotes/windowBuilderModel.js';
import { normalizeManualBuilderDraft, builderReviewResponse, validateBuilderDraft } from '../base44/shared/windowQuoteBuilder.js';
import { webcrypto } from 'node:crypto';
globalThis.crypto ??= webcrypto;

test('changing series retains sizes, identifiers, tempering and explicit grids', () => {
  const original = createBuilderLine('Studio Single Hung', { width: 33, height: 33, qty: 2, options: { tempered: true, grilles: '5/8 GBG 2W4H', screen: 'None' } });
  const changed = changeSeries(original, 'Hampton');
  assert.equal(changed.style, 'Hampton Single Hung');
  assert.deepEqual(changed.options, { ...original.options, series: 'Hampton' });
  for (const key of ['id', 'width', 'height', 'qty']) assert.equal(changed[key], original[key]);
  assert.equal(original.options.series, undefined);
  assert.ok(stylesForSeries('Hampton').some(item => item.value === 'Hampton Casement'));
  assert.ok(stylesForSeries('Hampton').every(item => !item.value.startsWith('Studio')));
  assert.equal(changeSeries({ ...changed, style: 'Hampton Casement' }, 'Studio Flush Fin').style, '');
});
test('explicit color changes preserve the other side and remove conflicting imported color fields', () => {
  const options = { color: 'White', exterior_color: 'Black', interior_color: 'White', tempered: true };
  const changed = changeColor(options, {}, 'interior', 'Black');
  assert.deepEqual(changed, { color: 'Black', tempered: true });
  assert.deepEqual(colorParts(changed), { exterior: 'Black', interior: 'Black' });
  assert.equal(changeColor({}, { color: 'White' }, 'exterior', 'Black').color, 'Black exterior / White interior');
});
test('grid controls distinguish per-panel 8 lite and whole-window 8 lite without modifying imported requirements', () => {
  const value = { mode: 'rectangular', type: '5/8" Flat', wide: 2, high: 4, scope: 'lite', color: 'White' };
  assert.deepEqual(parseGrilles(serializeGrilles(value)), value);
  assert.notEqual(serializeGrilles(value), serializeGrilles({ ...value, scope: 'window' }));
  assert.deepEqual(parseGrilles('5/8 GBG 2W4H on both panels'), { mode: 'custom', text: '5/8 GBG 2W4H on both panels' });
  assert.equal(serializeGrilles({ mode: 'standard' }), '');
  assert.equal(serializeGrilles({ mode: 'none' }), 'None');
  assert.throws(() => serializeGrilles({ ...value, wide: 0 }));
});
test('Hampton casement UI selections pass the strict builder contract and can route to online pricing', async () => {
  const draft = { settings: { dealer: 'BFS', yard: 'BFS-UTAH DESIGN(11)', gross_margin: 30, color: 'White', glass: 'CozE (LowE)' },
    source: { easy_request: { profile_id: 'studio-sh-standard', profile_revision: 1, confirmed: true, units: 'in', dimension_basis: 'call' } },
    lines: [createBuilderLine('Hampton Casement', { width: 44.25, height: 57, dimension_basis: 'frame', options: { series: 'Hampton', number_wide: 2, operation: 'Left / Right', grilles: serializeGrilles({ mode: 'rectangular', type: '5/8" Flat', wide: 2, high: 4, scope: 'lite', color: 'White' }) } })] };
  const validated = validateBuilderDraft(draft);
  const result = await builderReviewResponse(normalizeManualBuilderDraft(validated), { allowOnline: true });
  assert.equal(result.review.ready, true);
  assert.equal(result.draft.lines[0].style, 'Hampton Casement');
  assert.deepEqual(result.draft.lines[0].options, draft.lines[0].options);
});
