import { createClientFromRequest } from "npm:@base44/sdk@0.8.46";
import { createQuoteHandler } from "../../shared/windowQuotesCore.js";
import { execution } from "../../shared/windowQuoteScriptedRuntime.js";
// Conversational AI intake v8: verified regular-picture configuration and concise request clarifications.
export default createQuoteHandler({ getClient: createClientFromRequest, executionService: execution });