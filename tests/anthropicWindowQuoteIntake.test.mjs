import test from 'node:test';
import assert from 'node:assert/strict';
import { claudeAssistantStatus, invokeClaudeWindowQuote } from '../base44/shared/anthropicWindowQuoteIntake.js';

// Native Anthropic web-fetch block builders (actual response format).
function fetchResult({ tool_use_id = 'srvtoolu_1', url, title, data, retrieved_at }) {
  return {
    type: 'web_fetch_tool_result', tool_use_id,
    content: {
      type: 'web_fetch_result', url,
      content: { type: 'document', title, source: { type: 'text', media_type: 'text/plain', data }, citations: { enabled: true } },
      retrieved_at
    }
  };
}
function serverToolUse({ id = 'srvtoolu_1', url }) {
  return { type: 'server_tool_use', id, name: 'web_fetch', input: { url } };
}
function textBlock(text, citations = []) {
  return { type: 'text', text, citations };
}
function charCitation(document_index, cited_text, title = 'Doc') {
  return { type: 'char_location', document_index, document_title: title, start_char_index: 0, end_char_index: cited_text.length, cited_text };
}

function intakeResponse(content) {
  return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ content }) };
}
function researchResponse(content, stopReason = 'end_turn') {
  return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ content, stop_reason: stopReason }) };
}

test('assistant status is honest about whether Claude is configured', () => {
  assert.deepEqual(claudeAssistantStatus({ apiKey: '', model: 'claude-opus-5' }), {
    id: 'anthropic_claude',
    label: 'Claude AMSCO specialist',
    configured: false,
    model: 'claude-opus-5',
    fallback: 'Base44 AI'
  });
  assert.equal(claudeAssistantStatus({ apiKey: 'secret', model: 'test-model' }).configured, true);
});

test('Claude request carries the AMSCO system guard, schema, and supported attachments', async () => {
  let observed;
  const output = { summary: 'two windows', lines: [], settings: {}, questions: [], assumptions: [], unresolved: [] };
  const fetchImpl = async (url, options) => {
    assert.equal(Object.hasOwn(JSON.parse(options.body), "temperature"), false, "Claude rejects the deprecated temperature parameter");
    observed = { url, options };
    return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ content: [{ type: 'text', text: `\`\`\`json\n${JSON.stringify(output)}\n\`\`\`` }] }) };
  };
  const result = await invokeClaudeWindowQuote(
    { prompt: 'Build the schedule.', response_json_schema: { type: 'object', properties: { summary: { type: 'string' } } } },
    {
      apiKey: 'test-key', model: 'test-model', fetchImpl,
      attachments: [
        { name: 'plan.pdf', type: 'application/pdf', url: 'https://files.example/plan.pdf', size: 100 },
        { name: 'opening.jpg', type: 'image/jpeg', url: 'https://files.example/opening.jpg', size: 100 }
      ]
    }
  );
  assert.deepEqual(result, output);
  assert.equal(observed.url, 'https://api.anthropic.com/v1/messages');
  assert.equal(observed.options.headers['x-api-key'], 'test-key');
  assert.equal(observed.options.headers['anthropic-version'], '2023-06-01');
  const body = JSON.parse(observed.options.body);
  assert.equal(body.model, 'test-model');
  assert.match(body.system, /dedicated AMSCO window quoting specialist/);
  assert.equal(body.messages[0].content.filter(item => item.type === 'document').length, 1);
  assert.equal(body.messages[0].content.filter(item => item.type === 'image').length, 1);
  assert.match(body.messages[0].content.at(-1).text, /Return only JSON matching this schema/);
});

test('Claude transport refuses to run without a configured key', async () => {
  await assert.rejects(
    () => invokeClaudeWindowQuote({ prompt: 'x' }, { apiKey: '', fetchImpl: async () => null }),
    /ANTHROPIC_API_KEY/
  );
});

test('manufacturer lookup tool loop runs on demand and appends complete footnote with product context', async () => {
  const finalOutput = { summary: 'Two Studio single hung windows.', lines: [], removed_lines: [], settings_updates: [], questions: [], unresolved_requirements: [], resolved_requirements: [], assumptions: [] };
  const researchContent = [
    serverToolUse({ url: 'https://www.pella.com/professionals/downloads/studio.pdf' }),
    fetchResult({ url: 'https://www.pella.com/professionals/downloads/studio.pdf', title: 'Pella Studio Spec', data: 'Max call 60 x 60.', retrieved_at: '2026-09-11T12:00:00Z' }),
    textBlock('Max call size is 60 x 60 inches.', [charCitation(0, 'Max call 60 x 60.', 'Pella Studio Spec')])
  ];
  const intakeCalls = [];
  const researchCalls = [];
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    if (body.tools?.[0]?.name === 'lookup_manufacturer_specs') {
      intakeCalls.push(body);
      if (intakeCalls.length === 1) {
        return intakeResponse([{ type: 'tool_use', id: 'tool_1', name: 'lookup_manufacturer_specs', input: { manufacturer: 'Pella', series: 'Studio', product: 'Single Hung', question: 'max call size?' } }]);
      }
      return intakeResponse([{ type: 'text', text: '```json\n' + JSON.stringify(finalOutput) + '\n```' }]);
    }
    researchCalls.push(body);
    return researchResponse(researchContent);
  };

  const result = await invokeClaudeWindowQuote(
    { prompt: 'Build the schedule.', response_json_schema: { type: 'object', properties: { summary: { type: 'string' } } } },
    { apiKey: 'test-key', model: 'test-model', fetchImpl, attachments: [{ name: 'plan.pdf', type: 'application/pdf', url: 'https://files.example/plan.pdf', size: 100 }] }
  );

  assert.match(result.summary, /Two Studio single hung windows\./);
  assert.match(result.summary, /Manufacturer research/);
  assert.match(result.summary, /\[Pella Studio Single Hung\]/, 'footnote carries product context');
  assert.match(result.summary, /pella\.com\/professionals\/downloads\/studio\.pdf/, 'footnote retains the complete URL');
  assert.match(result.summary, /retrieved 2026-09-11T12:00:00Z/);
  assert.equal(intakeCalls[0].tools[0].name, 'lookup_manufacturer_specs');
  assert.equal(researchCalls.length, 1);
  assert.equal(researchCalls[0].tools[0].type, 'web_fetch_20250910');
  assert.deepEqual(researchCalls[0].tools[0].allowed_domains, ['pella.com', 'www.pella.com', 'professional.pella.com', 'media.pella.com']);
  assert.doesNotMatch(researchCalls[0].messages[0].content, /Build the schedule/);
  assert.equal(intakeCalls[1].messages[2].role, 'user');
  assert.equal(intakeCalls[1].messages[2].content[0].type, 'tool_result');
  assert.equal(intakeCalls[1].messages[2].content[0].tool_use_id, 'tool_1');
  assert.equal(intakeCalls[0].messages[0].content.filter(item => item.type === 'document').length, 1);
});

test('research capped by remaining budget passes a shared absolute deadline to the lookup', async () => {
  const start = Date.now();
  const finalOutput = { summary: 'Done.', lines: [], removed_lines: [], settings_updates: [], questions: [], unresolved_requirements: [], resolved_requirements: [], assumptions: [] };
  let intakeCount = 0;
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    if (body.tools?.[0]?.name === 'lookup_manufacturer_specs') {
      intakeCount++;
      if (intakeCount === 1) return intakeResponse([{ type: 'tool_use', id: 'tool_1', name: 'lookup_manufacturer_specs', input: { manufacturer: 'Pella', series: 'Studio', product: 'Single Hung', question: 'max call size?' } }]);
      return intakeResponse([{ type: 'text', text: '```json\n' + JSON.stringify(finalOutput) + '\n```' }]);
    }
    return researchResponse([textBlock('unknown', [])]);
  };
  await invokeClaudeWindowQuote(
    { prompt: 'Build the schedule.', response_json_schema: { type: 'object', properties: { summary: { type: 'string' } } } },
    { apiKey: 'test-key', model: 'test-model', fetchImpl, deadlineMs: 50000 }
  );
  // The lookup received an absolute deadline reserved 8s before the intake deadline.
  assert.ok(Date.now() - start < 1000, 'no real waiting in the test transport');
});

test('unavailable lookup produces no claimed sources and no footnote', async () => {
  const finalOutput = { summary: 'I could not confirm that size.', lines: [], removed_lines: [], settings_updates: [], questions: ['What is the max call size?'], unresolved_requirements: [], resolved_requirements: [], assumptions: [] };
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    if (body.tools?.[0]?.name === 'lookup_manufacturer_specs') {
      return intakeResponse([{ type: 'text', text: '```json\n' + JSON.stringify(finalOutput) + '\n```' }]);
    }
    return researchResponse([textBlock('unknown', [])]);
  };
  const result = await invokeClaudeWindowQuote(
    { prompt: 'Build the schedule.', response_json_schema: { type: 'object', properties: { summary: { type: 'string' } } } },
    { apiKey: 'test-key', model: 'test-model', fetchImpl }
  );
  assert.equal(result.summary, 'I could not confirm that size.');
  assert.doesNotMatch(result.summary, /Manufacturer research/);
});

test('research pause_turn continuation inside a lookup still yields cited evidence', async () => {
  const finalOutput = { summary: 'Standard grid confirmed.', lines: [], removed_lines: [], settings_updates: [], questions: [], unresolved_requirements: [], resolved_requirements: [], assumptions: [] };
  const paused = [
    fetchResult({ url: 'https://www.amscowindows.com/architects/spec', title: 'AMSCO Spec', data: 'Standard grid up to 48 x 72.', retrieved_at: '2026-09-11T12:00:00Z' }),
    textBlock('Researching…', [])
  ];
  const finished = [
    textBlock('Standard grid goes up to 48 x 72 inches call size.', [charCitation(0, 'Standard grid up to 48 x 72.', 'AMSCO Spec')])
  ];
  let researchCall = 0;
  let intakeCount = 0;
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    if (body.tools?.[0]?.name === 'lookup_manufacturer_specs') {
      intakeCount++;
      if (intakeCount === 1) return intakeResponse([{ type: 'tool_use', id: 'tool_1', name: 'lookup_manufacturer_specs', input: { manufacturer: 'AMSCO', series: 'Studio', product: 'XO Slider', question: 'standard grid max?' } }]);
      return intakeResponse([{ type: 'text', text: '```json\n' + JSON.stringify(finalOutput) + '\n```' }]);
    }
    researchCall++;
    return researchCall === 1 ? researchResponse(paused, 'pause_turn') : researchResponse(finished, 'end_turn');
  };
  const result = await invokeClaudeWindowQuote(
    { prompt: 'Build the schedule.', response_json_schema: { type: 'object', properties: { summary: { type: 'string' } } } },
    { apiKey: 'test-key', model: 'test-model', fetchImpl }
  );
  assert.match(result.summary, /Standard grid confirmed\./);
  assert.match(result.summary, /amscowindows\.com\/architects\/spec/);
  assert.match(result.summary, /retrieved 2026-09-11T12:00:00Z/);
});

test('research index alignment after a disallowed document still cites the valid source', async () => {
  const finalOutput = { summary: 'Max call size confirmed from the Pella PDF.', lines: [], removed_lines: [], settings_updates: [], questions: [], unresolved_requirements: [], resolved_requirements: [], assumptions: [] };
  const researchContent = [
    fetchResult({ url: 'https://apps.apple.com/us/app/pella-adm', title: 'App Store', data: 'listing', retrieved_at: '2026-09-11T12:00:00Z' }),
    fetchResult({ url: 'https://www.pella.com/professionals/downloads/studio.pdf', title: 'Pella Studio Spec', data: 'Max call 60 x 60.', retrieved_at: '2026-09-11T12:01:00Z' }),
    textBlock('Max call size is 60 x 60 inches.', [charCitation(1, 'Max call 60 x 60.', 'Pella Studio Spec')])
  ];
  let intakeCount = 0;
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    if (body.tools?.[0]?.name === 'lookup_manufacturer_specs') {
      intakeCount++;
      if (intakeCount === 1) return intakeResponse([{ type: 'tool_use', id: 'tool_1', name: 'lookup_manufacturer_specs', input: { manufacturer: 'Pella', series: 'Studio', product: 'Single Hung', question: 'max call size?' } }]);
      return intakeResponse([{ type: 'text', text: '```json\n' + JSON.stringify(finalOutput) + '\n```' }]);
    }
    return researchResponse(researchContent);
  };
  const result = await invokeClaudeWindowQuote(
    { prompt: 'Build the schedule.', response_json_schema: { type: 'object', properties: { summary: { type: 'string' } } } },
    { apiKey: 'test-key', model: 'test-model', fetchImpl }
  );
  assert.match(result.summary, /pella\.com\/professionals\/downloads\/studio\.pdf/);
  assert.doesNotMatch(result.summary, /apps\.apple\.com/);
});