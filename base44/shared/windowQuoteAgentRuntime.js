// The online agent is the bounded fallback for complete configurations that are not yet in the deterministic price map.
import { createSuperagentTransport } from './superagentTransport.js';
import { createAgentExecution } from './windowQuoteAgentService.js';
import { createConfigurationAgentRouter } from './configurationAgentRouter.js';

const apiKey = globalThis.Deno?.env?.get('WINDOW_QUOTES_SUPERAGENT_API_KEY');
export const transport = apiKey ? createSuperagentTransport({ apiKey }) : null;
const options = { transport, browserSlotId: '6a9dac833d04a18f0fd555f0', conversationId: '6a9db2ed143f8b28d5fbd6b3' };
const legacy = createAgentExecution({ ...options, continuationEnabled: false });
export const packageOnlineExecution = createAgentExecution({ ...options, continuationEnabled: !!transport, continuationLimit: 6 });
export const execution = createConfigurationAgentRouter({ legacy, onlineExecution: packageOnlineExecution });
