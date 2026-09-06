import { createSuperagentTransport } from './superagentTransport.js';
import { createAgentExecution } from './windowQuoteAgentService.js';

const apiKey = Deno.env.get('WINDOW_QUOTES_SUPERAGENT_API_KEY');
export const transport = apiKey ? createSuperagentTransport({ apiKey }) : null;
export const execution = createAgentExecution({ transport });

