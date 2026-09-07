// STAGED ONLY: retain authenticated historical reporting, never new browser dispatch.
import { createSuperagentTransport } from './superagentTransport.js';
import { createAgentExecution } from './windowQuoteAgentService.js';

const apiKey = Deno.env.get('WINDOW_QUOTES_SUPERAGENT_API_KEY');
// Read-only admin diagnostics still use this transport. It is not passed to execution.
export const transport = apiKey ? createSuperagentTransport({ apiKey }) : null;
export const execution = createAgentExecution({ transport: null, browserSlotId: '6a9dac833d04a18f0fd555f0', conversationId: '6a9db2ed143f8b28d5fbd6b3', continuationEnabled: false });


