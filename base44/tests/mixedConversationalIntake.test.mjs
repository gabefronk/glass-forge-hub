import test from 'node:test';
import assert from 'node:assert/strict';
import { createConversationalIntake, CONVERSATIONAL_INTAKE_SCHEMA } from '../shared/conversationalIntake.js';
import { normalizeConversationalSchedule } from '../shared/structuredQuoteIntake.js';
import { getProductProfileForLine } from '../shared/amscoQuotePlan.js';

const source = { easy_request: { confirmed: true, profile_id: 'studio-sh-standard', profile_revision: 1, dimension_basis: 'call', units: 'in' } };
const base = (message = 'One 8 foot by 6 foot tempered picture window with standard obscure glass.') => ({ id: 'mixed-test', input_revision: 1, source,
  settings: { dealer: 'BFS', yard: 'BFS-UTAH DESIGN (11)', gross_margin: 30, color: 'White', glass: 'CozE (LowE)' },
  lines: [], history: [], conversation: [{ role: 'user', content: message, revision: 1 }] });
const picture = (patch = {}) => ({ line_id: 'picture-1', style: 'Studio Picture', width: 96, height: 72, qty: 1, options: { tempered: true, patterned_glass: 'Obscure' },
  source_quotes: ['One 8 foot by 6 foot tempered picture window with standard obscure glass'], ...patch });
const response = (patch = {}) => ({ summary: 'One tempered picture window with obscure glass.', lines: [picture()], removed_lines: [], settings_updates: [],
  questions: [], unresolved_requirements: [], resolved_requirements: [], assumptions: [], ...patch });
const run = (quote, output, extra = {}) => createConversationalIntake({ invokeLLM: async () => output, normalizeStructured: normalizeConversationalSchedule, ...extra })(quote);

test('standard obscure stays a privacy texture alongside selected CozE LowE and tempering', async () => {
  const result = await run(base(), response());
  assert.equal(result.quote.settings.glass, 'CozE (LowE)');
  assert.equal(result.quote.lines[0].options.patterned_glass, 'Obscure');
  assert.equal(result.quote.lines[0].options.tempered, true);
  assert.equal(result.quote.lines[0].options.glass, undefined);
  assert.equal(result.quote.lines[0].options.hardware, undefined);
  assert.equal(result.quote.lines[0].options.screen, undefined);
  assert.equal(CONVERSATIONAL_INTAKE_SCHEMA.properties.lines.items.properties.options.properties.patterned_glass.type, 'string');
});

test('earlier Obscure migrates texture and uses the confirmed quoting coating when omitted', async () => {
  for (const glass of ['Obscure', 'standard obscure glass']) {
    const quote = base();
    const result = await run(quote, response({ lines: [picture({ options: { glass, tempered: true } })] }));
    assert.equal(result.quote.settings.glass, 'CozE (LowE)');
    assert.equal(result.quote.lines[0].options.glass, undefined);
    assert.equal(result.quote.lines[0].options.patterned_glass, 'Obscure');
    assert.equal(result.quote.lines[0].options.tempered, true);
    assert.match(result.intake_assessment.assumptions.join(' '), /privacy texture/);
    delete quote.settings.glass;
    const unspecified = await run(quote, response({ lines: [picture({ options: { glass, tempered: true } })] }));
    assert.equal(unspecified.quote.settings.glass, 'CozE (LowE)');
    assert.equal(unspecified.quote.lines[0].options.glass, undefined);
  }
});

test('explicit clear coating and another privacy pattern are preserved', async () => {
  const quote = base('One 8 foot by 6 foot picture window with clear coating and Rain privacy glass.');
  const result = await run(quote, response({ lines: [picture({ options: { glass: 'Clear', patterned_glass: 'Rain', tempered: false }, source_quotes: ['clear coating and Rain privacy glass'] })] }));
  assert.equal(result.quote.lines[0].options.glass, 'Clear');
  assert.equal(result.quote.lines[0].options.patterned_glass, 'Rain');
  assert.equal(result.quote.lines[0].options.tempered, false);
});

test('global obscure corrections update privacy texture without overwriting the selected coating', async () => {
  for (const field of ['glass', 'patterned_glass']) {
    const quote = base('Make all windows standard obscure glass.');
    const result = await run(quote, response({ lines: [picture({ options: { tempered: true }, source_quotes: ['Make all windows standard obscure glass'] })],
      settings_updates: [{ field, value: 'standard obscure glass', source_quote: 'Make all windows standard obscure glass' }] }));
    assert.equal(result.quote.settings.glass, 'CozE (LowE)');
    assert.equal(result.quote.settings.patterned_glass, 'Obscure');
    assert.equal(result.quote.lines[0].options.tempered, true);
  }
});

test('conflicting pattern descriptions ask rather than discard either specification', async () => {
  const result = await run(base(), response({ lines: [picture({ options: { glass: 'Obscure', patterned_glass: 'Rain', tempered: true } })] }));
  assert.equal(result.ok, false);
  assert.equal(result.quote.lines[0].options.patterned_glass, 'Rain');
  assert.ok(result.intake_assessment.questions.some(question => /glass notes say Obscure/.test(question)));
});

test('confirmed trade-code call assumption is visible and preserves explicit measurement basis', async () => {
  for (const basis of ['', 'call', 'frame', 'rough_opening']) {
    const quote = base('One 5050 XO slider.');
    quote.source = { easy_request: { ...source.easy_request, dimension_basis: basis } };
    const result = await run(quote, response({ lines: [picture({ line_id: 'slider-1', style: 'Studio XO Slider', width: 60, height: 60, options: { operation: 'XO' }, source_quotes: ['One 5050 XO slider'] })] }));
    assert.equal(result.quote.lines[0].dimension_basis, basis || 'call');
    assert.ok(result.intake_assessment.assumptions.some(note => note.includes('5050') && note.includes('60 × 60')));
    if (!basis) assert.ok(!result.intake_assessment.questions.some(question => /call sizes/.test(question)));
  }
});

test('a stale model capability summary is replaced with the understood window schedule', async () => {
  const result = await run(base(), response({ summary: 'The scripted planner only supports single hung, so this picture window cannot use the current runner.' }));
  assert.match(result.intake_assessment.summary, /Studio Picture/);
  assert.match(result.intake_assessment.summary, /96 × 72/);
  assert.doesNotMatch(result.intake_assessment.summary, /planner|runner|scripted|only supports/i);
  assert.doesNotMatch(result.assistant_message, /supported quoting path|supported product configuration/);
});

test('confirmed omitted installation uses nail fin while explicit fins are retained', async () => {
  const missing = await run(base(), response());
  assert.equal(missing.quote.lines[0].options.fin, 'nail fin');
  assert.ok(!missing.intake_assessment.questions.some(question => /which installation style/.test(question)));
  const supplied = await run(base(), response({ lines: [picture({ options: { fin: 'Flush Fin', tempered: true, patterned_glass: 'Obscure' } })] }));
  assert.equal(supplied.quote.lines[0].options.fin, 'Flush Fin');
  assert.ok(!supplied.intake_assessment.questions.some(question => /which installation style/.test(question)));
});

test('new family defaults require verified native mapping and reuse existing confirmed preferences', () => {
  const quote = base();
  quote.lines = [{ id: 'picture-1', style: 'Studio Picture', width: 96, height: 72, qty: 1, dimension_basis: 'call', units: 'in', options: { tempered: true, patterned_glass: 'Obscure' } }];
  const nativeDefaults = { series: 'Studio 1 3/8 inch Fin Setback', unit_type: 'Complete Unit', elevation: '2501 to 6500', tempered: false };
  const pending = normalizeConversationalSchedule(quote, { getProductProfileForLine: () => ({ status: 'pending', defaults: nativeDefaults }) });
  assert.equal(pending.quote.lines[0].options.series, undefined);
  const verified = normalizeConversationalSchedule(quote, { getProductProfileForLine: () => ({ status: 'verified', defaults: nativeDefaults }) });
  assert.equal(verified.quote.lines[0].options.series, nativeDefaults.series);
  assert.equal(verified.quote.lines[0].options.elevation, '2501 to 6500');
  assert.equal(verified.quote.lines[0].options.tempered, true);
  assert.equal(verified.quote.lines[0].options.patterned_glass, 'Obscure');
  assert.equal(verified.quote.lines[0].options.hardware, undefined);
  assert.equal(verified.quote.lines[0].options.hardware_color, undefined);
  assert.equal(verified.quote.lines[0].options.screen, undefined);
  assert.deepEqual(verified.quote.settings, quote.settings);
  const unconfirmed = normalizeConversationalSchedule({ ...quote, source: { easy_request: { ...source.easy_request, confirmed: false } } }, { getProductProfileForLine: () => ({ status: 'verified', defaults: nativeDefaults }) });
  assert.equal(unconfirmed.quote.lines[0].options.series, undefined);
});

test('matching slider control colors require that product mapping and keep explicit exceptions', () => {
  const quote = base('One 5050 XO slider.');
  quote.lines = [{ id: 'slider-1', style: 'Studio XO Slider', width: 60, height: 60, qty: 1, dimension_basis: 'call', units: 'in', options: { operation: 'XO', screen: 'Black' } }];
  quote.settings.color = 'Taupe';
  const result = normalizeConversationalSchedule(quote, { getProductProfileForLine: () => ({ status: 'verified', defaults: { hardware: 'Cam Latch' }, match_interior_options: ['hardware_color', 'screen'] }) });
  assert.equal(result.quote.lines[0].options.hardware_color, 'Taupe');
  assert.equal(result.quote.lines[0].options.screen, 'Black');
});

test('verified native product constraints survive as actionable explanations without substitutions', async () => {
  const message = 'AMSCO rejected the requested 96 × 72 call-size tempered picture window with Obscure glass: its glass is too large for the available Obscure sheet. Keep the requested privacy glass pending review; confirm a different glass option or a revised window configuration before quoting.';
  const question = 'Would you prefer to review a different privacy-glass option or revise the window configuration?';
  const result = await run(base(), response(), { normalizeStructured: async quote => ({ ok: false, quote, issues: [
    { code: 'unsupported_option', path: 'lines[0].style', message: 'Internal unsupported product description.' },
    { code: 'native_product_constraint', path: 'lines[0].options.patterned_glass', message, customer_question: question }
  ] }) });
  assert.equal(result.ok, false);
  assert.equal(result.intake_assessment.status, 'product_review');
  assert.deepEqual(result.intake_assessment.product_review, [message]);
  assert.equal(result.intake_assessment.questions[0], question);
  assert.ok(result.assistant_message.includes(message));
  assert.equal(result.quote.lines[0].options.patterned_glass, 'Obscure');
  assert.equal(result.quote.lines[0].options.tempered, true);
  assert.doesNotMatch(result.assistant_message, /Internal unsupported|needs its product options checked/);
});

test('confirmed preferences plus native profiles prepare actual flush/nail XO lines for quoting', async () => {
  const quote = base('Two 5050 XO sliders, one flush fin and one nail fin.');
  const lines = ['flush fin', 'nail fin'].map((fin, index) => ({ line_id: 'slider-' + (index + 1), style: 'Studio XO Slider', width: 60, height: 60, qty: 1,
    options: { fin, operation: 'XO' }, source_quotes: ['Two 5050 XO sliders', 'one ' + fin] }));
  const result = await run(quote, response({ summary: 'Two XO sliders with different fins.', lines }), {
    normalizeStructured: value => normalizeConversationalSchedule(value, { getProductProfileForLine })
  });
  assert.equal(result.ok, true, JSON.stringify(result.issues));
  assert.equal(result.plan.schema_version, 2);
  assert.deepEqual(result.plan.lines.map(line => line.product_profile_id), ['studio-flush-fin-xo-v1', 'studio-setback-xo-v1']);
  assert.deepEqual(result.quote.lines.map(line => line.options.fin), ['flush fin', 'nail fin']);
  for (const line of result.quote.lines) {
    assert.equal(line.options.hardware, 'Cam Latch');
    assert.equal(line.options.screen, 'White');
    assert.equal(line.options.tempered, false);
    assert.equal(line.options.patterned_glass, 'None');
  }
});

test('real picture-size rejection is explained while compatible sliders retain their complete inputs', async () => {
  const quote = base('Two 5050 XO sliders, one flush fin and one nail fin. One 8 foot by 6 foot tempered picture window with standard obscure glass.');
  const lines = [
    ...['flush fin', 'nail fin'].map((fin, index) => ({ line_id: 'slider-' + (index + 1), style: 'Studio XO Slider', width: 60, height: 60, qty: 1,
      options: { fin, operation: 'XO' }, source_quotes: ['Two 5050 XO sliders', 'one ' + fin] })),
    picture()
  ];
  const result = await run(quote, response({ lines }), { normalizeStructured: value => normalizeConversationalSchedule(value, { getProductProfileForLine }) });
  assert.equal(result.ok, false);
  assert.equal(result.intake_assessment.status, 'product_review');
  assert.equal(result.quote.lines.length, 3);
  assert.equal(result.quote.lines[0].options.hardware, 'Cam Latch');
  assert.equal(result.quote.lines[1].options.patterned_glass, 'None');
  assert.equal(result.quote.lines[2].options.patterned_glass, 'Obscure');
  assert.equal(result.quote.lines[2].options.tempered, true);
  assert.equal(result.quote.lines[2].options.hardware, undefined);
  assert.ok(result.intake_assessment.product_review.some(message => /too large for the available Obscure sheet/.test(message)));
  assert.doesNotMatch(result.assistant_message, /saved native validation|supported quoting path/);
});

test('conditional picture restriction keeps the necessary measurement question with standard nail fin', async () => {
  const quote = base();
  quote.source = { easy_request: { ...source.easy_request, dimension_basis: '' } };
  const result = await run(quote, response({ questions: ['Are these call sizes or frame sizes?'] }), {
    normalizeStructured: value => normalizeConversationalSchedule(value, { getProductProfileForLine })
  });
  assert.equal(result.ok, false);
  assert.equal(result.quote.lines[0].dimension_basis, undefined);
  assert.ok(result.intake_assessment.product_review.some(message => message.startsWith('When treated as call sizes, AMSCO rejected')));
  assert.deepEqual(result.intake_assessment.questions, [
    'Are the measurements call sizes, actual frame sizes, or rough openings?'
  ]);
});

function persistedBeaver() {
  const message = 'I need a quote for the following windows 5050 XO slider one with flush fin and one with just regular nail fin. Then can I get a quote for a 8 foot by 6 foot picture window tempered with standard obscure glass.';
  const quote = base(message);
  quote.input_revision = 2;
  quote.source = { easy_request: { ...source.easy_request, dimension_basis: '' } };
  quote.conversation.push({ role: 'user', revision: 2, content: 'Just do your best of what you think I need' });
  quote.lines = [
    { id: 'new-1', style: 'XO Slider', width: 60, height: 60, qty: 1, units: 'in', options: { fin: 'flush fin' } },
    { id: 'new-2', style: 'XO Slider', width: 60, height: 60, qty: 1, units: 'in', options: { fin: 'nail fin' } },
    { id: 'new-3', style: 'Picture', width: 96, height: 72, qty: 1, units: 'in', options: { tempered: true, glass: 'standard obscure' } }
  ];
  const output = response({ summary: 'Two XO sliders with different fins and one tempered picture window with obscure glass.', lines: [
    { line_id: 'new-1', style: 'Studio XO Slider', width: 60, height: 60, qty: 1, options: { operation: 'XO', fin: 'Flush Fin' }, source_quotes: ['5050 XO slider one with flush fin'] },
    { line_id: 'new-2', style: 'Studio XO Slider', width: 60, height: 60, qty: 1, options: { operation: 'XO', fin: 'Regular Nail Fin' }, source_quotes: ['one with just regular nail fin'] },
    { line_id: 'new-3', style: 'Studio Picture', width: 96, height: 72, qty: 1, options: { tempered: true, patterned_glass: 'Obscure', glass: 'CozE (LowE)' }, source_quotes: ['8 foot by 6 foot picture window tempered with standard obscure glass'] }
  ] });
  return { quote, output };
}

test('saved Beaver lines accept equivalent canonical spellings and privacy-field migration without a new instruction', async () => {
  const { quote, output } = persistedBeaver();
  const result = await run(quote, output, { normalizeStructured: value => normalizeConversationalSchedule(value, { getProductProfileForLine }) });
  assert.equal(result.intake_assessment.status, 'product_review', JSON.stringify(result.intake_assessment.failure_reason));
  assert.equal(result.intake_assessment.failure_reason, undefined);
  assert.deepEqual(result.quote.lines.map(line => line.style), ['Studio XO Slider', 'Studio XO Slider', 'Studio Picture']);
  assert.deepEqual(result.quote.lines.map(line => line.dimension_basis), ['call', 'call', undefined]);
  assert.equal(result.quote.lines[2].options.tempered, true);
  assert.equal(result.quote.lines[2].options.patterned_glass, 'Obscure');
  assert.equal(result.quote.lines[2].options.glass, undefined);
  assert.equal(result.quote.settings.glass, 'CozE (LowE)');
  assert.equal(quote.lines[2].options.glass, 'standard obscure');
});

test('alias tolerance still rejects actual specification changes with only historical or broad-permission evidence', async () => {
  for (const edit of [
    output => { output.lines[0].qty = 2; },
    output => { output.lines[0].style = 'Studio Single Hung'; },
    output => { output.lines[0].options.fin = 'Nail Fin'; },
    output => { output.lines[2].options.tempered = false; },
    output => { output.lines[2].options.patterned_glass = 'None'; },
    output => { output.lines[2].options.glass = 'Clear'; }
  ]) for (const evidence of ['historical', 'broad']) {
    const { quote, output } = persistedBeaver();
    edit(output);
    if (evidence === 'broad') output.lines.forEach(line => line.source_quotes = ['Just do your best of what you think I need']);
    const result = await run(quote, output);
    assert.equal(result.intake_assessment.status, 'unavailable');
    assert.match(result.intake_assessment.failure_reason.path, /^lines\[\d+\]\.(?:qty|style|options\.(?:fin|tempered|patterned_glass|glass))$/);
    assert.equal(result.intake_assessment.failure_reason.message, 'AI changed an existing window without a current instruction');
    assert.deepEqual(result.quote, quote);
  }
});

function jordanCorrection() {
  const quote = base('I need a quote for the following windows 5050 XO slider one with flush fin and one with just regular nail fin. Then can I get a quote for a 8 foot by 6 foot picture window tempered with standard obscure glass.');
  quote.id = '6a9f0c29347a4d2e647fd380';
  quote.title = 'Jordan bluff';
  quote.input_revision = 2;
  delete quote.settings.dealer;
  quote.settings.yard = 'BFS-UTAH DESIGN(11)';
  quote.source = { easy_request: { ...source.easy_request, dimension_basis: '' } };
  quote.conversation.push({ role: 'user', revision: 2, content: 'Sorry no obscure glass needed just regular glass' });
  const output = response({ summary: 'Two XO sliders and one tempered picture window, with the obscure texture removed.',
    lines: [
      { line_id: 'new-1', style: 'Studio XO Slider', width: 60, height: 60, qty: 1, options: { operation: 'XO', fin: 'Flush Fin' }, source_quotes: ['5050 XO slider one with flush fin'] },
      { line_id: 'new-2', style: 'Studio XO Slider', width: 60, height: 60, qty: 1, options: { operation: 'XO', fin: 'Regular Nail Fin' }, source_quotes: ['one with just regular nail fin'] },
      { line_id: 'new-3', style: 'Studio Picture', width: 96, height: 72, qty: 1, options: { tempered: true, patterned_glass: 'None' }, source_quotes: ['8 foot by 6 foot picture window tempered with standard obscure glass', 'Sorry no obscure glass needed just regular glass'] }
    ],
    resolved_requirements: [{ detail: 'The picture window requires Obscure glass.', source_quote: 'Sorry no obscure glass needed just regular glass' }]
  });
  return { quote, output };
}

test('Jordan correction can cancel historical obscure texture before a requirement ledger or lines exist', async () => {
  const { quote, output } = jordanCorrection();
  let prompt;
  const result = await run(quote, output, {
    invokeLLM: async params => { prompt = params.prompt; return output; },
    normalizeStructured: value => normalizeConversationalSchedule(value, { getProductProfileForLine })
  });
  assert.notEqual(result.intake_assessment.status, 'unavailable', JSON.stringify(result.intake_assessment.failure_reason));
  assert.equal(result.intake_assessment.version, 11);
  assert.equal(result.quote.lines.length, 3);
  assert.deepEqual(result.quote.lines.slice(0, 2).map(line => [line.style, line.options.operation, line.options.fin]), [
    ['Studio XO Slider', 'XO', 'Flush Fin'], ['Studio XO Slider', 'XO', 'Regular Nail Fin']
  ]);
  assert.equal(result.quote.lines[2].width, 96);
  assert.equal(result.quote.lines[2].height, 72);
  assert.equal(result.quote.lines[2].options.tempered, true);
  assert.equal(result.quote.lines[2].options.patterned_glass, 'None');
  assert.equal(result.quote.lines[2].options.glass, undefined);
  assert.equal(result.quote.settings.glass, 'CozE (LowE)');
  assert.equal(result.quote.settings.dealer, 'BFS');
  assert.equal(result.quote.lines[2].dimension_basis, undefined);
  assert.deepEqual(result.intake_assessment.unresolved_requirements, []);
  assert.match(prompt, /Regular glass.*does not mean 'no LowE' or 'not tempered'/);
  assert.match(prompt, /"dealer":"BFS"/);
  assert.equal(quote.settings.dealer, undefined);
});

test('unknown resolution entries cannot discard a different saved requirement', async () => {
  const { quote, output } = jordanCorrection();
  quote.intake_assessment = { unresolved_requirements: ['A safety restriction must be checked.'] };
  output.resolved_requirements.push({ detail: 'A fabricated requirement that was never stored.', source_quote: 'Not a supplied customer quotation' });
  const result = await run(quote, output);
  assert.notEqual(result.intake_assessment.status, 'unavailable');
  assert.equal(result.ok, false);
  assert.deepEqual(result.intake_assessment.unresolved_requirements, ['A safety restriction must be checked.']);
  assert.equal(result.quote.lines[2].options.tempered, true);
  assert.equal(result.quote.lines[2].options.patterned_glass, 'None');
});

test('only the exact selected known BFS yard with confirmed preferences supplies a missing dealer', async () => {
  for (const yard of ['BFS-UTAH DESIGN(11)', 'BFS-UTAH DESIGN (11)']) {
    const { quote, output } = jordanCorrection();
    quote.settings.yard = yard;
    // Repeating an already established account is harmless, even when its
    // citation comes from the selected settings rather than a chat message.
    output.settings_updates = [{ field: 'dealer', value: 'BFS', source_quote: yard }];
    const result = await run(quote, output);
    assert.notEqual(result.intake_assessment.status, 'unavailable');
    assert.equal(result.quote.settings.dealer, 'BFS');
    assert.ok(result.intake_assessment.assumptions.some(note => /BFS account identified/.test(note)));
  }
  for (const change of [
    quote => { quote.settings.dealer = 'BTB'; },
    quote => { quote.settings.yard = 'BFS-OTHER YARD (12)'; },
    quote => { quote.settings.yard = 'BFS-UTAH DESIGN (99)'; },
    quote => { quote.source.easy_request.confirmed = false; }
  ]) {
    const { quote, output } = jordanCorrection();
    change(quote);
    const result = await run(quote, output);
    assert.equal(result.quote.settings.dealer, quote.settings.dealer);
    assert.ok(!result.intake_assessment.assumptions.some(note => /BFS account identified/.test(note)));
    assert.equal(result.ok, false);
  }
});

test('configured BFS account needs no account-number question and corrected regular glass is described precisely', async () => {
  const { quote, output } = jordanCorrection();
  output.summary = 'Two XO sliders and a picture window with tempered, clear glass.';
  output.questions = [
    'Are these call sizes or actual frame sizes?',
    'Which fin should the picture window use?',
    'Could you confirm the BFS account number to associate with this quote?'
  ];
  const result = await run(quote, output, { normalizeStructured: value => normalizeConversationalSchedule(value, { getProductProfileForLine }) });
  assert.deepEqual(result.intake_assessment.questions, [
    'Are the measurements call sizes, actual frame sizes, or rough openings?',
    'For Studio Picture, which installation style should I use: nail fin, flush fin, or another style?'
  ]);
  assert.match(result.intake_assessment.summary, /regular glass \(no privacy texture\), with the selected CozE LowE coating/);
  assert.doesNotMatch(result.intake_assessment.summary, /\bclear glass\b/);
  assert.equal(result.quote.settings.glass, 'CozE (LowE)');
  assert.equal(result.quote.lines[2].options.tempered, true);
});

test('account question filtering never hides dealer conflicts or claims unknown accounts are configured', async () => {
  const { quote, output } = jordanCorrection();
  quote.settings.dealer = 'BTB';
  output.questions = ['Could you confirm the BFS account number to associate with this quote?'];
  const otherAccount = await run(quote, output);
  assert.ok(otherAccount.intake_assessment.questions.some(question => /account number/.test(question)));
  quote.settings.dealer = 'BFS';
  quote.conversation.push({ role: 'user', revision: 3, content: 'Use BTB for this quote instead.' });
  quote.input_revision = 3;
  output.settings_updates = [{ field: 'dealer', value: 'BTB', source_quote: 'Use BTB for this quote instead.' }];
  const conflict = await run(quote, output);
  assert.equal(conflict.ok, false);
  assert.equal(conflict.quote.settings.dealer, 'BFS');
  assert.ok(conflict.intake_assessment.questions.some(question => /saved dealer is BFS; your notes specify BTB/.test(question)));
});

test('an explicitly requested clear coating remains clear in both schedule and summary', async () => {
  const quote = base('One 8 foot by 6 foot tempered picture window, clear glass with no LowE.');
  const output = response({ summary: 'One tempered picture window with clear glass.', lines: [picture({ options: { tempered: true, patterned_glass: 'None', glass: 'Clear' },
    source_quotes: ['One 8 foot by 6 foot tempered picture window, clear glass with no LowE'] })] });
  const result = await run(quote, output);
  assert.equal(result.quote.lines[0].options.glass, 'Clear');
  assert.equal(result.intake_assessment.summary, 'One tempered picture window with clear glass.');
});
