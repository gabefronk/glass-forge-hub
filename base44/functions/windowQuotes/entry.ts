import { createClientFromRequest } from "npm:@base44/sdk@0.8.46";
import { createQuoteHandler } from "../../shared/windowQuotesCore.js";
import { execution } from "../../shared/windowQuoteAgentRuntime.js";
// Base44 Superagent is the only execution route. Local Codex worker actions are retired.
export default createQuoteHandler({ getClient: createClientFromRequest, executionService: execution });

// Dispatch v5: dedicated channel and concise complete clarification questions.
