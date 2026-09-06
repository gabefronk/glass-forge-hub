import { createClientFromRequest } from "npm:@base44/sdk@0.8.46";
import { createAgentToolHandler } from "../../shared/windowQuoteAgentService.js";
import { execution } from "../../shared/windowQuoteAgentRuntime.js";
// Scoped Base44 operation capabilities; never accepts legacy worker keys.
export default createAgentToolHandler({ getClient: createClientFromRequest, execution });
