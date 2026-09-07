import { createClientFromRequest } from "npm:@base44/sdk@0.8.46";
import { createQuoteHandler } from "../../shared/windowQuotesCore.js";
import { execution } from "../../shared/windowQuoteScriptedRuntime.js";
// Conversational AI intake v9: visible standard preferences and explicit instructions take priority.
export default createQuoteHandler({ getClient: createClientFromRequest, executionService: execution });