import { createClientFromRequest } from "npm:@base44/sdk@0.8.46";
import { createQuoteHandler } from "../../shared/windowQuotesCore.js";
import { execution } from "../../shared/windowQuoteScriptedRuntime.js";
// Conversational AI intake v11: native construction defaults and reviewed fresh retries.
export default createQuoteHandler({ getClient: createClientFromRequest, executionService: execution });