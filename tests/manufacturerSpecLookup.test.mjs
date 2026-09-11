import test from 'node:test';
import assert from 'node:assert/strict';
import { lookupManufacturerSpecs, __testManufacturerSpecLookup } from '../base44/shared/manufacturerSpecLookup.js';

const { isAllowedHost } = __testManufacturerSpecLookup;

function anthropicResponse(content, stopReason = 'end_turn') {
  return {
    ok: true,
    status: 200,
    headers: { get: () => null },
    json: async () => ({ content, stop_reason: stopReason })
  };
}

function makeFetch(responses) {
  const calls = [];
  const impl = async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) });
    const next = responses.shift() || anthropicResponse([]);
    return typeof next === 'function' ? next(calls.at(-1)) : next;
  };
  impl.calls = calls;
  return impl;
}

test('isAllowedHost enforces https + brand domain match', () => {
  assert.equal(isAllowedHost('https://www.pella.com/x', 'Pella'), true);
  assert.equal(isAllowedHost('https://professional.pella.com/x', 'Pella'), true);
  assert.equal(isAllowedHost('https://apps.amscowindows.com/x', 'AMSCO'), true);
  assert.equal(isAllowedHost('http://www.pella.com/x', 'Pella'), false, 'non-https rejected');
  assert.equal(isAllowedHost('https://example.com/x', 'Pella'), false, 'off-domain rejected');
  assert.equal(isAllowedHost('https://apps.apple.com/us/app/pella-adm', 'Pella'), false, 'app store is not a spec source');
});

test('missing series returns needs_details without an outbound call', async () => {
  let called = 0;
  const result = await lookupManufacturerSpecs(
    { manufacturer: 'Pella', product: 'Single Hung', question: 'max size?' },
    { apiKey: 'k', fetchImpl: async () => { called++; return anthropicResponse([]); } }
  );
  assert.equal(result.status, 'needs_details');
  assert.equal(result.sources.length, 0);
  assert.equal(called, 0, 'no outbound call for missing input');
});

test('unknown manufacturer returns needs_details without an outbound call', async () => {
  let called = 0;
  const result = await lookupManufacturerSpecs(
    { manufacturer: 'Andersen', series: 'A', product: 'Single Hung', question: 'max size?' },
    { apiKey: 'k', fetchImpl: async () => { called++; return anthropicResponse([]); } }
  );
  assert.equal(result.status, 'needs_details');
  assert.equal(called, 0);
});

test('successful fetched + cited source returns found with evidence', async () => {
  const fetchImpl = makeFetch([anthropicResponse([
    { type: 'web_fetch_tool_result', url: 'https://www.pella.com/professionals/downloads/studio-spec.pdf', title: 'Pella Studio Spec', content: [{ type: 'web_fetch_result', text: 'Max call size 60 x 60.' }] },
    { type: 'text', text: 'The maximum call size is 60 x 60 inches.', citations: [{ type: 'web_fetch_tool_result', document_index: 0, start_char: 0, end_char: 36 }] }
  ])]);
  const result = await lookupManufacturerSpecs(
    { manufacturer: 'Pella', series: 'Studio', product: 'Single Hung', question: 'What is the maximum call size?' },
    { apiKey: 'k', fetchImpl }
  );
  assert.equal(result.status, 'found');
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].url, 'https://www.pella.com/professionals/downloads/studio-spec.pdf');
  assert.equal(result.sources[0].title, 'Pella Studio Spec');
  assert.match(result.sources[0].excerpt, /maximum call size/);
  assert.equal(result.context.manufacturer, 'Pella');
  // request used the web_fetch server tool with brand-restricted allowed_domains
  const req = fetchImpl.calls[0].body;
  assert.equal(req.tools[0].type, 'web_fetch_20250910');
  assert.equal(req.tools[0].max_uses, 3);
  assert.equal(req.tools[0].max_content_tokens, 18000);
  assert.deepEqual(req.tools[0].citations, { enabled: true });
  assert.deepEqual(req.tools[0].allowed_domains, ['pella.com', 'www.pella.com', 'professional.pella.com', 'media.pella.com']);
});

test('fetch error / no citation returns unavailable with no claimed facts', async () => {
  const fetchImpl = makeFetch([anthropicResponse([
    { type: 'web_fetch_tool_result', url: 'https://www.pella.com/x', title: 'x', content: [{ type: 'web_fetch_tool_result_error', text: 'blocked' }] },
    { type: 'text', text: 'I could not find a document.', citations: [] }
  ])]);
  const result = await lookupManufacturerSpecs(
    { manufacturer: 'Pella', series: 'Studio', product: 'Single Hung', question: 'max size?' },
    { apiKey: 'k', fetchImpl }
  );
  assert.equal(result.status, 'unavailable');
  assert.equal(result.sources.length, 0);
  assert.equal(result.answer, '', 'no claimed facts without a citation');
});

test('citation to a disallowed-domain document is rejected', async () => {
  const fetchImpl = makeFetch([anthropicResponse([
    { type: 'web_fetch_tool_result', url: 'https://apps.apple.com/us/app/pella-adm', title: 'App Store', content: [{ type: 'web_fetch_result', text: 'listing' }] },
    { type: 'text', text: 'See the app listing.', citations: [{ type: 'web_fetch_tool_result', document_index: 0, start_char: 0, end_char: 10 }] }
  ])]);
  const result = await lookupManufacturerSpecs(
    { manufacturer: 'Pella', series: 'Studio', product: 'Single Hung', question: 'max size?' },
    { apiKey: 'k', fetchImpl }
  );
  assert.equal(result.status, 'unavailable');
  assert.equal(result.sources.length, 0, 'app-store URL is not accepted as evidence');
});

test('pause_turn is bounded to one continuation with assistant blocks unchanged', async () => {
  const pausedContent = [
    { type: 'web_fetch_tool_result', url: 'https://www.amscowindows.com/architects/spec', title: 'AMSCO Spec', content: [{ type: 'web_fetch_result', text: 'Standard grid up to 48 x 72.' }] },
    { type: 'text', text: 'Researching…', citations: [] }
  ];
  const finalContent = [
    { type: 'text', text: 'Standard grid goes up to 48 x 72 inches call size.', citations: [{ type: 'web_fetch_tool_result', document_index: 0, start_char: 0, end_char: 44 }] }
  ];
  const fetchImpl = makeFetch([
    anthropicResponse(pausedContent, 'pause_turn'),
    anthropicResponse(finalContent, 'end_turn')
  ]);
  const result = await lookupManufacturerSpecs(
    { manufacturer: 'AMSCO', series: 'Studio', product: 'XO Slider', question: 'standard grid max?' },
    { apiKey: 'k', fetchImpl }
  );
  assert.equal(result.status, 'found');
  assert.equal(result.sources.length, 1);
  assert.equal(fetchImpl.calls.length, 2, 'exactly one continuation');
  // continuation re-sent the assistant blocks unchanged
  assert.deepEqual(fetchImpl.calls[1].body.messages[1], { role: 'assistant', content: pausedContent });
});

test('http error returns unavailable', async () => {
  const fetchImpl = makeFetch([{ ok: false, status: 500, headers: { get: () => null }, json: async () => ({}) }]);
  const result = await lookupManufacturerSpecs(
    { manufacturer: 'Pella', series: 'Studio', product: 'Single Hung', question: 'max size?' },
    { apiKey: 'k', fetchImpl }
  );
  assert.equal(result.status, 'unavailable');
});

test('unconfigured key returns unavailable without a call', async () => {
  let called = 0;
  const result = await lookupManufacturerSpecs(
    { manufacturer: 'Pella', series: 'Studio', product: 'Single Hung', question: 'max size?' },
    { apiKey: '', fetchImpl: async () => { called++; return anthropicResponse([]); } }
  );
  assert.equal(result.status, 'unavailable');
  assert.equal(called, 0);
});