import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
globalThis.crypto ??= webcrypto;

test('runtime needs exact flag plus selected request ID; all missing or nonexact settings remain off', async () => {
  const oldDeno = globalThis.Deno, oldFetch = globalThis.fetch;
  let scenario = 0;
  try {
    for (const settings of [
      {},
      { WINDOW_QUOTES_CONTINUATIONS_ENABLED: 'TRUE', WINDOW_QUOTES_CONTINUATION_QUOTE_ID: 'pilot-request' },
      { WINDOW_QUOTES_CONTINUATIONS_ENABLED: 'true' },
      { WINDOW_QUOTES_CONTINUATIONS_ENABLED: 'true', WINDOW_QUOTES_CONTINUATION_QUOTE_ID: 'different-request' },
      { WINDOW_QUOTES_CONTINUATIONS_ENABLED: 'true', WINDOW_QUOTES_CONTINUATION_QUOTE_ID: 'pilot-request' }
    ]) {
      const env = { WINDOW_QUOTES_SUPERAGENT_API_KEY: 'synthetic-runtime-test-key', ...settings };
      globalThis.Deno = { env: { get: name => env[name] } };
      const requests = [];
      globalThis.fetch = async (url, init) => {
        requests.push({ url, body: JSON.parse(init.body) });
        assert.equal(init.method, 'POST');
        assert.ok(url.endsWith('/conversations/6a9db2ed143f8b28d5fbd6b3/messages'));
        return new Response('{}', { status: 200 });
      };
      const { execution } = await import('../shared/windowQuoteAgentRuntime.js?test-case=' + (++scenario));
      const quote = { id: 'pilot-request', state_version: 0, input_revision: 1, requester_email: 'test@example.invalid', worker_status: 'draft', sales_status: 'open' };
      const slot = { id: '6a9dac833d04a18f0fd555f0', name: 'Base44 Window Quotes browser', busy_token: '', poll_generation: 0 };
      const db = Object.fromEntries(Object.entries({ QuoteRequests: quote, QuoteWorkers: slot }).map(([name, row]) => [name, {
        async filter(query) { return Object.entries(query).every(([key, value]) => row[key] === value) ? [structuredClone(row)] : []; },
        async updateMany(query, patch) {
          if (!Object.entries(query).every(([key, value]) => row[key] === value)) return { updated: 0 };
          Object.assign(row, structuredClone(patch.$set));return { updated: 1 };
        }
      }]));
      const current = await execution.afterInput({ db, q: quote });
      const expected = settings.WINDOW_QUOTES_CONTINUATIONS_ENABLED === 'true' && settings.WINDOW_QUOTES_CONTINUATION_QUOTE_ID === quote.id;
      assert.equal(current.agent_run.continuation_enabled === true, expected);
      assert.equal(current.agent_run.continuation_limit, expected ? 1 : undefined);
      assert.equal(current.worker_status, 'running');assert.equal(requests.length, 1);
      assert.equal(requests[0].body.content.includes('Automatic continuation is available'), expected);
    }
  } finally {
    globalThis.fetch = oldFetch;
    if (oldDeno === undefined) delete globalThis.Deno;else globalThis.Deno = oldDeno;
  }
});
