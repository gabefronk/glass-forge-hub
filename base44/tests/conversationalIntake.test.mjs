import test from 'node:test';
import assert from 'node:assert/strict';
import { createConversationalIntake, CONVERSATIONAL_INTAKE_SCHEMA } from '../shared/conversationalIntake.js';
import { STANDARD_STUDIO_PROFILE } from '../shared/easyRequest.js';
import { normalizeConversationalSchedule } from '../shared/structuredQuoteIntake.js';

const source = { easy_request: { confirmed: true, profile_id: STANDARD_STUDIO_PROFILE.id, profile_revision: 1, dimension_basis: 'call', units: 'in' } };
const base = (message = 'Please quote one 3050 single hung.') => ({ id: 'request-1', input_revision: 1, settings: { dealer: 'BFS', yard: 'BFS-UTAH DESIGN (11)', gross_margin: 25, color: 'White', glass: 'CozE (LowE)' }, lines: [], source,
  history: [], conversation: [{ role: 'user', content: message, revision: 1 }] });
const line = (patch = {}) => ({ line_id: 'new-1', style: 'Studio Single Hung', width: 36, height: 60, qty: 1, dimension_basis: 'call', mark: null, room: null, options: {}, source_quotes: ['one 3050 single hung'], ...patch });
const response = (patch = {}) => ({ summary: 'I understood one single-hung window.', lines: [line()], removed_lines: [], settings_updates: [], questions: [], unresolved_requirements: [], assumptions: [], ...patch });
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
  assert.equal(result.intake_assessment.questions.length, 1);
  assert.equal(result.intake_assessment.product_review.length, 3);
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
  q.history = [{ reason: 'edited', revision: 1 }];
  q.lines = [{ id: 'W1', style: 'Single Hung', width: 36, height: 60, qty: 1, dimension_basis: 'call', units: 'in', options: {} }];
  let prompt;
  const result = await createConversationalIntake({ invokeLLM: async args => {
    prompt = args.prompt;
    return response({ lines: [line({ line_id: 'W1', style: 'Single Hung', source_quotes: ['Single Hung'] })] });
  }, normalizeStructured })(q);
  assert.match(prompt, /superseded_by_details_edit\":true/);
  assert.equal(result.ok, true);
});
