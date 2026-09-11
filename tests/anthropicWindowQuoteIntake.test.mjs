import test from 'node:test';
import assert from 'node:assert/strict';
import { claudeAssistantStatus, invokeClaudeWindowQuote } from '../base44/shared/anthropicWindowQuoteIntake.js';

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
    observed = { url, options };
    return {
      ok: true,
      status: 200,
      headers: { get: () => null },
      json: async () => ({ content: [{ type: 'text', text: `\`\`\`json\n${JSON.stringify(output)}\n\`\`\`` }] })
    };
  };
  const result = await invokeClaudeWindowQuote(
    { prompt: 'Build the schedule.', response_json_schema: { type: 'object', properties: { summary: { type: 'string' } } } },
    {
      apiKey: 'test-key',
      model: 'test-model',
      fetchImpl,
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

test('manufacturer lookup tool loop runs on demand and appends validated sources to the summary', async () => {
  const finalOutput = { summary: 'Two Studio single hung windows.', lines: [], removed_lines: [], settings_updates: [], questions: [], unresolved_requirements: [], resolved_requirements: [], assumptions: [] };
  const researchContent = [
    { type: 'web_fetch_tool_result', url: 'https://www.pella.com/professionals/downloads/studio.pdf', title: 'Pella Studio Spec', content: [{ type: 'web_fetch_result', text: 'Max call 60 x 60.' }] },
    { type: 'text', text: 'Max call size is 60 x 60 inches.', citations: [{ type: 'web_fetch_tool_result', document_index: 0, start_char: 0, end_char: 28 }] }
  ];
  const intakeCalls = [];
  const researchCalls = [];
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    if (body.tools?.[0]?.name === 'lookup_manufacturer_specs') {
      intakeCalls.push(body);
      if (intakeCalls.length === 1) {
        return {
          ok: true, status: 200, headers: { get: () => null },
          json: async () => ({ content: [{ type: 'tool_use', id: 'tool_1', name: 'lookup_manufacturer_specs', input: { manufacturer: 'Pella', series: 'Studio', product: 'Single Hung', question: 'max call size?' } }] })
        };
      }
      return {
        ok: true, status: 200, headers: { get: () => null },
        json: async () => ({ content: [{ type: 'text', text: '```json\n' + JSON.stringify(finalOutput) + '\n```' }] })
      };
    }
    researchCalls.push(body);
    return {
      ok: true, status: 200, headers: { get: () => null },
      json: async () => ({ content: researchContent, stop_reason: 'end_turn' })
    };
  };

  const result = await invokeClaudeWindowQuote(
    { prompt: 'Build the schedule.', response_json_schema: { type: 'object', properties: { summary: { type: 'string' } } } },
    {
      apiKey: 'test-key', model: 'test-model', fetchImpl,
      attachments: [{ name: 'plan.pdf', type: 'application/pdf', url: 'https://files.example/plan.pdf', size: 100 }]
    }
  );

  // final schema JSON is returned and research footnote added to existing summary
  assert.match(result.summary, /Two Studio single hung windows\./);
  assert.match(result.summary, /Manufacturer research/);
  assert.match(result.summary, /pella\.com\/professionals\/downloads\/studio\.pdf/);
  // the lookup tool was offered to the model
  assert.equal(intakeCalls[0].tools[0].name, 'lookup_manufacturer_specs');
  // the research request was brand-restricted and separate from quote data
  assert.equal(researchCalls.length, 1);
  assert.equal(researchCalls[0].tools[0].type, 'web_fetch_20250910');
  assert.deepEqual(researchCalls[0].tools[0].allowed_domains, ['pella.com', 'www.pella.com', 'professional.pella.com', 'media.pella.com']);
  // research prompt carried only public product fields, never the quote prompt
  assert.doesNotMatch(researchCalls[0].messages[0].content, /Build the schedule/);
  // tool_result was fed back to the model
  assert.equal(intakeCalls[1].messages[2].role, 'user');
  assert.equal(intakeCalls[1].messages[2].content[0].type, 'tool_result');
  assert.equal(intakeCalls[1].messages[2].content[0].tool_use_id, 'tool_1');
  // attachment handling preserved
  assert.equal(intakeCalls[0].messages[0].content.filter(item => item.type === 'document').length, 1);
});

test('unavailable lookup produces no claimed sources and no footnote', async () => {
  const finalOutput = { summary: 'I could not confirm that size.', lines: [], removed_lines: [], settings_updates: [], questions: ['What is the max call size?'], unresolved_requirements: [], resolved_requirements: [], assumptions: [] };
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    if (body.tools?.[0]?.name === 'lookup_manufacturer_specs') {
      return {
        ok: true, status: 200, headers: { get: () => null },
        json: async () => ({ content: [{ type: 'text', text: '```json\n' + JSON.stringify(finalOutput) + '\n```' }] })
      };
    }
    return {
      ok: true, status: 200, headers: { get: () => null },
      json: async () => ({ content: [{ type: 'text', text: 'unknown', citations: [] }], stop_reason: 'end_turn' })
    };
  };
  const result = await invokeClaudeWindowQuote(
    { prompt: 'Build the schedule.', response_json_schema: { type: 'object', properties: { summary: { type: 'string' } } } },
    { apiKey: 'test-key', model: 'test-model', fetchImpl }
  );
  assert.equal(result.summary, 'I could not confirm that size.');
  assert.doesNotMatch(result.summary, /Manufacturer research/);
});