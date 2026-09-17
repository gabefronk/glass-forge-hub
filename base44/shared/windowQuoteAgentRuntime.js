// The online agent is the bounded fallback for complete configurations that are not yet in the deterministic price map.
import { createSuperagentTransport } from './superagentTransport.js';
import { createAgentExecution } from './windowQuoteAgentService.js';
import { createConfigurationAgentRouter } from './configurationAgentRouter.js';

// Cutover 2026-09-17: the Base44 Superagent connection is retired. Online dispatch is
// disabled; every line routes to the laptop runner's native path, and anything the
// native planners cannot price parks with clarification questions instead of dispatching.
const apiKey = null;
export const transport = apiKey ? createSuperagentTransport({ apiKey }) : null;
const options = { transport, browserSlotId: '6a9dac833d04a18f0fd555f0', conversationId: '6a9db2ed143f8b28d5fbd6b3' };
const legacy = createAgentExecution({ ...options, continuationEnabled: false });
export const packageOnlineExecution = createAgentExecution({ ...options, continuationEnabled: !!transport, continuationLimit: 6 });
export const execution = createConfigurationAgentRouter({ legacy, onlineExecution: packageOnlineExecution });
