import test from 'node:test';
import assert from 'node:assert/strict';
import { dimensionLabel, isStandardSize, standardHeights, standardSizeGrid, standardWidths } from '../src/components/window-quotes/amscoStandardSizes.js';

test('standard sizes follow the selected AMSCO series and window type', () => {
  const singleHung = { style: 'Studio Single Hung', options: { series: 'Studio 1 3/8 inch Fin Setback' } };
  assert.deepEqual(standardWidths(singleHung), [12, 18, 24, 30, 36, 42, 48, 54]);
  assert.equal(standardHeights(singleHung, undefined, 36).at(-1), 102);

  const doubleVent = { style: 'Hampton Double Vent', options: { series: 'Hampton' } };
  assert.equal(standardWidths(doubleVent).at(0), 60);
  assert.equal(standardWidths(doubleVent).at(-1), 156);
  assert.equal(standardHeights(doubleVent, undefined, 84).at(-1), 84);
});

test('height choices narrow to cells present in the PK361 grid', () => {
  const picture = { style: 'Hampton Direct Set', options: { series: 'Hampton' } };
  assert.equal(standardHeights(picture, undefined, 72).at(-1), 132);
  assert.equal(standardHeights(picture, undefined, 96).at(-1), 90);
  assert.equal(standardHeights(picture, undefined, 120).at(-1), 78);

  const v2k = { style: 'V2K BW Single Vent', options: { series: 'V2K BW' } };
  assert.deepEqual(standardHeights(v2k, undefined, 24), [24, 36]);
  assert.deepEqual(standardHeights(v2k, undefined, 72), [36, 48, 60]);
});

test('unsupported geometry falls back to custom measurements without dropping values', () => {
  assert.equal(standardSizeGrid({ style: 'Studio Radius', options: { series: 'Studio SK3' } }), null);
  const line = { style: 'Studio XO Slider', width: 60, height: '', options: { series: 'Studio Flush Fin' } };
  assert.equal(isStandardSize(line, undefined, { allowPartial: true }), true);
  assert.equal(isStandardSize({ ...line, height: 72 }), true);
  assert.equal(isStandardSize({ ...line, height: 73 }), false);
});

test('dimension labels show inches and a field-friendly feet-inch reading', () => {
  assert.equal(dimensionLabel(60), '60" · 5′0″');
  assert.equal(dimensionLabel(17.5), '17.5" · 1′5.5″');
});
