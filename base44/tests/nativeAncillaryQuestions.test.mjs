import test from 'node:test';
import assert from 'node:assert/strict';
import { createConversationalIntake } from '../shared/conversationalIntake.js';
import { normalizeConversationalSchedule } from '../shared/structuredQuoteIntake.js';
import { getProductProfileForLine } from '../shared/amscoQuotePlan.js';

const message = 'Can I get a quote for a 5050 slider and a 5060 slider';
const make = () => ({ id: 'persisted-test2', input_revision: 1,
  source: { easy_request: { confirmed: true, profile_id: 'studio-sh-standard', profile_revision: 1, dimension_basis: 'call', units: 'in' } },
  settings: { dealer: 'BFS', yard: 'BFS-UTAH DESIGN(11)', gross_margin: 30, color: 'White', glass: 'CozE (LowE)' },
  history: [], conversation: [{ role: 'user', revision: 1, content: message }],
  lines: [60,72].map((height,index)=>({id:'new-'+(index+1),style:'Studio XO Slider',width:60,height,qty:1,units:'in',dimension_basis:'call',options:{operation:'XO',fin:'nail fin'}})) });
const response = (questions = ['Do you require any screens for these windows?']) => ({ summary:'One 5050 and one 5060 XO slider.',
  lines:[60,72].map((height,index)=>({line_id:'new-'+(index+1),style:'Studio XO Slider',width:60,height,qty:1,options:{operation:'XO',fin:'nail fin'},source_quotes:[index ? '5060 slider' : '5050 slider']})),
  removed_lines:[],settings_updates:[],questions,unresolved_requirements:[],resolved_requirements:[],assumptions:[] });
const normalize = q => normalizeConversationalSchedule(q,{getProductProfileForLine});
const run = (q,raw=response(),overrides={}) => createConversationalIntake({invokeLLM:async()=>raw,normalizeStructured:normalize,...overrides})(q);

test('Test2 standard screens do not trigger a redundant question or lose native defaults',async()=>{
  let prompt;
  const first=await run(make(),response(),{invokeLLM:async value=>{prompt=value.prompt;return response();}});
  assert.equal(first.ok,true,JSON.stringify(first.questions));
  assert.deepEqual(first.questions,[]);
  assert.deepEqual(first.quote.lines.map(line=>line.options.screen),['White','White']);
  assert.ok(first.plan.lines.every(line=>line.native_default_fields.includes('glass_thickness')));
  assert.ok(first.quote.lines.every(line=>line.options.glass_thickness===undefined));
  assert.match(prompt,/Do not volunteer a questionnaire about screens/);
  const persisted={...first.quote,input_revision:2,intake_assessment:{...first.intake_assessment,status:'needs_details',questions:response().questions},
    conversation:[...first.quote.conversation,{role:'assistant',revision:1,content:response().questions[0]},{role:'user',revision:2,content:'Yes'}]};
  const raw=response();raw.lines.forEach(line=>{line.source_quotes.push('Yes');line.options.screen='White';});
  const replied=await run(persisted,raw);
  assert.equal(replied.ok,true,JSON.stringify(replied.questions));
  assert.deepEqual(replied.questions,[]);
  assert.deepEqual(replied.quote.lines.map(line=>line.options.screen),['White','White']);
});

test('already-populated standard ancillary questions are suppressed together',async()=>{
  for(const question of ['Do you require screens?', 'What hardware should I use?', 'Which hardware finish do you want?',
    'What glass thickness should I use?', 'Which glazing method?', 'Do you want argon gas fill?', 'Do you need Super Spacer?',
    'Are capillary tubes required?', 'Would you like grilles?', 'Which elevation should I use?', 'Do you want an even sash split?']) {
    const result=await run(make(),response([question]));
    assert.equal(result.ok,true,question+': '+JSON.stringify(result.questions));
    assert.deepEqual(result.questions,[],question);
  }
});

test('combined questions keep unresolved main fields and explicit customer ancillary requirements',async()=>{
  for(const question of ['Do you require screens and tempered glass?', 'What screens and privacy glass do you need?', 'Which hardware and frame color should I use?', 'Do you want screens, and what color?', 'Which screens and window style should I use?']) {
    const result=await run(make(),response([question]));
    assert.equal(result.ok,false,question);
    assert.ok(result.questions.includes(question));
  }
  const q=make();q.conversation[0].content += '. I am unsure whether full screens or half screens are needed.';
  const result=await run(q,response());
  assert.equal(result.ok,false);
  assert.ok(result.questions.includes(response().questions[0]));
});

test('no screen or custom hardware instructions stay visible instead of being dismissed as routine',async()=>{
  for(const [note,question] of [['No screens on either window.','Do you require any screens for these windows?'],['No screens on either window.','Should I use CozE glass and no screens?'],['Use custom bronze hardware.','Which hardware should I use?']]) {
    const q=make();q.conversation[0].content += '. '+note;
    const raw=response([question]);raw.unresolved_requirements=[{detail:note,source_quote:note}];
    const result=await run(q,raw);
    assert.equal(result.ok,false);
    assert.ok(result.intake_assessment.unresolved_requirements.includes(note));
    assert.ok(result.questions.includes(question));
  }
});

test('missing or invalid ancillary values are never treated as resolved',async()=>{
  for(const mode of ['missing','invalid']) {
    const result=await run(make(),response(),{normalizeStructured:q=>{
      const normalized=normalize(q);
      if(mode==='missing')delete normalized.quote.lines[0].options.screen;
      else normalized.issues=[...(normalized.issues||[]),{code:'unsupported_option',path:'lines[0].options.screen',message:'Review the screen option.'}];
      normalized.ok=false;return normalized;
    }});
    assert.equal(result.ok,false);
    assert.ok(result.intake_assessment.questions.includes(response().questions[0]));
  }
});

test('unconfirmed recipes do not authorize dismissing ancillary questions',async()=>{
  const q=make();q.source.easy_request.confirmed=false;
  const result=await run(q,response());
  assert.equal(result.ok,false);
  assert.ok(result.questions.includes(response().questions[0]));
});

test('planner-owned native default fields resolve an ancillary question without a preset value',async()=>{
  const result=await run(make(),response(['What glass thickness should I use?']),{normalizeStructured:q=>{
    const normalized=normalize(q);
    normalized.quote.lines.forEach(line=>delete line.options.glass_thickness);
    normalized.plan.lines.forEach(line=>{delete line.options.glass_thickness;line.native_default_fields=['glass_thickness'];});
    return normalized;
  }});
  assert.equal(result.ok,true);
  assert.deepEqual(result.questions,[]);
  assert.ok(result.quote.lines.every(line=>line.options.glass_thickness===undefined));
});

test('native default policy omits recipe values but preserves explicit and settings overrides',()=>{
  const profile=getProductProfileForLine(make().lines[0],make().settings);
  for(const source of ['omitted','line','settings']) {
    const q=make();
    if(source==='line')q.lines[0].options.glass_thickness='SS over SS';
    if(source==='settings')q.settings.glass_thickness='SS over SS';
    const result=normalizeConversationalSchedule(q,{getProductProfileForLine:()=>({...profile,native_default_rules:{glass_thickness:{}}})});
    assert.equal(result.quote.lines[0].options.glass_thickness,source==='omitted'?undefined:'SS over SS');
  }
});

test('a current exact construction restatement remains explicit after clearing old derived defaults',async()=>{
  const initial=await run(make(),response([]));
  initial.quote.lines.forEach(line=>{line.options.glass_thickness='SS over SS';});
  initial.intake_assessment.line_provenance.forEach(line=>{line.derived_options.glass_thickness='SS over SS';});
  const q={...initial.quote,input_revision:2,intake_assessment:initial.intake_assessment,
    conversation:[...initial.quote.conversation,{role:'user',revision:2,content:'Keep SS over SS for both windows.'}]};
  const raw=response([]);raw.lines.forEach(line=>{line.options.glass_thickness='SS over SS';line.source_quotes=['Keep SS over SS for both windows'];});
  const result=await run(q,raw,{normalizeStructured:value=>{
    // A policy transition must not erase the now-explicit repeated value.
    assert.ok(value.lines.every(line=>line.options.glass_thickness==='SS over SS'));
    return normalize(value);
  }});
  assert.notEqual(result.intake_assessment.status,'unavailable');
  assert.ok(result.quote.lines.every(line=>line.options.glass_thickness==='SS over SS'));
});

test('persisted v9 Test2 construction defaults transition to native policy after the Yes reply',async()=>{
  const q=make();q.input_revision=2;
  const oldDefaults={glass_thickness:'SS over SS',glazing_method:'3/4 inch Insulated Glass',super_spacer:false,capillary_tubes:false,screen:'White'};
  q.lines.forEach(line=>Object.assign(line.options,oldDefaults));
  q.intake_assessment={version:9,status:'needs_details',questions:response().questions,unresolved_requirements:[],
    line_provenance:q.lines.map(line=>({line_id:line.id,derived_options:{...oldDefaults}}))};
  q.conversation.push({role:'assistant',revision:1,content:response().questions[0]},{role:'user',revision:2,content:'Yes'});
  const raw=response();raw.lines.forEach(line=>{Object.assign(line.options,oldDefaults);line.source_quotes.push('Yes');});
  const result=await run(q,raw);
  assert.equal(result.ok,true,JSON.stringify(result.questions));
  for(const line of result.quote.lines) {
    assert.equal(line.options.screen,'White');
    for(const field of ['glass_thickness','glazing_method','super_spacer','capillary_tubes'])assert.equal(line.options[field],undefined,field);
  }
  for(const line of result.plan.lines)assert.deepEqual(line.native_default_fields,['capillary_tubes','glass_thickness','glazing_method','super_spacer']);
  assert.equal(q.lines[1].options.glass_thickness,'SS over SS');
});
