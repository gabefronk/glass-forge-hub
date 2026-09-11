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
