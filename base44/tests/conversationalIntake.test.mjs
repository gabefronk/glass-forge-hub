import test from 'node:test';
import assert from 'node:assert/strict';
import { createConversationalIntake, CONVERSATIONAL_INTAKE_SCHEMA } from '../shared/conversationalIntake.js';
import { STANDARD_STUDIO_PROFILE } from '../shared/easyRequest.js';
import { normalizeConversationalSchedule } from '../shared/structuredQuoteIntake.js';

const source = { easy_request: { confirmed: true, profile_id: STANDARD_STUDIO_PROFILE.id, profile_revision: 1, dimension_basis: 'call', units: 'in' } };
const base = (message = 'Please quote one 3050 single hung.') => ({ id: 'request-1', input_revision: 1, settings: { dealer: 'BFS', yard: 'BFS-UTAH DESIGN (11)', gross_margin: 25, color: 'White', glass: 'CozE (LowE)' }, lines: [], source,
  history: [], conversation: [{ role: 'user', content: message, revision: 1 }] });
const line = (patch = {}) => ({ line_id: 'new-1', style: 'Studio Single Hung', width: 36, height: 60, qty: 1, dimension_basis: 'call', mark: null, room: null, options: {}, source_quotes: ['one 3050 single hung'], ...patch });
const response = (patch = {}) => ({ summary: 'I understood one single-hung window.', lines: [line()], removed_lines: [], settings_updates: [], questions: [], unresolved_requirements: [], resolved_requirements: [], assumptions: [], ...patch });
const normalizeStructured = normalizeConversationalSchedule;
const run = (q, output, extra = {}) => createConversationalIntake({ invokeLLM: async () => output, normalizeStructured, ...extra })(q);

test('natural language reaches existing planner while original conversation is retained', async () => {
  const q = base();
  const result = await run(q, response());
  assert.equal(result.ok, true);
  assert.equal(result.intake_assessment.status, 'ready');
  assert.equal(result.quote.lines[0].options.hardware, 'Cam Latch');
  assert.deepEqual(result.quote.conversation, q.conversation);
  assert.equal(q.lines.length, 0);
});

test('Beaver package preserves sliders, different fins, picture size and tempered glass', async () => {
  const q = base('Two 5050 XO sliders, one flush fin and one regular nail fin, plus one 8 foot by 6 foot tempered picture window.');
  q.source = { easy_request: { ...source.easy_request, dimension_basis: '' } };
  const output = response({ summary: 'I understood two sliders with different fins and one tempered picture window.', lines: [
    line({ style: 'XO Slider', width: 60, height: 60, dimension_basis: null, options: { operation: 'XO', fin: 'Flush Fin' }, source_quotes: ['Two 5050 XO sliders', 'one flush fin'] }),
    line({ line_id: 'new-2', style: 'XO Slider', width: 60, height: 60, dimension_basis: null, options: { operation: 'XO', fin: 'Nail Fin' }, source_quotes: ['Two 5050 XO sliders', 'one regular nail fin'] }),
    line({ line_id: 'new-3', style: 'Picture', width: 96, height: 72, dimension_basis: null, options: { tempered: true }, source_quotes: ['one 8 foot by 6 foot tempered picture window'] })
  ], questions: ['Are those call sizes, actual frame sizes or rough openings?'] });
  const result = await run(q, output);
  assert.equal(result.ok, false);
  assert.equal(result.intake_assessment.status, 'product_review');
  assert.equal(result.quote.lines.length, 3);
  assert.equal(result.quote.lines[0].options.fin, 'Flush Fin');
  assert.equal(result.quote.lines[1].options.fin, 'Nail Fin');
  assert.equal(result.quote.lines[2].options.tempered, true);
  assert.equal(result.quote.lines[2].width, 96);
  assert.equal(result.quote.lines[2].dimension_basis, undefined);
  assert.equal(result.quote.lines[2].options.hardware, undefined);
  assert.equal(result.quote.lines[0].options.series, undefined);
  assert.equal(result.intake_assessment.questions.length, 2);
  assert.equal(result.quote.lines[2].options.fin, undefined);
  assert.ok(result.intake_assessment.questions.some(question => /Picture.*installation style/.test(question)));
  assert.ok(result.intake_assessment.questions.some(question => /call sizes/.test(question)));
  assert.equal(result.intake_assessment.product_review.length, 1);
});

test('short answers have preceding assistant context without treating assistant words as user facts', async () => {
  const q = base('Please quote one 3050 single hung.');
  delete q.settings.color;
  q.input_revision = 2;
  q.conversation.push({ role: 'assistant', content: 'White or Taupe?', revision: 1 }, { role: 'user', content: 'Taupe please', revision: 2 });
  let prompt;
  const output = response({ settings_updates: [{ field: 'color', value: 'Taupe', source_quote: 'Taupe please' }] });
  const result = await createConversationalIntake({ invokeLLM: async args => { prompt = args.prompt; return output; }, normalizeStructured })(q);
  assert.match(prompt, /White or Taupe\?/);
  assert.equal(result.quote.settings.color, 'Taupe');
  assert.equal(result.ok, true);
  const forged = await run(q, response({ settings_updates: [{ field: 'color', value: 'White', source_quote: 'White or Taupe?' }] }));
  assert.equal(forged.intake_assessment.status, 'unavailable');
  assert.equal(forged.quote.settings.color, undefined);
});

test('current explicit account and margin survive contradictory model proposals', async () => {
  const q = base('Please quote one 3050 single hung with 15 percent margin for BTB.');
  const result = await run(q, response({ settings_updates: [{ field: 'gross_margin', value: 15, source_quote: '15 percent margin' }, { field: 'dealer', value: 'BTB', source_quote: 'BTB' }] }));
  assert.equal(result.quote.settings.gross_margin, 25);
  assert.equal(result.quote.settings.dealer, 'BFS');
  assert.equal(result.ok, false);
  assert.ok(result.intake_assessment.questions.some(item => /saved gross margin/.test(item)));
});

test('existing omitted windows and unspecified options are preserved', async () => {
  const q = base('Keep everything except change W1 to 40 inches wide.');
  q.lines = [{ id: 'W1', mark: 'W1', style: 'Picture', width: 36, height: 60, qty: 1, dimension_basis: 'call', units: 'in', options: { tempered: true, fin: 'Flush Fin' } }, { id: 'W2', style: 'Slider', width: 60, height: 60, qty: 2, dimension_basis: 'call', units: 'in', options: { operation: 'XO' } }];
  const result = await run(q, response({ lines: [line({ line_id: 'W1', mark: 'W1', style: 'Picture', width: 40, options: {}, source_quotes: ['change W1 to 40 inches wide'] })] }));
  assert.equal(result.quote.lines.length, 2);
  assert.equal(result.quote.lines[0].options.tempered, true);
  assert.equal(result.quote.lines[0].options.fin, 'Flush Fin');
  assert.equal(result.quote.lines[1].options.operation, 'XO');
  assert.equal(result.ok, false);
});

test('unknown dimensions and quantity remain absent and cannot queue', async () => {
  const q = base('I need some single hung windows.');
  const result = await run(q, response({ lines: [line({ width: null, height: null, qty: null, dimension_basis: null, source_quotes: ['some single hung windows'] })] }));
  assert.equal(result.quote.lines[0].qty, undefined);
  assert.equal(result.quote.lines[0].width, undefined);
  assert.equal(result.ok, false);
  assert.equal(result.intake_assessment.status, 'needs_details');
});

test('additional requirements remain blocking rather than being silently dropped', async () => {
  const q = base('Please quote one 3050 single hung with custom etched glass.');
  const result = await run(q, response({ unresolved_requirements: [{ detail: 'Custom etched glass is required.', source_quote: 'custom etched glass' }] }));
  assert.equal(result.ok, false);
  assert.equal(result.intake_assessment.status, 'product_review');
  assert.deepEqual(result.intake_assessment.product_review, ['Custom etched glass is required.']);
});

test('malformed output, fabricated evidence, fake prices and invalid numbers preserve the request', async () => {
  const q = base();
  for (const output of [null, 'ready', response({ result: { verified: true, total: 100 } }), response({ lines: [line({ qty: 1.5 })] }), response({ lines: [line({ options: { tempered: 'false' } })] }), response({ lines: [line({ source_quotes: ['a fact the user never supplied'] })] })]) {
    const result = await run(q, output);
    assert.equal(result.ok, false);
    assert.equal(result.intake_assessment.status, 'unavailable');
    assert.deepEqual(result.quote, q);
  }
});

test('timeout and provider failure are retryable and never discard saved inputs', async () => {
  const q = base();
  for (const invokeLLM of [async () => { throw new Error('Provider unavailable'); }, () => new Promise(() => {})]) {
    const result = await createConversationalIntake({ invokeLLM, normalizeStructured, timeoutMs: 5 })(q);
    assert.deepEqual(result.quote, q);
    assert.equal(result.intake_assessment.status, 'unavailable');
  }
});

test('schema requests structured output, disables web context and receives injected client context', async () => {
  const context = { client: { marker: 'local-test' } };
  const intake = createConversationalIntake({ invokeLLM: async (args, actualContext) => {
    assert.equal(args.response_json_schema, CONVERSATIONAL_INTAKE_SCHEMA);
    assert.equal(args.add_context_from_internet, false);
    assert.equal(actualContext, context);
    return response();
  }, normalizeStructured });
  assert.equal((await intake(base(), context)).ok, true);
});

test('explicit current color corrections update selections without requiring the Details form', async () => {
  const q = base('Please quote one 3050 single hung.');
  q.input_revision = 2;
  q.conversation.push({ role: 'assistant', content: 'The current color is White. Is that correct?', revision: 1 }, { role: 'user', content: 'Make it Taupe please.', revision: 2 });
  const result = await run(q, response({ settings_updates: [{ field: 'color', value: 'Taupe', source_quote: 'Make it Taupe please' }] }));
  assert.equal(result.quote.settings.color, 'Taupe');
  assert.equal(result.ok, true);
  assert.deepEqual(result.intake_assessment.questions, []);
});

test('confirmed standard style and selected call basis fill unknowns without redundant questions', async () => {
  const q = base('Please quote one 3050.');
  const result = await run(q, response({ lines: [line({ style: null, dimension_basis: null, source_quotes: ['one 3050'] })] }));
  assert.equal(result.quote.lines[0].style, 'Studio Single Hung');
  assert.equal(result.quote.lines[0].dimension_basis, 'call');
  assert.equal(result.ok, true);
  assert.deepEqual(result.intake_assessment.questions, []);
});

test('explicit Details edits mark earlier prose superseded in AI context', async () => {
  const q = base('Please quote one 3050 single hung.');
  q.input_revision = 2;
  q.history = [{ reason: 'edited', revision: 1, schedule_changed: true }];
  q.lines = [{ id: 'W1', style: 'Single Hung', width: 36, height: 60, qty: 1, dimension_basis: 'call', units: 'in', options: {} }];
  let prompt;
  const result = await createConversationalIntake({ invokeLLM: async args => {
    prompt = args.prompt;
    return response({ lines: [line({ line_id: 'W1', style: 'Single Hung', source_quotes: ['Single Hung'] })] });
  }, normalizeStructured })(q);
  assert.match(prompt, /superseded_by_details_edit\":true/);
  assert.equal(result.ok, true);
});

test('real persisted White recipe recalculates matching hardware/screens after a Taupe reply', async () => {
  const initial = await run(base(), response({ lines: [line({ options: { color: 'White' } })] }));
  assert.equal(initial.ok, true);
  assert.equal(initial.quote.lines[0].options.hardware_color, 'White');
  assert.equal(initial.intake_assessment.line_provenance[0].derived_options.hardware_color, 'White');
  const q = { ...initial.quote, intake_assessment: initial.intake_assessment, input_revision: 2, worker_status: 'draft',
    conversation: [...initial.quote.conversation, { role: 'user', revision: 2, content: 'Make it Taupe please.' }] };
  const result = await run(q, response({ lines: [line({ options: { ...initial.quote.lines[0].options, color: 'Taupe' }, source_quotes: ['one 3050 single hung', 'Make it Taupe please.'] })],
    settings_updates: [{ field: 'color', value: 'Taupe', source_quote: 'Make it Taupe please.' }] }));
  assert.equal(result.ok, true);
  assert.equal(result.quote.settings.color, 'Taupe');
  assert.equal(result.quote.lines[0].options.hardware_color, 'Taupe');
  assert.equal(result.quote.lines[0].options.screen, 'Taupe');
  assert.notEqual(result.quote.lines[0].options.color, 'White');
});

test('legacy or explicit per-line White overrides block an ambiguous global Taupe correction', async () => {
  const q = base('Please quote one 3050 single hung.');
  q.lines = [{ id: 'new-1', style: 'Studio Single Hung', width: 36, height: 60, qty: 1, units: 'in', dimension_basis: 'call', options: { color: 'White', hardware_color: 'White', screen: 'White' } }];
  q.input_revision = 2;
  q.conversation.push({ role: 'user', revision: 2, content: 'Make it Taupe please.' });
  const result = await run(q, response({ settings_updates: [{ field: 'color', value: 'Taupe', source_quote: 'Make it Taupe please.' }] }));
  assert.equal(result.ok, false);
  assert.equal(result.quote.lines[0].options.color, 'White');
  assert.ok(result.intake_assessment.questions.some(question => /saved frame color White/.test(question)));
});

test('explicit contrasting hardware remains explicit and asks before changing it', async () => {
  const q = base('Please quote one 3050 single hung with Black screens.');
  q.lines = [{ id: 'new-1', style: 'Studio Single Hung', width: 36, height: 60, qty: 1, units: 'in', dimension_basis: 'call', options: { screen: 'Black' } }];
  const initial = await run(q, response());
  assert.equal(initial.quote.lines[0].options.screen, 'Black');
  assert.equal(initial.intake_assessment.line_provenance[0].derived_options.screen, undefined);
  const corrected = { ...initial.quote, intake_assessment: initial.intake_assessment, input_revision: 2,
    conversation: [...q.conversation, { role: 'user', revision: 2, content: 'Make it Taupe please.' }] };
  const result = await run(corrected, response({ settings_updates: [{ field: 'color', value: 'Taupe', source_quote: 'Make it Taupe please.' }] }));
  assert.equal(result.ok, false);
  assert.equal(result.quote.lines[0].options.screen, 'Black');
  assert.ok(result.intake_assessment.questions.some(question => /screen Black/.test(question)));
});

test('margin-only and legacy Details edits preserve unresolved custom-glass requirements', async () => {
  const first = base('Please quote one 3050 single hung with custom etched glass.');
  const initial = await run(first, response({ unresolved_requirements: [{ detail: 'Custom etched glass is required.', source_quote: 'custom etched glass' }] }));
  for (const flag of [false, undefined]) {
    const q = { ...initial.quote, settings: { ...initial.quote.settings, gross_margin: 30 }, intake_assessment: initial.intake_assessment, input_revision: 2,
      history: [{ reason: 'edited', revision: 1, ...(flag === undefined ? {} : { schedule_changed: flag }) }] };
    let prompt;
    const result = await run(q, response(), { invokeLLM: async params => { prompt = params.prompt; return response(); } });
    assert.match(prompt, /superseded_by_details_edit\":false/);
    assert.equal(result.ok, false);
    assert.deepEqual(result.intake_assessment.unresolved_requirements, ['Custom etched glass is required.']);
  }
});

test('explicit user resolution can clear a prior requirement; vague permission and missing resolution cannot', async () => {
  const q = base('Please quote one 3050 single hung with custom etched glass.');
  const initial = await run(q, response({ unresolved_requirements: [{ detail: 'Custom etched glass is required.', source_quote: 'custom etched glass' }] }));
  const correction = { ...initial.quote, intake_assessment: initial.intake_assessment, input_revision: 2,
    conversation: [...q.conversation, { role: 'user', revision: 2, content: 'Remove the etched glass requirement; use the selected CozE LowE glass.' }] };
  const output = response({ resolved_requirements: [{ detail: 'Custom etched glass is required.', source_quote: 'Remove the etched glass requirement' }] });
  const resolved = await run(correction, output);
  assert.equal(resolved.ok, true);
  assert.deepEqual(resolved.intake_assessment.unresolved_requirements, []);
  const vague = { ...correction, conversation: [...q.conversation, { role: 'user', revision: 2, content: 'Just do your best.' }] };
  const invalid = await run(vague, response({ resolved_requirements: [{ detail: 'Custom etched glass is required.', source_quote: 'Just do your best.' }] }));
  assert.equal(invalid.ok, false);
  assert.deepEqual(invalid.intake_assessment.unresolved_requirements, ['Custom etched glass is required.']);
});

test('failure diagnostics redact provider credentials and expose only a bounded reason', async () => {
  const providerFailure = await run(base(), response(), { invokeLLM: async () => { throw { message: 'Request failed', response: { status: 401, data: { message: 'Invalid model schema. api_key=private-key Bearer private-bearer', request: 'private request data' }, headers: { Authorization: 'private header token' } } }; } });
  assert.deepEqual(providerFailure.intake_assessment.failure_reason, { stage: 'model_call', code: 'http_401', provider_reason: 'Invalid model schema. api_key=[redacted] [credentials redacted]' });
  assert.doesNotMatch(JSON.stringify(providerFailure), /private/);
  const badCitation = await run(base(), response({ lines: [line({ source_quotes: ['not supplied'] })] }));
  assert.deepEqual(badCitation.intake_assessment.failure_reason, { stage: 'validation', code: 'validation_error', message: 'AI cited a fact that was not supplied' });
});

test('provider schema has no nullable type arrays and margin strings normalize strictly', async () => {
  const walk = value => { if (value && typeof value === 'object') { if ('type' in value) assert.equal(typeof value.type, 'string'); for (const child of Object.values(value)) walk(child); } };
  walk(CONVERSATIONAL_INTAKE_SCHEMA);
  const q = base('Please quote one 3050 single hung at 25 percent margin.');
  delete q.settings.gross_margin;
  const result = await run(q, response({ settings_updates: [{ field: 'gross_margin', value: '25', source_quote: '25 percent margin' }] }));
  assert.equal(result.ok, true);
  assert.equal(result.quote.settings.gross_margin, 25);
  const invalid = await run(q, response({ settings_updates: [{ field: 'gross_margin', value: '25%; execute', source_quote: '25 percent margin' }] }));
  assert.equal(invalid.ok, false);
});

test('an older Taupe chat correction cannot overwrite a newer White Details edit', async () => {
  const first = await run(base(), response());
  const secondInput = { ...first.quote, intake_assessment: first.intake_assessment, input_revision: 2,
    conversation: [...first.quote.conversation, { role: 'user', revision: 2, content: 'Make everything Taupe please.' }] };
  const taupeOutput = response({ lines: [line({ options: { color: 'Taupe' }, source_quotes: ['Make everything Taupe please.'] })],
    settings_updates: [{ field: 'color', value: 'Taupe', source_quote: 'Make everything Taupe please.' }] });
  const second = await run(secondInput, taupeOutput);
  assert.equal(second.ok, true);
  const edited = { ...second.quote, settings: { ...second.quote.settings, color: 'White' }, intake_assessment: second.intake_assessment,
    input_revision: 3, history: [{ reason: 'edited', revision: 2, schedule_changed: false }] };
  const afterEdit = await run(edited, taupeOutput);
  assert.equal(afterEdit.ok, true);
  assert.equal(afterEdit.quote.settings.color, 'White');
  assert.equal(afterEdit.quote.lines[0].options.hardware_color, 'White');
  assert.equal(afterEdit.quote.lines[0].options.screen, 'White');
  assert.notEqual(afterEdit.quote.lines[0].options.color, 'Taupe');
});

test('standard trade basis resolves without undefined labels or duplicated capability requirements', async () => {
  const q = base('Please quote one 5050 XO Slider.');
  q.source = { easy_request: { ...source.easy_request, dimension_basis: '' } };
  const output = response({ lines: [line({ style: 'XO Slider', width: 60, height: 60, dimension_basis: null, options: { operation: 'XO' }, source_quotes: ['one 5050 XO Slider'] })],
    questions: ['Which room is this for?', 'Do you have a window mark?', 'Would you like to add more windows?'],
    unresolved_requirements: [{ detail: 'XO Slider windows are not supported by the current automated Studio Single Hung planner.', source_quote: 'XO Slider' }] });
  const result = await run(q, output);
  assert.equal(result.quote.lines[0].dimension_basis, 'call');
  assert.ok(!result.intake_assessment.questions.some(question => /call sizes/.test(question)));
  assert.equal(result.intake_assessment.product_review.length, 0);
  assert.deepEqual(result.intake_assessment.unresolved_requirements, []);
  assert.doesNotMatch(JSON.stringify(result.intake_assessment), /undefined/);
  assert.equal(result.ok, false);
  const lostSlider = await run(q, { ...output, lines: [line({ source_quotes: ['one 5050 XO Slider'] })], questions: [] });
  assert.equal(lostSlider.ok, false);
  assert.equal(lostSlider.intake_assessment.unresolved_requirements.length, 1);
  const saved = { ...result.quote, intake_assessment: { ...result.intake_assessment, unresolved_requirements: [output.unresolved_requirements[0].detail, 'Custom etched glass is required.'] } };
  const refreshed = await run(saved, { ...output, unresolved_requirements: [] });
  assert.deepEqual(refreshed.intake_assessment.unresolved_requirements, ['Custom etched glass is required.']);
});

