import { createClientFromRequest } from "npm:@base44/sdk@0.8.46";
import { createQuoteHandler } from "../../shared/windowQuotesCore.js";
import { execution } from "../../shared/windowQuoteScriptedRuntime.js";
// Conversational AI intake v7: preserve corrections and infer BFS only from its explicitly selected yard.
export default createQuoteHandler({ getClient: createClientFromRequest, executionService: execution });