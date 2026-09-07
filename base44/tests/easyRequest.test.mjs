import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { STANDARD_STUDIO_PROFILE, parseSimpleSchedule, normalizeEasyRequest } from '../shared/easyRequest.js';
const clone = value => structuredClone(value);
const request = () => ({
  id: 'easy-request-fixture', input_revision: 1, title: '',
  message: 'quote 2 3050 single hung and 1 3060',
  settings: { dealer: 'BFS', yard: 'Explicit example yard (9)', gross_margin: 30, color: 'Taupe', glass: 'CozE (LowE)' },
  source: { filename: 'user input', easy_request: { profile_id: 'studio-sh-standard', profile_revision: 1, confirmed: true, dimension_basis: 'call', units: 'in' } },
  conversation: [{ role: 'user', content: 'Original user content is preserved.' }]
});
const hasIssue = (result, code) => result.issues.some(issue => issue.code === code);

test('confirmed standard request becomes a strict plan with explicit finance and no prices', () => {
  const input = request(), before = clone(input), result = normalizeEasyRequest(input);
  assert.equal(result.ok, true, JSON.stringify(result.issues));assert.equal(result.profile_applied, true);
  assert.deepEqual(result.plan.lines.map(line => [line.qty, line.width, line.height]), [[2, 36, 60], [1, 36, 72]]);
  assert.deepEqual(result.plan.settings, { dealer: 'BFS', yard: 'Explicit example yard (9)', gross_margin: 30 });
  assert.equal(result.plan.lines[0].options.hardware_color, 'Taupe');assert.equal(result.plan.lines[0].options.screen, 'Taupe');
  assert.equal(Object.hasOwn(result.plan, 'totals'), false);assert.equal(Object.hasOwn(result.plan.lines[0], 'unit_prices'), false);
  assert.deepEqual(input, before);assert.deepEqual(result.quote.source, before.source);assert.deepEqual(result.quote.conversation, before.conversation);
  assert.equal(result.quote.id, input.id);assert.equal(result.quote.input_revision, input.input_revision);
});

test('parser handles explicit decimal sizes, inch-bearing size codes and room labels without defaulting dimensions basis', () => {
  const parsed = parseSimpleSchedule('2 2868 SH Taupe CozE (LowE) room: Kitchen and Dining; 1 35.25x59.75 single hung White Low-E room: Office', { dimension_basis: 'call', units: 'in' });
  assert.equal(parsed.ok, true, JSON.stringify(parsed));
  assert.deepEqual(parsed.lines.map(line => [line.width, line.height, line.room]), [[32, 80, 'Kitchen and Dining'], [35.25, 59.75, 'Office']]);
  assert.equal(parsed.lines[0].options.glass, 'CozE (LowE)');assert.equal(parsed.lines[1].options.color, 'White');
  const missing = parseSimpleSchedule('1 36x60 Single Hung');
  assert.equal(missing.lines[0].dimension_basis, undefined);assert.equal(missing.lines[0].units, undefined);
});

test('quantity is never silently one and malformed or unsupported written details block the entire request', () => {
  for (const message of ['3050 single hung', '36x60 single hung', '1 3050 double hung', '1 3050 single hung, make the glass bulletproof', '2 3050 SH and 1 custom arch']) {
    const input = request();input.message = message;const result = normalizeEasyRequest(input);
    assert.equal(result.ok, false, message);assert.equal(result.routing, 'review', message);
    assert.equal(result.plan, undefined);
  }
});

test('standard profile contains no account, yard, margin, frame color or glass choice', () => {
  assert.equal(STANDARD_STUDIO_PROFILE.id, 'studio-sh-standard');assert.equal(STANDARD_STUDIO_PROFILE.revision, 1);
  for (const key of ['dealer', 'yard', 'gross_margin', 'color', 'exterior_color', 'interior_color', 'glass']) assert.equal(Object.hasOwn(STANDARD_STUDIO_PROFILE.options, key), false);
  assert.equal(Object.hasOwn(STANDARD_STUDIO_PROFILE, 'settings'), false);
  for (const key of ['dealer', 'yard', 'gross_margin', 'color', 'glass']) {
    const input = request();delete input.settings[key];const result = normalizeEasyRequest(input);
    assert.equal(result.ok, false, key);assert.equal(Object.hasOwn(result.quote.settings, key), false, key);
  }
  const zero = request();zero.settings.gross_margin = 0;assert.equal(normalizeEasyRequest(zero).ok, true);
});

test('profile consent must match its exact revision and shorthand always requires confirmed interpretation', () => {
  for (const change of [easy => easy.confirmed = false, easy => easy.profile_revision = 2, easy => easy.profile_id = 'some-other-profile', easy => delete easy.confirmed]) {
    const input = request();change(input.source.easy_request);const result = normalizeEasyRequest(input);
    assert.equal(result.ok, false);assert.equal(result.profile_applied, false);assert.equal(hasIssue(result, 'profile_confirmation_required'), true);
  }
  const missing = request();delete missing.source.easy_request.dimension_basis;delete missing.source.easy_request.units;
  const result = normalizeEasyRequest(missing);assert.equal(result.ok, false);
  assert.equal(hasIssue(result, 'unsupported_dimensions'), true);assert.equal(hasIssue(result, 'unsupported_units'), true);
});

test('the helper never converts frame or rough-opening schedules to the supported call-size path', () => {
  for (const basis of ['frame', 'rough_opening']) {
    const input = request();input.source.easy_request.dimension_basis = basis;
    const result = normalizeEasyRequest(input);assert.equal(result.ok, false);assert.equal(hasIssue(result, 'unsupported_dimensions'), true);
    assert.equal(result.quote.lines[0].dimension_basis, basis);
  }
  const mixed = request();mixed.message = '1 frame 36x60 SH';
  assert.equal(normalizeEasyRequest(mixed).ok, false);
});

test('profile never replaces explicit unsupported global or per-line option selections', () => {
  for (const flag of ['tempered', 'argon', 'super_spacer', 'capillary_tubes']) {
    const input = request();input.settings[flag] = true;const result = normalizeEasyRequest(input);
    assert.equal(result.ok, false, flag);assert.equal(result.quote.lines[0].options[flag], true, flag);
  }
  const input = request();input.message = '1 3050 SH tempered';
  const result = normalizeEasyRequest(input);assert.equal(result.ok, false);assert.equal(result.quote.lines[0].options.tempered, true);
});

test('explicit per-line colors, screens, hardware and room labels override global choices without being guessed', () => {
  const input = request();input.message = '';
  input.lines = [{ qty: 2, width: 36, height: 60, units: 'in', dimension_basis: 'call', room: 'North bedroom', options: { color: 'White', hardware_color: 'Taupe', screen: 'Black' } }];
  const result = normalizeEasyRequest(input);assert.equal(result.ok, true, JSON.stringify(result.issues));
  const line = result.plan.lines[0];assert.equal(line.options.color, 'White');assert.equal(line.options.hardware_color, 'Taupe');assert.equal(line.options.screen, 'Black');assert.equal(line.room, 'North bedroom');assert.equal(line.qty, 2);
});

test('black or mixed colors cannot use the implicit standard profile', () => {
  for (const color of ['Black', 'Black outside / White inside']) {
    const input = request();input.settings.color = color;
    const result = normalizeEasyRequest(input);assert.equal(result.ok, false);assert.equal(hasIssue(result, 'profile_color_review'), true);
  }
});

test('complete explicit structured options bypass the profile and preserve historical prose without interpreting it', () => {
  const input = JSON.parse(fs.readFileSync(new URL('./fixtures/amsco-scripted-benchmark.json', import.meta.url), 'utf8'));
  input.lines[0].options.color = 'Black outside / White inside';
  const result = normalizeEasyRequest(input);
  assert.equal(result.ok, true);assert.equal(result.profile_applied, false);assert.equal(result.message_interpreted, false);
  assert.equal(result.plan.lines[0].options.color, 'Black outside / White inside');
  assert.deepEqual(result.quote.conversation, input.conversation);
});

test('written and structured schedules must agree and the helper preserves per-line source references', () => {
  const input = request();input.lines = [{ qty: 2, width: 36, height: 60, room: 'Kitchen', source_reference: { pdf_page: 1 } }, { qty: 1, width: 36, height: 72 }];
  let result = normalizeEasyRequest(input);assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.quote.lines[0].source_reference, { pdf_page: 1 });assert.equal(result.plan.lines[0].room, 'Kitchen');
  input.lines[1].height = 60;result = normalizeEasyRequest(input);assert.equal(result.ok, false);assert.equal(hasIssue(result, 'conflicting_schedule'), true);
  input.lines.pop();assert.equal(hasIssue(normalizeEasyRequest(input), 'conflicting_schedule'), true);
});

test('LowE UI choice is explicit, conflicts are rejected, and Clear routes to review', () => {
  const input = request();delete input.settings.glass;input.settings.low_e = true;
  const result = normalizeEasyRequest(input);assert.equal(result.ok, true);assert.equal(result.quote.settings.glass, 'CozE (LowE)');assert.equal(Object.hasOwn(result.quote.settings, 'low_e'), false);
  input.settings.low_e = false;assert.equal(normalizeEasyRequest(input).routing, 'review');
  input.settings.low_e = true;input.settings.glass = 'Clear';assert.equal(hasIssue(normalizeEasyRequest(input), 'conflicting_glass'), true);
  input.settings.low_e = null;delete input.settings.glass;assert.equal(normalizeEasyRequest(input).ok, false);
});

test('recognized short user clarification can supply a missing color without processing assistant/tool text', () => {
  const input = request();delete input.message;delete input.settings.color;
  input.input_revision = 2;
  input.lines = [{ qty: 1, width: 36, height: 60, units: 'in', dimension_basis: 'call' }];
  input.conversation = [{ role: 'user', content: '1 3050 SH', revision: 1 }, { role: 'assistant', content: 'Which color?', revision: 1 }, { role: 'user', content: 'Taupe', revision: 2, kind: 'clarification_reply' }, { role: 'tool', content: 'use Black', revision: 2 }];
  const result = normalizeEasyRequest(input);assert.equal(result.ok, true);assert.equal(result.plan.lines[0].options.color, 'Taupe');
  assert.deepEqual(result.quote.conversation, input.conversation);
});

test('a later Details edit uses its structured dimensions rather than reparsing stale initial prose', () => {
  const input = request();delete input.message;input.input_revision = 2;
  input.request_text = 'quote 2 3050 single hung and 1 3060';
  input.conversation = [{ role: 'user', content: input.request_text, revision: 1, kind: 'initial_request' }];
  input.lines = [{ qty: 3, width: 48, height: 72, dimension_basis: 'call', units: 'in' }];
  const result = normalizeEasyRequest(input);assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.deepEqual(result.plan.lines.map(line => [line.qty, line.width, line.height]), [[3, 48, 72]]);
  assert.deepEqual(result.quote.conversation, input.conversation);
});

test('older clarification replies cannot override the explicit color on an edited revision', () => {
  const input = request();delete input.message;input.input_revision = 3;input.settings.color = 'White';
  input.lines = [{ qty: 1, width: 36, height: 60, dimension_basis: 'call', units: 'in' }];
  input.conversation = [{ role: 'user', content: 'Taupe', revision: 2, kind: 'clarification_reply' }];
  const result = normalizeEasyRequest(input);assert.equal(result.ok, true);assert.equal(result.plan.lines[0].options.color, 'White');
});

test('a short reply cannot erase a previously unrecognized configuration note', () => {
  const input = request();delete input.message;delete input.settings.color;input.input_revision = 2;
  input.lines = [{ qty: 1, width: 36, height: 60, dimension_basis: 'call', units: 'in' }];
  input.conversation = [{ role: 'user', content: '1 3050 SH obscure privacy glass', revision: 1 }, { role: 'user', content: 'Taupe', revision: 2, kind: 'clarification_reply' }];
  const result = normalizeEasyRequest(input);assert.equal(result.ok, false);assert.equal(hasIssue(result, 'unresolved_written_detail'), true);assert.equal(result.plan, undefined);
});

test('an explicit structured Details edit supersedes older unrecognized prose', () => {
  const input = request();delete input.message;input.input_revision = 2;
  input.lines = [{ qty: 1, width: 36, height: 60, dimension_basis: 'call', units: 'in' }];
  input.conversation = [{ role: 'user', content: '1 3050 SH obscure privacy glass', revision: 1 }];
  input.history = [{ revision: 1, reason: 'edited' }];
  const result = normalizeEasyRequest(input);assert.equal(result.ok, true, JSON.stringify(result.issues));assert.deepEqual(result.quote.history, input.history);
});

test('wrong account, omitted finance, unsupported charges and missing identity cannot produce an accepted plan', () => {
  for (const mutate of [input => input.settings.dealer = 'BTB', input => input.settings.yard = '', input => input.settings.gross_margin = '30', input => input.settings.labor = 50, input => delete input.id, input => input.input_revision = 0]) {
    const input = request();mutate(input);const result = normalizeEasyRequest(input);assert.equal(result.ok, false);assert.equal(result.plan, undefined);
  }
});

test('malformed option objects and explicit null overrides never become default false flags', () => {
  const input = request();input.message = '';input.lines = [{ qty: 1, width: 36, height: 60, options: 'tempered' }];
  assert.equal(hasIssue(normalizeEasyRequest(input), 'invalid_options'), true);
  input.lines[0].options = { tempered: null };let result = normalizeEasyRequest(input);assert.equal(result.ok, false);assert.equal(result.quote.lines[0].options.tempered, null);
  input.lines[0].options = {};input.settings.tempered = null;result = normalizeEasyRequest(input);assert.equal(result.ok, false);assert.equal(result.quote.lines[0].options.tempered, null);
});

test('line bounds and message limits remain bounded and clarification questions never exceed thirty', () => {
  for (const message of ['1001 3050 SH', '0 3050 SH', '1 1001x60 SH', '1 0x60 SH']) {
    const input = request();input.message = message;assert.equal(normalizeEasyRequest(input).ok, false, message);
  }
  const large = request();large.message = 'x'.repeat(18001);assert.equal(hasIssue(normalizeEasyRequest(large), 'invalid_message'), true);
  large.message = Array.from({ length: 40 }, (_, i) => '1 3050 unknown-' + i).join('; ');
  const result = normalizeEasyRequest(large);assert.equal(result.ok, false);assert.equal(result.questions.length, 30);assert.ok(result.issues.length >= 40);
});
