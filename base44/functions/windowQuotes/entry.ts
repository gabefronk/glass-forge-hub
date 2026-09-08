import { createClientFromRequest } from "npm:@base44/sdk@0.8.46";
import { createQuoteHandler } from "../../shared/windowQuotesCore.js";
import { execution } from "../../shared/windowQuoteScriptedRuntime.js";
// Intake v12: reviewed visual builder schedules and conversational AI guidance.
export default createQuoteHandler({ getClient: createClientFromRequest, executionService: execution });