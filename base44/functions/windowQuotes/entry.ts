import { createClientFromRequest } from "npm:@base44/sdk@0.8.46";
import { createQuoteHandler } from "../../shared/windowQuotesCore.js";
import { execution } from "../../shared/windowQuoteScriptedRuntime.js";
// Conversational AI intake v10: standard preferences respect flush and frame-to-frame instructions.
export default createQuoteHandler({ getClient: createClientFromRequest, executionService: execution });