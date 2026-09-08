import { createClientFromRequest } from "npm:@base44/sdk@0.8.46";
import { createQuoteHandler } from "../../shared/windowQuotesCore.js";
import { execution } from "../../shared/windowQuoteScriptedRuntime.js";
// Intake v13: visual builder and canonical operations with resolved standard options.
export default createQuoteHandler({ getClient: createClientFromRequest, executionService: execution });