import test from 'node:test';
import assert from 'node:assert/strict';
import { lookupManufacturerSpecs, __testManufacturerSpecLookup } from '../base44/shared/manufacturerSpecLookup.js';

const { isAllowedHost, collectDocuments, extractCitations, validCitation } = __testManufacturerSpecLookup;

// Native Anthropic web-fetch block builders (actual response format).
function fetchResult({ tool_use_id = 'srvtoolu_1', url, title, data, retrieved_at }) {
  return {
    type: 'web_fetch_tool_result',
    tool_use_id,
    content: {
      type: 'web_fetch_result',
      url,
      content: {
        type: 'document',
        title,
        source: { type: 'text', media_type: 'text/plain', data },
        citations: { enabled: true }
      },
      retrieved_at
    }
  };
}
function fetchErrorBlock({ tool_use_id = 'srvtoolu_1', error_code = 'url_not_accessible' }) {
  return { type: 'web_fetch_tool_result', tool_use_id, content: { type: 'web_fetch_tool_result_error', error_code } };
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
function pageCitation(document_index, cited_text, start_page_number = 1, title = 'Doc') {
  return { type: 'page_location', document_index, document_title: title, start_page_number, end_page_number: start_page_number, cited_text };
}

function anthropicResponse(content, stopReason = 'end_turn') {
  return { ok: true, status: 200, headers: { get: () => null }, json: async () => ({ content, stop_reason: stopReason }) };
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
function delay(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

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

test('ordinal document index is among fetched documents, not assistant block position; excerpt comes from cited_text', async () => {
  // text + server_tool_use precede the fetch result, so the fetch result is at
  // block position 2 but must be document_index 0.
  const content = [
    textBlock("I'll fetch the SpecFinder page to find the vinyl colors."),
    serverToolUse({ url: 'https://apps.amscowindows.com/' }),
    fetchResult({ url: 'https://apps.amscowindows.com/', title: 'AMSCO SpecFinder', data: 'White, Almond, Taupe', retrieved_at: '2026-09-11T12:00:00Z' }),
    textBlock('The listed vinyl colors are White, Almond, Taupe.', [charCitation(0, 'White, Almond, Taupe', 'AMSCO SpecFinder')])
  ];
  const fetchImpl = makeFetch([anthropicResponse(content)]);
  const result = await lookupManufacturerSpecs(
    { manufacturer: 'AMSCO', series: 'Studio', product: 'Single Hung', question: 'Which vinyl colors are listed in SpecFinder?' },
    { apiKey: 'k', fetchImpl }
  );
  assert.equal(result.status, 'found');
  assert.equal(result.sources.length, 1);
  assert.equal(result.sources[0].url, 'https://apps.amscowindows.com/');
  assert.equal(result.sources[0].title, 'AMSCO SpecFinder');
  assert.equal(result.sources[0].retrieved_at, '2026-09-11T12:00:00Z', 'provider retrieved_at preserved');
  assert.equal(result.sources[0].excerpt, 'White, Almond, Taupe', 'excerpt is cited_text, not a slice of the answer');
  assert.equal(result.sources[0].document_index, 0);
  // answer contains only the cited text block, not the uncited "I'll fetch" prose
  assert.equal(result.answer, 'The listed vinyl colors are White, Almond, Taupe.');
  assert.equal(result.context.retrieved_at, '2026-09-11T12:00:00Z', 'context retrieved_at is the provider value, not fabricated');
  // request used the web_fetch server tool with brand-restricted allowed_domains
  const req = fetchImpl.calls[0].body;
  assert.equal(req.tools[0].type, 'web_fetch_20250910');
  assert.equal(req.tools[0].max_uses, 3);
  assert.equal(req.tools[0].max_content_tokens, 18000);
  assert.deepEqual(req.tools[0].citations, { enabled: true });
  assert.deepEqual(req.tools[0].allowed_domains, ['amscowindows.com', 'www.amscowindows.com', 'apps.amscowindows.com']);
});

test('page_location citation on a PDF document yields a page number', async () => {
  const content = [
    fetchResult({ url: 'https://www.pella.com/professionals/downloads/studio-spec.pdf', title: 'Pella Studio Spec', data: 'page 4: max call 60 x 60', retrieved_at: '2026-09-11T12:00:00Z' }),
    textBlock('Maximum call size is 60 x 60 inches.', [pageCitation(0, 'max call 60 x 60', 4, 'Pella Studio Spec')])
  ];
  const result = await lookupManufacturerSpecs(
    { manufacturer: 'Pella', series: 'Studio', product: 'Single Hung', question: 'max call size?' },
    { apiKey: 'k', fetchImpl: makeFetch([anthropicResponse(content)]) }
  );
  assert.equal(result.status, 'found');
  assert.equal(result.sources[0].page, 4);
  assert.equal(result.sources[0].excerpt, 'max call 60 x 60');
});

test('disallowed-domain document keeps its index slot; citation to the valid later document still resolves', async () => {
  // doc 0 is an app-store URL (disallowed), doc 1 is a valid Pella PDF. The
  // citation document_index:1 must map to the Pella doc, not shift onto doc 0.
  const content = [
    fetchResult({ url: 'https://apps.apple.com/us/app/pella-adm', title: 'App Store', data: 'listing', retrieved_at: '2026-09-11T12:00:00Z' }),
    fetchResult({ url: 'https://www.pella.com/professionals/downloads/studio.pdf', title: 'Pella Studio Spec', data: 'Max call 60 x 60.', retrieved_at: '2026-09-11T12:01:00Z' }),
    textBlock('Max call size is 60 x 60 inches.', [charCitation(1, 'Max call 60 x 60.', 'Pella Studio Spec')])
  ];
  const result = await lookupManufacturerSpecs(
    { manufacturer: 'Pella', series: 'Studio', product: 'Single Hung', question: 'max call size?' },
    { apiKey: 'k', fetchImpl: makeFetch([anthropicResponse(content)]) }
  );
  assert.equal(result.status, 'found');
  assert.equal(result.sources.length, 1, 'only the allowlisted document is evidence');
  assert.equal(result.sources[0].url, 'https://www.pella.com/professionals/downloads/studio.pdf');
  assert.equal(result.sources[0].document_index, 1, 'index alignment preserved across the disallowed slot');
});

test('citation to a disallowed-domain document index is rejected', async () => {
  const content = [
    fetchResult({ url: 'https://apps.apple.com/us/app/pella-adm', title: 'App Store', data: 'listing', retrieved_at: '2026-09-11T12:00:00Z' }),
    textBlock('See the app listing.', [charCitation(0, 'listing', 'App Store')])
  ];
  const result = await lookupManufacturerSpecs(
    { manufacturer: 'Pella', series: 'Studio', product: 'Single Hung', question: 'max size?' },
    { apiKey: 'k', fetchImpl: makeFetch([anthropicResponse(content)]) }
  );
  assert.equal(result.status, 'unavailable');
  assert.equal(result.sources.length, 0, 'app-store URL is not accepted as evidence');
});

test('fetch error returns unavailable with no claimed facts', async () => {
  const content = [
    fetchErrorBlock({ error_code: 'url_not_accessible' }),
    textBlock('I could not find a document.', [])
  ];
  const result = await lookupManufacturerSpecs(
    { manufacturer: 'Pella', series: 'Studio', product: 'Single Hung', question: 'max size?' },
    { apiKey: 'k', fetchImpl: makeFetch([anthropicResponse(content)]) }
  );
  assert.equal(result.status, 'unavailable');
  assert.equal(result.sources.length, 0);
  assert.equal(result.answer, '', 'no claimed facts without a citation');
});

test('uncited answer prose is not returned as evidence', async () => {
  const content = [
    fetchResult({ url: 'https://www.pella.com/professionals/downloads/studio.pdf', title: 'Pella Studio Spec', data: 'Max call 60 x 60.', retrieved_at: '2026-09-11T12:00:00Z' }),
    textBlock('The maximum call size is 60 x 60 inches.', [charCitation(0, 'Max call 60 x 60.', 'Pella Studio Spec')]),
    textBlock('I believe it also comes in Bronze, but I am not certain.', [])
  ];
  const result = await lookupManufacturerSpecs(
    { manufacturer: 'Pella', series: 'Studio', product: 'Single Hung', question: 'max size?' },
    { apiKey: 'k', fetchImpl: makeFetch([anthropicResponse(content)]) }
  );
  assert.equal(result.status, 'found');
  assert.equal(result.answer, 'The maximum call size is 60 x 60 inches.', 'uncited prose block is excluded');
});

test('unknown fact (model states unknown, no citation) returns unavailable', async () => {
  const content = [
    textBlock('The documents do not establish a triple-pane glazing option; this is unknown.', [])
  ];
  const result = await lookupManufacturerSpecs(
    { manufacturer: 'Pella', series: 'Impervia', product: 'Casement', question: 'Does the ADM list triple-pane glazing as an option?' },
    { apiKey: 'k', fetchImpl: makeFetch([anthropicResponse(content)]) }
  );
  assert.equal(result.status, 'unavailable');
  assert.equal(result.sources.length, 0);
  assert.equal(result.answer, '');
});

test('missing retrieved_at timestamp rejects the document (no fabricated date)', async () => {
  const content = [
    fetchResult({ url: 'https://www.pella.com/professionals/downloads/studio.pdf', title: 'Pella Studio Spec', data: 'Max call 60 x 60.', retrieved_at: '' }),
    textBlock('Max call size is 60 x 60 inches.', [charCitation(0, 'Max call 60 x 60.', 'Pella Studio Spec')])
  ];
  const result = await lookupManufacturerSpecs(
    { manufacturer: 'Pella', series: 'Studio', product: 'Single Hung', question: 'max call size?' },
    { apiKey: 'k', fetchImpl: makeFetch([anthropicResponse(content)]) }
  );
  assert.equal(result.status, 'unavailable', 'a document without a provider timestamp is not evidence');
  assert.equal(result.sources.length, 0);
});

test('pause_turn preserves fetched documents across the continuation', async () => {
  const pausedContent = [
    fetchResult({ url: 'https://www.amscowindows.com/architects/spec', title: 'AMSCO Spec', data: 'Standard grid up to 48 x 72.', retrieved_at: '2026-09-11T12:00:00Z' }),
    textBlock('Researching…', [])
  ];
  const finalContent = [
    textBlock('Standard grid goes up to 48 x 72 inches call size.', [charCitation(0, 'Standard grid up to 48 x 72.', 'AMSCO Spec')])
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
  assert.equal(result.sources[0].url, 'https://www.amscowindows.com/architects/spec');
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

test('deadline exceeded mid-fetch returns unavailable', async () => {
  let called = 0;
  const result = await lookupManufacturerSpecs(
    { manufacturer: 'Pella', series: 'Studio', product: 'Single Hung', question: 'max size?' },
    { apiKey: 'k', deadlineAt: Date.now() + 4000, fetchImpl: async () => { called++; await delay(5000); return anthropicResponse([]); } }
  );
  assert.equal(result.status, 'unavailable');
  assert.match(result.clarification, /Timed out/);
  assert.equal(called, 1);
});

test('deadline already expired returns unavailable without calling', async () => {
  let called = 0;
  const result = await lookupManufacturerSpecs(
    { manufacturer: 'Pella', series: 'Studio', product: 'Single Hung', question: 'max size?' },
    { apiKey: 'k', deadlineAt: Date.now(), fetchImpl: async () => { called++; return anthropicResponse([]); } }
  );
  assert.equal(result.status, 'unavailable');
  assert.match(result.clarification, /timed out/i);
  assert.equal(called, 0);
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

test('validCitation rejects bad type, out-of-range index, and failed documents', () => {
  const docs = [];
  collectDocuments([
    fetchResult({ url: 'https://apps.apple.com/x', title: 'App Store', data: 'x', retrieved_at: '2026-09-11T12:00:00Z' }),
    fetchResult({ url: 'https://www.pella.com/x', title: 'Pella', data: 'y', retrieved_at: '2026-09-11T12:00:00Z' })
  ], 'Pella', docs);
  assert.equal(docs.length, 2);
  assert.equal(docs[0].success, false, 'disallowed domain is not successful');
  assert.equal(docs[1].success, true);
  assert.equal(validCitation({ type: 'char_location', document_index: 0, cited_text: 'x' }, docs), null, 'disallowed doc rejected');
  assert.equal(validCitation({ type: 'char_location', document_index: 5, cited_text: 'x' }, docs), null, 'out-of-range index rejected');
  assert.equal(validCitation({ type: 'web_search_result', document_index: 1, cited_text: 'x' }, docs), null, 'bad citation type rejected');
  assert.equal(validCitation({ type: 'char_location', document_index: 1, cited_text: 'y' }, docs)?.doc.url, 'https://www.pella.com/x');
});