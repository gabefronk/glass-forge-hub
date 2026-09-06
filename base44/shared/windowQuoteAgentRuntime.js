import { createSuperagentTransport } from './superagentTransport.js';
import { createAgentExecution } from './windowQuoteAgentService.js';

const apiKey = Deno.env.get('WINDOW_QUOTES_SUPERAGENT_API_KEY');
export const transport = apiKey ? createSuperagentTransport({ apiKey }) : null;
// OFF unless the private deployment setting is explicitly "true". Existing runs
// do not opt in retroactively; the one-continuation pilot starts a new operation.
const continuationEnabled = Deno.env.get('WINDOW_QUOTES_CONTINUATIONS_ENABLED') === 'true';
// Even with the flag on, only this explicitly selected pilot request may opt in.
const continuationQuoteId = Deno.env.get('WINDOW_QUOTES_CONTINUATION_QUOTE_ID') || '';
export const execution = createAgentExecution({ transport, browserSlotId: '6a9dac833d04a18f0fd555f0', conversationId: '6a9db2ed143f8b28d5fbd6b3', continuationEnabled: !!transport && continuationEnabled, continuationLimit: 1, continuationQuoteIds: continuationQuoteId ? [continuationQuoteId] : [] });


