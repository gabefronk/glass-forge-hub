import test from 'node:test';
import assert from 'node:assert/strict';
import { parseBuilderImport, BUILDER_IMPORT_OPTION_TYPES } from '../src/components/window-quotes/builderImport.js';
import { CSV_TEMPLATE } from '../src/components/window-quotes/takeoff.js';
import { buildBuilderPreview } from '../src/components/window-quotes/windowBuilderModel.js';
import { STANDARD_STUDIO_PROFILE } from '../src/lib/easyRequest.js';
const row = overrides => ({ mark: 'W1', style: 'Studio Picture', width: 48, height: 48, dimension_basis: 'call', units: 'in', qty: 1, ...overrides });
const fromJSON = value => parseBuilderImport(JSON.stringify(value), 'windows.json');
const settings = { dealer: 'BFS', yard: 'BFS-UTAH DESIGN (11)', gross_margin: 30, color: 'White', glass: 'CozE (LowE)' };
const source = { easy_request: { confirmed: true, profile_id: STANDARD_STUDIO_PROFILE.id, profile_revision: STANDARD_STUDIO_PROFILE.revision, units: 'in', dimension_basis: 'call' } };

test('bundled CSV template becomes a strict builder row without top-level option duplicates', () => {
  const result = parseBuilderImport(CSV_TEMPLATE, 'template.csv');
  assert.equal(result.lines.length, 1); const line = result.lines[0];
  assert.equal(line.width, 36); assert.equal(line.height, 60); assert.equal(line.qty, 2); assert.equal(line.room, 'Bedroom');
  assert.equal(line.options.color, 'White'); assert.equal(line.options.glass, 'CozE (LowE)');
  for (const key of ['color', 'glass', 'series']) assert.equal(Object.hasOwn(line, key), false);
  assert.equal(buildBuilderPreview(settings, result.lines, source).ok, true);
  assert.deepEqual(result.source, { filename: 'template.csv', format: 'csv' });
});
test('CSV patternedGlass, argon, grille and all other supported option columns survive in options', () => {
  const options = Object.fromEntries(Object.entries(BUILDER_IMPORT_OPTION_TYPES).map(([key, type]) => [key, type === 'boolean' ? 'true' : type === 'number' ? '2' : `Explicit ${key}`]));
  const base = row(); const headers = [...Object.keys(base), ...Object.keys(options)];
  const result = parseBuilderImport(headers.join(',') + '\n' + [...Object.values(base), ...Object.values(options)].join(','));
  for (const [key, type] of Object.entries(BUILDER_IMPORT_OPTION_TYPES)) {
    assert.equal(typeof result.lines[0].options[key], type); assert.equal(Object.hasOwn(result.lines[0], key), false);
  }
  const camel = parseBuilderImport('style,width,height,qty,units,basis,patternedGlass,argon,grille\nPicture,48,48,1,in,call,Obscure,yes,Colonial');
  assert.deepEqual(camel.lines[0].options, { patterned_glass: 'Obscure', argon: true, grilles: 'Colonial' });
  const preview = buildBuilderPreview(settings, camel.lines, source);
  assert.equal(preview.ok, false); assert.equal(preview.normalizedLines[0].options.patterned_glass, 'Obscure');
  assert.equal(preview.normalizedLines[0].options.argon, true); assert.equal(preview.normalizedLines[0].options.grilles, 'Colonial');
});
test('false booleans stay false and blanks remain omitted rather than becoming false', () => {
  for (const value of [false, 0, 'false', 'FALSE', 'no', 'No', '0']) {
    const result = fromJSON([row({ tempered: value, options: { argon: value, super_spacer: '', capillary_tubes: null } })]);
    assert.deepEqual(result.lines[0].options, { argon: false, tempered: false });
  }
  for (const value of ['maybe', 'None', 2, [], {}]) assert.throws(() => fromJSON([row({ tempered: value })]), /tempered.*true\/false/);
});
test('JSON nested options and CSV options JSON preserve types and explicit specifications', () => {
  const nested = fromJSON({ lines: [row({ options: { patterned_glass: 'Obscure', tempered: true, number_wide: 1 } })], source: { filename: 'source.csv', format: 'csv' } });
  assert.deepEqual(nested.lines[0].options, { patterned_glass: 'Obscure', tempered: true, number_wide: 1 });
  assert.deepEqual(nested.source.supplied, { filename: 'source.csv', format: 'csv' });
  const csv = 'style,width,height,qty,units,basis,options\nPicture,48,48,1,in,call,"{""tempered"":false,""argon"":""no""}"';
  assert.deepEqual(parseBuilderImport(csv).lines[0].options, { tempered: false, argon: false });
});
test('conflicting top-level and nested options reject the complete import', () => {
  for (const [key, top, nested] of [['patterned_glass','Obscure','None'],['argon',false,true],['number_wide',1,2],['color','White','Taupe']]) {
    assert.throws(() => fromJSON([row(), row({ [key]: top, options: { [key]: nested } })]), /Line 2: conflicting/);
  }
  assert.deepEqual(fromJSON([row({ tempered: 'no', options: { tempered: false } })]).lines[0].options, { tempered: false });
  assert.deepEqual(fromJSON([row({ patterned_glass: '', options: { patterned_glass: 'Obscure' } })]).lines[0].options, { patterned_glass: 'Obscure' });
});
test('unknown instructions and execution fields are visibly blocked, including nested and wrapper data', () => {
  for (const field of ['notes', 'special_instructions', 'price', 'native_default_fields', 'request_text']) {
    assert.throws(() => fromJSON([row({ [field]: 'Keep my explicit requirement' })]), /Line 1:.*cannot be imported.*AI guide/);
  }
  assert.throws(() => fromJSON([row({ options: { safety_lock: true } })]), /Line 1 options:.*safety lock/);
  assert.throws(() => fromJSON({ lines: [row()], notes: 'Custom etched glass' }), /Schedule:.*notes/);
  assert.throws(() => fromJSON({ lines: [row()], source: { notes: 'Custom etched glass' } }), /Schedule source:.*notes/);
});
test('duplicate aliases cannot overwrite customer values', () => {
  assert.throws(() => fromJSON([row({ quantity: 2 })]), /duplicate.*qty/);
  assert.throws(() => fromJSON([row({ options: { patterned_glass: 'None', patternedGlass: 'Obscure' } })]), /duplicate.*patterned glass/);
  assert.throws(() => parseBuilderImport('style,width,height,qty,quantity\nPicture,48,48,1,2'), /headers must be nonempty and unique/);
});
test('rows and marks are not merged and duplicate IDs receive separate safe IDs', () => {
  const records = [row({ id: 'old', room: 'Kitchen' }), row({ id: 'old', room: 'Bedroom' })], before = structuredClone(records);
  const result = fromJSON(records);
  assert.equal(result.lines.length, 2); assert.notEqual(result.lines[0].id, result.lines[1].id);
  assert.deepEqual(result.lines.map(line => line.mark), ['W1', 'W1']);
  assert.deepEqual(result.lines.map(line => line.room), ['Kitchen', 'Bedroom']); assert.deepEqual(records, before);
});
test('aliases, quoted multiline rooms and exact measurement bases normalize without size conversion', () => {
  const csv = 'window_style,width_in,height_in,quantity,unit,dimension_type,location\nPicture,48,48,2,inches,frame size,"Kitchen, east\nwall"';
  const line = parseBuilderImport(csv).lines[0];
  assert.equal(line.width, 48); assert.equal(line.height, 48); assert.equal(line.qty, 2);
  assert.equal(line.dimension_basis, 'frame'); assert.equal(line.room, 'Kitchen, east\nwall');
});
test('malformed, missing and oversized schedules fail before producing replacement rows', () => {
  for (const value of ['', '[]', '{broken', 'null']) assert.throws(() => parseBuilderImport(value, 'x.json'));
  assert.throws(() => fromJSON([row({ options: '{bad' })]), /options must be valid JSON/);
  assert.throws(() => fromJSON([row({ qty: '' })]), /quantity/);
  assert.throws(() => fromJSON([row({ width: '' })]), /width is required/);
  assert.throws(() => fromJSON([row({ height: 'not a size' })]), /numeric height/);
  assert.throws(() => fromJSON([row({ units: 'cm' })]), /use inches/);
  assert.throws(() => fromJSON([row({ dimension_basis: '' })]), /specify call size/);
  assert.throws(() => fromJSON(Array.from({ length: 201 }, () => row())), /at most 200/);
});
