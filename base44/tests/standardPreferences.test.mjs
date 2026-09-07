import test from 'node:test';
import assert from 'node:assert/strict';
import { createConversationalIntake } from '../shared/conversationalIntake.js';
import { normalizeConversationalSchedule } from '../shared/structuredQuoteIntake.js';
import { getProductProfileForLine } from '../shared/amscoQuotePlan.js';

const message = 'Can you call me a 3050 single Hoang and a 4040, picture Window white';
const make = () => ({ id: '6a9f239d198a9928e58a16af', input_revision: 1, title: 'Test',
  source: { easy_request: { confirmed: true, profile_id: 'studio-sh-standard', profile_revision: 1, dimension_basis: '', units: 'in' } },
  settings: { dealer: 'BFS', yard: 'BFS-UTAH DESIGN(11)', gross_margin: 30, color: 'White', glass: '' },
  history: [], conversation: [{ role: 'user', revision: 1, content: message }],
  lines: [
    { id: 'new-1', style: 'Studio Single Hung', width: 36, height: 60, qty: 1, units: 'in', options: {} },
    { id: 'new-2', style: 'Studio Picture', width: 48, height: 48, qty: 1, units: 'in', options: {} }
  ] });
const output = () => ({ summary: 'One 3050 Single Hung and one 4040 picture window in White.',
  lines: [
    { line_id: 'new-1', style: 'Studio Single Hung', width: 36, height: 60, qty: 1, options: {}, source_quotes: ['3050 single Hoang'] },
    { line_id: 'new-2', style: 'Studio Picture', width: 48, height: 48, qty: 1, options: {}, source_quotes: ['4040, picture Window white'] }
  ], removed_lines: [], settings_updates: [], questions: ['Are these call sizes, frame sizes or rough openings?', 'Should I use nail fin or flush fin?', 'Should I use CozE LowE glass?'],
  unresolved_requirements: [], resolved_requirements: [], assumptions: [] });
const run = (q, raw = output(), options = {}) => createConversationalIntake({ invokeLLM: async () => raw,
  normalizeStructured: value => normalizeConversationalSchedule(value, { getProductProfileForLine }), ...options })(q);

test('exact saved Test and initial typo request resolve standard defaults and repeated questions', async () => {
  for (const persisted of [false, true]) {
    const q = make(); if (!persisted) q.lines = [];
    q.intake_assessment = { version: 7, input_revision: 1, questions: output().questions, unresolved_requirements: [] };
    let prompt;
    const result = await run(q, output(), { invokeLLM: async params => { prompt = params.prompt; return output(); } });
    assert.equal(result.ok, true, JSON.stringify(result));
    assert.equal(result.intake_assessment.version, 8);
    assert.deepEqual(result.questions, []);
    assert.deepEqual(result.quote.lines.map(line => [line.width, line.height, line.dimension_basis, line.qty]), [[36,60,'call',1],[48,48,'call',1]]);
    assert.equal(result.quote.settings.glass, 'CozE (LowE)');
    assert.equal(result.quote.settings.gross_margin, 30);
    assert.equal(result.quote.lines[0].options.series, 'Studio 1 3/8 inch Fin Setback');
    assert.equal(result.quote.lines[0].options.fin, undefined);
    assert.equal(result.quote.lines[1].options.fin, 'nail fin');
    assert.equal(result.quote.lines[1].options.tempered, false);
    assert.equal(result.quote.lines[1].options.patterned_glass, 'None');
    assert.equal(result.quote.lines[1].options.hardware, undefined);
    assert.equal(result.quote.lines[1].options.screen, undefined);
    assert.match(result.assistant_message, /standard quote.*CozE LowE.*call sizes.*standard nail fin/s);
    assert.match(prompt, /Do not ask the customer to reconfirm these routine omissions/);
    assert.equal(q.settings.glass, '');
    assert.deepEqual(result.quote.conversation, q.conversation);
  }
});

test('explicit saved basis, fin, coating, privacy and tempering are never overwritten by defaults', async () => {
  for (const basis of ['frame', 'rough_opening']) {
    const q = make(); q.source.easy_request.dimension_basis = basis;
    q.settings.glass = 'Clear';
    q.lines[1].options = { fin: 'flush fin', tempered: true, patterned_glass: 'Rain' };
    const result = await run(q);
    assert.equal(result.quote.lines[1].dimension_basis, basis);
    assert.equal(result.quote.settings.glass, 'Clear');
    for (const [key,value] of Object.entries(q.lines[1].options)) assert.equal(result.quote.lines[1].options[key],value);
    assert.equal(result.ok,false);
  }
});

test('written uncertainty and contrary instructions keep defaults unanswered', async () => {
  for (const [note, field] of [
    ['I am not sure which glass coating to use.', 'glass'],
    ['No LowE; I want clear glass.', 'glass'],
    ['Use Solarban glass.', 'glass'],
    ['I am unsure whether these are frame sizes.', 'basis'],
    ['These are rough openings.', 'basis'],
    ['I am not sure which fin to use.', 'fin'],
    ['Do not assume anything.', 'all']
  ]) {
    const q = make(); q.conversation[0].content += '. ' + note;
    const result = await run(q);
    assert.equal(result.ok,false,note);
    if (field==='glass'||field==='all') {
      assert.equal(result.quote.settings.glass,'',note);
      assert.ok(result.quote.lines.every(line=>!line.options.glass),note);
    }
    if (field==='basis'||field==='all') assert.ok(result.quote.lines.every(line=>!line.dimension_basis),note);
    if (field==='fin'||field==='all') assert.equal(result.quote.lines[1].options.fin,undefined,note);
  }
});

test('no confirmed standard profile never authorizes new routine defaults', async () => {
  const q=make();q.source.easy_request.confirmed=false;
  const result=await run(q);
  assert.equal(result.ok,false);
  assert.equal(result.quote.settings.glass,'');
  assert.equal(result.quote.lines[1].options.fin,undefined);
  assert.ok(result.quote.lines.every(line=>!line.dimension_basis));
});

test('malformed model sizes cannot exploit a trade-code default to change the schedule', async () => {
  for(const persisted of [false,true]) {
    const q=make();if(!persisted)q.lines=[];
    const raw=output();raw.lines[1].width=60;
    if(persisted){q.input_revision=2;q.conversation.push({role:'user',revision:2,content:'Just do your best'});}
    const result=await run(q,raw);
    assert.equal(result.intake_assessment.status,'unavailable');
    assert.deepEqual(result.quote.lines,q.lines);
    assert.equal(result.quote.settings.glass,'');
  }
});

test('numeric dimensions without a linked trade code still need a measurement basis', async () => {
  const q=make();q.conversation[0].content='One 36 by 60 single hung and one 48 by 48 picture window white.';
  const raw=output();raw.lines[0].source_quotes=['36 by 60 single hung'];raw.lines[1].source_quotes=['48 by 48 picture window white'];
  const result=await run(q,raw);
  assert.equal(result.ok,false);
  assert.ok(result.quote.lines.every(line=>!line.dimension_basis));
  assert.equal(result.questions.filter(question=>/call sizes/.test(question)).length,1);
});

test('unresolved custom glazing survives standard defaults and margin-only retries', async () => {
  const q=make();q.input_revision=2;q.settings.gross_margin=25;
  q.intake_assessment={version:7,unresolved_requirements:['Custom etched glass design must match the sample.']};
  const result=await run(q);
  assert.equal(result.ok,false);
  assert.deepEqual(result.intake_assessment.unresolved_requirements,q.intake_assessment.unresolved_requirements);
  assert.ok(result.intake_assessment.product_review.includes(q.intake_assessment.unresolved_requirements[0]));
});

test('explicit safety and texture uncertainty is not filled from the standard picture profile', async () => {
  const q=make();q.conversation[0].content += '. I am unsure whether the picture needs tempered safety glass or a privacy pattern.';
  const raw=output();raw.questions=['Does the picture need tempered glass or a privacy pattern?'];
  const result=await run(q,raw);
  assert.equal(result.ok,false);
  assert.equal(result.quote.lines[1].options.tempered,undefined);
  assert.equal(result.quote.lines[1].options.patterned_glass,undefined);
  assert.ok(result.questions.some(question=>/tempered/.test(question)));
});

test('global and trailing fin instructions cannot become a conflicting per-line nail-fin default', async () => {
  for (const instruction of ['Both windows must use flush fin.', 'Use flush fin on all windows.', 'Place flush fin on these windows.', 'Flush fin.']) {
    const q = make(); q.lines = [];
    q.conversation[0].content = 'Please quote one 4040 XO slider in Kitchen and one 5050 XO slider in Bedroom. ' + instruction;
    const raw = output(); raw.questions = [];
    raw.lines = [
      { line_id: 'new-1', style: 'Studio XO Slider', width: 48, height: 48, qty: 1, options: { operation: 'XO' }, source_quotes: ['4040 XO slider in Kitchen'] },
      { line_id: 'new-2', style: 'Studio XO Slider', width: 60, height: 60, qty: 1, options: { operation: 'XO', fin: 'flush fin' }, source_quotes: ['5050 XO slider in Bedroom', instruction] }
    ];
    const result = await run(q, raw);
    assert.equal(result.ok, false, instruction);
    assert.equal(result.quote.lines[0].options.fin, undefined, instruction);
    assert.equal(result.quote.lines[1].options.fin, 'flush fin', instruction);
    assert.ok(result.questions.some(question => /installation style/.test(question)), instruction);
    assert.ok(!result.intake_assessment.assumptions.some(note => /standard nail fin/.test(note)), instruction);
  }
});

test('explicit current width correction may retain historical trade-code citation on an existing line', async () => {
  const q = make(); q.input_revision = 2;
  q.conversation.push({ role: 'user', revision: 2, content: 'Change width to 40 on the single hung.' });
  const raw = output(); raw.lines[0].width = 40;
  raw.lines[0].source_quotes = ['3050 single Hoang', 'Change width to 40 on the single hung'];
  const result = await run(q, raw);
  assert.notEqual(result.intake_assessment.status, 'unavailable');
  assert.equal(result.quote.lines[0].width, 40);
  assert.equal(result.quote.lines[0].height, 60);
});
