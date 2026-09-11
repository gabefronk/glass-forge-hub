import test from 'node:test';
import assert from 'node:assert/strict';
import { createWindowQuoteBuilderHandler } from '../base44/shared/windowQuoteBuilder.js';

const adminClient = {
  auth: { me: async () => ({ id: 'admin-1', role: 'admin' }) },
  asServiceRole: { entities: {} }
};
const request = body => new Request('https://example.test/windowQuoteBuilder', {
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body)
});
const draft = {
  title: 'Attachment test',
  settings: { dealer: 'BFS', yard: 'BFS-UTAH DESIGN(11)', gross_margin: 30 },
  lines: [{
    id: 'w1',
    mark: 'W1',
    style: 'Studio Single Hung',
    qty: 1,
    width: 36,
    height: 60,
    units: 'in',
    dimension_basis: 'call',
    options: {}
  }],
  source: { amsco_configurator: { version: 1 } }
};

test('authenticated builder reports the actual assistant provider without requiring a draft', async () => {
  const status = { id: 'anthropic_claude', label: 'Claude AMSCO specialist', configured: false, model: 'claude-opus-5', fallback: 'Base44 AI' };
  const handler = createWindowQuoteBuilderHandler({
    getClient: async () => adminClient,
    normalizeAI: async () => { throw new Error('not called'); },
    assistantStatus: () => status
  });
  const response = await handler(request({ action: 'assistant_status' }));
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), status);
});

test('validated attachments are passed only to the specialist runtime', async () => {
  let runtimeContext;
  const handler = createWindowQuoteBuilderHandler({
    getClient: async () => adminClient,
    assistantStatus: () => ({ id: 'anthropic_claude', configured: true }),
    normalizeAI: async (quote, context) => {
      runtimeContext = context;
      return {
        ok: false,
        quote,
        issues: [],
        questions: ['Confirm the attached schedule.'],
        assistant_message: 'I read the attached schedule.',
        intake_assessment: {
          questions: ['Confirm the attached schedule.'],
          product_review: [],
          unresolved_requirements: [],
          assumptions: []
        }
      };
    }
  });
  const attachment = { url: 'https://files.example.test/window-plan.pdf?signature=temporary', name: 'window-plan.pdf', type: 'application/pdf', size: 2400 };
  const response = await handler(request({
    action: 'assist',
    draft,
    conversation: [{ role: 'user', content: 'Build this schedule.' }],
    unresolved_requirements: [],
    file_attachments: [attachment]
  }));
  assert.equal(response.status, 200);
  assert.deepEqual(runtimeContext.attachments, [{ ...attachment, index: 0 }]);
  assert.equal((await response.json()).assistant_provider.id, 'anthropic_claude');
});

test('oversized specialist attachments are rejected before any model call', async () => {
  let called = false;
  const handler = createWindowQuoteBuilderHandler({
    getClient: async () => adminClient,
    normalizeAI: async () => { called = true; }
  });
  const response = await handler(request({
    action: 'assist',
    draft,
    conversation: [{ role: 'user', content: 'Read this.' }],
    file_attachments: [{ url: 'https://files.example.test/large.pdf', name: 'large.pdf', type: 'application/pdf', size: 10000001 }]
  }));
  assert.equal(response.status, 400);
  assert.equal(called, false);
});
