import test from 'node:test';
import assert from 'node:assert/strict';
import { applyConfiguratorSelections, changeSeries, colorParts, changeColor, parseGrilles, serializeGrilles, stylesForSeries, selectedSeries } from '../src/components/window-quotes/amscoConfiguratorModel.js';
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
test('catalog family choices preserve the requested series through online fallback', async () => {
  assert.equal(stylesForSeries('Serenity').length, 6);
  assert.equal(stylesForSeries('V2K BW').length, 4);
  for (const [series, style] of [['Serenity', 'Serenity Single Hung'], ['V2K BW', 'V2K BW Single Vent'], ['Studio SK3', 'Studio XO Slider']]) {
    const line = createBuilderLine(style, { width: 36, height: 48, dimension_basis: 'frame', options: { series, tempered: true } });
    assert.equal(selectedSeries(line), series);
    const draft = { settings: { dealer: 'BFS', yard: 'BFS-UTAH DESIGN(11)', gross_margin: 30, color: 'White', glass: 'CozE (LowE)' }, lines: [line] };
    const result = await builderReviewResponse(normalizeManualBuilderDraft(validateBuilderDraft(draft)), { allowOnline: true });
    assert.equal(result.review.ready, true, series + ': ' + JSON.stringify(result.review));
    assert.equal(result.draft.lines[0].options.series, series);
    assert.equal(result.draft.lines[0].style, style);
    assert.equal(result.draft.lines[0].options.tempered, true);
  }
  assert.equal(selectedSeries({ style: 'Serenity Single Hung' }), 'Serenity');
  assert.equal(selectedSeries({ style: 'V2K BW Single Vent' }), 'V2K BW');
  assert.equal(changeSeries({ style: 'Studio Single Hung', options: {} }, 'Serenity').style, 'Serenity Single Hung');
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


test('unit selections and accessories follow current colors through pricing and saved draft validation', () => {
  const settings = { dealer:'BFS', yard:'BFS-UTAH DESIGN(11)', gross_margin:30, color:'White', glass:'CozE (LowE)' };
  const original = createBuilderLine('Studio Single Hung', { width:36, height:66, options:{sash_split:'Uneven',unit_type:'Sash Only',hardware_color:'Black',screen:'Black',hardware:'Cam Latch, Black'} });
  for (const [color,expected] of [['White','White'],['Black exterior / White interior','White'],['Black','Black'],['Taupe','Taupe']]) {
    const selected = applyConfiguratorSelections(original, {...settings,color});
    assert.equal(selected.options.sash_split,'Even');
    assert.equal(selected.options.unit_type,'Complete Unit');
    assert.equal(selected.options.hardware_color,expected);
    assert.equal(selected.options.screen,expected);
    assert.equal(selected.options.hardware,'Cam Latch');
    const validated = validateBuilderDraft({settings:{...settings,color},lines:[selected]});
    assert.equal(validated.lines[0].options.hardware_color,expected);
    assert.equal(validated.lines[0].options.screen,expected);
  }
  const split = applyConfiguratorSelections({...original,options:{color:'Black exterior / White interior'}},settings);
  assert.equal(split.options.hardware_color,'White');
  const changed = applyConfiguratorSelections({...split,options:changeColor(split.options,settings,'interior','Black')},settings);
  assert.equal(changed.options.hardware_color,'Black');
  assert.equal(changed.options.screen,'Black');
  const withoutScreen = applyConfiguratorSelections({...changed,options:{...changed.options,screen:'None'}},settings);
  assert.equal(withoutScreen.options.screen,'None');
  const fixed = applyConfiguratorSelections(createBuilderLine('Studio Picture'),settings);
  assert.equal(fixed.options.hardware_color,undefined);
  assert.equal(fixed.options.screen,undefined);
  assert.equal(original.options.hardware_color,'Black');
  assert.equal(original.options.unit_type,'Sash Only');
});
