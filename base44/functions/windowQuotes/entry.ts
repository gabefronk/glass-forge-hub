import { createClientFromRequest } from "npm:@base44/sdk@0.8.46";
import { createQuoteHandler } from "../../shared/windowQuotesCore.js";
import { execution } from "../../shared/windowQuoteScriptedRuntime.js";
// Intake v14: canonical operations with verified warm engine contract ce17adad + private native price previews.
export default createQuoteHandler({ getClient: createClientFromRequest, executionService: execution });